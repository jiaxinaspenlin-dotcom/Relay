"""Sign-in: users, argon2 password hashes, and HttpOnly session cookies.

Sessions are random 256-bit tokens; only their SHA-256 hash is stored. The cookie is HttpOnly and
SameSite=Lax (Secure when RELAY_SECURE_COOKIE=1, for HTTPS deployments). Office pages
(/office/{token}) never use accounts.

Sample accounts (Sam Ortiz, coordinator; Dr. Avery Lin, clinician) exist only while sample data
is loaded; their passwords are in the README.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import uuid
from dataclasses import asdict, dataclass
from datetime import timedelta
from typing import Optional

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app import config

COOKIE = "relay_session"
SESSION_HOURS = 12
_hasher = PasswordHasher()

SAMPLE_PRACTICE = "Quabbin Hills Family Medicine"
SAMPLE_USERS = [
    {"name": "Sam Ortiz", "email": "sam.ortiz@quabbinhills.example", "role": "coordinator",
     "password": "relay-coordinator"},
    {"name": "Dr. Avery Lin", "email": "avery.lin@quabbinhills.example", "role": "clinician",
     "password": "relay-clinician"},
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    role TEXT NOT NULL CHECK (role IN ('coordinator', 'clinician')),
    practice TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    sample INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires TEXT NOT NULL
);
"""


@dataclass(frozen=True)
class User:
    id: str
    name: str
    email: str
    role: str  # coordinator | clinician
    practice: str
    sample: bool = False

    def public(self) -> dict:
        return asdict(self)


class AuthError(ValueError):
    pass


def secure_cookie() -> bool:
    return os.environ.get("RELAY_SECURE_COOKIE", "") == "1"


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Users:
    """User and session storage on the Repo's SQLite connection (same lock)."""

    def __init__(self, repo) -> None:
        self.repo = repo
        with repo._lock:
            repo.conn.executescript(SCHEMA)
            repo.conn.commit()

    def _row(self, r) -> User:
        return User(r["id"], r["name"], r["email"], r["role"], r["practice"], bool(r["sample"]))

    def count(self) -> int:
        return self.repo._one("SELECT COUNT(*) FROM users")[0]

    def create(self, *, name: str, email: str, role: str, practice: str, password: str,
               sample: bool = False) -> User:
        if role not in ("coordinator", "clinician"):
            raise AuthError("Role must be coordinator or clinician")
        if len(password) < 8:
            raise AuthError("Use a password of at least 8 characters")
        uid = f"u-{uuid.uuid4().hex[:12]}"
        with self.repo._lock:
            try:
                self.repo.conn.execute(
                    "INSERT INTO users(id, name, email, role, practice, password_hash, sample) VALUES(?,?,?,?,?,?,?)",
                    (uid, name.strip(), email.strip().lower(), role, practice.strip(), _hasher.hash(password), int(sample)))
                self.repo.conn.commit()
            except Exception as e:  # sqlite3.IntegrityError on duplicate email
                if "UNIQUE" in str(e):
                    raise AuthError("An account with that email already exists") from None
                raise
        return self.get(uid)

    def get(self, uid: str) -> Optional[User]:
        r = self.repo._one("SELECT * FROM users WHERE id = ?", (uid,))
        return self._row(r) if r else None

    def by_email(self, email: str):
        return self.repo._one("SELECT * FROM users WHERE email = ? COLLATE NOCASE", (email.strip().lower(),))

    def verify(self, email: str, password: str) -> User:
        r = self.by_email(email)
        # Same error for unknown email and wrong password.
        if r is None:
            _hasher.hash(password)  # similar timing either way
            raise AuthError("Email or password is not right")
        try:
            _hasher.verify(r["password_hash"], password)
        except (VerifyMismatchError, InvalidHashError):
            raise AuthError("Email or password is not right") from None
        return self._row(r)

    # ---- sessions
    def start_session(self, user: User) -> str:
        token = secrets.token_urlsafe(32)
        expires = (config.real_now() + timedelta(hours=SESSION_HOURS)).isoformat()
        with self.repo._lock:
            self.repo.conn.execute("INSERT INTO sessions(token_hash, user_id, expires) VALUES(?,?,?)",
                                   (_hash_token(token), user.id, expires))
            self.repo.conn.commit()
        return token

    def session_user(self, token: Optional[str]) -> Optional[User]:
        if not token:
            return None
        r = self.repo._one("SELECT user_id, expires FROM sessions WHERE token_hash = ?", (_hash_token(token),))
        if r is None:
            return None
        if r["expires"] < config.real_now().isoformat():
            self.end_session(token)
            return None
        return self.get(r["user_id"])

    def end_session(self, token: Optional[str]) -> None:
        if not token:
            return
        with self.repo._lock:
            self.repo.conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash_token(token),))
            self.repo.conn.commit()

    # ---- sample accounts (exist only while sample data is loaded)
    def add_sample_users(self) -> None:
        for u in SAMPLE_USERS:
            if self.by_email(u["email"]) is None:
                self.create(name=u["name"], email=u["email"], role=u["role"], practice=SAMPLE_PRACTICE,
                            password=u["password"], sample=True)

    def remove_sample_users(self) -> None:
        with self.repo._lock:
            self.repo.conn.execute("DELETE FROM users WHERE sample = 1")
            self.repo.conn.commit()

    def sample_user(self, role: str) -> Optional[User]:
        r = self.repo._one("SELECT * FROM users WHERE sample = 1 AND role = ?", (role,))
        return self._row(r) if r else None
