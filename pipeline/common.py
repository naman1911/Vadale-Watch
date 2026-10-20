"""Shared helpers: paths, config loading, lake geometry."""
from __future__ import annotations

import json
import math
from pathlib import Path

import yaml
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
IMAGES = DATA / "images"
LAKE_FILE = DATA / "lake.geojson"
HISTORY_FILE = DATA / "history.csv"
SCENES_FILE = DATA / "scenes.csv"
USER_AGENT = "VadaleLakeWatch/1.0 (+https://github.com/naman1911/Vadale-Watch)"


def load_config(path: Path | None = None) -> dict:
    with open(path or ROOT / "config.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_lake():
    """Return the lake outline as a shapely geometry in lon/lat (EPSG:4326)."""
    with open(LAKE_FILE, encoding="utf-8") as f:
        gj = json.load(f)
    feat = gj["features"][0] if gj.get("type") == "FeatureCollection" else gj
    return shape(feat["geometry"])


# --- Web Mercator helpers (used for map tiles and display images) ---------

def lonlat_to_merc(lon: float, lat: float) -> tuple[float, float]:
    r = 6378137.0
    x = math.radians(lon) * r
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * r
    return x, y


def merc_to_lonlat(x: float, y: float) -> tuple[float, float]:
    r = 6378137.0
    lon = math.degrees(x / r)
    lat = math.degrees(2 * math.atan(math.exp(y / r)) - math.pi / 2)
    return lon, lat
