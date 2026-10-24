"""SQLite persistence (stdlib sqlite3, one file).

Referrals are stored as JSON documents of the Referral model; patients, office-link tokens, and
settings get their own tables. All writes go through one connection guarded by a lock.
"""
from __future__ import annotations

import json
import secrets
import sqlite3
import uuid
from datetime import date, timedelta
from pathlib import Path
from threading import RLock
from typing import Any, Optional

from app.config import DEFAULT_PRACTICE, SAMPLE_BASE_DATE
from app.models import Referral, load_patients, load_seed

SCHEMA = """
CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    sample INTEGER NOT NULL DEFAULT 0,
    created_seq INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS referrals (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL UNIQUE,
    data TEXT NOT NULL,
    sample INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS office_tokens (
    token TEXT PRIMARY KEY,
    referral_id TEXT NOT NULL UNIQUE REFERENCES referrals(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

DEFAULT_SETTINGS: dict[str, Any] = {
    "demo_mode": False,
    "demo_offset_days": 0,
    "practice": DEFAULT_PRACTICE,
}


class SampleAlreadyLoaded(ValueError):
    pass


class Repo:
    def __init__(self, path: Path | str) -> None:
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    # ------------------------------------------------------------ locked reads
    # One sqlite3 connection is shared by FastAPI's threadpool. Concurrent use of one connection is
    # not safe (reads can interleave and return missing rows), so every read takes the lock too.
    def _one(self, sql: str, args: tuple = ()):
        with self._lock:
            return self.conn.execute(sql, args).fetchone()

    def _all(self, sql: str, args: tuple = ()):
        with self._lock:
            return self.conn.execute(sql, args).fetchall()

    # ------------------------------------------------------------ settings
    def setting(self, key: str) -> Any:
        row = self._one("SELECT value FROM settings WHERE key = ?", (key,))
        return json.loads(row["value"]) if row else DEFAULT_SETTINGS.get(key)

    def set_setting(self, key: str, value: Any) -> None:
        with self._lock:
            self.conn.execute(
                "INSERT INTO settings(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, json.dumps(value)))
            self.conn.commit()

    # ------------------------------------------------------------ patients
    def patients(self) -> dict[str, dict]:
        rows = self._all("SELECT data FROM patients ORDER BY created_seq")
        out = {}
        for r in rows:
            p = json.loads(r["data"])
            out[p["id"]] = p
        return out

    def patient(self, pid: str) -> Optional[dict]:
        row = self._one("SELECT data FROM patients WHERE id = ?", (pid,))
        return json.loads(row["data"]) if row else None

    def add_patient(self, p: dict) -> dict:
        p = {"sample": False, "chart_id": None, "sex": None, "suggested_specialty": None,
             "suggested_condition_code": None, **p}
        p.setdefault("id", f"pt-{uuid.uuid4().hex[:12]}")
        with self._lock:
            seq = self._one("SELECT COALESCE(MAX(created_seq), 0) + 1 FROM patients")[0]
            self.conn.execute("INSERT INTO patients(id, data, sample, created_seq) VALUES(?, ?, ?, ?)",
                              (p["id"], json.dumps(p), int(bool(p["sample"])), seq))
            self.conn.commit()
        return p

    # ------------------------------------------------------------ referrals
    def all(self) -> list[Referral]:
        rows = self._all("SELECT data FROM referrals ORDER BY seq")
        return [Referral.model_validate_json(r["data"]) for r in rows]

    def count(self) -> int:
        return self._one("SELECT COUNT(*) FROM referrals")[0]

    def get(self, rid: str) -> Referral:
        row = self._one("SELECT data FROM referrals WHERE id = ?", (rid,))
        if row is None:
            raise KeyError(f"No referral {rid}")
        return Referral.model_validate_json(row["data"])

    def put(self, ref: Referral) -> Referral:
        data = ref.model_dump_json(by_alias=True)
        with self._lock:
            exists = self._one("SELECT 1 FROM referrals WHERE id = ?", (ref.id,))
            if exists:
                self.conn.execute("UPDATE referrals SET data = ? WHERE id = ?", (data, ref.id))
            else:
                seq = self._seq_for(ref.id)
                self.conn.execute("INSERT INTO referrals(id, seq, data, sample) VALUES(?, ?, ?, ?)",
                                  (ref.id, seq, data, int(ref.sample)))
            self.conn.commit()
        return ref

    def _seq_for(self, rid: str) -> int:
        try:
            return int(rid.split("-")[1])
        except (IndexError, ValueError):
            return self._one("SELECT COALESCE(MAX(seq), 100) + 1 FROM referrals")[0]

    def next_id(self) -> str:
        n = self._one("SELECT COALESCE(MAX(seq), 100) + 1 FROM referrals")[0]
        return f"R-{n}"

    # ------------------------------------------------------------ office links
    def token_for(self, rid: str) -> str:
        """The referral's office-update token, created on first use (unguessable, 192 bits)."""
        with self._lock:
            row = self._one("SELECT token FROM office_tokens WHERE referral_id = ?", (rid,))
            if row:
                return row["token"]
            token = secrets.token_urlsafe(24)
            self.conn.execute("INSERT INTO office_tokens(token, referral_id) VALUES(?, ?)", (token, rid))
            self.conn.commit()
            return token

    def referral_for_token(self, token: str) -> Optional[str]:
        row = self._one("SELECT referral_id FROM office_tokens WHERE token = ?", (token,))
        return row["referral_id"] if row else None

    # ------------------------------------------------------------ sample data + reset
    def has_sample(self) -> bool:
        return self._one("SELECT 1 FROM referrals WHERE sample = 1 LIMIT 1") is not None

    def load_sample(self, today: date) -> int:
        """Load referrals.json + Synthea patients, shifting dates so the sample reads as of `today`."""
        if self.has_sample():
            raise SampleAlreadyLoaded("Sample data is already loaded")
        shift = today - SAMPLE_BASE_DATE
        seed = load_seed()
        existing = self.patients()
        for p in load_patients().values():
            if p["id"] not in existing:
                self.add_patient(p)
        offset = self._one("SELECT COALESCE(MAX(seq), 100) FROM referrals")[0] - 100
        id_map = {}
        for r in seed["referrals"]:
            new_id = f"R-{int(r.id.split('-')[1]) + offset}" if offset else r.id
            id_map[r.id] = new_id
        for r in seed["referrals"]:
            r = shift_dates(r, shift)
            r.id = id_map[r.id]
            r.replaces = id_map.get(r.replaces) if r.replaces else None
            r.sample = True
            self.put(r)
            self.token_for(r.id)
        return len(seed["referrals"])

    def reset_sample(self, today: date) -> int:
        """Delete sample referrals and sample patients, then load the sample again."""
        with self._lock:
            self.conn.executescript(
                "DELETE FROM office_tokens WHERE referral_id IN (SELECT id FROM referrals WHERE sample = 1);"
                "DELETE FROM referrals WHERE sample = 1; DELETE FROM patients WHERE sample = 1;")
            self.conn.commit()
        return self.load_sample(today)

    def clear_all(self) -> None:
        with self._lock:
            self.conn.executescript("DELETE FROM office_tokens; DELETE FROM referrals; "
                                    "DELETE FROM patients;")
            self.conn.commit()


def shift_dates(ref: Referral, delta: timedelta) -> Referral:
    """Copy of `ref` with every workflow date moved by `delta` (condition onset is left alone)."""
    if not delta:
        return ref.model_copy(deep=True)
    r = ref.model_copy(deep=True)
    r.authored_on += delta
    for e in r.events:
        e.at += delta
    if r.appointment:
        r.appointment.start += delta
    for b in r.barriers:
        b.opened += delta
        if b.addressed:
            b.addressed += delta
    for c in r.communications:
        c.sent += delta
    if r.plan:
        r.plan.returned_on += delta
        r.plan.visit_date += delta
    if r.closure:
        r.closure.at += delta
    if r.authorization_since:
        r.authorization_since += delta
    return r
