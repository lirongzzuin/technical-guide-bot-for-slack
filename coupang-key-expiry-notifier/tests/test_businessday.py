from __future__ import annotations

from datetime import date

import pytest

from app.businessday import calc_notify_date, resolve_business_day


class TestResolveBusinessDay:
    def test_weekday_unchanged(self, fixed_holidays):
        # 2025-03-05 수요일 → 그대로
        assert resolve_business_day(date(2025, 3, 5)) == date(2025, 3, 5)

    def test_saturday_backward(self, fixed_holidays):
        # 토요일 → backward → 금요일
        assert resolve_business_day(date(2025, 3, 8), "backward") == date(2025, 3, 7)

    def test_sunday_backward(self, fixed_holidays):
        # 일요일 → backward → 금요일
        assert resolve_business_day(date(2025, 3, 9), "backward") == date(2025, 3, 7)

    def test_saturday_forward(self, fixed_holidays):
        # 토요일 → forward → 월요일
        assert resolve_business_day(date(2025, 3, 8), "forward") == date(2025, 3, 10)

    def test_holiday_backward(self, fixed_holidays):
        # 어린이날(월) 2025-05-05 → backward → 금 2025-05-02
        assert resolve_business_day(date(2025, 5, 5), "backward") == date(2025, 5, 2)

    def test_lunar_holiday_consecutive(self, fixed_holidays):
        # fixed_holidays: 2025-01-28(화)~30(목) 설연휴, 2025-01-27(월)은 미포함
        # 2025-01-28 backward → 가장 가까운 영업일 2025-01-27(월)
        assert resolve_business_day(date(2025, 1, 28), "backward") == date(2025, 1, 27)

    def test_new_year_backward(self, fixed_holidays):
        # 2025-01-01 공휴일 → backward → 2024-12-31 (화) — 공휴일 캐시 없어도 정상 처리
        result = resolve_business_day(date(2025, 1, 1), "backward")
        assert result < date(2025, 1, 1)


class TestCalcNotifyDate:
    def test_normal(self, fixed_holidays):
        expiry = date(2025, 6, 20)  # 금
        notify = calc_notify_date(expiry, lead_days=15, direction="backward")
        # 2025-06-05 목요일 → 평일이므로 그대로
        assert notify == date(2025, 6, 5)

    def test_lands_on_weekend(self, fixed_holidays):
        # expiry=2025-06-22(일), raw_notify=2025-06-07(토) → backward → 금 2025-06-06
        notify = calc_notify_date(date(2025, 6, 22), lead_days=15, direction="backward")
        assert notify == date(2025, 6, 6)
