from __future__ import annotations

import logging

from app.ingestion.base import IngestionAdapter, IntegrationEvent

logger = logging.getLogger(__name__)


class ShoplinkerApiAdapter(IngestionAdapter):
    """
    샵링커 API를 폴링해 연동 이벤트를 가져오는 어댑터.
    엔드포인트·인증 방식 확정 후 아래 TODO를 채워라.
    """

    def __init__(self):
        # TODO: 샵링커 API 엔드포인트/인증 정보 초기화
        # self.base_url = os.environ.get("SHOPLINKER_API_URL", "")
        # self.api_key  = os.environ.get("SHOPLINKER_API_KEY", "")
        pass

    def fetch_events(self) -> list[IntegrationEvent]:
        # TODO: 샵링커 API 엔드포인트/인증/응답 스키마 확정 후 작성
        # 예시:
        # resp = requests.get(
        #     f"{self.base_url}/v1/integrations",
        #     headers={"Authorization": f"Bearer {self.api_key}"},
        #     params={"channel": "coupang", "since": "..."},
        # )
        # resp.raise_for_status()
        # return [IntegrationEvent(...) for item in resp.json()["items"]]
        raise NotImplementedError(
            "ShoplinkerApiAdapter: 샵링커 API 스펙 확정 후 fetch_events() 구현 필요"
        )
