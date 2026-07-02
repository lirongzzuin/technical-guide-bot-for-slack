from __future__ import annotations

from app.config import config
from app.ingestion.base import IngestionAdapter


def get_adapter() -> IngestionAdapter:
    """INGESTION_SOURCE 환경변수로 활성 어댑터를 반환."""
    source = config.INGESTION_SOURCE.lower()
    if source == "manual_csv":
        from app.ingestion.manual_csv import ManualCsvAdapter
        return ManualCsvAdapter()
    elif source == "db_polling":
        from app.ingestion.db_polling import DbPollingAdapter
        return DbPollingAdapter()
    elif source == "shoplinker":
        from app.ingestion.shoplinker_api import ShoplinkerApiAdapter
        return ShoplinkerApiAdapter()
    else:
        raise ValueError(f"Unknown INGESTION_SOURCE: {source!r}")
