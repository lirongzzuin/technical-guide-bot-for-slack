from __future__ import annotations

import os
import tempfile
from datetime import date
from pathlib import Path

import pytest

# 테스트 시 실제 DB/외부 API 사용 방지
os.environ.setdefault("DB_PATH", ":memory:")
os.environ.setdefault("INGESTION_SOURCE", "manual_csv")
os.environ.setdefault("SLACK_WEBHOOK_URL", "http://mock-slack")
os.environ.setdefault("DATA_GO_KR_API_KEY", "")


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    """테스트별 격리된 SQLite DB."""
    db_file = tmp_path / "test.db"
    monkeypatch.setenv("DB_PATH", str(db_file))
    # config 재로드
    import importlib
    import app.config as cfg_mod
    importlib.reload(cfg_mod)
    from app.config import config
    config.DB_PATH = str(db_file)

    from app import db as db_mod
    importlib.reload(db_mod)
    db_mod.init_db()
    yield db_mod


@pytest.fixture
def fixed_holidays(monkeypatch):
    """공휴일 API/라이브러리를 mock으로 대체."""
    import app.holidays_kr as hkr
    # 테스트용 고정 공휴일: 2025-01-01, 2025-01-28~30(설연휴)
    fixed = {
        date(2025, 1, 1),
        date(2025, 1, 28),
        date(2025, 1, 29),
        date(2025, 1, 30),
        date(2025, 5, 5),  # 어린이날
        date(2026, 1, 1),
        date(2026, 5, 5),
    }
    monkeypatch.setattr(hkr, "_holiday_cache", {2025: fixed, 2026: fixed})
    return fixed
