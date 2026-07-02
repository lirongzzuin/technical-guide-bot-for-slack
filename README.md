# 기술지원 가이드봇 (techguide-bot)

기술지원 관련 표준 가이드를 Slack에서 즉시 조회할 수 있는 슬래시 명령어 봇입니다.  
Cloudflare Workers 위에서 동작하는 무상태(stateless) 서버리스 핸들러입니다.

---

## 사용 방법

### 기본 형식

```
/<명령어> <키워드>
```

모든 응답은 **채널에 공개**됩니다. 가이드 제목이 채널에 올라가고 상세 내용은 스레드로 달립니다.  
`help` 키워드와 빈 입력은 나에게만 보이는 ephemeral 메시지로 응답합니다.

---

### `/오류검색` — 시스템 오류 메시지로 가이드 역검색

화면에 뜬 시스템 에러 메시지의 일부를 입력하면 매칭되는 가이드를 자동으로 찾아 줍니다. 모든 도메인의 가이드에서 `시스템 메시지 예시:` 인용블록을 자동 인덱싱하여 검색합니다.

```
/오류검색 ADDR-4001         # 주소정제 가이드를 채널에 게시
/오류검색 reason             # 매칭되는 가이드 후보 목록 (ephemeral)
/오류검색 timeout            # 송장timeout 가이드를 채널에 게시
/오류검색 가용재고가 존재하지 않  # 재고부족 가이드를 채널에 게시
/오류검색 help               # 사용법 안내
```

매칭 결과가 1건이면 곧바로 채널에 게시되고, 여러 건이면 후보 목록이 본인에게만 표시됩니다.

---

### `/샵링커` — 샵링커 연동 가이드

| 명령어 | 내용 |
|--------|------|
| `/샵링커 계정변경` | 16시 → 24시 계정 변경 절차 |
| `/샵링커 수집기준` | 판매처별 주문/클레임 수집 일수 기준 |
| `/샵링커 수집시간` | 16시/24시 계정 수집 시간 및 계정 구분 방법 |
| `/샵링커 help` | 샵링커 명령어 목록 보기 |

---

### `/할당` — 할당 실패 사유 및 대처법

실제 시스템 에러 메시지 기반의 할당 실패 가이드입니다.

**먼저 확인**
- `/할당 사전확인` — 정보 수정 후에도 할당이 안 될 때 2가지 점검
- `/할당 실패사유` — 전체 카테고리 목록

**주문 상태**
- `/할당 주문일시초과` · `/할당 주문취소` · `/할당 취소개별주문`

**재고**
- `/할당 재고부족` · `/할당 전용재고` · `/할당 보충필요`

**주소·배송지**
- `/할당 주소정제` · `/할당 전화번호` · `/할당 해외주소` · `/할당 주소길이초과` · `/할당 우편번호`

**송화인·SKU 정보**
- `/할당 송화인정보`
- `/할당 SKU필수정보` · `/할당 SKU체적` · `/할당 통관금액`

**기타**
- `/할당 사은품송장` · `/할당 국가코드` · `/할당 송장timeout`



---

### `/판매처등록` — 판매처별 샵링커 연동 필요 정보

`shoplinker_markets.xlsx` 파일에서 자동 생성되며, 60여 개 판매처에 대해 다음 정보를 제공합니다.

- 필요 계정 정보 (아이디·비밀번호·API 키 등)
- 설정 가이드 이미지 링크
- 어드민 페이지 바로가기 링크

사용 예시:

```
/판매처등록 쿠팡         # 정확한 판매처명으로 조회
/판매처등록 롯데         # 부분 검색 (롯데백화점·롯데홈쇼핑·롯데온 목록)
/판매처등록 SI빌리지      # 별칭 검색 → 신세계V로 매칭
/판매처등록 help         # 전체 판매처 목록 보기
```

