"""Straight-line distance between points. Never drive time."""
from __future__ import annotations

from math import asin, cos, radians, sin, sqrt

EARTH_RADIUS_MILES = 3958.7613


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = radians(lat1), radians(lat2)
    dlat, dlon = p2 - p1, radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(p1) * cos(p2) * sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * asin(sqrt(a))


def miles_between(a, b) -> int:
    """Whole miles between two objects with .lat/.lon (town centroids or hospital points)."""
    return round(haversine_miles(a.lat, a.lon, b.lat, b.lon))
