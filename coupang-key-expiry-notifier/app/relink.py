"""python -m app.relink --customer "고객사" --store "스토어" --date YYYY-MM-DD [--key-ref ****1234]"""
from __future__ import annotations

import argparse
import logging
from datetime import date

from app.businessday import calc_expiry_date, calc_notify_date
from app.config import config
from app.db import upsert_integration

logging.basicConfig(level=config.LOG_LEVEL, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def run_relink(customer: str, store: str, linked_at: date, key_ref: str = "") -> None:
    expiry = calc_expiry_date(linked_at, config.VALIDITY_DAYS)
    notify = calc_notify_date(expiry, config.LEAD_DAYS, config.ROLL_DIRECTION)
    upsert_integration(
        customer_name=customer,
        store_name=store,
        channel="coupang",
        integration_method="shoplinker",
        api_key_ref=key_ref,
        linked_at=linked_at,
        expiry_date=expiry,
        notify_date=notify,
        validity_days=config.VALIDITY_DAYS,
    )
    print(f"Relinked: {customer}/{store} linked_at={linked_at} expiry={expiry} notify={notify}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--customer", required=True)
    parser.add_argument("--store", required=True)
    parser.add_argument("--date", required=True, dest="linked_at")
    parser.add_argument("--key-ref", default="")
    args = parser.parse_args()
    run_relink(
        customer=args.customer,
        store=args.store,
        linked_at=date.fromisoformat(args.linked_at),
        key_ref=args.key_ref,
    )
