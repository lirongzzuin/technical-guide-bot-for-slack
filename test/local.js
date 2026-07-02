import crypto from 'node:crypto';
import worker from '../index.js';

const TEST_SECRET = 'test_signing_secret_32byteslong!!';
const env = {
  SLACK_SIGNING_SECRET: TEST_SECRET,
  SLACK_BOT_TOKEN: 'xoxb-test-token',
  SUGGESTION_CHANNEL_ID: 'C123TEST',
};

// Intercept all Slack API calls.
// chat.postMessage returns a fake ts so postGuideToChannel can thread correctly.
const apiCalls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (typeof url === 'string' && url.startsWith('https://slack.com/api/')) {
    const endpoint = url.split('/api/')[1];
    const body = JSON.parse(options?.body ?? '{}');
    apiCalls.push({ endpoint, body });
    const mockData = { ok: true };
    if (endpoint === 'chat.postMessage') mockData.ts = '1111111111.000001';
    return new Response(JSON.stringify(mockData), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return originalFetch(url, options);
};

// ctx mock: collects waitUntil promises so tests can await them
function makeCtx() {
  const promises = [];
  return {
    ctx: { waitUntil: (p) => promises.push(p) },
    flush: () => Promise.all(promises),
  };
}

function makeSlashRequest(text, opts = {}) {
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const command = opts.command ?? '%2F%EC%83%B5%EB%A7%81%EC%BB%A4'; // /샵링커
  const body = [
    `command=${command}`,
    `text=${encodeURIComponent(text)}`,
    `user_id=U99999`,
    `channel_id=C_TEST_CHAN`,
  ].join('&');
  const sig = 'v0=' + crypto
    .createHmac('sha256', opts.secret ?? TEST_SECRET)
    .update(`v0:${timestamp}:${body}`, 'utf8')
    .digest('hex');
  return new Request('https://example.com/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': String(timestamp),
      'x-slack-signature': opts.wrongSig ? 'v0=badsig' : sig,
    },
    body,
  });
}

function makeEventRequest(payload) {
  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = 'v0=' + crypto
    .createHmac('sha256', TEST_SECRET)
    .update(`v0:${timestamp}:${rawBody}`, 'utf8')
    .digest('hex');
  return new Request('https://example.com/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-slack-request-timestamp': String(timestamp),
      'x-slack-signature': sig,
    },
    body: rawBody,
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? 'assertion failed');
}

// 가이드 응답은 모두 ephemeral. 응답 본문을 받아 반환한다.
async function expectEphemeral(res) {
  const data = await res.json();
  assert(data.response_type === 'ephemeral', `ephemeral 아님: ${JSON.stringify(data).slice(0, 100)}`);
  return data.text;
}

