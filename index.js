import crypto from 'node:crypto';
import registry from './guides/index.js';

const TIMESTAMP_TOLERANCE_SEC = 300;
const PARTIAL_MATCH_LIMIT = 20;
const ERROR_SEARCH_LIMIT = 10;
const ERROR_SNIPPET_PREVIEW = 80;

// ──────────────────────────────────────────────────────────────────────
// 시스템 메시지 역검색 인덱스 — 모듈 로드 시 1회 빌드
// 각 가이드 텍스트에서 "시스템 메시지 예시:" 다음의 `>` blockquote들을 추출
// ──────────────────────────────────────────────────────────────────────
// "시스템 메시지 예시:" 다음에 연속으로 이어지는 인용블록(`> ...`)만 추출.
// 빈 줄이나 다른 형식의 줄을 만나면 섹션 종료 — 가이드 본문에 별도로 등장하는
// 일반 노트(`> ...`)가 잘못 인덱싱되는 것을 막는다.
function extractSnippets(guideText) {
  const snippets = [];
  const lines = guideText.split('\n');
  let inExampleSection = false;
  for (const line of lines) {
    if (line.includes('시스템 메시지 예시')) {
      inExampleSection = true;
      continue;
    }
    if (inExampleSection) {
      if (line.startsWith('> ')) {
        snippets.push(line.slice(2).trim());
      } else {
        inExampleSection = false;
      }
    }
  }
  return snippets;
}

function buildErrorIndex(reg) {
  const index = [];
  const seenGuideText = new Map(); // 별칭 중복 방지 (같은 가이드 텍스트는 한 번만)
  for (const [domain, mod] of Object.entries(reg)) {
    if (mod.isErrorSearch) continue;
    if (mod.hidden) continue; // 숨김 도메인은 검색에서 제외
    for (const [keyword, guideText] of Object.entries(mod.guides)) {
      if (keyword === 'help') continue;
      if (typeof guideText !== 'string') continue;
      const dupKey = `${domain}::${guideText}`;
      if (seenGuideText.has(dupKey)) continue;
      seenGuideText.set(dupKey, true);
      const snippets = extractSnippets(guideText);
      if (snippets.length > 0) {
        index.push({ domain, keyword, snippets });
      }
    }
  }
  return index;
}

const ERROR_INDEX = buildErrorIndex(registry);

function scoreMatch(snippet, query) {
  const ns = snippet.toLowerCase();
  const nq = query.toLowerCase();
  if (ns === nq) return 1000;
  if (ns.includes(nq)) return 500 + Math.min(nq.length, 100);
  if (nq.includes(ns)) return 400 + Math.min(ns.length, 100);
  const words = nq.split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return 0;
  const hits = words.filter(w => ns.includes(w));
  if (hits.length === words.length) return 100 + hits.length * 10;
  if (hits.length > words.length / 2) return 50 + hits.length * 5;
  return 0;
}

