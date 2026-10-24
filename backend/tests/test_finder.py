"""Finder: town normalization, distance, practice grouping, nearest hospital, CMS join, ranking."""
from __future__ import annotations

import csv
import json

import pytest

from app.config import DATA_PUBLIC, FINDER_SPECIALTIES
from app.finder.distance import haversine_miles
from app.finder.hospitals import (ACUTE, BEDS_LABEL, all_hospitals, cms_by_name, nearest_hospitals,
                                  normalize_name)
from app.finder.practices import MEDICARE_LABELS, USECOLS, medicare_assignment, practices_for
from app.finder.rank import TELEHEALTH_NOTE, find
from app.finder.names import address_key, org_key, title_case
from app.finder.towns import VILLAGE_TO_TOWN, _key, resolve_town, towns

SPECIALTIES = list(FINDER_SPECIALTIES)


# ---------------------------------------------------------------- towns

def test_every_village_target_is_a_real_town():
    missing = [t for t in VILLAGE_TO_TOWN.values() if _key(t) not in towns()]
    assert missing == []


@pytest.mark.parametrize("raw,town", [
    ("HYANNIS", "Barnstable"), ("Hyannis", "Barnstable"), ("CHESTNUT HILL", "Newton"),
    ("W SPRINGFIELD", "West Springfield"), ("S YARMOUTH", "South Yarmouth"), ("BRIGHTON", "Boston"),
    ("  north adams ", "North Adams"), ("GT BARRINGTON", "Great Barrington"),
    ("NORTH ATTLEBORO", "North Attleborough"), ("MANCHESTER", "Manchester-by-the-Sea"),
    ("WORCESTEER", "Worcester"),
])
def test_resolve_town(raw, town):
    assert resolve_town(raw).name == town


def test_unknown_town_is_none():
    assert resolve_town("ATLANTIS") is None
    assert resolve_town("") is None


@pytest.mark.parametrize("specialty", SPECIALTIES)
def test_unmatched_city_rate_under_10_percent(specialty):
    ps = practices_for(FINDER_SPECIALTIES[specialty])
    unmatched = [p for p in ps if p.town is None]
    assert len(unmatched) / len(ps) < 0.10, sorted({p.city_raw for p in unmatched})


def test_unmatched_rate_overall():
    ps = [p for s in SPECIALTIES for p in practices_for(FINDER_SPECIALTIES[s])]
    rate = sum(p.town is None for p in ps) / len(ps)
    assert rate < 0.10
    print(f"unmatched practice towns: {rate:.1%} of {len(ps)}")


# ---------------------------------------------------------------- distance

def test_haversine_known_distance():
    # Boston (42.3601, -71.0589) to Springfield (42.1015, -72.5898): ~79 miles straight-line
    assert 77 <= haversine_miles(42.3601, -71.0589, 42.1015, -72.5898) <= 81
    assert haversine_miles(42.0, -72.0, 42.0, -72.0) == 0


# ---------------------------------------------------------------- practices

def test_telehealth_and_individual_columns_are_not_loaded():
    assert "telehlth" not in USECOLS
    assert "ind_pac_id" not in USECOLS


@pytest.mark.parametrize("specialty", SPECIALTIES)
def test_no_individual_identifiers_in_output(specialty):
    out = find(specialty, "North Adams", limit=None)
    keys = set().union(*(r.keys() for r in out["results"]))
    assert not keys & {"npi", "ind_pac_id", "frst_nm", "lst_nm", "provider_first_name",
                       "provider_last_name", "telehlth", "telehealth"}
    blob = json.dumps(out["results"])
    with open(DATA_PUBLIC / "clinicians_ma.csv", newline="", encoding="utf-8") as f:
        npis = {r["npi"] for r in csv.DictReader(f) if r["pri_spec"] == FINDER_SPECIALTIES[specialty]}
    assert not any(n in blob for n in list(npis)[:500])


