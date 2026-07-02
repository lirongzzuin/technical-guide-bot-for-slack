from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date


@dataclass
class IntegrationEvent:
    """수집 어댑터가 반환하는 연동 이벤트 단위."""
    customer_name: str
    store_name: str
    channel: str = "coupang"
    integration_method: str = "shoplinker"
    api_key_ref: str = ""
    linked_at: date = None  # type: ignore[assignment]


class IngestionAdapter(ABC):
    """모든 수집 어댑터가 구현해야 하는 인터페이스."""

    @abstractmethod
    def fetch_events(self) -> list[IntegrationEvent]:
        """신규/변경된 연동 이벤트 목록을 반환."""
        ...