function searchErrorIndex(query) {
  const q = query.trim();
  if (!q) return [];
  const results = [];
  for (const entry of ERROR_INDEX) {
    let bestScore = 0;
    let bestSnippet = '';
    for (const snippet of entry.snippets) {
      const s = scoreMatch(snippet, q);
      if (s > bestScore) { bestScore = s; bestSnippet = snippet; }
    }
    if (bestScore > 0) {
      results.push({ ...entry, score: bestScore, snippet: bestSnippet });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

// ──────────────────────────────────────────────────────────────────────
// Slack 요청 처리 유틸
// ──────────────────────────────────────────────────────────────────────
function verifySlackRequest(headers, rawBody, signingSecret) {
  const timestamp = headers.get('x-slack-request-timestamp');
  const signature = headers.get('x-slack-signature');
  if (!timestamp || !signature) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > TIMESTAMP_TOLERANCE_SEC) return false;
  const baseString = `v0:${timestamp}:${rawBody}`;
  const computed = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(baseString, 'utf8')
    .digest('hex');
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

function parseUrlEncoded(raw) {
  const params = {};
  for (const pair of raw.split('&')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    params[safeDecode(pair.slice(0, idx))] = safeDecode(pair.slice(idx + 1));
  }
  return params;
}

function slackResponse(text) {
  return new Response(
    JSON.stringify({ response_type: 'ephemeral', text }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

function emptyOk() {
  return new Response('', { status: 200 });
}

// 모든 가이드 답변은 본인에게만 표시 (ephemeral).
// 채널에 봇 메시지를 남기지 않아 채널이 깔끔하게 유지됩니다.
// 다른 분과 공유가 필요하면 사용자가 직접 답변을 복사해 채널에 붙여넣습니다.
function deliverGuide(guideText, params, env, ctx) {
  return slackResponse(guideText);
}

async function publishHomeView(userId, botToken) {
  const cmdLines = [];
  for (const [cmd, mod] of Object.entries(registry)) {
    if (mod.hidden) continue;
    cmdLines.push(`• \`/${cmd}\` — ${mod.description}`);
  }

  const view = {
    type: 'home',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '기술지원 가이드봇', emoji: false },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '자주 묻는 기술 문의를 슬랙에서 즉시 조회할 수 있는 사내 가이드 봇입니다.',
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            '*기본 사용법*\n' +
            '`/<명령어> <키워드>` 형식, 사이에 *띄어쓰기 필수*\n' +
            '예) `/할당 재고부족`   `/판매처등록 쿠팡`\n\n' +
            '*검색 방법*\n' +
            '• 정확한 키워드: `/판매처등록 쿠팡`\n' +
            '• 일부만 입력: `/판매처등록 롯데`\n' +
            '• 오류 메시지로: `/오류검색 ADDR-4001`',
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*명령어*\n' + cmdLines.join('\n') },
      },
      { type: 'divider' },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text:
              '전체 사용법 `/사용법` · 상황별 안내 `/사용법 자주묻는질문` · 가이드 건의 `/<명령어> 건의 <내용>`',
          },
        ],
      },
    ],
  };

  const res = await fetch('https://slack.com/api/views.publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${botToken}` },
    body: JSON.stringify({ user_id: userId, view }),
  });
  const data = await res.json();
  if (!data.ok) console.error('views.publish failed:', data.error);
}

async function postSuggestion(userId, fromChannelId, content, command, botToken, suggestionChannelId) {
  const timestamp = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date()) + ' KST';

  const text = [
    '*[새 가이드 건의]*',
    '',
    `• 명령어: \`/${command}\``,
    `• 건의자: <@${userId}>`,
    `• 채널: <#${fromChannelId}>`,
    `• 접수: ${timestamp}`,
    '',
    '*건의 내용*',
    content,
  ].join('\n');

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${botToken}` },
    body: JSON.stringify({ channel: suggestionChannelId, text }),
  });
  const data = await res.json();
  if (!data.ok) console.error('chat.postMessage (suggestion) failed:', data.error);
}

// ──────────────────────────────────────────────────────────────────────
// /오류검색 처리
// ──────────────────────────────────────────────────────────────────────
function handleErrorSearch(rawText, namespace, params, env, ctx) {
  const query = rawText.trim();

  if (!query || query === 'help') {
    return slackResponse(registry[namespace].guides.help);
  }

  const results = searchErrorIndex(query);

  if (results.length === 0) {
    return slackResponse(
      `*\`${truncate(query, 60)}\`* 와(과) 일치하는 시스템 메시지를 찾을 수 없습니다.\n\n` +
      '*다시 시도해 보세요*\n' +
      '• 더 짧은 핵심 단어로 검색 (예: `ADDR`, `timeout`, `재고`, `우편번호`)\n' +
      '• 메시지 일부만 입력 (전체 문장이 아니어도 됩니다)\n' +
      '• `/할당` 으로 카테고리별 안내 확인\n\n' +
      '찾으시는 메시지가 가이드에 없다면 `/할당 건의 <내용>` 으로 추가 요청해 주세요.'
    );
  }

  if (results.length === 1) {
    const hit = results[0];
    const guideText = registry[hit.domain].guides[hit.keyword];
    return deliverGuide(guideText, params, env, ctx);
  }

  // 여러 건: ephemeral 후보 목록
  const shown = results.slice(0, ERROR_SEARCH_LIMIT);
  const more = results.length > shown.length ? `\n_... 외 ${results.length - shown.length}건_` : '';
  const list = shown.map(r => {
    const preview = truncate(r.snippet, ERROR_SNIPPET_PREVIEW);
    return `• \`/${r.domain} ${r.keyword}\`\n  _"${preview}"_`;
  }).join('\n');

  return slackResponse(
    `*\`${truncate(query, 60)}\`* 검색 결과 (${results.length}건)*\n\n` +
    list + more + '\n\n위 명령어 중 하나를 입력하면 해당 가이드를 채널에서 볼 수 있습니다.'
  );
}

