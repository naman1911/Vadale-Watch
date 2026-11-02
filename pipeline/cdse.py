"""Second image source: ESA's own Copernicus Data Space Ecosystem (CDSE).

Same Sentinel-2 images as Microsoft Planetary Computer, but usually published
sooner, and an independent copy when one provider's file is damaged (as on
28 Oct 2026). Only the few pixels around the lake are requested, through the
Sentinel Hub "Process" service, so each image costs a tiny part of the free
monthly allowance.

Needs a free CDSE account and an OAuth client (see README). The ID and secret
are read from the CDSE_CLIENT_ID and CDSE_CLIENT_SECRET environment variables
(GitHub secrets). Without them this source is simply switched off.

Check that it agrees with Planetary Computer (prints a comparison, changes nothing):
  python -m pipeline.cdse
"""
from __future__ import annotations

import datetime as dt
import os
import re
import time
from types import SimpleNamespace

import numpy as np
import requests

TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
CATALOG_URL = "https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search"
PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process"
BANDS = ["B02", "B03", "B04", "B08", "B11", "SCL"]
# Values are requested "harmonised": ESA's +1000 offset already removed, so
# they are reflectance x 10000 for every image. The pipeline is told so by
# giving these images a pre-2022 processing baseline (= no offset to remove).
NO_OFFSET_BASELINE = "00.00"

EVALSCRIPT = """//VERSION=3
function setup() {
  return {input: [{bands: ["B02", "B03", "B04", "B08", "B11", "SCL"], units: "DN"}],
          output: {bands: 6, sampleType: "UINT16"}};
}
function evaluatePixel(s) { return [s.B02, s.B03, s.B04, s.B08, s.B11, s.SCL]; }
"""

_token: dict = {}


def enabled() -> bool:
    return bool(os.environ.get("CDSE_CLIENT_ID") and os.environ.get("CDSE_CLIENT_SECRET"))


def _auth() -> dict:
    if _token.get("expires", 0) < time.time() + 60:
        r = requests.post(TOKEN_URL, timeout=60, data={
            "grant_type": "client_credentials",
            "client_id": os.environ["CDSE_CLIENT_ID"],
            "client_secret": os.environ["CDSE_CLIENT_SECRET"]})
        r.raise_for_status()
        j = r.json()
        _token.update(value=j["access_token"], expires=time.time() + j.get("expires_in", 600))
    return {"Authorization": f"Bearer {_token['value']}"}


def scene_id(cdse_id: str) -> str:
    """CDSE names images like Planetary Computer, plus a processing-baseline
    part (_N0511) and '.SAFE'. Dropping those gives the same ID, so an image
    seen through either source is checked only once."""
    return re.sub(r"_N\d{4}(?=_)", "", cdse_id).removesuffix(".SAFE")


def tile_epsg(sid: str) -> int | None:
    """UTM zone from the tile code, e.g. T43QCB -> EPSG:32643 (north)."""
    m = re.search(r"_T(\d{2})([C-X])[A-Z]{2}(_|$)", sid)
    if not m:
        return None
    return (32600 if m.group(2) >= "N" else 32700) + int(m.group(1))


def search(lake_lonlat, start: str, end: str, max_cloud: float) -> list:
    """Images over the lake, as items shaped like the Planetary Computer ones."""
    body = {"collections": ["sentinel-2-l2a"], "bbox": list(lake_lonlat.bounds),
            "datetime": f"{start}T00:00:00Z/{end}T23:59:59Z", "limit": 100}
    items, seen = [], set()
    while True:
        r = requests.post(CATALOG_URL, json=body, headers=_auth(), timeout=60)
        r.raise_for_status()
        j = r.json()
        for f in j.get("features", []):
            p = f.get("properties", {})
            sid = scene_id(f["id"])
            cloud = p.get("eo:cloud_cover")
            epsg = tile_epsg(sid)
            if sid in seen or epsg is None or (cloud is not None and cloud > max_cloud):
                continue
            seen.add(sid)
            items.append(SimpleNamespace(
                id=sid, source="cdse",
                datetime=dt.datetime.fromisoformat(p["datetime"].replace("Z", "+00:00")),
                properties={"eo:cloud_cover": cloud, "proj:epsg": epsg,
                            "s2:processing_baseline": NO_OFFSET_BASELINE}))
        nxt = j.get("context", {}).get("next")
        if not nxt:
            break
        body["next"] = nxt
    items.sort(key=lambda it: it.datetime)
    return items


