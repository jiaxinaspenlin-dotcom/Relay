"""Place context: required metadata on every item, county/town joins, and wording."""
from __future__ import annotations

import json
import sys

import pytest

from app.config import ROOT
from app.context.place import PLACES_ORDER, place_context
from app.finder.hospitals import ACUTE, BEDS_LABEL, all_hospitals

sys.path.insert(0, str(ROOT / "scripts"))
from check_copy import violations  # noqa: E402

DEMO_TOWNS = ["Athol", "Great Barrington", "Greenfield", "Orange", "Ware", "North Adams"]


@pytest.mark.parametrize("town", DEMO_TOWNS)
def test_every_item_has_provenance(town):
    ctx = place_context(town)
    assert {i["kind"] for i in ctx["items"]} == {"places", "ej", "hrsa", "hospitals"}
    for item in ctx["items"]:
        for key in ("source", "source_url", "year", "level", "cannot_tell_you"):
            assert item[key], f"{item['kind']} missing {key}"


@pytest.mark.parametrize("town", DEMO_TOWNS)
def test_places_has_five_measures_with_ci(town):
    item = next(i for i in place_context(town)["items"] if i["kind"] == "places")
    assert [v["measure"] for v in item["values"]] == PLACES_ORDER
    assert item["year"] == "2023" and item["level"].startswith("County")
    for v in item["values"]:
        assert v["ci_low"] <= v["value"] <= v["ci_high"]


def test_county_from_towns_csv():
    assert place_context("Orange")["county"] == "Franklin"
    assert place_context("Athol")["county"] == "Worcester"


def test_hrsa_marks_designations_that_include_the_town():
    item = next(i for i in place_context("Orange")["items"] if i["kind"] == "hrsa")
    names = {d["name"]: d for d in item["designations"]}
    assert names["North Quabbin"]["includes_town"] is True
    assert names["North Quabbin"]["designation_type"] == "Geographic HPSA"
    assert len({d["hpsa_id"] for d in item["designations"]}) == len(item["designations"])
    assert item["designations"][0]["includes_town"] is True  # town matches sort first


def test_ej_counts_block_groups():
    item = next(i for i in place_context("Greenfield")["items"] if i["kind"] == "ej")
    assert item["block_groups"] == sum(c["block_groups"] for c in item["criteria"])


def test_three_nearest_acute_hospitals():
    item = next(i for i in place_context("North Adams")["items"] if i["kind"] == "hospitals")
    by_name = {h.name: h for h in all_hospitals()}
    assert len(item["hospitals"]) == 3
    assert [h["miles"] for h in item["hospitals"]] == sorted(h["miles"] for h in item["hospitals"])
    for h in item["hospitals"]:
        assert by_name[h["name"]].facility_type == ACUTE
        assert h["beds_label"] == BEDS_LABEL


@pytest.mark.parametrize("town", DEMO_TOWNS)
def test_context_wording_passes_copy_guard(town):
    ctx = place_context(town)
    for item in ctx["items"]:
        for key in ("title", "source", "level", "cannot_tell_you"):
            assert violations(item[key]) == [], (key, item[key])
    blob = json.dumps(ctx).lower()
    assert "risk" not in blob and "vulnerab" not in blob and "total beds" not in blob


def test_unknown_town():
    with pytest.raises(ValueError):
        place_context("Atlantis")
