from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime


@dataclass
class Integration:
    id: int | None
    customer_name: str
    store_name: str
    channel: str
    integration_method: str
    api_key_ref: str
    linked_at: date
    validity_days: int
    expiry_date: date
    notify_date: date
    status: str
    notified_at: datetime | None
    created_at: datetime | None
    updated_at: datetime | None