async function run() {
  let passed = 0;
  let failed = 0;

  async function test(label, fn) {
    apiCalls.length = 0;
    try {
      await fn();
      passed++;
      console.log(`[PASS] ${label}`);
    } catch (e) {
      failed++;
      console.log(`[FAIL] ${label}\n       ${e.message}`);
    }
  }

  // ── /샵링커 가이드 키워드: 채널 제목 + 쓰레드 내용 ────────────────

  await test('계정변경 → ephemeral 본문에 가이드 표시 (채널 게시 X)', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('계정변경'), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    // 채널에는 봇 메시지가 게시되지 않아야 함
    const posts = apiCalls.filter(c => c.endpoint === 'chat.postMessage');
    assert(posts.length === 0, `채널 게시 X 이어야 함, 실제: ${posts.length}회`);
    assert(body.includes('계정 변경'), `제목 누락: ${body.slice(0, 60)}`);
    assert(body.includes('진행 절차'), `본문 누락: ${body.slice(0, 60)}`);
  });

  await test('수집기준 → ephemeral 본문에 가이드 표시', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('수집기준'), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    const posts = apiCalls.filter(c => c.endpoint === 'chat.postMessage');
    assert(posts.length === 0);
    assert(body.includes('수집 일수'));
    assert(body.includes('스마트스토어'));
  });

  await test('수집시간 → ephemeral 본문에 가이드 표시', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('수집시간'), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    const posts = apiCalls.filter(c => c.endpoint === 'chat.postMessage');
    assert(posts.length === 0);
    assert(body.includes('수집 시간'));
    assert(body.includes('계정 구분'));
  });

  // ── ephemeral 케이스: 본인에게만 표시 ────────────────────

  await test('help → ephemeral', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('help'), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('샵링커 가이드'));
  });

  await test('빈 문자열 → ephemeral help', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest(''), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
  });

  await test('앞뒤 공백 → trim 후 채널 게시', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('  계정변경  '), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
  });

  await test('알 수 없는 키워드 → ephemeral 경고', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('모르는키워드'), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('알 수 없는 키워드'));
  });

  await test('건의 (내용 없음) → ephemeral 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('건의'), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('건의 방법'));
  });

  await test('건의 (내용 있음) → 구조화 양식으로 채널 전송 + ephemeral 확인', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('건의 배송 지연 기준 가이드가 필요합니다'), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('접수'));
    const call = apiCalls.find(c => c.endpoint === 'chat.postMessage');
    assert(call, 'chat.postMessage 미호출');
    assert(call.body.channel === 'C123TEST');
    assert(call.body.text.includes('[새 가이드 건의]'), '제목 누락');
    assert(call.body.text.includes('<@U99999>'), '건의자 누락');
    assert(call.body.text.includes('<#C_TEST_CHAN>'), '채널 누락');
    assert(call.body.text.includes('KST'), '접수 시각 누락');
    assert(call.body.text.includes('배송 지연 기준 가이드가 필요합니다'), '건의 내용 누락');
    assert(call.body.text.includes('/샵링커'), '명령어 누락');
  });

  await test('건의 (채널 미설정) → ephemeral 오류', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('건의 새 가이드'), { SLACK_SIGNING_SECRET: TEST_SECRET, SLACK_BOT_TOKEN: 'xoxb-test' }, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.text.includes('설정되지 않았습니다'));
  });

  await test('SLACK_BOT_TOKEN 미설정 → ephemeral 폴백', async () => {
    const { ctx, flush } = makeCtx();
    const envNoToken = { SLACK_SIGNING_SECRET: TEST_SECRET };
    const res = await worker.fetch(makeSlashRequest('계정변경'), envNoToken, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('계정 변경'));
  });

  // ── 중복 방지 ─────────────────────────────────────────────

  await test('Slack 재시도 헤더 → API 호출 없이 200', async () => {
    const { ctx, flush } = makeCtx();
    const timestamp = Math.floor(Date.now() / 1000);
    const body = `command=%2F%EC%83%B5%EB%A7%81%EC%BB%A4&text=%EA%B3%84%EC%A0%95%EB%B3%80%EA%B2%BD&user_id=U99999&channel_id=C_TEST_CHAN`;
    const sig = 'v0=' + crypto.createHmac('sha256', TEST_SECRET).update(`v0:${timestamp}:${body}`, 'utf8').digest('hex');
    const req = new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-slack-request-timestamp': String(timestamp),
        'x-slack-signature': sig,
        'x-slack-retry-num': '1',
        'x-slack-retry-reason': 'http_timeout',
      },
      body,
    });
    const res = await worker.fetch(req, env, ctx);
    await flush();
    assert(res.status === 200);
    assert(apiCalls.length === 0, `재시도 시 API 호출 없어야 함, 실제: ${apiCalls.length}회`);
  });

  // ── 보안 / 엣지 케이스 ────────────────────────────────────

  await test('ssl_check → 서명 없이 200', async () => {
    const { ctx, flush } = makeCtx();
    const req = new Request('https://example.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'ssl_check=1&token=legacy',
    });
    const res = await worker.fetch(req, {}, ctx);
    await flush();
    assert(res.status === 200);
  });

  await test('잘못된 서명 → 401', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('계정변경', { wrongSig: true }), env, ctx);
    await flush();
    assert(res.status === 401);
  });

  await test('만료된 타임스탬프 → 401', async () => {
    const { ctx, flush } = makeCtx();
    const ts = Math.floor(Date.now() / 1000) - 400;
    const res = await worker.fetch(makeSlashRequest('계정변경', { timestamp: ts }), env, ctx);
    await flush();
    assert(res.status === 401);
  });

  await test('SIGNING_SECRET 미설정 → 500', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('계정변경'), {}, ctx);
    await flush();
    assert(res.status === 500);
  });

  // ── Events API ────────────────────────────────────────────

  await test('url_verification → challenge 반환', async () => {
    const { ctx, flush } = makeCtx();
    const req = new Request('https://example.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'url_verification', challenge: 'abc123xyz' }),
    });
    const res = await worker.fetch(req, env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.challenge === 'abc123xyz', `challenge 불일치: ${data.challenge}`);
  });

  await test('app_home_opened → views.publish 호출', async () => {
    const { ctx, flush } = makeCtx();
    const req = makeEventRequest({ type: 'event_callback', event: { type: 'app_home_opened', user: 'U12345' } });
    const res = await worker.fetch(req, env, ctx);
    await flush();
    assert(res.status === 200);
    const call = apiCalls.find(c => c.endpoint === 'views.publish');
    assert(call, 'views.publish 미호출');
    assert(call.body.user_id === 'U12345');
  });

  // ── /샵링커 멀티 커맨드 라우팅 ────────────────────────────────────

  await test('/할당 help → 할당 도메인 help', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('help', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('/할당'), `할당 help 누락: ${data.text.slice(0, 60)}`);
  });

  await test('/할당 빈 키워드 → 할당 도메인 help', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('/할당'));
  });

  await test('/할당 건의 → 명령어 필드에 할당 포함', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('건의 새로운 할당 기준이 필요합니다', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('접수'));
    const call = apiCalls.find(c => c.endpoint === 'chat.postMessage');
    assert(call, 'chat.postMessage 미호출');
    assert(call.body.text.includes('/할당'), '명령어 필드 누락');
  });

  await test('미등록 명령어 → ephemeral 오류', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('test', { command: '%2F%EB%AF%B8%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('등록되지 않은 명령어'));
  });

  // ── /할당 실제 가이드 콘텐츠 ────────────────────────────────

  await test('/할당 실패사유 → 전체 카테고리 목록', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('실패사유', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    // 주요 카테고리 키워드 검증
    assert(body.includes('사전확인'));
    assert(body.includes('재고부족'));
    assert(body.includes('전용재고'));
    assert(body.includes('주소정제'));
    assert(body.includes('SKU필수정보'));
    assert(body.includes('송장timeout'));
  });

  await test('/할당 사전확인 → 사전 점검 2가지 항목 포함', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('사전확인', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('주문일시 10일 초과'));
    assert(body.includes('할당 변경 이력'));
  });

  await test('/할당 재고부족 → 운영자/판매자 콘솔 경로 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('재고부족', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('가용재고'));
    assert(body.includes('운영자 콘솔'));
    assert(body.includes('판매자 콘솔'));
  });

  await test('/할당 전용재고 → 일반 주문·전용 채널 상황 분기', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('전용재고', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('전용 재고'));
    assert(body.includes('일반 주문'));
  });

  await test('/할당 보충필요 → 피킹 로케이션 이동 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('보충필요', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('피킹'));
    assert(body.includes('재고이동') || body.includes('재고 이동'));
  });

  await test('/할당 주소정제 → ADDR-4001 에러 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('주소정제', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('ADDR-4001'));
    assert(body.includes('수동 정상화'));
  });

  await test('/할당 전화번호 → LBL-1290 & 형식 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('전화번호', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('LBL-1290'));
    assert(body.includes('3-4-4'));
  });

  await test('/할당 주소길이초과 → 150Byte / 300Byte 한도', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('주소길이초과', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('150 Byte'));
    assert(body.includes('300 Byte'));
  });

  await test('/할당 SKU필수정보 → 4종 정보 (영문이름·HS코드·원산지·성분)', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('SKU필수정보', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('영문이름'));
    assert(body.includes('HS 코드'));
    assert(body.includes('원산지'));
    assert(body.includes('성분') || body.includes('재질'));
  });

  await test('/할당 SKU체적 → 가로·세로·높이·무게', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('SKU체적', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('가로'));
    assert(body.includes('세로'));
    assert(body.includes('높이'));
    assert(body.includes('무게'));
  });

  await test('/할당 사은품송장 → 송장당 최대 출고 수량 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('사은품송장', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('송장당 최대 출고 수량'));
    assert(body.includes('할당 제어'));
  });

  await test('/할당 송장timeout → 자동 재시도 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('송장timeout', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('timeout'));
    assert(body.includes('기다려'));
  });

  await test('/할당 국가코드 → 배송 규칙 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('국가코드', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('배송 규칙'));
  });

  await test('/할당 통관금액 → 해외 출고 통관 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('통관금액', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('통관 기본 금액'));
  });

  await test('/할당 우편번호 → 해외 우편번호 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('우편번호', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('배송 가능 우편번호'));
  });

  await test('/할당 송화인정보 → 영문 송화인명·연락처 경로', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('송화인정보', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('영문 송화인명'));
    assert(body.includes('대표 전화번호'));
  });

  await test('/할당 주문일시초과 → 수동 할당 요청 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('주문일시초과', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('10일'));
    assert(body.includes('수동 할당'));
  });

  await test('/할당 주문취소 → 목록 제거 요청 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('주문취소', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('목록 제거 요청'));
  });

  await test('/할당 취소개별주문 → 수기 주문 출고 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('취소개별주문', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('수기 주문'));
  });

  await test('/할당 해외주소 → 현지 우편번호 검색 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('해외주소', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('해외'));
    assert(body.includes('invalid address') || body.includes('우편번호'));
  });

  await test('/할당 부분 검색 SKU → SKU필수정보+SKU체적 매칭', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('SKU', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('SKU필수정보'));
    assert(data.text.includes('SKU체적'));
  });

  // 이모지 회귀 방지 — 모든 새 할당 가이드에 장식용 이모지가 없어야 함
  await test('할당 가이드 전체 — 장식용 이모지 회귀 방지', async () => {
    const allocation = (await import('../guides/allocation.js')).default;
    for (const [k, v] of Object.entries(allocation.guides)) {
      if (/[📋✅🔗📖🔓⚠️💡🛒🕓🕛🔍]/.test(v)) {
        throw new Error(`할당.${k} 가이드에 장식 이모지 포함됨`);
      }
    }
  });

  // ── /판매처등록 (xlsx 기반 자동 생성) ───────────────────────

  await test('/판매처등록 help → ephemeral (지원 판매처 목록 포함)', async () => {
    const { ctx, flush } = makeCtx();
    // URL encode: /판매처등록 = %2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D
    const res = await worker.fetch(makeSlashRequest('help', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('/판매처등록'));
    assert(data.text.includes('쿠팡'), '판매처 목록 누락');
  });

  await test('/판매처등록 쿠팡 → 슬랙 형식 검증 (헤더·계정정보·빠른링크)', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('쿠팡', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('*쿠팡*'), '헤더 판매처명 누락');
    assert(body.includes('샵링커 연동 필요 정보'), '헤더 텍스트 누락');
    assert(body.includes('*필요 계정 정보*'), '계정 정보 섹션 누락');
    assert(body.includes('• Access Key'), 'Access Key 누락');
    assert(body.includes('• 업체코드'), '업체코드 누락');
    assert(body.includes('*빠른 링크*'), '빠른 링크 섹션 누락');
    assert(body.includes('|설정 가이드 보기>'), '설정 가이드 라벨 누락');
    assert(body.includes('|어드민 바로가기>'), '어드민 라벨 누락');
    assert(!body.includes('*비고*'), '쿠팡은 완전 정보이므로 비고가 없어야 함');
    // 이모지 회귀 방지
    assert(!/[📋✅🔗📖🔓⚠️💡]/.test(body), '장식용 이모지가 포함됨');
  });

  await test('/판매처등록 지마켓 → 채널 게시 (마스터 아이디 포함)', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('지마켓', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('마스터 아이디'));
  });

  await test('/판매처등록 11번가 → 채널 게시', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('11번가', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('api key'));
  });

  await test('/판매처등록 SSG → 가이드 2개일 때 번호 라벨', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('SSG', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('API인증키'));
    assert(body.includes('|설정 가이드 1 보기>'), '가이드1 라벨 누락');
    assert(body.includes('|설정 가이드 2 보기>'), '가이드2 라벨 누락');
  });

  await test('/판매처등록 지그재그 → 채널 게시 (별칭 포함)', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('지그재그', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('Access Key'));
  });

  await test('/판매처등록 포스티 → 지그재그 별칭으로 채널 게시', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('포스티', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
  });

  await test('/판매처등록 롯데 → 부분 검색 3건 ephemeral', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('롯데', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('롯데백화점'), '롯데백화점 누락');
    assert(data.text.includes('롯데홈쇼핑'), '롯데홈쇼핑 누락');
    assert(data.text.includes('롯데온'), '롯데온 누락');
    assert(data.text.includes('검색 결과'), '검색 결과 문구 누락');
    // 마크다운 형식 검증 (별표 비대칭 버그 회귀 방지)
    const headerMatch = data.text.match(/\*`롯데` 검색 결과 \(\d+건\)\*/);
    assert(headerMatch, `검색 결과 헤더 마크다운 형식 오류: ${data.text.slice(0, 80)}`);
  });

  await test('/판매처등록 SI빌리지 → 별칭(신세계V) 매칭', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('SI빌리지', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('신세계V'), '신세계V 가이드 본문 누락');
  });

  await test('/판매처등록 이마트 → 별칭(SSG) 매칭', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('이마트', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('SSG'));
  });

  await test('/판매처등록 신세계닷컴 → 별칭(SSG) 매칭', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('신세계닷컴', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('SSG'));
  });

  await test('/판매처등록 11 → 부분 검색이 1건이면 바로 채널 게시', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('11', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('11번가'));
  });

  await test('/판매처등록 부분 검색 BOT_TOKEN 없을 때 → ephemeral 폴백', async () => {
    const { ctx, flush } = makeCtx();
    const envNoToken = { SLACK_SIGNING_SECRET: TEST_SECRET };
    const res = await worker.fetch(makeSlashRequest('11', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), envNoToken, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('11번가'));
  });

  await test('/판매처등록 빈 입력 → ephemeral help (61개 판매처 표시)', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    const m = data.text.match(/지원 판매처 \((\d+)개\)/);
    assert(m, '판매처 개수 표시 누락');
    assert(Number(m[1]) >= 60, `판매처 수 부족 (실제: ${m[1]})`);
  });

  // ── 비고 (어드민/가이드 누락, 카테고리 특이사항) ──────────

  await test('/판매처등록 알리익스프레스 → "어드민 확인 불가" 카테고리 비고', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('알리익스프레스', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('알리익스프레스'));
    assert(body.includes('*비고*'), '비고 섹션 헤더 누락');
    assert(body.includes('어드민 URL이 미확인된 판매처'), '카테고리 비고 누락');
    assert(!body.includes('|어드민 바로가기>'), '없는 어드민 링크가 표시됨');
  });

  await test('/판매처등록 이랜드몰 → "쇼핑몰 확인 불가" 카테고리 비고', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('이랜드몰', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('쇼핑몰 운영 또는 어드민 접근이 미확인'), '카테고리 비고 누락');
  });

  await test('/판매처등록 갤러리아 → "쇼핑몰 확인 불가" 카테고리 비고', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('갤러리아', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('갤러리아'));
    assert(body.includes('쇼핑몰 운영 또는 어드민 접근이 미확인'));
  });

  await test('/판매처등록 퀸잇 → 가이드 없음 비고만 표시', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('퀸잇', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('|어드민 바로가기>'), '어드민 링크 누락');
    assert(body.includes('별도 설정 가이드가 없습니다'), '가이드 누락 비고 부재');
    assert(!body.includes('설정 가이드 보기'), '없는 가이드 링크 표시됨');
  });

  await test('/판매처등록 패션플러스 → 안내 문구(blockquote)가 포함', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('패션플러스', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    // blockquote(>) 형식으로 안내 문구가 들어가야 함
    assert(/^> 접속 유형이 브랜드 관리자/m.test(body), '안내 문구가 blockquote 형식이 아님');
    // 안내 문구는 계정 정보 불릿에 섞여 들어가면 안 됨
    assert(!body.includes('• 접속 유형'), '안내 문구가 계정 정보로 잘못 분류됨');
  });

  await test('/판매처등록 삼성 → 부분 검색 여러 건 ephemeral', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('삼성', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('삼성'), '삼성 관련 결과 누락');
  });

  await test('/판매처등록 없는판매처 → ephemeral 오류', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('존재하지않는판매처XYZ', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('알 수 없는 키워드'));
  });

  await test('/판매처등록 건의 → 명령어 필드에 판매처등록 포함', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('건의 스마트스토어 연동 가이드가 필요합니다', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.text.includes('접수'));
    const call = apiCalls.find(c => c.endpoint === 'chat.postMessage');
    assert(call, 'chat.postMessage 미호출');
    assert(call.body.text.includes('/판매처등록'), '명령어 필드 누락');
  });

  // ── /입고요청서 (현재 숨김 처리) ───────────────────────────
  // URL encode: /입고요청서 = %2F%EC%9E%85%EA%B3%A0%EC%9A%94%EC%B2%AD%EC%84%9C
  const inboundCmd = '%2F%EC%9E%85%EA%B3%A0%EC%9A%94%EC%B2%AD%EC%84%9C';

  await test('/입고요청서 (숨김) → 보완 중 안내 (ephemeral)', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('', { command: inboundCmd }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('보완 작업 중'), '보완 중 안내 누락');
    // 채널에 게시되지 않아야 함
    const posts = apiCalls.filter(c => c.endpoint === 'chat.postMessage');
    assert(posts.length === 0, '숨김 도메인이 채널에 게시되면 안 됨');
  });

  await test('/입고요청서 help (숨김) → 보완 중 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('help', { command: inboundCmd }), env, ctx);
    await flush();
    const data = await res.json();
    assert(data.text.includes('보완 작업 중'));
  });

  await test('/입고요청서 작성방법 (숨김) → 보완 중 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('작성방법', { command: inboundCmd }), env, ctx);
    await flush();
    const data = await res.json();
    assert(data.text.includes('보완 작업 중'));
    // 본문이 채널에 노출되지 않아야 함
    const posts = apiCalls.filter(c => c.endpoint === 'chat.postMessage');
    assert(posts.length === 0);
  });

  await test('/입고요청서 건의 (숨김) → 보완 중 안내 (건의 채널 전송 X)', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('건의 냉동 상품 입고 가이드 필요', { command: inboundCmd }), env, ctx);
    await flush();
    const data = await res.json();
    assert(data.text.includes('보완 작업 중'));
    // 건의 채널로 보내지 않아야 함
    const posts = apiCalls.filter(c => c.endpoint === 'chat.postMessage');
    assert(posts.length === 0);
  });

  // ── /사용법 ───────────────────────────────────────────────

  await test('/사용법 (빈 입력) → 간결한 메인 가이드 (4섹션)', async () => {
    const { ctx, flush } = makeCtx();
    // URL encode: /사용법 = %2F%EC%82%AC%EC%9A%A9%EB%B2%95
    const res = await worker.fetch(makeSlashRequest('', { command: '%2F%EC%82%AC%EC%9A%A9%EB%B2%95' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    const text = data.text;
    // 핵심 섹션 4개
    assert(text.includes('*기본 사용법*'));
    assert(text.includes('*명령어*'));
    assert(text.includes('*키워드를 모를 땐*'));
    assert(text.includes('*더 알아보기*'));
    // 노출 도메인 + 오류검색
    assert(text.includes('/샵링커'));
    assert(text.includes('/할당'));
    assert(text.includes('/판매처등록'));
    assert(text.includes('/오류검색'));
    assert(!text.includes('/입고요청서'), '숨김 도메인이 노출되면 안 됨');
    // 띄어쓰기 강조
    assert(text.includes('띄어쓰기'));
    // 더 알아보기 진입점 3개
    assert(text.includes('/사용법 자주묻는질문'));
    assert(text.includes('/사용법 오류검색'));
    assert(text.includes('/사용법 건의방법'));
    // 가독성 — 메인 가이드는 1200자 이하로 제한
    assert(text.length < 1200, `메인 가이드 너무 김: ${text.length}자`);
  });

  await test('/사용법 help → 메인 가이드와 동일 내용', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('help', { command: '%2F%EC%82%AC%EC%9A%A9%EB%B2%95' }), env, ctx);
    await flush();
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('*기본 사용법*'));
    assert(data.text.includes('*명령어*'));
  });

  await test('/사용법 시작하기 → 메인과 동일 (alias)', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('시작하기', { command: '%2F%EC%82%AC%EC%9A%A9%EB%B2%95' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('*기본 사용법*'));
    assert(body.includes('*명령어*'));
  });

  await test('/사용법 건의방법 → 간결한 건의 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('건의방법', { command: '%2F%EC%82%AC%EC%9A%A9%EB%B2%95' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('요청 형식'));
    assert(body.includes('접수 흐름'));
    assert(body.includes('지속적으로 개선'));
    assert(body.includes('/할당 건의'));
    assert(body.includes('/판매처등록 건의'));
  });

  await test('/사용법 건의 (인자 없음) → 빌트인 안내 + /사용법 건의방법 연결', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('건의', { command: '%2F%EC%82%AC%EC%9A%A9%EB%B2%95' }), env, ctx);
    await flush();
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('가이드 건의 방법'));
    assert(data.text.includes('/사용법 건의방법'));
  });

  // 제거된 키워드들은 알 수 없는 키워드로 응답 (도메인 메인 help 포함)
  await test('/사용법 답변 (제거됨) → 알 수 없는 키워드 + 메인 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('답변', { command: '%2F%EC%82%AC%EC%9A%A9%EB%B2%95' }), env, ctx);
    await flush();
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('알 수 없는 키워드'));
  });

  await test('/사용법 명령어 (제거됨) → 알 수 없는 키워드', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('명령어', { command: '%2F%EC%82%AC%EC%9A%A9%EB%B2%95' }), env, ctx);
    await flush();
    const data = await res.json();
    assert(data.text.includes('알 수 없는 키워드'));
  });

  // `검색`은 `오류검색`과 부분 매칭 충돌 방지를 위해 메인 alias로 등록
  await test('/사용법 검색 → 메인 가이드 alias (ephemeral)', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('검색', { command: '%2F%EC%82%AC%EC%9A%A9%EB%B2%95' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('*기본 사용법*'));
  });

  // /사용법 도메인별 키워드는 모두 제거됨 — 알 수 없는 키워드로 처리
  // (사용자는 도메인 자체의 help 를 이용: `/샵링커 help`, `/할당 help` 등)
  await test('/사용법 판매처등록 (제거됨) → 알 수 없는 키워드', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('판매처등록', { command: '%2F%EC%82%AC%EC%9A%A9%EB%B2%95' }), env, ctx);
    await flush();
    const data = await res.json();
    assert(data.text.includes('알 수 없는 키워드'));
  });

  // /판매처등록 help 의 동적 빌드는 거기서 검증
  await test('/판매처등록 help → 동적 판매처 개수 표시', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('help', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    const data = await res.json();
    const m = data.text.match(/지원 판매처 \((\d+)개\)/);
    assert(m, '판매처 개수 표시 누락');
    assert(Number(m[1]) >= 50, `판매처 개수가 너무 적음: ${m[1]}`);
  });

  // 이모지 회귀 방지 — usage 가이드 전체에 장식용 이모지가 없어야 함
  await test('사용법 가이드 전체 — 장식용 이모지 회귀 방지', async () => {
    const usage = (await import('../guides/usage.js')).default;
    for (const [k, v] of Object.entries(usage.guides)) {
      if (/[📋✅🔗📖🔓⚠️💡🛒🕓🕛🔍❌]/.test(v)) {
        throw new Error(`사용법.${k} 가이드에 장식 이모지 포함됨`);
      }
    }
  });

  // ── App Home: 모든 도메인 표시 확인 ──────────────────────

  // ── 채널 비공개 회귀 방지: 어떤 가이드도 채널에 게시하지 않는다 ──

  await test('모든 가이드는 ephemeral — 채널에 봇 메시지 게시 안 함', async () => {
    const cases = [
      ['계정변경', '%2F%EC%83%B5%EB%A7%81%EC%BB%A4'],   // /샵링커
      ['재고부족', '%2F%ED%95%A0%EB%8B%B9'],            // /할당
      ['쿠팡', '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D'],   // /판매처등록
      ['자주묻는질문', '%2F%EC%82%AC%EC%9A%A9%EB%B2%95'],  // /사용법
      ['ADDR-4001', '%2F%EC%98%A4%EB%A5%98%EA%B2%80%EC%83%89'],  // /오류검색
    ];
    for (const [kw, cmd] of cases) {
      apiCalls.length = 0;
      const { ctx, flush } = makeCtx();
      const res = await worker.fetch(makeSlashRequest(kw, { command: cmd }), env, ctx);
      await flush();
      const body = await expectEphemeral(res);
      assert(body.length > 0, `${kw}: 본문 누락`);
      const posts = apiCalls.filter(c => c.endpoint === 'chat.postMessage');
      assert(posts.length === 0, `${kw}: 채널 게시 없어야 함, 실제: ${posts.length}회`);
    }
  });

  await test('App Home → 간결한 안내 (기본 사용법·검색·명령어·진입점)', async () => {
    const { ctx, flush } = makeCtx();
    const req = makeEventRequest({ type: 'event_callback', event: { type: 'app_home_opened', user: 'U12345' } });
    const res = await worker.fetch(req, env, ctx);
    await flush();
    assert(res.status === 200);
    const call = apiCalls.find(c => c.endpoint === 'views.publish');
    assert(call, 'views.publish 미호출');
    const viewText = JSON.stringify(call.body.view);
    // 노출 도메인
    assert(viewText.includes('샵링커'));
    assert(viewText.includes('할당'));
    assert(viewText.includes('판매처등록'));
    assert(viewText.includes('오류검색'));
    assert(!viewText.includes('/입고요청서'), '숨김 도메인이 App Home에 노출되면 안 됨');
    // 핵심 안내
    assert(viewText.includes('띄어쓰기'));
    assert(viewText.includes('자주묻는질문'));
    // 가독성 — 전체 view JSON 길이가 너무 크지 않아야 함 (간결성 회귀 방지)
    assert(viewText.length < 2500, `App Home 너무 김: ${viewText.length}자`);
  });

  // ── /오류검색 — 시스템 메시지 역검색 ─────────────────────────
  // URL encode: /오류검색 = %2F%EC%98%A4%EB%A5%98%EA%B2%80%EC%83%89
  const errSearchCmd = '%2F%EC%98%A4%EB%A5%98%EA%B2%80%EC%83%89';

  await test('/오류검색 (빈 입력) → ephemeral help', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('', { command: errSearchCmd }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('오류검색'));
    assert(data.text.includes('ADDR-4001'));
  });

  await test('/오류검색 help → ephemeral help', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('help', { command: errSearchCmd }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('오류검색'));
  });

  await test('/오류검색 ADDR-4001 → 주소정제 가이드 1건 채널 게시', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('ADDR-4001', { command: errSearchCmd }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('택배사 주소 정제'));
  });

  await test('/오류검색 LBL-1290 → 전화번호 가이드 1건 채널 게시', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('LBL-1290', { command: errSearchCmd }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('전화번호 양식 오류'));
  });

  await test('/오류검색 RECEIVER_ADDR → 주소길이초과 가이드 1건 채널 게시', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('RECEIVER_ADDR', { command: errSearchCmd }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('주소 길이 초과'));
  });

  await test('/오류검색 timeout → 송장timeout 가이드 1건 채널 게시', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('timeout', { command: errSearchCmd }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('타임아웃'));
  });

  await test('/오류검색 reason → 여러 건 ephemeral 후보 목록 (주소정제·전화번호)', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('reason', { command: errSearchCmd }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    // 'reason'이 포함된 시스템 메시지는 주소정제(x2), 전화번호, 주소길이초과
    // entry 단위 dedup 후 여러 건
    assert(data.text.includes('주소정제'), '주소정제 후보 누락');
    assert(data.text.includes('전화번호'), '전화번호 후보 누락');
    assert(/검색 결과 \(\d+건\)/.test(data.text), '검색 결과 헤더 누락');
  });

  await test('/오류검색 배송 규칙 → 우편번호 + 국가코드 후보 목록', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('배송 규칙', { command: errSearchCmd }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('우편번호'), '우편번호 후보 누락');
    assert(data.text.includes('국가코드'), '국가코드 후보 누락');
  });

  await test('/오류검색 가용재고가 존재하지 않 → 재고부족 1건 채널 게시', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('가용재고가 존재하지 않', { command: errSearchCmd }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('재고 부족'));
  });

  await test('/오류검색 피킹가능 로케이션 → 보충필요 1건 채널 게시', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('피킹가능 로케이션', { command: errSearchCmd }), env, ctx);
    await flush();
    assert(res.status === 200);
    const body = await expectEphemeral(res);
    assert(body.includes('보충 필요'));
  });

  await test('/오류검색 존재하지않는키워드XYZ → 0건 안내', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('존재하지않는키워드XYZ', { command: errSearchCmd }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('찾을 수 없습니다'));
    assert(data.text.includes('짧은 핵심 단어'));
  });

  await test('/오류검색 매칭 결과 BOT_TOKEN 없을 때 → ephemeral 폴백', async () => {
    const { ctx, flush } = makeCtx();
    const envNoToken = { SLACK_SIGNING_SECRET: TEST_SECRET };
    const res = await worker.fetch(makeSlashRequest('ADDR-4001', { command: errSearchCmd }), envNoToken, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('택배사 주소 정제'));
  });

  // ── 인덱싱 자체 검증 ───────────────────────────────────────

  await test('인덱스 빌드 — 시스템 메시지가 있는 모든 키워드가 인덱싱됨', async () => {
    const { ERROR_INDEX } = await import('../index.js');
    // 핵심 키워드들이 인덱스에 있는지
    const expected = ['주소정제', '전화번호', '주소길이초과', '재고부족', '보충필요',
                      '송장timeout', '취소개별주문', '전용재고', '우편번호', '국가코드',
                      '사은품송장', 'SKU필수정보', 'SKU체적', '통관금액', '송화인정보', '해외주소'];
    for (const kw of expected) {
      const entry = ERROR_INDEX.find(e => e.keyword === kw);
      assert(entry, `인덱스에 ${kw} 누락`);
      assert(entry.snippets.length > 0, `${kw} 스니펫 누락`);
    }
  });

  await test('인덱스 빌드 — 시스템 메시지 없는 키워드는 인덱싱 안 됨', async () => {
    const { ERROR_INDEX } = await import('../index.js');
    const skipped = ['help', '사전확인', '실패사유', '주문일시초과', '주문취소', '계정변경', '수집기준', '수집시간'];
    for (const kw of skipped) {
      const entry = ERROR_INDEX.find(e => e.keyword === kw);
      assert(!entry, `시스템 메시지 없는 ${kw}가 인덱싱됨`);
    }
  });

  // ── /사용법 자주묻는질문 (FAQ) ────────────────────────────

  await test('/사용법 오류검색 → 검색 예시·결과 안내 포함', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('오류검색', { command: '%2F%EC%82%AC%EC%9A%A9%EB%B2%95' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('ADDR-4001'));
    assert(body.includes('timeout'));
    assert(body.includes('통째'));   // "통째 붙여넣기" / "통째로 ..."
  });

  await test('/사용법 자주묻는질문 → 핵심 5개 시나리오', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('자주묻는질문', { command: '%2F%EC%82%AC%EC%9A%A9%EB%B2%95' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('할당이 실패'));
    assert(body.includes('에러 코드'));
    assert(body.includes('새 판매처'));
    assert(body.includes('샵링커 계정'));
    assert(!body.includes('입고요청서'), '숨김 도메인 시나리오가 노출되면 안 됨');
    assert(body.includes('가이드에 없는'));
    assert(body.includes('/오류검색'));
    // 가독성 — FAQ는 800자 이하
    assert(body.length < 1000, `FAQ 너무 김: ${body.length}자`);
  });

  await test('/사용법 FAQ → 자주묻는질문과 동일 (별칭)', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('FAQ', { command: '%2F%EC%82%AC%EC%9A%A9%EB%B2%95' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('이럴 땐 이 명령어'));
  });

  await test('/사용법 시나리오 → 자주묻는질문과 동일 (별칭)', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('시나리오', { command: '%2F%EC%82%AC%EC%9A%A9%EB%B2%95' }), env, ctx);
    await flush();
    const body = await expectEphemeral(res);
    assert(body.includes('이럴 땐 이 명령어'));
  });

  // ── 알 수 없는 키워드 — 시스템 메시지 가능성 안내 ────

  await test('알 수 없는 키워드 (시스템 메시지로 보임) → /오류검색 안내', async () => {
    const { ctx, flush } = makeCtx();
    // 영문/숫자가 포함된 8자 이상 입력 → 시스템 메시지로 추측
    const res = await worker.fetch(makeSlashRequest('SOME_ERROR_CODE_X', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('/오류검색'), '/오류검색 안내 누락');
    assert(data.text.includes('자주묻는질문') || data.text.includes('help'), 'FAQ/help 안내 누락');
  });

  await test('알 수 없는 키워드 (시스템 메시지 아님: 짧은 한글) → 기존 안내 (오류검색 헤더 없음)', async () => {
    const { ctx, flush } = makeCtx();
    // 짧은 한글 → 시스템 메시지로 추측 안 함
    const res = await worker.fetch(makeSlashRequest('이상한단어', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('알 수 없는 키워드'));
    // 시스템 메시지 안내 헤더가 노출되면 안 됨 (도메인 help 안에 /오류검색 진입점은 들어가 있어도 OK)
    assert(!data.text.includes('시스템에서 본 오류 메시지'), '잘못된 시스템 메시지 안내 헤더 노출');
  });

  await test('/판매처등록 알 수 없는 키워드 → /오류검색 안내가 잘못 나오지 않음', async () => {
    const { ctx, flush } = makeCtx();
    // 영문이 포함된 입력이지만 /판매처등록 에서는 시스템 메시지 안내가 작동하지 않아야 함
    const res = await worker.fetch(makeSlashRequest('UNKNOWN_SELLER_X', { command: '%2F%ED%8C%90%EB%A7%A4%EC%B2%98%EB%93%B1%EB%A1%9D' }), env, ctx);
    await flush();
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(!data.text.includes('시스템에서 본 오류 메시지'),
      '/판매처등록 도메인에서 시스템 메시지 안내가 잘못 작동함');
  });

  // ── 도메인 help 크로스 참조 ────────────────────────

  await test('/할당 help → /오류검색 진입점 포함', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('help', { command: '%2F%ED%95%A0%EB%8B%B9' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.text.includes('/오류검색'), '/할당 help 에 /오류검색 누락');
  });

  await test('/샵링커 help → /오류검색 진입점 포함', async () => {
    const { ctx, flush } = makeCtx();
    const res = await worker.fetch(makeSlashRequest('help', { command: '%2F%EC%83%B5%EB%A7%81%EC%BB%A4' }), env, ctx);
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.text.includes('/오류검색'));
  });

  // ── 잘못된 명령어 입력 시 띄어쓰기 누락 안내 ──────────────

  await test('등록되지 않은 명령어 → 띄어쓰기 누락 가능성 안내', async () => {
    const { ctx, flush } = makeCtx();
    // /할당재고부족 = %2F%ED%95%A0%EB%8B%B9%EC%9E%AC%EA%B3%A0%EB%B6%80%EC%A1%B1
    const res = await worker.fetch(
      makeSlashRequest('', { command: '%2F%ED%95%A0%EB%8B%B9%EC%9E%AC%EA%B3%A0%EB%B6%80%EC%A1%B1' }),
      env, ctx
    );
    await flush();
    assert(res.status === 200);
    const data = await res.json();
    assert(data.response_type === 'ephemeral');
    assert(data.text.includes('등록되지 않은 명령어'));
    assert(data.text.includes('띄어쓰기'), '띄어쓰기 안내 누락');
    assert(data.text.includes('/사용법'), '사용법 안내 누락');
  });

  // ─────────────────────────────────────────────────────────

  console.log(`\n결과: ${passed}/${passed + failed} 통과`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
