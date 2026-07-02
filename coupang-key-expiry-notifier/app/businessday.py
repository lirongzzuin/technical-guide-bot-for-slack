from __future__ import annotations

from datetime import date, timedelta

from app.holidays_kr import is_business_day


def resolve_business_day(d: date, direction: str = "backward") -> date:
    """
    d가 영업일이면 그대로 반환.
    아니면 direction에 따라 가장 가까운 영업일로 이동:
      backward: 하루씩 앞당김 (사전 고지 리드타임 보존, 기본값)
      forward:  하루씩 미룸
    """
    step = timedelta(days=-1) if direction == "backward" else timedelta(days=1)
    current = d
    while not is_business_day(current):
        current += step
    return current


def calc_expiry_date(linked_at: date, validity_days: int) -> date:
    return linked_at + timedelta(days=validity_days)


def calc_notify_date(expiry_date: date, lead_days: int, direction: str = "backward") -> date:
    raw = expiry_date - timedelta(days=lead_days)
    return resolve_business_day(raw, direction=direction)
