from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")


def now_kst() -> datetime:
    """현재 시각을 KST datetime으로 반환."""
    return datetime.now(tz=KST)


def today_kst() -> date:
    """오늘 날짜를 KST date로 반환."""
    return now_kst().date()
