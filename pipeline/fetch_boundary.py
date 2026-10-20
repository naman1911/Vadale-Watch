"""Step 1: download the lake outline from OpenStreetMap.

Usage:  python -m pipeline.fetch_boundary

Searches OpenStreetMap (via the Overpass API) for water bodies near the lake
centre in config.yaml, picks the one whose name matches, and saves:
  data/lake.geojson          the chosen outline (used for all measurements)
  data/lake_candidates.json  every water body found nearby, for checking
  data/lake_preview.png      the outline drawn on Esri satellite imagery
If config.yaml has lake.osm_id set, that exact OpenStreetMap object is used.
"""
from __future__ import annotations

import io
import json
import math
import re
import sys

import requests
from PIL import Image, ImageDraw, ImageFont
from pyproj import Geod
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, mapping
from shapely.ops import polygonize, unary_union

from .common import DATA, LAKE_FILE, USER_AGENT, load_config

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
ESRI_TILE = ("https://server.arcgisonline.com/ArcGIS/rest/services/"
             "World_Imagery/MapServer/tile/{z}/{y}/{x}")
GEOD = Geod(ellps="WGS84")


def overpass(query: str) -> dict:
    last = None
    for url in OVERPASS_URLS:
        try:
            r = requests.post(url, data={"data": query}, timeout=180,
                              headers={"User-Agent": USER_AGENT})
            r.raise_for_status()
            return r.json()
        except Exception as e:  # try the next mirror
            last = e
            print(f"Overpass mirror failed ({url}): {e}", file=sys.stderr)
    raise RuntimeError(f"All Overpass mirrors failed: {last}")


def element_geometry(el: dict):
    """Turn an Overpass element (with 'out geom') into a shapely polygon."""
    if el["type"] == "way":
        pts = [(p["lon"], p["lat"]) for p in el.get("geometry", [])]
        if len(pts) >= 4 and pts[0] == pts[-1]:
            return Polygon(pts).buffer(0)
        return None
    if el["type"] == "relation":
        outers, inners = [], []
        for m in el.get("members", []):
            if m.get("type") != "way" or "geometry" not in m:
                continue
            line = LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
            (inners if m.get("role") == "inner" else outers).append(line)
        outer = unary_union(list(polygonize(unary_union(outers)))) if outers else None
        if outer is None or outer.is_empty:
            return None
        if inners:
            hole = unary_union(list(polygonize(unary_union(inners))))
            outer = outer.difference(hole)
        return outer.buffer(0)
    return None


def area_ha(geom) -> float:
    return abs(GEOD.geometry_area_perimeter(geom)[0]) / 10_000


def find_candidates(cfg: dict) -> list[dict]:
    lake = cfg["lake"]
    lat, lon, rad = lake["center_lat"], lake["center_lon"], lake["search_radius_m"]
    q = f"""
    [out:json][timeout:120];
    (
      way["natural"="water"](around:{rad},{lat},{lon});
      relation["natural"="water"](around:{rad},{lat},{lon});
      way["water"](around:{rad},{lat},{lon});
      relation["water"](around:{rad},{lat},{lon});
      way["landuse"="reservoir"](around:{rad},{lat},{lon});
      way["landuse"="basin"](around:{rad},{lat},{lon});
    );
    out tags geom;
    """
    data = overpass(q)
    pats = [re.compile(p, re.I) for p in lake["name_patterns"]]
    centre = Point(lon, lat)
    seen, out = set(), []
    for el in data.get("elements", []):
        key = f"{el['type']}/{el['id']}"
        if key in seen:
            continue
        seen.add(key)
        geom = element_geometry(el)
        if geom is None or geom.is_empty:
            continue
        tags = el.get("tags", {})
        names = " | ".join(v for k, v in tags.items() if k.startswith(("name", "alt_name", "old_name", "official_name")))
        dist_m = GEOD.inv(lon, lat, *geom.representative_point().coords[0])[2]
        out.append({
            "osm_id": key,
            "name": tags.get("name", ""),
            "all_names": names,
            "name_match": any(p.search(names) for p in pats),
            "area_ha": round(area_ha(geom), 2),
            "distance_m": 0 if geom.contains(centre) else round(dist_m),
            "tags": tags,
            "geometry": geom,
        })
    # Best first: name match, then closest, then biggest.
    out.sort(key=lambda c: (not c["name_match"], c["distance_m"], -c["area_ha"]))
    return out


