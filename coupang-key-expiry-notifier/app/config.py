from __future__ import annotations

import os
from dotenv import load_dotenv

load_dotenv()


def _bool(val: str | None, default: bool = False) -> bool:
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes")


def _int(val: str | None, default: int) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _list_int(val: str | None) -> list[int]:
    if not val or not val.strip():
        return []
    try:
        return [int(x.strip()) for x in val.split(",") if x.strip()]
    except ValueError:
        return []


class Config:
    SLACK_WEBHOOK_URL: str = os.environ.get("SLACK_WEBHOOK_URL", "")
    SLACK_MENTION: str = os.environ.get("SLACK_MENTION", "")

    DATA_GO_KR_API_KEY: str = os.environ.get("DATA_GO_KR_API_KEY", "")

    DB_PATH: str = os.environ.get("DB_PATH", "./data/notifier.db")

    VALIDITY_DAYS: int = _int(os.environ.get("VALIDITY_DAYS"), 180)
    LEAD_DAYS: int = _int(os.environ.get("LEAD_DAYS"), 15)
    ROLL_DIRECTION: str = os.environ.get("ROLL_DIRECTION", "backward")
    ESCALATION_REMINDERS: list[int] = _list_int(os.environ.get("ESCALATION_REMINDERS"))

    INGESTION_SOURCE: str = os.environ.get("INGESTION_SOURCE", "manual_csv")
    SEED_CSV_PATH: str = os.environ.get("SEED_CSV_PATH", "./data/seed.csv")

    DRY_RUN: bool = _bool(os.environ.get("DRY_RUN"))
    LOG_LEVEL: str = os.environ.get("LOG_LEVEL", "INFO")


config = Config()
