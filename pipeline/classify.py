"""Pixel classification: open water vs floating vegetation (weed).

Everything here works on plain numpy arrays so it can be tested without
downloading anything.

Plain-language summary of the method
------------------------------------
Sentinel-2 measures how much sunlight bounces back in several colours,
including two the eye can't see: near-infrared (NIR) and short-wave
infrared (SWIR).
* Living leaves reflect a lot of NIR; water absorbs almost all of it.
  NDVI = (NIR - Red) / (NIR + Red) is therefore high for weed, low for water.
* Water reflects more green light than NIR (NDWI) or SWIR (MNDWI), so those
  "water indices" are positive for open water and negative once leaves cover it.
A pixel is called weed when it is green-leafy (NDVI high) AND no longer looks
like open water (water index low).
"""
from __future__ import annotations

import numpy as np

WATER, WEED, OTHER, MASKED, OUTSIDE = 0, 1, 2, 3, 255


def to_reflectance(dn: np.ndarray, processing_baseline: str | float | None) -> np.ndarray:
    """Convert Sentinel-2 L2A digital numbers to surface reflectance (0..1).

    Since processing baseline 04.00 (25 Jan 2022) ESA adds +1000 to every
    value, so it must be subtracted or vegetation indices shift.
    """
    dn = dn.astype("float32")
    try:
        pb = float(processing_baseline) if processing_baseline is not None else 0.0
    except ValueError:
        pb = 0.0
    offset = -1000.0 if pb >= 4.0 else 0.0
    refl = (dn + offset) / 10000.0
    return np.clip(refl, 1e-4, None)


def norm_diff(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        out = (a - b) / (a + b)
    return np.nan_to_num(out, nan=0.0)


def indices(refl: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    return {
        "ndvi": norm_diff(refl["B08"], refl["B04"]),
        "ndwi": norm_diff(refl["B03"], refl["B08"]),
        "mndwi": norm_diff(refl["B03"], refl["B11"]),
    }


def classify(idx: dict[str, np.ndarray], valid: np.ndarray, inside: np.ndarray,
             det: dict, ndvi_threshold: float | None = None) -> np.ndarray:
    """Return a class map: WATER, WEED, OTHER (mud/mixed), MASKED or OUTSIDE."""
    t = det["ndvi_weed"] if ndvi_threshold is None else ndvi_threshold
    wi = idx[det["water_index"]]
    weed = (idx["ndvi"] >= t) & (wi <= det["water_index_max_for_weed"])
    water = ~weed & (wi > det["water_index_min_for_water"])
    cls = np.full(valid.shape, OUTSIDE, dtype="uint8")
    cls[inside] = OTHER
    cls[inside & water] = WATER
    cls[inside & weed] = WEED
    cls[inside & ~valid] = MASKED
    return cls


def summarise(cls: np.ndarray, lake_area_ha: float) -> dict:
    """Turn a class map into percentages and hectares.

    Percentages are shares of the *visible* part of the lake; hectares apply
    those shares to the full lake area from the fixed outline.
    """
    n_weed = int((cls == WEED).sum())
    n_water = int((cls == WATER).sum())
    n_other = int((cls == OTHER).sum())
    n_vis = n_weed + n_water + n_other
    if n_vis == 0:
        return {"weed_pct": None, "water_pct": None, "other_pct": None,
                "weed_ha": None, "open_water_ha": None, "pixels": 0}
    weed_pct = 100 * n_weed / n_vis
    water_pct = 100 * n_water / n_vis
    return {
        "weed_pct": weed_pct,
        "water_pct": water_pct,
        "other_pct": 100 * n_other / n_vis,
        "weed_ha": lake_area_ha * weed_pct / 100,
        "open_water_ha": lake_area_ha * water_pct / 100,
        "pixels": n_vis,
    }
