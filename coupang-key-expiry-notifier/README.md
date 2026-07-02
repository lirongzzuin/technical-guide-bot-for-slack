# 쿠팡 API키 만료 사전 알림 시스템

쿠팡(샵링커) 주문수집 API키의 만료 15영업일 전에 슬랙으로 자동 알림을 보내는 경량 Python 자동화 도구입니다.

## 설치

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # .env 편집 후 사용
```

## 환경 변수 설정 (.env)

| 변수 | 설명 | 기본값 |
|---|---|---|
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL | (필수) |
| `SLACK_MENTION` | 알림 시 멘션 (예: `<!here>`) | - |
| `DATA_GO_KR_API_KEY` | 공공데이터포털 API키 (공휴일) | - |
| `DB_PATH` | SQLite DB 경로 | `./data/notifier.db` |
| `VALIDITY_DAYS` | API키 유효 기간(일) | `180` |
| `LEAD_DAYS` | 만료 N일 전 알림 | `15` |
| `ROLL_DIRECTION` | 영업일 보정 방향 (`backward`/`forward`) | `backward` |
| `INGESTION_SOURCE` | 수집 어댑터 | `manual_csv` |
| `SEED_CSV_PATH` | seed CSV 경로 | `./data/seed.csv` |

## 실행 명령

```bash
# 1. DB 초기화
python -m app.init_db

# 2. 연동 이벤트 수집 (seed.csv → DB upsert)
python -m app.ingest

# 3. 일일 체크 (슬랙 발송)
python -m app.check

# 4. dry-run (발송/DB 변경 없이 확인)
python -m app.check --dry-run

# 5. 재연동 수동 입력
python -m app.relink --customer "고객사명" --store "스토어명" --date 2026-05-01 --key-ref "****1234"

# 6. 만료 예정 목록 조회
python -m app.list --upcoming 30
```

## 영업일 보정 (ROLL_DIRECTION)

- **backward (기본)**: raw_notify가 토/일/공휴일이면 **앞 영업일**로 이동 → 사전 고지 리드타임 보존
- **forward**: raw_notify가 토/일/공휴일이면 **뒷 영업일**로 이동

## 보안 원칙

> **실제 쿠팡/샵링커 API 키·시크릿은 절대 이 시스템에 저장하지 않습니다.**
> DB에는 마스킹된 식별자(`api_key_ref`, 예: `****1234`)만 저장합니다.

## 감지 소스 확정 시 스텁 채우기 가이드

현재 `INGESTION_SOURCE=manual_csv`가 기본이며, `db_polling`/`shoplinker` 어댑터는 스텁입니다.

### DbPollingAdapter 채우기 (`app/ingestion/db_polling.py`)

1. 사내 DB 연결 정보를 환경변수에 추가 (`.env.example` 참고)
2. `fetch_events()` 안의 `# TODO` 주석을 실제 SELECT 쿼리로 교체
3. `INGESTION_SOURCE=db_polling`으로 변경

### ShoplinkerApiAdapter 채우기 (`app/ingestion/shoplinker_api.py`)

1. `SHOPLINKER_API_URL`, `SHOPLINKER_API_KEY` 환경변수 추가
2. `fetch_events()` 안의 `# TODO`를 실제 API 호출 코드로 교체
3. `INGESTION_SOURCE=shoplinker`으로 변경

## cron 등록

```bash
crontab -e
# crontab.example 내용 참고
```

## 테스트

```bash
pytest tests/ -v
```
