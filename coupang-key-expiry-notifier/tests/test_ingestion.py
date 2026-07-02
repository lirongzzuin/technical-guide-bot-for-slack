from __future__ import annotations

import csv
import tempfile
from datetime import date
from pathlib import Path

import pytest

from app.ingestion.manual_csv import ManualCsvAdapter


class TestManualCsvAdapter:
    def test_loads_csv(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        with csv_file.open("w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["customer_name", "store_name", "api_key_ref", "linked_at"])
            writer.writeheader()
            writer.writerow({"customer_name": "고객A", "store_name": "스토어1", "api_key_ref": "****abcd", "linked_at": "2025-11-01"})

        adapter = ManualCsvAdapter(str(csv_file))
        events = adapter.fetch_events()
        assert len(events) == 1
        assert events[0].customer_name == "고객A"
        assert events[0].linked_at == date(2025, 11, 1)

    def test_missing_file_returns_empty(self):
        adapter = ManualCsvAdapter("/nonexistent/path.csv")
        assert adapter.fetch_events() == []

    def test_relink_resets_notified(self, tmp_db):
        """더 최신 linked_at upsert 시 notified_at이 NULL로 리셋되는지."""
        older = date(2025, 10, 1)
        newer = date(2026, 1, 1)
        from app.businessday import calc_expiry_date, calc_notify_date
        expiry_old = calc_expiry_date(older, 180)
        notify_old = calc_notify_date(expiry_old, 15)

        tmp_db.upsert_integration(
            customer_name="고객Z", store_name="스토어Z",
            channel="coupang", integration_method="shoplinker",
            api_key_ref="****old", linked_at=older,
            expiry_date=expiry_old, notify_date=notify_old, validity_days=180,
        )
        # notified_at 수동 마킹
        tmp_db.mark_notified([tmp_db.get_pending_notifications(notify_old)[0].id or 1])

        # 재연동
        expiry_new = calc_expiry_date(newer, 180)
        notify_new = calc_notify_date(expiry_new, 15)
        tmp_db.upsert_integration(
            customer_name="고객Z", store_name="스토어Z",
            channel="coupang", integration_method="shoplinker",
            api_key_ref="****new", linked_at=newer,
            expiry_date=expiry_new, notify_date=notify_new, validity_days=180,
        )

        from app.timeutil import today_kst
        pending = tmp_db.get_pending_notifications(notify_new)
        assert any(i.customer_name == "고객Z" and i.notified_at is None for i in pending)
