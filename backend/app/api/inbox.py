"""PCP inbox: returned plans beside the original referral (R8.1)."""
from __future__ import annotations

from fastapi import APIRouter

from app.store import store
from app.views import inbox_view

router = APIRouter(prefix="/api")


@router.get("/inbox")
def inbox() -> dict:
    return inbox_view(store.all(), store.patients, store.today)
