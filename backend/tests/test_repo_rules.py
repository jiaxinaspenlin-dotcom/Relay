"""Repository guards: demo clock only, and no screen reads mock fixtures."""
from __future__ import annotations

import re

from app.config import ROOT

REAL_CLOCK = re.compile(
    r"\b(date\.today|datetime\.(now|utcnow|today)|time\.(time|localtime|gmtime)|"
    r"datetime\.datetime\.(now|utcnow|today))\s*\(")


def test_backend_never_reads_the_real_clock():
    offenders = []
    for path in sorted((ROOT / "backend" / "app").rglob("*.py")):
        if path.name == "config.py":
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if REAL_CLOCK.search(line):
                offenders.append(f"{path.relative_to(ROOT)}:{n}: {line.strip()}")
    assert offenders == [], "Use app.clock.today(repo); only config.py reads the real clock"


def test_real_clock_pattern_catches_common_calls():
    for s in ["date.today()", "datetime.now()", "datetime.utcnow()", "time.time()",
              "datetime.datetime.now(tz)"]:
        assert REAL_CLOCK.search(s), s
    assert not REAL_CLOCK.search("clock.today(repo)")


MOCK_IMPORT = re.compile(r"""(from\s+["'][^"']*\bmock/|import\s*\(\s*["'][^"']*\bmock/|require\(\s*["'][^"']*\bmock/)""")


def test_no_frontend_source_imports_mock_fixtures():
    src = ROOT / "frontend" / "src"
    offenders = []
    for path in sorted(src.rglob("*")):
        if path.suffix not in {".ts", ".tsx"} or "mock" in path.relative_to(src).parts:
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if MOCK_IMPORT.search(line):
                offenders.append(f"{path.relative_to(ROOT)}:{n}: {line.strip()}")
    assert offenders == [], "Screens must use the API, not src/mock/*.json"


def test_mock_pattern_catches_imports():
    assert MOCK_IMPORT.search('import dashboard from "./mock/dashboard.json";')
    assert MOCK_IMPORT.search("const m = await import('../mock/finder.json')")
    assert not MOCK_IMPORT.search('import { api } from "./api";')