@pytest.mark.parametrize("specialty", SPECIALTIES)
def test_clinician_counts_match_source(specialty):
    pri = FINDER_SPECIALTIES[specialty]
    with open(DATA_PUBLIC / "clinicians_ma.csv", newline="", encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r["pri_spec"] == pri]
    expected = len({(r["npi"], org_key(r["facility_name"].strip()), address_key(r["adr_ln_1"].strip()),
                     _key(r["city_town"]), r["zip_code"][:5]) for r in rows})
    assert sum(p.clinician_count for p in practices_for(pri)) == expected


@pytest.mark.parametrize("raw,key", [
    ("725 N Street Berkshire OB/GYN Of", "725 N ST"),
    ("777 N Street 4TH Floor", "777 N ST"),
    ("777 N ST", "777 N ST"),
    ("77 Warren St 1ST Floor And 2ND Floor", "77 WARREN ST"),
    ("55 Fruit Street, Suite 300", "55 FRUIT ST"),
    ("1 Medical Center Dr.", "1 MEDICAL CENTER DR"),
    ("100 Main St Ste 2", "100 MAIN ST"),
    ("10 Hospital Road #4", "10 HOSPITAL RD"),
])
def test_address_key(raw, key):
    assert address_key(raw) == key


def test_dedupes_pittsfield_locations():
    ps = [p for p in practices_for(FINDER_SPECIALTIES["Cardiology"])
          if p.town == "Pittsfield" and "BERKSHIRE FACULTY" in p.facility_name]
    assert sorted(p.address for p in ps) == ["725 N St", "777 N St"]


@pytest.mark.parametrize("raw,shown", [
    ("BERKSHIRE FACULTY SERVICES INC", "Berkshire Faculty Services Inc"),
    ("BMC AFFILIATED PHYSICIANS, INC.", "BMC Affiliated Physicians, Inc."),
    ("UMASS MEMORIAL MEDICAL GROUP INC", "UMass Memorial Medical Group Inc"),
    ("MASSACHUSETTS GENERAL PHYSICIANS ORGANIZATION INC", "Massachusetts General Physicians Organization Inc"),
    ("BRIGHAM AND WOMENS PHYSICIANS ORGANIZATION INC", "Brigham and Womens Physicians Organization Inc"),
    ("MEDICAL AFFILIATES OF CAPE COD INC", "Medical Affiliates of Cape Cod Inc"),
])
def test_title_case(raw, shown):
    assert title_case(raw) == shown


def test_labels_and_filters():
    out = find("Cardiology", "Pittsfield", limit=None)
    zero = next(r for r in out["results"] if r["miles"] == 0)
    assert zero["distance_label"] == "In Pittsfield"
    assert all(r["clinician_label"].startswith(f"{r['clinician_count']} clinician") for r in out["results"])
    one = [r for r in out["results"] if r["clinician_count"] == 1]
    assert one and one[0]["clinician_label"] == "1 clinician in this specialty"
    near = find("Cardiology", "North Adams", max_miles=25, limit=None)
    assert near["total"] < out["total_unfiltered"] and all(r["miles"] <= 25 for r in near["results"])
    acc = find("Cardiology", "North Adams", accepts_only=True, limit=None)
    assert acc["total"] > 0 and all(r["medicare_assignment"] == "accepts" for r in acc["results"])
    with pytest.raises(ValueError):
        find("Cardiology", "North Adams", max_miles=30)


def test_paging():
    p1 = find("Cardiology", "North Adams", limit=10, offset=0)
    p2 = find("Cardiology", "North Adams", limit=10, offset=10)
    assert len(p1["results"]) == 10 and p1["has_more"]
    assert not {r["id"] for r in p1["results"]} & {r["id"] for r in p2["results"]}
    assert p1["results"][-1]["miles"] <= p2["results"][0]["miles"]


def test_medicare_assignment_labels():
    assert medicare_assignment(["Y", "Y"]) == "accepts"
    assert medicare_assignment(["Y", "M"]) == "may_accept"
    assert medicare_assignment(["M"]) == "may_accept"
    assert MEDICARE_LABELS == {
        "accepts": "Accepts Medicare assignment",
        "may_accept": "May accept Medicare assignment — confirm with the office",
    }
    labels = {p.medicare_label for s in SPECIALTIES for p in practices_for(FINDER_SPECIALTIES[s])}
    assert labels <= set(MEDICARE_LABELS.values())
    assert not any(l.lower().startswith("no") for l in labels)


