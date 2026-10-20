"""Find Sentinel-2 images on Microsoft Planetary Computer and read the small
window around the lake (a few kilobytes per band, not the whole 100 km tile)."""
from __future__ import annotations

import math
import os
import time

import numpy as np
import planetary_computer
import pystac_client
import rasterio
from pyproj import Transformer
from rasterio.windows import from_bounds
import shapely

BANDS_10M = ["B02", "B03", "B04", "B08"]
BANDS_20M = ["B11", "SCL"]

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "4")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif,.TIF")


def search(cfg: dict, lake_lonlat, start: str, end: str) -> list:
    sat = cfg["satellite"]
    client = pystac_client.Client.open(sat["stac_url"])
    s = client.search(
        collections=[sat["collection"]],
        intersects=lake_lonlat.__geo_interface__,
        datetime=f"{start}/{end}",
        query={"eo:cloud_cover": {"lte": sat["max_tile_cloud_pct"]}},
        max_items=5000,
    )
    items = list(s.items())
    items.sort(key=lambda it: it.datetime)
    return items


def item_epsg(item) -> int:
    p = item.properties
    if p.get("proj:epsg"):
        return int(p["proj:epsg"])
    code = p.get("proj:code") or item.assets["B04"].extra_fields.get("proj:code")
    return int(str(code).split(":")[-1])


def lake_in_crs(lake_lonlat, epsg: int):
    tr = Transformer.from_crs(4326, epsg, always_xy=True)
    return shapely.transform(lake_lonlat, lambda xy: np.column_stack(tr.transform(xy[:, 0], xy[:, 1])))


def analysis_bounds(lake_utm, margin_m: float) -> tuple[float, float, float, float]:
    """Lake bounding box plus margin, snapped to the 20 m pixel grid so the 10 m
    and 20 m bands line up exactly (Sentinel-2 tile origins are multiples of 60 m)."""
    minx, miny, maxx, maxy = lake_utm.bounds
    s = 20.0
    return (math.floor((minx - margin_m) / s) * s, math.floor((miny - margin_m) / s) * s,
            math.ceil((maxx + margin_m) / s) * s, math.ceil((maxy + margin_m) / s) * s)


def _read(href: str, bounds, shape) -> np.ndarray:
    with rasterio.open(href) as ds:
        win = from_bounds(*bounds, transform=ds.transform).round_offsets().round_lengths()
        return ds.read(1, window=win, boundless=True, fill_value=0, out_shape=shape)


def read_window(item, bounds) -> dict:
    """Read all needed bands for `bounds` (in the item's UTM CRS) at 10 m."""
    signed = planetary_computer.sign(item)
    w = int(round((bounds[2] - bounds[0]) / 10))
    h = int(round((bounds[3] - bounds[1]) / 10))
    out = {}
    for b in BANDS_10M + BANDS_20M:
        href = signed.assets[b].href
        for attempt in range(3):
            try:
                if b in BANDS_10M:
                    arr = _read(href, bounds, (h, w))
                else:
                    small = _read(href, bounds, (h // 2, w // 2))
                    arr = np.repeat(np.repeat(small, 2, axis=0), 2, axis=1)
                break
            except rasterio.errors.RasterioIOError:
                if attempt == 2:
                    raise
                time.sleep(3 * (attempt + 1))
        out[b] = arr
    out["transform"] = rasterio.transform.from_origin(bounds[0], bounds[3], 10, 10)
    return out