판매처 데이터를 추가·수정하려면 `shoplinker_markets.xlsx` 를 편집한 뒤 `npm run build-sellers` 를 실행하세요. (아래 [가이드 추가·수정 방법](#가이드-추가수정-방법) 참고)

---

### `/입고요청서` — 입고요청서 작성 및 처리 가이드

| 명령어 | 내용 |
|--------|------|
| `/입고요청서 작성방법` | 기본 작성 규칙 및 항목 설명 |
| `/입고요청서 신규상품` | 신규 상품 입고 시 사전 등록 절차 |
| `/입고요청서 검수기준` | 입고 검수 항목 및 결과 처리 기준 |
| `/입고요청서 오류대처` | 주요 오류 유형 및 해결 방법 |
| `/입고요청서 반품입고` | 반품 상품 입고 처리 방법 |
| `/입고요청서 help` | 입고요청서 명령어 목록 보기 |

---

### 가이드 건의

가이드 추가나 수정이 필요하면 명령어에 `건의`를 사용하세요.

```
/<명령어> 건의 <건의 내용>
```

예시:
```
/샵링커 건의 배송 지연 처리 기준 가이드가 필요합니다
/할당 건의 유통기한 초과로 인한 할당 실패 사유 추가 요청
```

건의 내용은 담당자가 검토 후 가이드에 반영합니다.

---

### 앱 홈 (App Home)

Slack 좌측 사이드바에서 앱 이름을 클릭하면 **앱 홈** 탭에서 전체 명령어 목록을 한눈에 볼 수 있습니다.

---

## 파일 구조

```
shoplinker-bot/
├── index.js                       — Workers 핸들러 (서명 검증 · 라우팅 · Slack API)
├── guides/
│   ├── index.js                   — 명령어 registry (새 명령어 추가 시 여기만 수정)
│   ├── shoplinker.js              — /샵링커 가이드
│   ├── allocation.js              — /할당 가이드
│   ├── seller.js                  — /판매처등록 가이드 (AUTO-GENERATED)
│   ├── inbound.js                 — /입고요청서 가이드
│   ├── usage.js                   — /사용법 가이드 (도메인별 키워드 동적 빌드)
│   └── error-search.js            — /오류검색 메타·help (검색 로직은 index.js)
├── shoplinker_markets.xlsx        — 판매처 정보 원본 (seller.js 빌드 소스)
├── scripts/
│   └── build-seller-guides.js     — xlsx → seller.js 변환 스크립트
├── wrangler.toml
├── package.json
└── test/
    └── local.js                   — 로컬 테스트 스크립트
```

---

## 가이드 추가·수정 방법

### 기존 가이드에 키워드 추가

해당 도메인 파일(예: `guides/allocation.js`)을 열고 `guides` 객체에 키워드를 추가합니다.

```js
"새키워드": "가이드 내용 (마크다운 사용 가능)",
```

`help` 텍스트에도 새 키워드를 목록에 추가합니다.

### `/판매처등록` 정보 수정 (xlsx 기반)

`shoplinker_markets.xlsx` 파일이 원본입니다. 직접 `guides/seller.js`를 수정하지 마세요.

1. `shoplinker_markets.xlsx` 편집 (판매처명·필요정보·가이드 URL·어드민 URL)
2. 빌드 스크립트 실행:

```bash
npm run build-sellers
```

3. 생성된 `guides/seller.js` 가 자동 업데이트됩니다.

판매처명 규칙:
- 슬래시(`/`)로 별칭 표시: `지그재그/포스티` → `지그재그`, `포스티` 두 키 등록
- 괄호 안 별칭: `신세계V(구 SI빌리지)` → `신세계V` + 별칭 `SI빌리지`
- 쉼표 구분 다중 별칭: `SSG (이마트, 신세계닷컴)` → `SSG` + `이마트` + `신세계닷컴`

### 새 명령어(도메인) 추가

1. `guides/새모듈.js` 파일을 기존 파일과 동일한 구조로 생성
2. `guides/index.js`에 한 줄 추가:

```js
'새명령어': 새모듈,
```

3. Slack 앱 설정에서 `/새명령어` 슬래시 커맨드를 동일한 Worker URL로 등록

`/사용법` 의 help 텍스트는 도메인별 키워드를 동적으로 읽어오므로, 새 도메인을 추가할 경우 `guides/usage.js` 에 도메인 import를 추가하면 안내문에 자동 반영됩니다.

### 변경 후 배포

```bash
npx wrangler deploy
```

---

## 배포 절차 (최초 1회)

### 1. 프로젝트 폴더 이동 및 의존성 설치

```bash
cd ~/Claude/shoplinker-bot
npm install
```

### 2. Cloudflare 로그인

```bash
npx wrangler login
```

### 3. Slack 앱 생성

[api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**

**OAuth & Permissions** → Bot Token Scopes 추가:
- `chat:write`
- `commands`

**Install App to Workspace** 후 Bot Token(`xoxb-...`) 복사

### 4. Cloudflare Secrets 등록

```bash
npx wrangler secret put SLACK_SIGNING_SECRET
# → Slack 앱 > Basic Information > Signing Secret 값 입력

npx wrangler secret put SLACK_BOT_TOKEN
# → Slack 앱 > OAuth & Permissions > Bot User OAuth Token 값 입력

npx wrangler secret put SUGGESTION_CHANNEL_ID
# → 건의 수신 채널 ID 입력 (채널 우클릭 > 채널 세부정보 > 맨 아래 ID)
```

### 5. 배포

```bash
npx wrangler deploy
```

출력된 URL(예: `https://techguide-bot.xxx.workers.dev`)을 복사합니다.

### 6. Slack Slash Commands 등록

Slack 앱 → **Slash Commands** → **Create New Command**  
아래 명령을 모두 동일한 Worker URL로 등록합니다.

| Command | Short Description | Usage Hint |
|---------|-------------------|------------|
| `/샵링커` | 샵링커 연동 가이드 | `<키워드>` |
| `/할당` | 할당 실패 대처법 | `<키워드>` |
| `/판매처등록` | 판매처별 연동 정보 | `<판매처명>` |
| `/입고요청서` | 입고요청서 가이드 | `<키워드>` |
| `/사용법` | 봇 전체 사용법 안내 | `[항목]` |
| `/오류검색` | 시스템 오류 메시지로 가이드 역검색 | `<메시지의 일부>` |

### 7. App Home 활성화 (선택)

Slack 앱 → **Event Subscriptions** → Enable Events ON  
→ Request URL 입력 → `app_home_opened` 이벤트 구독 추가

Slack 앱 → **App Home** → Home Tab 활성화

---

## 로컬 테스트

```bash
npm test
```

Node.js 18 이상 필요. Cloudflare 계정 없이 동작합니다.  
테스트 스크립트가 임시 서명 시크릿으로 유효한 요청을 직접 생성합니다.

---

## 보안

- Slack `x-slack-signature` 헤더를 HMAC-SHA256으로 검증합니다.
- 타임스탬프가 현재 시각과 300초(5분) 이상 차이나면 리플레이 공격으로 간주해 401 반환합니다.
- Slack 재시도 요청(`x-slack-retry-num`)은 중복 처리 없이 즉시 200 반환합니다.
- 모든 시크릿은 `wrangler secret`으로만 관리하며 코드에 포함되지 않습니다.
