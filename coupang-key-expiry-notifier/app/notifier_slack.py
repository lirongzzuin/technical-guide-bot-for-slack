from __future__ import annotations

import logging
from datetime import date

import requests

from app.config import config
from app.models import Integration
from app.timeutil import today_kst

logger = logging.getLogger(__name__)


def _days_until(expiry: date, today: date) -> int:
    return (expiry - today).days


def _build_integration_block(item: Integration, today: date, urgent: bool) -> dict:
    days = _days_until(item.expiry_date, today)
    prefix = "🚨 " if urgent else "•"
    text = (
        f"{prefix} *{item.customer_name}* / {item.store_name}\n"
        f"  만료 예정일: `{item.expiry_date}` (D{days:+d})\n"
        f"  연동일: `{item.linked_at}` | 키 식별자: `{item.api_key_ref or '-'}`"
    )
    return {"type": "section", "text": {"type": "mrkdwn", "text": text}}


def build_message(normal: list[Integration], urgent: list[Integration], today: date) -> dict:
    """Block Kit 메시지 조립."""
    mention = f"{config.SLACK_MENTION} " if config.SLACK_MENTION else ""
    total = len(normal) + len(urgent)

    blocks: list[dict] = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": "⏰ 쿠팡 API키 만료 사전 알림 (D-15 영업일 기준)",
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"{mention}발송일: *{today}* | 총 {total}건",
            },
        },
        {"type": "divider"},
    ]

    if urgent:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": "*🚨 긴급 / 이미 만료 임박·경과*"},
        })
        for item in urgent:
            blocks.append(_build_integration_block(item, today, urgent=True))
        blocks.append({"type": "divider"})

    if normal:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": "*📋 사전 알림 대상*"},
        })
        for item in normal:
            blocks.append(_build_integration_block(item, today, urgent=False))
        blocks.append({"type": "divider"})

    blocks.append({
        "type": "context",
        "elements": [
            {
                "type": "mrkdwn",
                "text": f"총 {total}건 | 재연동 완료 후 본 시스템에 갱신 입력 필요 (`python -m app.relink`)",
            }
        ],
    })

    return {"blocks": blocks}


def send_notification(normal: list[Integration], urgent: list[Integration], today: date | None = None) -> tuple[bool, int]:
    """슬랙 Incoming Webhook으로 발송. (ok, status_code) 반환."""
    today = today or today_kst()
    payload = build_message(normal, urgent, today)

    if not config.SLACK_WEBHOOK_URL:
        logger.error("SLACK_WEBHOOK_URL 미설정")
        return False, 0

    try:
        resp = requests.post(config.SLACK_WEBHOOK_URL, json=payload, timeout=10)
        ok = 200 <= resp.status_code < 300
        if not ok:
            logger.error("Slack error: status=%d body=%s", resp.status_code, resp.text[:200])
        return ok, resp.status_code
    except Exception as e:
        logger.error("Slack request failed: %s", e)
        return False, 0
