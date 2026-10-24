"""Process-wide repository handle. Tests swap it with set_repo(Repo(":memory:"))."""
from __future__ import annotations

from typing import Optional

from app.config import DB_PATH
from app.db import Repo

_repo: Optional[Repo] = None


def get_repo() -> Repo:
    global _repo
    if _repo is None:
        _repo = Repo(DB_PATH)
    return _repo


def set_repo(repo: Repo) -> None:
    global _repo
    _repo = repo
