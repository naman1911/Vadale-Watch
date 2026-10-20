"""Make the pictures shown on the website.

All images share one fixed Web Mercator grid around the lake, so any two
dates line up exactly in the before/after slider and on the Leaflet map.
"""
from __future__ import annotations

import math

import numpy as np
from affine import Affine
from PIL import Image
from rasterio.warp import Resampling, reproject

from .classify import MASKED, WEED
from .common import lonlat_to_merc, merc_to_lonlat


def display_grid(lake_lonlat, margin_m: float, scale: int) -> dict:
    """Fixed output grid: Web Mercator, `scale` screen pixels per 10 m."""
    minx, miny, maxx, maxy = lake_lonlat.bounds
    lat = (miny + maxy) / 2
    k = 1 / math.cos(math.radians(lat))  # Mercator stretch at this latitude
    px = 10 * k / scale
    m = margin_m * k
    x0, y0 = lonlat_to_merc(minx, miny)
    x1, y1 = lonlat_to_merc(maxx, maxy)
    x0, y0, x1, y1 = x0 - m, y0 - m, x1 + m, y1 + m
    w, h = int(math.ceil((x1 - x0) / px)), int(math.ceil((y1 - y0) / px))
    x1, y0 = x0 + w * px, y1 - h * px
    west, south = merc_to_lonlat(x0, y0)
    east, north = merc_to_lonlat(x1, y1)
    return {
        "transform": Affine(px, 0, x0, 0, -px, y1),
        "width": w, "height": h,
        # Leaflet bounds: [[south, west], [north, east]]
        "bounds": [[round(south, 7), round(west, 7)], [round(north, 7), round(east, 7)]],
    }


def _warp(arr: np.ndarray, src_transform, epsg: int, grid: dict, nodata) -> np.ndarray:
    dst = np.full((grid["height"], grid["width"]), nodata, dtype=arr.dtype)
    reproject(arr, dst, src_transform=src_transform, src_crs=f"EPSG:{epsg}",
              dst_transform=grid["transform"], dst_crs="EPSG:3857",
              resampling=Resampling.nearest, src_nodata=None, dst_nodata=nodata)
    return dst


def true_colour(refl: dict, src_transform, epsg: int, grid: dict) -> Image.Image:
    """Natural-colour picture with one fixed brightness stretch for every date,
    so differences between dates are real, not caused by auto-contrast."""
    chans = []
    for b in ("B04", "B03", "B02"):
        v = np.clip(refl[b] / 0.20, 0, 1) ** (1 / 1.6)
        chans.append(_warp((v * 255).astype("uint8"), src_transform, epsg, grid, 0))
    return Image.fromarray(np.dstack(chans), "RGB")


def weed_overlay(cls: np.ndarray, src_transform, epsg: int, grid: dict) -> Image.Image:
    """Transparent PNG: green = weed, grey = hidden by cloud, clear = everything else."""
    c = _warp(cls, src_transform, epsg, grid, 255)
    rgba = np.zeros(c.shape + (4,), dtype="uint8")
    rgba[c == WEED] = (57, 255, 20, 255)
    rgba[c == MASKED] = (200, 200, 200, 170)
    return Image.fromarray(rgba, "RGBA")
