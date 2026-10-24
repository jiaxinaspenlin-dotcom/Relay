"""Town table (data/public/towns.csv) and CMS `city_town` normalization (design.md §5.2).

CMS city values are mostly uppercase, sometimes mixed case, and often a village or neighborhood
rather than the municipality. We normalize the text, expand N/S/E/W prefixes, and then map known
villages and typos to the town in towns.csv. Anything left over is "distance unavailable".
"""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Optional

from app.config import DATA_PUBLIC

PREFIXES = {"N": "NORTH", "NO": "NORTH", "S": "SOUTH", "SO": "SOUTH", "E": "EAST", "W": "WEST",
            "GT": "GREAT"}

# Village / neighborhood / spelling variant -> town in towns.csv. Keys are post-normalization.
# Seeded from the snapshot's unmatched values (design.md §5.2).
VILLAGE_TO_TOWN: dict[str, str] = {
    # Boston neighborhoods
    "ALLSTON": "Boston", "BRIGHTON": "Boston", "CHARLESTOWN": "Boston", "DORCHESTER": "Boston",
    "EAST BOSTON": "Boston", "HYDE PARK": "Boston", "JAMAICA PLAIN": "Boston",
    "MATTAPAN": "Boston", "ROSLINDALE": "Boston", "ROXBURY": "Boston",
    "ROXBURY CROSSING": "Boston", "SOUTH BOSTON": "Boston", "WEST ROXBURY": "Boston",
    # Newton villages. Chestnut Hill spans Newton and Brookline; mapped to Newton (decision 2026-10-24).
    "CHESTNUT HILL": "Newton", "AUBURNDALE": "Newton", "NEWTON CENTER": "Newton",
    "NEWTON CENTRE": "Newton", "NEWTON HIGHLANDS": "Newton", "NEWTON LOWER FALLS": "Newton",
    "NEWTON UPPER FALLS": "Newton", "NEWTONVILLE": "Newton", "WABAN": "Newton",
    "WEST NEWTON": "Newton",
    # Barnstable villages
    "HYANNIS": "Barnstable", "CENTERVILLE": "Barnstable", "COTUIT": "Barnstable",
    "MARSTONS MILLS": "Barnstable", "OSTERVILLE": "Barnstable", "WEST BARNSTABLE": "Barnstable",
    # Other villages
    "NORTH DARTMOUTH": "Dartmouth", "SOUTH DARTMOUTH": "Dartmouth",
    "NORTH DARMOUTH": "Dartmouth", "SOUTH DARMOUTH": "Dartmouth",
    "SOUTH WEYMOUTH": "Weymouth", "EAST WEYMOUTH": "Weymouth", "NORTH WEYMOUTH": "Weymouth",
    "FLORENCE": "Northampton", "LEEDS": "Northampton",
    "YARMOUTHPORT": "Yarmouth",  # South Yarmouth is its own place in towns.csv
    "NORTH EASTON": "Easton", "SOUTH EASTON": "Easton",
    "NORTH ATTLEBORO": "North Attleborough", "ATTLEBORO FALLS": "North Attleborough",
    "SOUTH ATTLEBORO": "Attleboro",
    "NORTH CHELMSFORD": "Chelmsford", "NORTH BILLERICA": "Billerica",
    "SOUTH HAMILTON": "Hamilton", "NORTH GRAFTON": "Grafton", "SOUTH GRAFTON": "Grafton",
    "WELLESLEY HILLS": "Wellesley", "WELLESLEY HLS": "Wellesley",
    "NEEDHAM HEIGHTS": "Needham", "EAST WALPOLE": "Walpole", "EAST WAREHAM": "Wareham",
    "FEEDING HILLS": "Agawam", "INDIAN ORCHARD": "Springfield", "BRADFORD": "Haverhill",
    "WEST HATFIELD": "Hatfield", "NORTH OXFORD": "Oxford", "ROCHDALE": "Leicester",
    "CATAUMET": "Bourne", "SAGAMORE BEACH": "Bourne", "NORTH CHATHAM": "Chatham",
    "SOUTH CHATHAM": "Chatham", "WEST HARWICH": "Harwich", "EAST ORLEANS": "Orleans",
    "NORTH DIGHTON": "Dighton", "BYFIELD": "Newbury", "HAYDENVILLE": "Williamsburg",
    "GILBERTVILLE": "Hardwick", "BONDSVILLE": "Palmer", "EAST FREETOWN": "Freetown",
    "ASSONET": "Freetown", "SOUTH EGREMONT": "Egremont", "CHERRY VALLEY": "Leicester",
    "SHELBURNE FLS": "Shelburne", "NORTH CAMBRIDGE": "Cambridge", "NORTH WALTHAM": "Waltham",
    "THREE RIVERS": "Palmer", "WEST TOWNSEND": "Townsend", "STILL RIVER": "Harvard",
    "WAQUOIT": "Falmouth",
    # Short forms of "-borough" towns
    "FOXBORO": "Foxborough", "MIDDLEBORO": "Middleborough", "WESTBORO": "Westborough",
    "WEST BOROUGH": "Westborough", "SOUTHBORO": "Southborough", "TYNGSBORO": "Tyngsborough",
    "MANCHESTER": "Manchester-by-the-Sea",
    # Spelling errors in the source
    "WORCESTEER": "Worcester", "SOMVERVILLE": "Somerville", "SOMMERVILLE": "Somerville",
    "CANBRIDGE": "Cambridge", "HAVERILL": "Haverhill", "NORWOD": "Norwood", "NATIC": "Natick",
    "WILIMINGTON": "Wilmington", "WASTHAMPTON": "Westhampton", "GREAT BARINGTON": "Great Barrington",
    "GARDER CITY": "Gardner",
}


@dataclass(frozen=True)
class Town:
    name: str
    county: str
    lat: float
    lon: float


def _key(s: str) -> str:
    """Uppercase, punctuation/hyphens → space, collapse spaces, expand direction prefixes."""
    s = re.sub(r"[^A-Z0-9 ]", " ", s.upper())
    tokens = s.split()
    if len(tokens) > 1 and tokens[0] in PREFIXES:
        tokens[0] = PREFIXES[tokens[0]]
    return " ".join(tokens)


@lru_cache(maxsize=1)
def towns() -> dict[str, Town]:
    """Normalized key -> Town."""
    out = {}
    with open(DATA_PUBLIC / "towns.csv", newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            t = Town(r["town"], r["county"], float(r["lat"]), float(r["lon"]))
            out[_key(t.name)] = t
    return out


def resolve_town(raw: str) -> Optional[Town]:
    """Map a CMS `city_town` (or a patient town) to a towns.csv Town, or None if unmatched."""
    if not raw or not raw.strip():
        return None
    k = _key(raw)
    table = towns()
    if k in table:
        return table[k]
    target = VILLAGE_TO_TOWN.get(k)
    return table.get(_key(target)) if target else None
