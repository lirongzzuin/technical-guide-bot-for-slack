"""python -m app.list [--upcoming 30]"""
from __future__ import annotations

import argparse
import logging

from app.config import config
from app.db import list_upcoming
from app.timeutil import today_kst

logging.basicConfig(level=config.LOG_LEVEL, format="%(asctime)s %(levelname)s %(name)s %(message)s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--upcoming", type=int, default=30)
    args = parser.parse_args()

    today = today_kst()
    items = list_upcoming(args.upcoming, today)

    if not items:
        print(f"No integrations expiring within {args.upcoming} days.")
    else:
        print(f"{'고객사':<20} {'스토어':<20} {'연동일':<12} {'만료일':<12} {'알림일':<12} {'D-day':>6} {'상태'}")
        print("-" * 95)
        for item in items:
            days = (item.expiry_date - today).days
            print(
                f"{item.customer_name:<20} {item.store_name:<20} "
                f"{item.linked_at!s:<12} {item.expiry_date!s:<12} {item.notify_date!s:<12} "
                f"{days:>6} {item.status}"
            )
