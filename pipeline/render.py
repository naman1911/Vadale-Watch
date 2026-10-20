"""Make the pictures shown on the website.

All images share one fixed Web Mercator grid around the lake, so any two
dates line up exactly in the before/after slider and on the Leaflet map.
"""
from __future__ import annotations

import math

import numpy as np
from affine import Affine
from PIL import Image, ImageDraw
from pyproj import Transformer
from rasterio.warp import Resampling, reproject

from .classify import MASKED, OTHER, OUTSIDE, WATER, WEED
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


def refine(grid: dict, k: int) -> dict:
    """The same area as `grid` with k times as many pixels each way."""
    t = grid["transform"]
    return {**grid, "transform": Affine(t.a / k, 0, t.c, 0, t.e / k, t.f),
            "width": grid["width"] * k, "height": grid["height"] * k}


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


PIXEL_COLOURS = {WEED: (57, 255, 20, 255), WATER: (42, 143, 214, 255),
                 OTHER: (196, 160, 98, 255), MASKED: (90, 90, 90, 170)}
GRID_LINE = (6, 22, 26, 255)


def weed_overlay(cls: np.ndarray, src_transform, epsg: int, grid: dict) -> Image.Image:
    """Transparent PNG of the lake drawn as satellite pixels: green = weed,
    blue = open water, sand = mud/mixed, stripes = hidden by cloud/haze.

    Each 10 m pixel is drawn as its true (very slightly rotated) square, with
    thin dark lines between squares, so the grid lines up with the map."""
    h, w = cls.shape
    # Corners of every satellite pixel, projected to display-image coordinates.
    cols, rows = np.meshgrid(np.arange(w + 1), np.arange(h + 1))
    xs = src_transform.c + cols * src_transform.a
    ys = src_transform.f + rows * src_transform.e
    mx, my = Transformer.from_crs(epsg, 3857, always_xy=True).transform(xs, ys)
    g = grid["transform"]
    px, py = (mx - g.c) / g.a, (my - g.f) / g.e
    square = np.hypot(px[0, 1] - px[0, 0], py[0, 1] - py[0, 0])   # one 10 m pixel, in image pixels
    ss = 4 if square < 16 else 2   # draw larger and scale down, so the tilted grid lines are smooth
    line = max(1, round(square * ss / 24))   # grid line ~1/12 of a square (neighbours share it)
    px, py = px * ss, py * ss

    size = (grid["width"], grid["height"])
    big = (size[0] * ss, size[1] * ss)
    img = Image.new("RGBA", big, (0, 0, 0, 0))
    hidden = Image.new("L", big, 0)
    draw, draw_hidden = ImageDraw.Draw(img), ImageDraw.Draw(hidden)
    polys = []
    for r, c in zip(*np.nonzero(cls != OUTSIDE)):
        poly = [(px[r, c], py[r, c]), (px[r, c + 1], py[r, c + 1]),
                (px[r + 1, c + 1], py[r + 1, c + 1]), (px[r + 1, c], py[r + 1, c])]
        draw.polygon(poly, fill=PIXEL_COLOURS[int(cls[r, c])])
        if cls[r, c] == MASKED:
            draw_hidden.polygon(poly, fill=255)
        polys.append(poly)
    for poly in polys:
        draw.polygon(poly, outline=GRID_LINE, width=line)
    img = img.resize(size, Image.BOX)
    # Hidden by cloud/haze: white diagonal stripes on the grey squares.
    yy, xx = np.indices((size[1], size[0]))
    sw = max(2, round(square / 4))
    stripes = (((xx + yy) // sw) % 2 == 0) & (np.array(hidden.resize(size, Image.BOX)) > 160)
    rgba = np.array(img)
    rgba[stripes] = (255, 255, 255, 220)
    return Image.fromarray(rgba, "RGBA")
