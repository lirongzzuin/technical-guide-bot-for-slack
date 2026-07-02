from __future__ import annotations

import json
import logging
from datetime import date
from pathlib import Path

import requests

from app.config import config

logger = logging.getLogger(__name__)

_CACHE_DIR = Path("./data")
_API_URL = "http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo"


def _cache_path(year: int) -> Path:
    return _CACHE_DIR / f"holidays_cache_{year}.json"


def _fetch_from_api(year: int) -> set[date] | None:
    """공공데이터포털 특일정보 API로 공휴일 조회."""
    if not config.DATA_GO_KR_API_KEY:
        return None
    try:
        resp = requests.get(
            _API_URL,
            params={
                "serviceKey": config.DATA_GO_KR_API_KEY,
                "solYear": str(year),
                "numOfRows": "50",
                "_type": "json",
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        items = data.get("response", {}).get("body", {}).get("items", {})
        if not items:
            return set()
        raw = items.get("item", [])
        if isinstance(raw, dict):
            raw = [raw]
        result: set[date] = set()
        for item in raw:
            locdate = str(item.get("locdate", ""))
            if len(locdate) == 8:
                result.add(date(int(locdate[:4]), int(locdate[4:6]), int(locdate[6:])))
        logger.info("API: fetched %d holidays for %d", len(result), year)
        return result
    except Exception as e:
        logger.warning("Holiday API error: %s", e)
        return None


def _fetch_from_library(year: int) -> set[date]:
    """holidays 라이브러리 fallback."""
    try:
        import holidays as hol
        kr = hol.SouthKorea(years=year)
        return set(kr.keys())
    except Exception as e:
        logger.warning("holidays library error: %s", e)
        return set()


def _load_holidays(year: int) -> set[date]:
    """캐시 → API → 라이브러리 순서로 공휴일 로드."""
    cache_file = _cache_path(year)
    if cache_file.exists():
        try:
            raw = json.loads(cache_file.read_text())
            return {date.fromisoformat(d) for d in raw}
        except Exception:
            pass

    holidays = _fetch_from_api(year)
    if holidays is None:
        logger.warning("API 미설정/실패 — holidays 라이브러리 fallback 사용 (year=%d)", year)
        holidays = _fetch_from_library(year)

    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(sorted(d.isoformat() for d in holidays)))
    return holidays


# 연도별 캐시 (프로세스 내 메모리)
_holiday_cache: dict[int, set[date]] = {}


def _get_holidays(year: int) -> set[date]:
    if year not in _holiday_cache:
        _holiday_cache[year] = _load_holidays(year)
    return _holiday_cache[year]


def is_holiday(d: date) -> bool:
    """해당 날짜가 한국 공휴일이면 True."""
    return d in _get_holidays(d.year)


def is_business_day(d: date) -> bool:
    """주말·공휴일이 아니면 True."""
    if d.weekday() >= 5:  # 5=토, 6=일
        return False
    return not is_holiday(d)


def invalidate_cache(year: int | None = None) -> None:
    """테스트용: 메모리 캐시 무효화."""
    if year is None:
        _holiday_cache.clear()
    else:
        _holiday_cache.pop(year, None)
