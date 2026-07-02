"""python -m app.init_db"""
from __future__ import annotations

import logging

from app.config import config
from app.db import init_db

logging.basicConfig(level=config.LOG_LEVEL, format="%(asctime)s %(levelname)s %(name)s %(message)s")

if __name__ == "__main__":
    init_db()
    print("DB initialized:", config.DB_PATH)