def test_blank_facility_name_label():
    blanks = [p for s in SPECIALTIES for p in practices_for(FINDER_SPECIALTIES[s]) if not p.facility_name]
    assert blanks, "snapshot has blank facility names"
    for p in blanks:
        assert p.label.startswith("Practice at ") and p.label.endswith(f", {p.town or p.city_raw.strip().title()}")


def test_unsupported_specialty_rejected():
    with pytest.raises(ValueError):
        find("Dermatology", "North Adams")
    with pytest.raises(ValueError):
        practices_for("INTERVENTIONAL CARDIOLOGY")
    with pytest.raises(ValueError):
        find("Cardiology", "Atlantis")


# ---------------------------------------------------------------- hospitals

def test_cms_join_is_exact_normalized_name_only():
    cms = cms_by_name()
    matched = [h for h in all_hospitals() if h.cms is not None]
    assert len(matched) == 36
    for h in all_hospitals():
        assert (h.cms is not None) == (normalize_name(h.name) in cms)


def test_normalize_name():
    assert normalize_name("Brown University Health - Morton  Hospital") == \
        "BROWN UNIVERSITY HEALTH MORTON HOSPITAL"
    assert normalize_name("Mass Eye & Ear") == "MASS EYE AND EAR"


def test_nearest_hospital_is_acute_and_closest():
    town = resolve_town("North Adams")
    (h, miles), = nearest_hospitals(town, k=1)
    assert h.facility_type == ACUTE
    for other in all_hospitals():
        if other.facility_type == ACUTE:
            assert haversine_miles(town.lat, town.lon, other.lat, other.lon) >= miles - 0.5


@pytest.mark.parametrize("specialty", SPECIALTIES)
def test_hospital_cards(specialty):
    out = find(specialty, "Greenfield", limit=None)
    by_name = {h.name: h for h in all_hospitals()}
    for r in out["results"]:
        h = r["nearest_hospital"]
        if r["town"] is None:
            assert h is None
            continue
        src = by_name[h["name"]]
        assert src.facility_type == ACUTE
        assert h["beds_label"] == BEDS_LABEL == "med/surg + ICU + pediatric beds"
        assert h["beds"] == src.med_surg_beds + src.icu_beds + src.pediatric_beds
        assert h["icu_beds"] == src.icu_beds
        if src.cms is None:
            assert h["cms_rating"] is None and h["cms_facility_id"] is None
        else:
            assert h["cms_rating"] == src.cms.rating


# ---------------------------------------------------------------- ranking and wording

@pytest.mark.parametrize("specialty", SPECIALTIES)
def test_sorted_by_distance_only(specialty):
    out = find(specialty, "North Adams", limit=None)
    assert out["sort"] == "distance"
    miles = [r["miles"] for r in out["results"]]
    known = [m for m in miles if m is not None]
    assert known == sorted(known)
    assert miles[: len(known)] == known  # unmatched last
    assert out["distance_unavailable"] == miles.count(None)


def test_limit_and_metadata():
    out = find("Cardiology", "North Adams", coverage="dual", limit=5)
    assert len(out["results"]) == 5 and out["total"] > 5
    assert out["medicare_prominent"] is True
    assert out["telehealth_note"] == TELEHEALTH_NOTE
    assert find("Cardiology", "North Adams", coverage="commercial_ppo")["medicare_prominent"] is False


def test_no_banned_wording_in_output():
    """Relay's own fields never say these words. Organization names are source data and exempt
    (e.g. a real organization is named "BMC Affiliated Physicians")."""
    out = find("Cardiology", "North Adams", limit=None)
    for r in out["results"]:
        r.pop("label"), r.pop("facility_name")
        r["nearest_hospital"] and r["nearest_hospital"].pop("name")
    blob = json.dumps(out).lower()
    for word in ("affiliat", "best", "total beds", "drive time", "minutes away", "in network"):
        assert word not in blob
