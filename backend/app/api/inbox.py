"""PCP inbox: returned plans beside the original referral (R8.1)."""
from __future__ import annotations

from fastapi import APIRouter

from app import clock
from app.store import get_repo
from app.views import inbox_view

router = APIRouter(prefix="/api")


@router.get("/inbox")
def inbox() -> dict:
    repo = get_repo()
    return inbox_view(repo.all(), repo.patients(), clock.today(repo))
