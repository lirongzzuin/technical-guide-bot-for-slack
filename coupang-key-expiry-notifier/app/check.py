"""python -m app.check [--dry-run]"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import date

from app.config import config
from app.db import get_pending_notifications, mark_notified
from app.notifier_slack import send_notification
from app.timeutil import today_kst

logging.basicConfig(level=config.LOG_LEVEL, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)


def run_check(dry_run: bool = False, today: date | None = None) -> None:
    today = today or today_kst()
    pending = get_pending_notifications(today)

    if not pending:
        logger.info("No pending notifications for %s", today)
        return

    # 긴급: 만료일이 오늘 이전이거나 오늘인 건 (이미 만료 임박/경과)
    urgent = [i for i in pending if i.expiry_date <= today]
    normal = [i for i in pending if i.expiry_date > today]

    logger.info("Pending: normal=%d urgent=%d", len(normal), len(urgent))

    if dry_run:
        print(f"[DRY-RUN] {today} — would send {len(pending)} notification(s)")
        for item in urgent:
            print(f"  🚨 URGENT {item.customer_name}/{item.store_name} expires={item.expiry_date}")
        for item in normal:
            print(f"  📋 NORMAL {item.customer_name}/{item.store_name} expires={item.expiry_date}")
        return

    ok, status = send_notification(normal, urgent, today)
    if ok:
        ids = [i.id for i in pending if i.id is not None]
        mark_notified(ids)
        logger.info("Slack sent OK (status=%d), marked %d records", status, len(ids))
    else:
        # 발송 실패 → 마킹하지 않음 (다음 실행에 재시도)
        logger.error("Slack send FAILED (status=%d) — no records marked", status)
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", default=config.DRY_RUN)
    args = parser.parse_args()
    run_check(dry_run=args.dry_run)
