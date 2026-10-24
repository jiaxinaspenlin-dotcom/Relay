"""Sign-in endpoints and the request user helpers.

Every /api route needs a signed-in user except: health, config, auth, the office link (token
only), sample-data loading on a brand-new install (no accounts yet), and the test reset (only
when RELAY_E2E=1)."""
from __future__ import annotations

import os
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.auth import COOKIE, SAMPLE_USERS, SESSION_HOURS, AuthError, User, secure_cookie
from app.store import get_repo

router = APIRouter(prefix="/api/auth")

PUBLIC_PREFIXES = ("/api/health", "/api/config", "/api/auth/", "/api/office/")


def is_public(request: Request) -> bool:
    p = request.url.path
    if not p.startswith("/api/") or p.startswith(PUBLIC_PREFIXES):
        return True
    if p == "/api/test/reset" and os.environ.get("RELAY_E2E") == "1":
        return True
    # A brand-new install has no accounts: allow loading sample data to get the sample accounts.
    if p == "/api/sample-data" and request.method == "POST" and get_repo().users.count() == 0:
        return True
    return False


async def auth_middleware(request: Request, call_next):
    user = get_repo().users.session_user(request.cookies.get(COOKIE))
    request.state.user = user
    if user is None and not is_public(request):
        return JSONResponse({"detail": "Sign in to continue"}, status_code=401)
    return await call_next(request)


def current_user(request: Request) -> User:
    u = getattr(request.state, "user", None)
    if u is None:
        raise HTTPException(401, "Sign in to continue")
    return u


def require_role(request: Request, role: str, what: str) -> User:
    u = current_user(request)
    if u.role != role:
        raise HTTPException(403, f"Only a {role} can {what}")
    return u


def _set_cookie(resp: Response, token: str) -> None:
    resp.set_cookie(COOKIE, token, httponly=True, samesite="lax", secure=secure_cookie(),
                    max_age=SESSION_HOURS * 3600, path="/")


class SignIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)


@router.post("/sign-in")
def sign_in(body: SignIn, response: Response) -> dict:
    users = get_repo().users
    try:
        user = users.verify(body.email, body.password)
    except AuthError as e:
        raise HTTPException(401, str(e)) from e
    _set_cookie(response, users.start_session(user))
    return {"user": user.public(), "home": "/inbox" if user.role == "clinician" else "/"}


@router.post("/sign-out")
def sign_out(request: Request, response: Response) -> dict:
    get_repo().users.end_session(request.cookies.get(COOKIE))
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(request: Request) -> dict:
    u = current_user(request)
    return {"user": u.public(), "home": "/inbox" if u.role == "clinician" else "/"}


@router.get("/status")
def status() -> dict:
    """What the sign-in page shows: first-run setup when there are no accounts, and the sample
    buttons only while sample data (and so the sample accounts) is loaded."""
    repo = get_repo()
    has_sample = repo.has_sample()
    return {
        "has_users": repo.users.count() > 0,
        "has_sample": has_sample,
        "sample_accounts": [{"role": u["role"], "email": u["email"], "name": u["name"]} for u in SAMPLE_USERS] if has_sample else [],
    }


class SampleSignIn(BaseModel):
    role: Literal["coordinator", "clinician"]


@router.post("/sample-sign-in")
def sample_sign_in(body: SampleSignIn, response: Response) -> dict:
    """Sign in as a sample account. Works only while sample data is loaded."""
    repo = get_repo()
    if not repo.has_sample():
        raise HTTPException(404, "Sample accounts are available only while sample data is loaded")
    user = repo.users.sample_user(body.role)
    if user is None:
        raise HTTPException(404, "Sample account not found. Reload sample data.")
    _set_cookie(response, repo.users.start_session(user))
    return {"user": user.public(), "home": "/inbox" if user.role == "clinician" else "/"}


class Setup(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=3, max_length=200, pattern=r"^[^@\s]+@[^@\s]+$")
    password: str = Field(min_length=8, max_length=200)
    practice: str = Field(min_length=1, max_length=200)


@router.post("/setup", status_code=201)
def first_account(body: Setup, response: Response) -> dict:
    """First-run only: create the first coordinator account when none exist."""
    repo = get_repo()
    if repo.users.count() > 0:
        raise HTTPException(409, "Accounts already exist. Sign in instead.")
    try:
        user = repo.users.create(name=body.name, email=body.email, role="coordinator",
                                 practice=body.practice, password=body.password)
    except AuthError as e:
        raise HTTPException(422, str(e)) from e
    practice = dict(repo.setting("practice"))
    practice.update(practice=body.practice, coordinator=body.name)
    repo.set_setting("practice", practice)
    _set_cookie(response, repo.users.start_session(user))
    return {"user": user.public(), "home": "/"}


class NewUser(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=3, max_length=200, pattern=r"^[^@\s]+@[^@\s]+$")
    password: str = Field(min_length=8, max_length=200)
    role: Literal["coordinator", "clinician"]


@router.post("/users", status_code=201)
def add_user(body: NewUser, request: Request) -> dict:
    """A coordinator adds a colleague at the same practice."""
    me_ = require_role(request, "coordinator", "add accounts")
    try:
        u = get_repo().users.create(name=body.name, email=body.email, role=body.role,
                                    practice=me_.practice, password=body.password)
    except AuthError as e:
        raise HTTPException(422, str(e)) from e
    return {"user": u.public()}
