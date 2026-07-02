from __future__ import annotations

import logging

from app.ingestion.base import IngestionAdapter, IntegrationEvent

logger = logging.getLogger(__name__)


class DbPollingAdapter(IngestionAdapter):
    """
    사내 DB에서 신규/변경된 쿠팡 연동 이벤트를 SELECT하는 어댑터.
    스키마 확정 후 아래 TODO를 채워라.
    """

    def __init__(self):
        # TODO: 사내 DB 연결 정보 초기화 (env에서 로드)
        pass

    def fetch_events(self) -> list[IntegrationEvent]:
        # TODO: 사내 DB 스키마 확정 후 작성
        # 예시 쿼리 (실제 컬럼명/테이블명은 스키마에 맞게 수정):
        #
        # conn = get_internal_db_connection()
        # rows = conn.execute("""
        #     SELECT
        #         customer_name,
        #         store_name,
        #         'coupang'       AS channel,
        #         'shoplinker'    AS integration_method,
        #         masked_api_key  AS api_key_ref,
        #         linked_at::date AS linked_at
        #     FROM coupang_integrations
        #     WHERE updated_at > NOW() - INTERVAL '2 hours'
        #       AND status = 'active'
        # """).fetchall()
        # return [IntegrationEvent(**dict(r)) for r in rows]
        raise NotImplementedError(
            "DbPollingAdapter: 사내 DB 스키마 확정 후 fetch_events() 구현 필요"
        )
