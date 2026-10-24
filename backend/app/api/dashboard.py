"""Dashboard, demo clock, and demo reset."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.store import store
from app.views import dashboard_view

router = APIRouter(prefix="/api")


@router.get("/dashboard")
def dashboard() -> dict:
    return dashboard_view(store.all(), store.patients, store.today)


class ClockAction(BaseModel):
    advance_days: Optional[int] = None
    reset: bool = False


@router.get("/clock")
def get_clock() -> dict:
    return store.clock()


@router.post("/clock")
def set_clock(body: ClockAction) -> dict:
    if body.reset:
        store.reset_clock()
    elif body.advance_days in (1, 7):
        store.advance(body.advance_days)
    else:
        raise HTTPException(422, "Use advance_days 1 or 7, or reset")
    return store.clock()


@router.post("/reset")
def reset_demo() -> dict:
    store.reset()
    return {"ok": True, **store.clock()}
