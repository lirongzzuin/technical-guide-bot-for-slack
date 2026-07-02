"""python -m app.ingest"""
from __future__ import annotations

import logging

from app.businessday import calc_expiry_date, calc_notify_date
from app.config import config
from app.db import upsert_integration
from app.ingestion.factory import get_adapter

logging.basicConfig(level=config.LOG_LEVEL, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)


def run_ingest() -> int:
    adapter = get_adapter()
    events = adapter.fetch_events()
    count = 0
    for ev in events:
        expiry = calc_expiry_date(ev.linked_at, config.VALIDITY_DAYS)
        notify = calc_notify_date(expiry, config.LEAD_DAYS, config.ROLL_DIRECTION)
        upsert_integration(
            customer_name=ev.customer_name,
            store_name=ev.store_name,
            channel=ev.channel,
            integration_method=ev.integration_method,
            api_key_ref=ev.api_key_ref,
            linked_at=ev.linked_at,
            expiry_date=expiry,
            notify_date=notify,
            validity_days=config.VALIDITY_DAYS,
        )
        count += 1
    logger.info("Ingest done: %d events processed", count)
    return count


if __name__ == "__main__":
    n = run_ingest()
    print(f"Ingested {n} events.")
