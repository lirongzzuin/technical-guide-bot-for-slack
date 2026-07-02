from __future__ import annotations

from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import pytest

from app.models import Integration
from app.notifier_slack import build_message, send_notification


def _make_item(days_until_expiry: int, today: date) -> Integration:
    expiry = today + timedelta(days=days_until_expiry)
    return Integration(
        id=1, customer_name="테스트고객", store_name="테스트스토어",
        channel="coupang", integration_method="shoplinker",
        api_key_ref="****1234",
        linked_at=expiry - timedelta(days=180),
        validity_days=180,
        expiry_date=expiry,
        notify_date=today,
        status="active",
        notified_at=None, created_at=None, updated_at=None,
    )


class TestBuildMessage:
    def test_contains_customer_name(self):
        today = date(2026, 3, 1)
        item = _make_item(15, today)
        msg = build_message([item], [], today)
        text = str(msg)
        assert "테스트고객" in text

    def test_urgent_section_present(self):
        today = date(2026, 3, 1)
        expired = _make_item(-2, today)
        msg = build_message([], [expired], today)
        text = str(msg)
        assert "긴급" in text

    def test_no_urgent_section_when_empty(self):
        today = date(2026, 3, 1)
        item = _make_item(15, today)
        msg = build_message([item], [], today)
        text = str(msg)
        assert "긴급" not in text


class TestSendNotification:
    def test_returns_true_on_200(self):
        today = date(2026, 3, 1)
        item = _make_item(15, today)
        with patch("app.notifier_slack.requests.post") as mock_post:
            mock_post.return_value.status_code = 200
            mock_post.return_value.text = "ok"
            ok, status = send_notification([item], [], today)
        assert ok is True
        assert status == 200

    def test_returns_false_on_500(self):
        today = date(2026, 3, 1)
        item = _make_item(15, today)
        with patch("app.notifier_slack.requests.post") as mock_post:
            mock_post.return_value.status_code = 500
            mock_post.return_value.text = "error"
            ok, status = send_notification([item], [], today)
        assert ok is False

    def test_returns_false_on_exception(self):
        today = date(2026, 3, 1)
        item = _make_item(15, today)
        with patch("app.notifier_slack.requests.post", side_effect=Exception("network error")):
            ok, status = send_notification([item], [], today)
        assert ok is False
        assert status == 0

    def test_no_webhook_url(self, monkeypatch):
        import app.config as cfg
        monkeypatch.setattr(cfg.config, "SLACK_WEBHOOK_URL", "")
        today = date(2026, 3, 1)
        item = _make_item(15, today)
        ok, status = send_notification([item], [], today)
        assert ok is False
