# 기술지원 가이드봇 (techguide-bot)

> 반복되는 기술 문의를 Slack 슬래시 명령어로 바로 찾아보게 하는 **Cloudflare Workers 기반 가이드봇**과, 쿠팡 API 키 만료 전에 Slack으로 알려 주는 **Python 알림 도구**
> 1인 개발 · 2026 · 사내 업무용으로 만든 도구를 공개용으로 정리한 저장소

`JavaScript (ESM)` `Cloudflare Workers` `Slack Slash Commands · Events API` `HMAC-SHA256` `SheetJS(xlsx)` `Python 3` `SQLite` `pytest`

> **공개용 정리 안내** — 원래 사내 업무에 쓰던 도구입니다. 공개하면서 `/할당` 가이드 본문은 실제 운영 절차·시스템 메뉴·오류 코드 대신 **가상의 예시 내용**(운영자 콘솔·판매자 콘솔, `ADDR-4001` 같은 가상 코드)으로 바꿨고, 계정 번호 등 식별 정보도 예시 값으로 바꿨습니다. 봇의 구조와 동작은 그대로입니다.

---

## 무엇을 해결하나

문의 채널에 "할당이 실패했는데 어떻게 하나요?", "이 판매처 연동하려면 뭐가 필요하죠?" 같은 같은 질문이 반복해서 올라오는 상황을 줄이기 위해 만들었습니다.

| 명령어 | 하는 일 |
|---|---|
| `/할당 <키워드>` | 주문 할당 실패 사유별 원인·확인 방법·대처법 (20개 키워드) |
| `/오류검색 <메시지 일부>` | 화면에 뜬 **오류 메시지 일부**로 해당 가이드를 역검색 |
| `/판매처등록 <판매처명>` | 판매처(오픈마켓·종합몰) 61곳의 연동 필요 정보·설정 가이드·어드민 링크. 부분 검색·별칭 검색 지원 |
| `/샵링커 <키워드>` | 연동 솔루션(샵링커) 계정·수집 기준 안내 |
| `/사용법` | 봇 사용법, 상황별 명령어 안내 |
| `/<명령어> 건의 <내용>` | 가이드 추가·수정 요청을 지정 채널로 전달 |

함께 들어 있는 [`coupang-key-expiry-notifier/`](coupang-key-expiry-notifier/README.md)는 쿠팡 주문수집 API 키(유효 180일)가 만료되기 전에 Slack으로 미리 알려 주는 별도 도구입니다.

## 아키텍처

```
Slack ──(slash command / app_home_opened)──▶ Cloudflare Worker  index.js
                                               │ 1. x-slack-retry-num → 즉시 200 (중복 처리 방지)
                                               │ 2. HMAC-SHA256 서명 + 5분 타임스탬프 검증
                                               │ 3. 명령어 이름 → guides/index.js 레지스트리로 라우팅
                                               ▼
              ┌──────────── guides/ (도메인별 모듈: { description, guides, hidden? }) ────────────┐
              │ allocation · seller(자동 생성) · shoplinker · inbound(숨김) · usage · error-search │
              └──────────────────────────────────────────────────────────────────────────────┘
                                               │ 정확 일치 → 부분 일치 → 오류 메시지 추정 안내
                                               ▼
                                   ephemeral 응답 (본인에게만 표시)
                                   건의 → chat.postMessage / 앱 홈 → views.publish (ctx.waitUntil)

shoplinker_markets.xlsx ──npm run build-sellers──▶ guides/seller.js (AUTO-GENERATED)
```

- 상태 없는(stateless) 핸들러 하나로 동작하고, 런타임 의존성이 없습니다 (`node:crypto`만 사용, `nodejs_compat`).
- 새 명령어는 `guides/새모듈.js`를 만들고 `guides/index.js`에 한 줄 추가하면 됩니다. 앱 홈·`/사용법`의 명령어 목록은 레지스트리에서 동적으로 만듭니다.

## 기술적으로 집중한 부분

**1. 오류 메시지로 가이드를 찾는 역검색 (`/오류검색`)**
- 문제: 사용자는 키워드 대신 화면에 뜬 오류 문장을 그대로 들고 옵니다.
- 해결: 각 가이드 본문의 `시스템 메시지 예시:` 바로 뒤에 이어지는 인용블록(`> ...`)만 골라 모듈 로드 시 한 번 인덱스를 만듭니다. 빈 줄을 만나면 섹션을 끝내서 일반 안내문 인용이 섞이지 않게 했습니다. 검색은 완전 일치 > 포함 > 역포함 > 단어 일치 순으로 점수를 매깁니다.
- 결과: 가이드 작성자는 예시 메시지만 적으면 되고, 검색 인덱스를 따로 관리하지 않습니다. 결과가 1건이면 바로 가이드를, 여러 건이면 후보 목록을 보여 줍니다.

**2. 스프레드시트를 원본으로 하는 판매처 가이드 생성**
- 문제: 판매처 61곳의 연동 정보(필요 계정 정보·설정 가이드 이미지·어드민 주소)가 엑셀 표로 관리되고 있어, 가이드 코드와 따로 놀기 쉬웠습니다.
- 해결: `scripts/build-seller-guides.js`가 xlsx를 읽어 `guides/seller.js`를 생성합니다. `지그재그/포스티`, `신세계V(구 SI빌리지)`, `SSG (이마트, 신세계닷컴)` 같은 판매처명에서 주 키와 별칭을 뽑아 별칭으로도 찾을 수 있게 했습니다.
- 결과: 엑셀만 고치고 빌드하면 봇에 반영되고, 같은 가이드를 가리키는 별칭이 함께 검색돼도 중복 없이 1건으로 보여 줍니다.

