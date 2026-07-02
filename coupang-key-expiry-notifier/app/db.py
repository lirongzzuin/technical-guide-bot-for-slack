from __future__ import annotations

import logging
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
from typing import Generator

from app.config import config
from app.models import Integration
from app.timeutil import now_kst

logger = logging.getLogger(__name__)


@contextmanager
def get_conn() -> Generator[sqlite3.Connection, None, None]:
    """DB 연결 컨텍스트 매니저. 추후 PostgreSQL/MySQL로 교체 시 이 함수만 수정."""
    db_path = Path(config.DB_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """테이블 생성 (idempotent)."""
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS integrations (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_name       TEXT    NOT NULL,
                store_name          TEXT    NOT NULL,
                channel             TEXT    NOT NULL DEFAULT 'coupang',
                integration_method  TEXT    NOT NULL DEFAULT 'shoplinker',
                api_key_ref         TEXT    NOT NULL DEFAULT '',
                linked_at           TEXT    NOT NULL,
                validity_days       INTEGER NOT NULL DEFAULT 180,
                expiry_date         TEXT    NOT NULL,
                notify_date         TEXT    NOT NULL,
                status              TEXT    NOT NULL DEFAULT 'active',
                notified_at         TEXT,
                created_at          TEXT    NOT NULL,
                updated_at          TEXT    NOT NULL,
                UNIQUE (customer_name, store_name, channel)
            )
        """)
    logger.info("DB initialized: %s", config.DB_PATH)


def upsert_integration(
    customer_name: str,
    store_name: str,
    channel: str,
    integration_method: str,
    api_key_ref: str,
    linked_at: date,
    expiry_date: date,
    notify_date: date,
    validity_days: int,
) -> None:
    """
    신규면 INSERT, 기존이면 linked_at이 더 최신일 때만 UPDATE.
    재연동 감지 시 notified_at을 NULL로 리셋해 다음 알림 사이클을 재시작한다.
    """
    now = now_kst().isoformat()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT linked_at FROM integrations WHERE customer_name=? AND store_name=? AND channel=?",
            (customer_name, store_name, channel),
        ).fetchone()

        if existing is None:
            conn.execute(
                """
                INSERT INTO integrations
                  (customer_name, store_name, channel, integration_method, api_key_ref,
                   linked_at, validity_days, expiry_date, notify_date,
                   status, notified_at, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    customer_name, store_name, channel, integration_method, api_key_ref,
                    linked_at.isoformat(), validity_days,
                    expiry_date.isoformat(), notify_date.isoformat(),
                    "active", None, now, now,
                ),
            )
            logger.info("INSERT integration: %s / %s", customer_name, store_name)
        else:
            existing_linked_at = date.fromisoformat(existing["linked_at"])
            if linked_at > existing_linked_at:
                # 재연동: notified_at 리셋으로 다음 사이클에 알림 재발송
                conn.execute(
                    """
                    UPDATE integrations SET
                      integration_method=?, api_key_ref=?,
                      linked_at=?, validity_days=?, expiry_date=?, notify_date=?,
                      status='active', notified_at=NULL, updated_at=?
                    WHERE customer_name=? AND store_name=? AND channel=?
                    """,
                    (
                        integration_method, api_key_ref,
                        linked_at.isoformat(), validity_days,
                        expiry_date.isoformat(), notify_date.isoformat(),
                        now, customer_name, store_name, channel,
                    ),
                )
                logger.info("UPDATE (relink) integration: %s / %s", customer_name, store_name)
            else:
                logger.debug("SKIP (not newer): %s / %s", customer_name, store_name)


def get_pending_notifications(today: date) -> list[Integration]:
    """오늘 기준으로 발송 대상(notify_date <= today, 미발송, active)을 반환."""
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT * FROM integrations
            WHERE status='active' AND notified_at IS NULL AND notify_date <= ?
            ORDER BY notify_date ASC
            """,
            (today.isoformat(),),
        ).fetchall()
    return [_row_to_model(r) for r in rows]


def mark_notified(ids: list[int]) -> None:
    """슬랙 발송 성공 후 notified_at 마킹."""
    if not ids:
        return
    now = now_kst().isoformat()
    placeholders = ",".join("?" * len(ids))
    with get_conn() as conn:
        conn.execute(
            f"UPDATE integrations SET notified_at=?, updated_at=? WHERE id IN ({placeholders})",
            [now, now, *ids],
        )
    logger.info("Marked notified: ids=%s", ids)


def list_upcoming(within_days: int, today: date) -> list[Integration]:
    """today 기준 within_days 이내 만료 예정 목록."""
    from datetime import timedelta
    upper = today + timedelta(days=within_days)
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT * FROM integrations
            WHERE status='active' AND expiry_date BETWEEN ? AND ?
            ORDER BY expiry_date ASC
            """,
            (today.isoformat(), upper.isoformat()),
        ).fetchall()
    return [_row_to_model(r) for r in rows]


def _row_to_model(row: sqlite3.Row) -> Integration:
    return Integration(
        id=row["id"],
        customer_name=row["customer_name"],
        store_name=row["store_name"],
        channel=row["channel"],
        integration_method=row["integration_method"],
        api_key_ref=row["api_key_ref"],
        linked_at=date.fromisoformat(row["linked_at"]),
        validity_days=row["validity_days"],
        expiry_date=date.fromisoformat(row["expiry_date"]),
        notify_date=date.fromisoformat(row["notify_date"]),
        status=row["status"],
        notified_at=datetime.fromisoformat(row["notified_at"]) if row["notified_at"] else None,
        created_at=datetime.fromisoformat(row["created_at"]) if row["created_at"] else None,
        updated_at=datetime.fromisoformat(row["updated_at"]) if row["updated_at"] else None,
    )