def read_window(item, bounds) -> dict:
    """The lake window (in the image's UTM projection) at 10 m, all bands.
    The two overlapping tiles of the same pass are joined automatically."""
    import rasterio
    from rasterio.io import MemoryFile

    epsg = item.properties["proj:epsg"]
    w = int(round((bounds[2] - bounds[0]) / 10))
    h = int(round((bounds[3] - bounds[1]) / 10))
    t0 = item.datetime - dt.timedelta(minutes=10)
    t1 = item.datetime + dt.timedelta(minutes=10)
    iso = lambda t: t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    body = {
        "input": {
            "bounds": {"bbox": list(bounds),
                       "properties": {"crs": f"http://www.opengis.net/def/crs/EPSG/0/{epsg}"}},
            "data": [{"type": "sentinel-2-l2a",
                      "dataFilter": {"timeRange": {"from": iso(t0), "to": iso(t1)},
                                     "mosaickingOrder": "mostRecent"},
                      "processing": {"harmonizeValues": True, "upsampling": "NEAREST",
                                     "downsampling": "NEAREST"}}]},
        "output": {"width": w, "height": h,
                   "responses": [{"identifier": "default", "format": {"type": "image/tiff"}}]},
        "evalscript": EVALSCRIPT,
    }
    for attempt in range(3):
        r = requests.post(PROCESS_URL, json=body, headers={**_auth(), "Accept": "image/tiff"}, timeout=120)
        if r.status_code not in (429, 500, 502, 503, 504) or attempt == 2:
            break
        time.sleep(5 * (attempt + 1))
    r.raise_for_status()
    with MemoryFile(r.content) as mf, mf.open() as ds:
        data = ds.read()
    out = {b: data[i].astype(np.uint16) for i, b in enumerate(BANDS)}
    out["SCL"] = out["SCL"].astype(np.uint8)
    out["transform"] = rasterio.transform.from_origin(bounds[0], bounds[3], 10, 10)
    return out


def compare():
    """Read the newest clear date from CDSE and compare with the saved
    Planetary Computer pixels. Prints only; changes nothing."""
    from . import run
    from .common import HISTORY_FILE, load_config, load_lake
    from .classify import to_reflectance
    from .sentinel import analysis_bounds, lake_in_crs

    cfg, lake = load_config(), load_lake()
    history = run.read_csv(HISTORY_FILE, "date")
    date = max(d for d, r in history.items() if not r["flag"])
    arrs_pc, epsg, baseline, tr, sid = run.load_cache(date)
    items = [it for it in search(lake, date, date, 100) if it.id == sid] or search(lake, date, date, 100)
    if not items:
        raise SystemExit(f"CDSE has no image for {date}")
    it = items[0]
    bounds = analysis_bounds(lake_in_crs(lake, epsg), cfg["output"]["image_margin_m"])
    arrs_cd = read_window(it, bounds)
    print(f"Date {date}  Planetary Computer {sid}\n           CDSE {it.id}")
    ok = (arrs_pc["SCL"] != 0) & (arrs_cd["SCL"] != 0)
    for b in BANDS[:-1]:
        pc = to_reflectance(arrs_pc[b], baseline)[ok]
        cd = to_reflectance(arrs_cd[b], NO_OFFSET_BASELINE)[ok]
        print(f"  {b}: median reflectance PC {np.median(pc):.4f}  CDSE {np.median(cd):.4f}  "
              f"typical difference {np.median(np.abs(pc - cd)):.4f}")
    print(f"  SCL classes agree on {100 * (arrs_pc['SCL'][ok] == arrs_cd['SCL'][ok]).mean():.1f}% of pixels")
    for name, a, pb in (("PC", arrs_pc, baseline), ("CDSE", arrs_cd, NO_OFFSET_BASELINE)):
        res = run.analyse(a, epsg, pb, tr, lake, cfg)
        print(f"  {name:>4}: weed {res['stats']['weed_pct']:.1f}%  visible {res['visible_pct']:.1f}%  "
              f"status {run.quality_status(res, cfg) or 'ok'}")


if __name__ == "__main__":
    compare()