// ──────────────────────────────────────────────────────────────────────
// 메인 핸들러
// ──────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (request.headers.get('x-slack-retry-num')) {
      return emptyOk();
    }

    const rawBody = await request.text();
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      let payload;
      try { payload = JSON.parse(rawBody); } catch {
        return new Response('Bad Request', { status: 400 });
      }

      if (payload.type === 'url_verification') {
        return new Response(JSON.stringify({ challenge: payload.challenge }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!env.SLACK_SIGNING_SECRET) {
        console.error('SLACK_SIGNING_SECRET is not configured');
        return new Response('Internal Server Error', { status: 500 });
      }
      if (!verifySlackRequest(request.headers, rawBody, env.SLACK_SIGNING_SECRET)) {
        return new Response('Unauthorized', { status: 401 });
      }

      if (payload.event?.type === 'app_home_opened' && env.SLACK_BOT_TOKEN) {
        ctx.waitUntil(publishHomeView(payload.event.user, env.SLACK_BOT_TOKEN));
      }

      return new Response('ok');
    }

    const params = parseUrlEncoded(rawBody);

    if (params.ssl_check === '1') {
      return new Response('ok', { status: 200 });
    }

    if (!env.SLACK_SIGNING_SECRET) {
      console.error('SLACK_SIGNING_SECRET is not configured');
      return new Response('Internal Server Error', { status: 500 });
    }
    if (!verifySlackRequest(request.headers, rawBody, env.SLACK_SIGNING_SECRET)) {
      console.error('Slack signature verification failed');
      return new Response('Unauthorized', { status: 401 });
    }

    // Resolve domain from the slash command name (e.g. "/샵링커" → "샵링커")
    const namespace = (params.command || '').replace(/^\//, '');
    const domain = registry[namespace];

    if (!domain) {
      // 키워드를 붙여 입력했을 가능성 안내 (e.g. /할당재고부족)
      const hint = '\n\n혹시 명령어와 키워드 사이에 *띄어쓰기* 가 빠지지 않았나요?\n예) `/할당 재고부족` (O), `/할당재고부족` (X)\n\n전체 사용법은 `/사용법` 또는 `/사용법 시작하기` 로 확인하세요.';
      return slackResponse(`\`/${namespace}\` 은(는) 등록되지 않은 명령어입니다.${hint}`);
    }

    // 숨김 도메인 — 입력 무엇이든 "보완 중" 안내로 응답
    if (domain.hidden) {
      return slackResponse(
        `*\`/${namespace}\` 가이드는 현재 보완 작업 중입니다.*\n\n` +
        '내용 보완이 완료되는 대로 다시 사용할 수 있도록 준비하고 있습니다.\n' +
        '다른 가이드는 `/사용법` 으로 확인할 수 있습니다.'
      );
    }

    const text = (params.text || '').trim();

    // /오류검색 은 텍스트 전체를 검색어로 다룬다 (띄어쓰기 포함 입력 가능)
    if (domain.isErrorSearch) {
      return handleErrorSearch(text, namespace, params, env, ctx);
    }

    const spaceIdx = text.indexOf(' ');
    const keyword = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
    const argument = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();

    if (!keyword || keyword === 'help') {
      return slackResponse(domain.guides.help);
    }

    if (keyword === '건의') {
      if (!argument) {
        return slackResponse(
          `*가이드 건의 방법*\n\n\`/${namespace} 건의 <건의 내용>\` 형식으로 입력하세요.\n\n예시: \`/${namespace} 건의 배송 지연 처리 기준 가이드가 필요합니다\`\n\n건의 내용은 담당자가 검토 후 가이드에 반영합니다.\n\n자세한 안내는 \`/사용법 건의방법\` 을 참고하세요.`
        );
      }
      if (!env.SLACK_BOT_TOKEN || !env.SUGGESTION_CHANNEL_ID) {
        console.error('SLACK_BOT_TOKEN or SUGGESTION_CHANNEL_ID is not configured');
        return slackResponse('건의 기능이 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.');
      }
      ctx.waitUntil(
        postSuggestion(
          params.user_id || 'unknown',
          params.channel_id || 'unknown',
          argument,
          namespace,
          env.SLACK_BOT_TOKEN,
          env.SUGGESTION_CHANNEL_ID,
        )
      );
      return slackResponse('건의가 접수되었습니다.\n담당자가 검토 후 가이드에 반영하겠습니다.');
    }

    if (domain.guides[keyword]) {
      return deliverGuide(domain.guides[keyword], params, env, ctx);
    }

    // 부분 검색: 정확히 일치하지 않으면 키 이름에 포함되는지 검사
    const lowerKw = keyword.toLowerCase();
    const allKeys = Object.keys(domain.guides).filter(k => k !== 'help');
    const matches = allKeys.filter(k => k.toLowerCase().includes(lowerKw));

    if (matches.length === 1) {
      return deliverGuide(domain.guides[matches[0]], params, env, ctx);
    }

    if (matches.length > 1) {
      // 같은 가이드 내용을 가리키는 별칭이 함께 매칭되면 중복 제거
      const unique = [];
      const seenTexts = new Set();
      for (const k of matches) {
        const t = domain.guides[k];
        if (!seenTexts.has(t)) { seenTexts.add(t); unique.push(k); }
      }

      if (unique.length === 1) {
        return deliverGuide(domain.guides[unique[0]], params, env, ctx);
      }

      const shown = unique.slice(0, PARTIAL_MATCH_LIMIT);
      const more = unique.length > shown.length ? `\n_... 외 ${unique.length - shown.length}건_` : '';
      const list = shown.map(k => `• \`/${namespace} ${k}\``).join('\n');
      return slackResponse(
        `*\`${keyword}\` 검색 결과 (${unique.length}건)*\n\n${list}${more}\n\n정확한 이름으로 다시 조회하세요.`
      );
    }

    // 알 수 없는 키워드 — 시스템 메시지 가능성 안내 + 도메인 help
    // `/할당` 에서만 작동 (시스템 에러 메시지가 가장 많이 등장하는 도메인)
    const fullInput = text; // 키워드 + 인자 모두 합쳐서
    const looksLikeSystemMessage =
      namespace === '할당' &&
      fullInput.length >= 8 &&
      (/[A-Za-z]{3,}/.test(fullInput) ||  // 영문 단어 (ADDR, RECEIVER_ADDR, timeout 등)
       /[._-]/.test(fullInput) ||         // 에러 코드 구분자
       fullInput.includes(' '));          // 띄어쓰기 (문장 입력 가능성)

    if (looksLikeSystemMessage) {
      const hint =
        `*\`${keyword}\`* 은(는) \`/${namespace}\` 의 키워드로 등록되어 있지 않습니다.\n\n` +
        `*시스템에서 본 오류 메시지인가요?*\n` +
        `에러 메시지의 일부라면 \`/오류검색\` 으로 다시 시도해 보세요.\n` +
        `예) \`/오류검색 ${truncate(fullInput, 50)}\`\n\n` +
        `*다른 도움말*\n` +
        `• \`/사용법 자주묻는질문\` — 상황별 명령어 매핑\n` +
        `• \`/${namespace} help\` — \`/${namespace}\` 의 전체 키워드 보기`;
      return slackResponse(hint);
    }

    return slackResponse(`*\`${keyword}\`* 은(는) 알 수 없는 키워드입니다.\n\n` + domain.guides.help);
  },
};

// 테스트용 export (Cloudflare Workers 런타임에서는 사용되지 않음)
export { buildErrorIndex, searchErrorIndex, extractSnippets, ERROR_INDEX };
