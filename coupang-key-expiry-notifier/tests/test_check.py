from __future__ import annotations

import importlib
from datetime import date, timedelta
from unittest.mock import patch

import pytest

from app.businessday import calc_expiry_date, calc_notify_date
from app.config import config


def _insert(db_mod, customer, store, linked_at: date, today: date):
    """헬퍼: notify_date = today로 강제 삽입."""
    expiry = calc_expiry_date(linked_at, 180)
    db_mod.upsert_integration(
        customer_name=customer, store_name=store,
        channel="coupang", integration_method="shoplinker",
        api_key_ref="****test", linked_at=linked_at,
        expiry_date=expiry, notify_date=today, validity_days=180,
    )


class TestIdempotency:
    def test_sends_once_per_notify_date(self, tmp_db):
        today = date(2026, 3, 10)
        linked = today - timedelta(days=165)
        _insert(tmp_db, "고객A", "스토어1", linked, today)

        with patch("app.notifier_slack.requests.post") as mock_post:
            mock_post.return_value.__class__ = type("R", (), {"status_code": 200, "text": "ok"})()
            mock_post.return_value.status_code = 200
            mock_post.return_value.text = "ok"

            from app.check import run_check
            run_check(today=today)
            run_check(today=today)  # 2번째 실행

        # post는 1번만 호출됐어야 함
        assert mock_post.call_count == 1


class TestMissedDayRecovery:
    def test_past_notify_date_still_sends(self, tmp_db):
        today = date(2026, 3, 15)
        yesterday = today - timedelta(days=1)
        linked = today - timedelta(days=165)
        _insert(tmp_db, "고객B", "스토어2", linked, yesterday)  # notify_date가 어제

        with patch("app.notifier_slack.requests.post") as mock_post:
            mock_post.return_value.status_code = 200
            mock_post.return_value.text = "ok"

            from app.check import run_check
            run_check(today=today)

        assert mock_post.call_count == 1


class TestSlackFailureRollback:
    def test_no_mark_on_slack_failure(self, tmp_db):
        today = date(2026, 3, 20)
        linked = today - timedelta(days=165)
        _insert(tmp_db, "고객C", "스토어3", linked, today)

        with patch("app.notifier_slack.requests.post") as mock_post:
            mock_post.return_value.status_code = 500
            mock_post.return_value.text = "error"

            from app.check import run_check
            with pytest.raises(SystemExit):
                run_check(today=today)

        # 마킹 안 됐는지 확인
        pending = tmp_db.get_pending_notifications(today)
        assert len(pending) == 1
        assert pending[0].notified_at is None


class TestDryRun:
    def test_no_db_change_no_slack(self, tmp_db, capsys):
        today = date(2026, 3, 25)
        linked = today - timedelta(days=165)
        _insert(tmp_db, "고객D", "스토어4", linked, today)

        with patch("app.notifier_slack.requests.post") as mock_post:
            from app.check import run_check
            run_check(dry_run=True, today=today)

        mock_post.assert_not_called()
        pending = tmp_db.get_pending_notifications(today)
        assert pending[0].notified_at is None

        captured = capsys.readouterr()
        assert "DRY-RUN" in captured.out


class TestUrgentSection:
    def test_expired_goes_to_urgent(self, tmp_db):
        today = date(2026, 4, 1)
        linked = today - timedelta(days=200)  # 이미 만료
        expiry = calc_expiry_date(linked, 180)
        tmp_db.upsert_integration(
            customer_name="고객E", store_name="스토어5",
            channel="coupang", integration_method="shoplinker",
            api_key_ref="****urg", linked_at=linked,
            expiry_date=expiry, notify_date=today - timedelta(days=5),
            validity_days=180,
        )

        normal_list, urgent_list = [], []
        with patch("app.check.send_notification", return_value=(True, 200)) as mock_send, \
             patch("app.check.mark_notified"):
            from app.check import run_check
            run_check(today=today)
            _, kwargs = mock_send.call_args
            # send_notification(normal, urgent, today)
            args = mock_send.call_args[0]
            normal_list = args[0]
            urgent_list = args[1]

        assert len(urgent_list) == 1
        assert len(normal_list) == 0
