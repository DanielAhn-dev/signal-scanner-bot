"""Shared .env loader for standalone scripts."""
from __future__ import annotations

import os


def load_env(filepath: str = ".env") -> None:
    try:
        with open(filepath, encoding="utf-8-sig") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass
