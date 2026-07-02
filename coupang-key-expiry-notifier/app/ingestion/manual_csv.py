from __future__ import annotations

import csv
import logging
from datetime import date
from pathlib import Path

from app.config import config
from app.ingestion.base import IngestionAdapter, IntegrationEvent

logger = logging.getLogger(__name__)


class ManualCsvAdapter(IngestionAdapter):
    """
    seed CSV(또는 구글시트 export CSV)를 읽어 연동 이벤트를 반환.
    CSV 헤더: customer_name,store_name,api_key_ref,linked_at[,channel,integration_method]
    linked_at 형식: YYYY-MM-DD
    """

    def __init__(self, csv_path: str | None = None):
        self.csv_path = Path(csv_path or config.SEED_CSV_PATH)

    def fetch_events(self) -> list[IntegrationEvent]:
        if not self.csv_path.exists():
            logger.warning("seed CSV not found: %s", self.csv_path)
            return []

        events: list[IntegrationEvent] = []
        with self.csv_path.open(newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    linked_at = date.fromisoformat(row["linked_at"].strip())
                    events.append(IntegrationEvent(
                        customer_name=row["customer_name"].strip(),
                        store_name=row["store_name"].strip(),
                        channel=row.get("channel", "coupang").strip() or "coupang",
                        integration_method=row.get("integration_method", "shoplinker").strip() or "shoplinker",
                        api_key_ref=row.get("api_key_ref", "").strip(),
                        linked_at=linked_at,
                    ))
                except (KeyError, ValueError) as e:
                    logger.warning("CSV row skip (error=%s): %s", e, dict(row))

        logger.info("ManualCsvAdapter: loaded %d events from %s", len(events), self.csv_path)
        return events