# --- preview map -----------------------------------------------------------

def _tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def render_preview(chosen, others, path, zoom=17):
    minx, miny, maxx, maxy = chosen.bounds
    pad_x, pad_y = (maxx - minx) * 0.35 + 0.001, (maxy - miny) * 0.35 + 0.001
    minx, maxx, miny, maxy = minx - pad_x, maxx + pad_x, miny - pad_y, maxy + pad_y
    while True:
        x0, y0 = _tile_xy(minx, maxy, zoom)
        x1, y1 = _tile_xy(maxx, miny, zoom)
        if (x1 - x0) * 256 <= 1400 or zoom <= 13:
            break
        zoom -= 1
    tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
    mosaic = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256), "#333")
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            try:
                r = requests.get(ESRI_TILE.format(z=zoom, x=tx, y=ty), timeout=30,
                                 headers={"User-Agent": USER_AGENT})
                r.raise_for_status()
                mosaic.paste(Image.open(io.BytesIO(r.content)).convert("RGB"),
                             ((tx - tx0) * 256, (ty - ty0) * 256))
            except Exception as e:
                print(f"tile {zoom}/{tx}/{ty} failed: {e}", file=sys.stderr)
    crop = (int((x0 - tx0) * 256), int((y0 - ty0) * 256),
            int((x1 - tx0) * 256), int((y1 - ty0) * 256))
    img = mosaic.crop(crop)
    draw = ImageDraw.Draw(img)

    def px(lon, lat):
        x, y = _tile_xy(lon, lat, zoom)
        return ((x - x0) * 256, (y - y0) * 256)

    def rings(geom):
        polys = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
        for p in polys:
            yield p.exterior
            yield from p.interiors

    for g in others:
        for ring in rings(g):
            draw.line([px(*c) for c in ring.coords], fill=(80, 200, 255), width=2)
    for ring in rings(chosen):
        draw.line([px(*c) for c in ring.coords], fill=(255, 230, 0), width=4)
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", 18)
    except OSError:
        font = ImageFont.load_default()
    label = "Yellow = chosen lake outline   Blue = other water nearby"
    draw.rectangle([0, 0, img.width, 30], fill=(0, 0, 0))
    draw.text((8, 5), label, fill="white", font=font)
    draw.text((8, img.height - 24), "Imagery: Esri World Imagery", fill="white", font=font)
    img.save(path)


def main():
    cfg = load_config()
    DATA.mkdir(exist_ok=True)
    cands = find_candidates(cfg)
    if not cands:
        sys.exit("No water bodies found near the configured centre.")
    pinned = cfg["lake"].get("osm_id")
    if pinned:
        matches = [c for c in cands if c["osm_id"] == pinned]
        if not matches:
            sys.exit(f"Pinned OSM object {pinned} not found within the search radius.")
        chosen = matches[0]
    else:
        chosen = cands[0]

    print("Water bodies found (best match first):")
    for c in cands[:15]:
        mark = "->" if c is chosen else "  "
        print(f"{mark} {c['osm_id']:<20} {c['area_ha']:>8.2f} ha  {c['distance_m']:>6} m  "
              f"name_match={c['name_match']}  {c['all_names']!r}")

    feature = {
        "type": "Feature",
        "properties": {
            "name": chosen["name"] or cfg["lake"]["name"],
            "osm_id": chosen["osm_id"],
            "osm_url": f"https://www.openstreetmap.org/{chosen['osm_id']}",
            "area_ha": chosen["area_ha"],
            "source": "© OpenStreetMap contributors (ODbL)",
        },
        "geometry": mapping(chosen["geometry"]),
    }
    with open(LAKE_FILE, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": [feature]}, f, ensure_ascii=False)
    with open(DATA / "lake_candidates.json", "w", encoding="utf-8") as f:
        json.dump([{k: v for k, v in c.items() if k != "geometry"} for c in cands],
                  f, ensure_ascii=False, indent=1)

    nearby = [c["geometry"] for c in cands[1:]
              if c["geometry"].distance(chosen["geometry"]) < 0.01]
    render_preview(chosen["geometry"], nearby, DATA / "lake_preview.png")
    print(f"\nSaved {LAKE_FILE.relative_to(DATA.parent)}: {chosen['osm_id']} "
          f"'{chosen['name']}' {chosen['area_ha']} ha")


if __name__ == "__main__":
    main()