**3. Slack 요청 보안과 3초 응답 제한**
- 서명 비교는 `crypto.timingSafeEqual`로 하고, 타임스탬프가 300초 넘게 차이 나면 거부합니다. Slack 재시도 요청은 바로 200을 돌려 중복 처리를 막습니다.
- 건의 전달·앱 홈 갱신처럼 Slack API를 다시 부르는 작업은 `ctx.waitUntil`로 응답 뒤에 처리합니다.

**4. 잘못 입력했을 때의 안내**
- `/할당재고부족`처럼 띄어쓰기를 빠뜨리면 "등록되지 않은 명령어" 대신 띄어쓰기 안내를 보여 줍니다.
- `/할당`에 영문·기호가 섞인 긴 문장이 들어오면 오류 메시지로 보고 `/오류검색`을 권합니다.

**5. API 키 만료 알림 (`coupang-key-expiry-notifier/`)**
- 만료일 = 연동일 + 180일, 알림일 = 만료일 − 15일. 알림일이 주말·공휴일이면 직전 영업일로 당깁니다 (`ROLL_DIRECTION`).
- 공휴일은 캐시 파일 → 공공데이터포털 특일정보 API → `holidays` 라이브러리 순으로 가져옵니다.
- 재연동(더 최신 연동일)이 들어오면 `notified_at`을 비워 다음 알림 주기를 다시 시작합니다. Slack 발송이 실패하면 발송 완료로 표시하지 않아 다음 실행에서 다시 보냅니다.
- 연동 이벤트 수집은 어댑터(`manual_csv` / `db_polling` / `shoplinker`)로 분리했습니다. 현재 구현된 것은 CSV 어댑터이고 나머지 둘은 인터페이스만 있는 스텁입니다.
- API 키 원문은 저장하지 않고 마스킹된 식별자(`****1234`)만 SQLite에 둡니다.

## 품질 / 테스트

| 대상 | 명령 | 결과 |
|---|---|---|
| 가이드봇 | `npm test` (`node test/local.js`) | 107개 통과 |
| 만료 알림 도구 | `pytest tests/` | 24개 통과 |

- 가이드봇 테스트는 Cloudflare 계정 없이 돕니다. 테스트용 시크릿으로 서명된 요청을 직접 만들고 `fetch`를 가로채 Slack API 호출을 기록합니다. 서명 오류·만료 타임스탬프·재시도 헤더·숨김 도메인·부분 검색·오류검색 인덱스·건의 전달 등을 확인합니다.
- 만료 알림 도구 테스트는 테스트마다 분리된 SQLite DB와 고정 공휴일 목록을 써서 영업일 보정, 재연동, 발송 실패 처리를 확인합니다.

## 실행 방법

### 가이드봇

```bash
npm install
npm test                 # 로컬 테스트 (Node.js 18+)
npx wrangler login
npx wrangler secret put SLACK_SIGNING_SECRET
npx wrangler secret put SLACK_BOT_TOKEN
npx wrangler secret put SUGGESTION_CHANNEL_ID   # 건의를 받을 채널 ID
npm run deploy           # wrangler deploy
```

Slack 앱 설정:
1. Bot Token Scopes: `chat:write`, `commands`
2. Slash Commands: `/샵링커` `/할당` `/판매처등록` `/입고요청서` `/사용법` `/오류검색`을 모두 같은 Worker URL로 등록
3. (선택) Event Subscriptions에서 `app_home_opened` 구독 후 App Home의 Home Tab 활성화

판매처 정보를 바꿀 때는 `shoplinker_markets.xlsx`를 고친 뒤 `npm run build-sellers`를 실행합니다. `guides/seller.js`는 직접 고치지 않습니다.

### 만료 알림 도구

```bash
cd coupang-key-expiry-notifier
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # SLACK_WEBHOOK_URL 등 입력
python -m app.init_db
python -m app.ingest          # data/seed.csv → DB
python -m app.check --dry-run # 발송 없이 확인
pytest tests/
```

`crontab.example`에 매일 09:10 점검, 매시간 수집 예시가 있습니다.

## 설정

| 위치 | 값 |
|---|---|
| Wrangler secret | `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `SUGGESTION_CHANNEL_ID` |
| `coupang-key-expiry-notifier/.env` | `SLACK_WEBHOOK_URL`, `SLACK_MENTION`, `DATA_GO_KR_API_KEY`, `VALIDITY_DAYS`(180), `LEAD_DAYS`(15), `ROLL_DIRECTION`, `INGESTION_SOURCE` 등 (`.env.example` 참고) |

모든 비밀값은 Wrangler secret 또는 `.env`로만 넣고, 저장소에는 올리지 않습니다.

## 파일 구조

```
index.js                     Workers 핸들러 (서명 검증 · 라우팅 · 오류검색 인덱스 · Slack API)
guides/                      명령어별 가이드 모듈 + 레지스트리(index.js)
scripts/build-seller-guides.js  xlsx → guides/seller.js 생성
shoplinker_markets.xlsx      판매처 연동 정보 원본
test/local.js                로컬 테스트
coupang-key-expiry-notifier/ API 키 만료 알림 도구 (Python)
```

## 개발 방식

Claude Code와 함께 설계·구현했습니다 (커밋의 `Co-Authored-By` 참고).
