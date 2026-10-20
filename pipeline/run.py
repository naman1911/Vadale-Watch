"""Process Sentinel-2 images of the lake.

Examples
  python -m pipeline.run                                  # new images since the last run
  python -m pipeline.run --start 2025-09-01               # a date range (end defaults to today)
  python -m pipeline.run --start 2019-01-01 --end 2025-08-31
  python -m pipeline.run --reclassify                     # re-apply config.yaml thresholds
                                                          # to saved data, no downloading
Outputs
  data/history.csv   one row per clear date (the numbers on the website)
  data/scenes.csv    every image checked, including the cloudy ones skipped
  data/images/       true-colour and weed-overlay picture per clear date
  data/cache/        the raw lake pixels per clear date (for --reclassify)
  data/site.json     summary read by the website
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import sys
from pathlib import Path

import numpy as np
from pyproj import Geod
from rasterio.features import geometry_mask

from . import classify as C
from .common import DATA, HISTORY_FILE, IMAGES, SCENES_FILE, load_config, load_lake
from .render import display_grid, refine, true_colour, weed_overlay

CACHE = DATA / "cache"
HISTORY_COLS = ["date", "weed_pct", "open_water_ha", "visible_pct",
                "weed_pct_low", "weed_pct_high", "weed_ha", "other_pct", "flag", "scene_id"]
SCENE_COLS = ["scene_id", "date", "tile_cloud_pct", "lake_visible_pct", "status"]
BANDS = ["B02", "B03", "B04", "B08", "B11", "SCL"]
OVERLAY_DETAIL = 4   # weed map pixels per photo pixel


def lake_area_ha(lake) -> float:
    return abs(Geod(ellps="WGS84").geometry_area_perimeter(lake)[0]) / 10_000


def read_csv(path: Path, key: str) -> dict:
    if not path.exists():
        return {}
    with open(path, newline="", encoding="utf-8") as f:
        return {r[key]: r for r in csv.DictReader(f)}


def write_csv(path: Path, rows: list[dict], cols: list[str]):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def analyse(arrs: dict, epsg: int, baseline, transform, lake, cfg: dict) -> dict:
    """Cloud-mask, classify and summarise one image window."""
    from .sentinel import lake_in_crs

    lake_utm = lake_in_crs(lake, epsg)
    shape = arrs["SCL"].shape
    inside = geometry_mask([lake_utm], shape, transform, invert=True)
    core_geom = lake_utm.buffer(-cfg["lake"]["edge_buffer_m"])
    core = geometry_mask([core_geom], shape, transform, invert=True) if not core_geom.is_empty else inside
    if core.sum() == 0:
        core = inside
    sat = cfg["satellite"]
    refl = {b: C.to_reflectance(arrs[b], baseline) for b in BANDS if b != "SCL"}
    valid = (~np.isin(arrs["SCL"], sat["scl_masked_classes"]) & (arrs["B04"] > 0)
             & (refl["B02"] <= sat["haze_blue_pixel_max"]))
    visible_pct = 100 * (valid & inside).sum() / max(inside.sum(), 1)
    haze_blue = float(np.median(refl["B02"][valid & inside])) if (valid & inside).any() else None
    idx = C.indices(refl)
    det = cfg["detection"]
    area = lake_area_ha(lake)
    cls = C.classify(idx, valid, core, det)
    main = C.summarise(cls, area)
    low = C.summarise(C.classify(idx, valid, core, det, det["ndvi_weed_strict"]), area)
    high = C.summarise(C.classify(idx, valid, core, det, det["ndvi_weed_loose"]), area)
    return {"visible_pct": visible_pct, "haze_blue": haze_blue, "cls": cls, "refl": refl, "stats": main,
            "weed_pct_low": low["weed_pct"], "weed_pct_high": high["weed_pct"]}


def quality_status(res: dict, cfg: dict) -> str | None:
    """Why an image can't be used, or None if it is fine."""
    sat = cfg["satellite"]
    if res["visible_pct"] < sat["min_visible_pct"]:
        return "too_cloudy"
    if res["haze_blue"] is None or res["haze_blue"] > sat["haze_blue_median_max"]:
        return "hazy"
    return None


def low_confidence_flag(res: dict, cfg: dict) -> str:
    """Empty if the estimate is trustworthy, otherwise the reason it is not."""
    q = cfg["quality"]
    if res["stats"]["other_pct"] > q["max_other_pct"]:
        return "lake_bed_exposed"
    if res["weed_pct_high"] - res["weed_pct_low"] > q["max_range_points"]:
        return "wide_range"
    return ""


def history_row(date: str, scene_id: str, res: dict, cfg: dict) -> dict:
    s = res["stats"]
    r1 = lambda v: "" if v is None else f"{v:.1f}"
    r2 = lambda v: "" if v is None else f"{v:.2f}"
    return {"date": date, "weed_pct": r1(s["weed_pct"]), "open_water_ha": r2(s["open_water_ha"]),
            "visible_pct": r1(res["visible_pct"]), "weed_pct_low": r1(res["weed_pct_low"]),
            "weed_pct_high": r1(res["weed_pct_high"]), "weed_ha": r2(s["weed_ha"]),
            "other_pct": r1(s["other_pct"]), "flag": low_confidence_flag(res, cfg), "scene_id": scene_id}


def save_outputs(date: str, res: dict, epsg: int, transform, grid: dict):
    IMAGES.mkdir(parents=True, exist_ok=True)
    true_colour(res["refl"], transform, epsg, grid).save(IMAGES / f"{date}_rgb.jpg", quality=90)
    # The weed map is drawn at extra detail so its squares and grid lines stay
    # sharp when a phone stretches it; it covers exactly the same area.
    fine = refine(grid, OVERLAY_DETAIL)
    weed_overlay(res["cls"], transform, epsg, fine).save(IMAGES / f"{date}_weed.png", optimize=True)


def save_cache(date: str, scene_id: str, arrs: dict, epsg: int, baseline, bounds):
    CACHE.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(CACHE / f"{date}.npz", **{b: arrs[b] for b in BANDS},
                        epsg=epsg, baseline=str(baseline), bounds=np.array(bounds),
                        scene_id=scene_id)


def load_cache(date: str):
    from rasterio.transform import from_origin
    z = np.load(CACHE / f"{date}.npz")
    bounds = z["bounds"].tolist()
    return ({b: z[b] for b in BANDS}, int(z["epsg"]), str(z["baseline"]),
            from_origin(bounds[0], bounds[3], 10, 10), str(z["scene_id"]))


def next_passes(scenes: dict, days: int = 30) -> list[str]:
    """Predict upcoming Sentinel-2 passes over the lake.

    Each satellite (S2A/S2B/S2C) repeats the same orbit every 10 days, so the
    next passes are the last seen date of each satellite+orbit plus 10, 20, ...
    """
    last: dict[tuple, dt.date] = {}
    for sid, r in scenes.items():
        parts = sid.split("_")
        if len(parts) < 4:
            continue
        key = (parts[0], parts[3])
        d = dt.date.fromisoformat(r["date"])
        last[key] = max(last.get(key, d), d)
    today = dt.date.today()
    out = set()
    for d in last.values():
        if (today - d).days > 60:  # satellite no longer active
            continue
        while d <= today + dt.timedelta(days=days):
            if d > today:
                out.add(d.isoformat())
            d += dt.timedelta(days=10)
    return sorted(out)


def write_site_json(cfg: dict, lake, grid: dict, history: dict, scenes: dict):
    entries = []
    for d in sorted(history):
        r = history[d]
        entries.append({k: (r[k] if k in ("date", "scene_id", "flag") else (float(r[k]) if r[k] != "" else None))
                        for k in HISTORY_COLS})
    info = {
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "lake": {"name": cfg["lake"]["name"], "area_ha": round(lake_area_ha(lake), 2)},
        "image_bounds": grid["bounds"],
        "campaign_start": cfg["satellite"]["campaign_start"],
        "min_visible_pct": cfg["satellite"]["min_visible_pct"],
        "detection": cfg["detection"],
        "scenes_checked": len(scenes),
        "last_scene_date": max((s["date"] for s in scenes.values()), default=None),
        "next_passes": next_passes(scenes),
        "entries": entries,
    }
    with open(DATA / "site.json", "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False, indent=1)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", help="YYYY-MM-DD (default: day after the newest image already checked)")
    ap.add_argument("--end", help="YYYY-MM-DD (default: today)")
    ap.add_argument("--force", action="store_true", help="re-download images already checked")
    ap.add_argument("--reclassify", action="store_true", help="re-run classification from data/cache only")
    a = ap.parse_args(argv)

    cfg = load_config()
    lake = load_lake()
    out = cfg["output"]
    grid = display_grid(lake, out["image_margin_m"], out["display_scale"])
    first = cfg["satellite"]["baseline_start"]
    history = {d: r for d, r in read_csv(HISTORY_FILE, "date").items() if d >= first}
    scenes = {k: r for k, r in read_csv(SCENES_FILE, "scene_id").items() if r["date"] >= first}

    if a.reclassify:
        # Only images that passed before can be re-checked (others were never saved).
        for date in sorted(history):
            arrs, epsg, baseline, transform, sid = load_cache(date)
            res = analyse(arrs, epsg, baseline, transform, lake, cfg)
            bad = quality_status(res, cfg)
            if bad:
                del history[date]
                if sid in scenes:
                    scenes[sid]["status"] = bad
                    scenes[sid]["lake_visible_pct"] = f"{res['visible_pct']:.1f}"
                print(f"{date}  removed: {bad}")
                continue
            history[date] = history_row(date, sid, res, cfg)
            if sid in scenes:
                scenes[sid]["lake_visible_pct"] = history[date]["visible_pct"]
            save_outputs(date, res, epsg, transform, grid)
            print(f"{date}  weed {history[date]['weed_pct']:>5}%")
    else:
        from .sentinel import analysis_bounds, item_epsg, lake_in_crs, read_window, search
        today = dt.date.today().isoformat()
        start = a.start or (max((s["date"] for s in scenes.values()), default=cfg["satellite"]["campaign_start"]))
        start = max(start, first)
        end = a.end or today
        print(f"Searching Sentinel-2 images {start} .. {end}")
        items = search(cfg, lake, start, end)
        print(f"Found {len(items)} images; {sum(i.id not in scenes for i in items)} not checked before")
        if a.force:  # forget earlier results in this range; they are recomputed below
            history = {d: r for d, r in history.items() if not start <= d <= end}
        best: dict[str, float] = {d: float(r["visible_pct"]) for d, r in history.items()}
        failures = 0
        for it in items:
            if it.id in scenes and not a.force:
                continue
            date = it.datetime.date().isoformat()
            if date < first:
                continue
            tile_cloud = it.properties.get("eo:cloud_cover")
            try:
                epsg = item_epsg(it)
                bounds = analysis_bounds(lake_in_crs(lake, epsg), out["image_margin_m"])
                arrs = read_window(it, bounds)
                res = analyse(arrs, epsg, it.properties.get("s2:processing_baseline"),
                              arrs["transform"], lake, cfg)
            except Exception as e:  # network hiccup: don't record, retry next run
                failures += 1
                print(f"{date} {it.id}: ERROR {e}", file=sys.stderr)
                continue
            vis = res["visible_pct"]
            bad = quality_status(res, cfg)
            if bad:
                status = bad
            elif vis <= best.get(date, -1):
                status = "duplicate_date"  # same day seen in an overlapping tile
            else:
                status = "used"
                best[date] = vis
                prev = history.get(date, {}).get("scene_id")
                if prev in scenes and prev != it.id:
                    scenes[prev]["status"] = "duplicate_date"
                history[date] = history_row(date, it.id, res, cfg)
                save_outputs(date, res, epsg, arrs["transform"], grid)
                save_cache(date, it.id, arrs, epsg, it.properties.get("s2:processing_baseline"), bounds)
            scenes[it.id] = {"scene_id": it.id, "date": date,
                             "tile_cloud_pct": f"{tile_cloud:.1f}" if tile_cloud is not None else "",
                             "lake_visible_pct": f"{vis:.1f}", "status": status}
            extra = f"weed {history[date]['weed_pct']}%" if status == "used" else ""
            print(f"{date} {it.id[:38]:<38} visible {vis:5.1f}%  {status:<14} {extra}")
        if failures:
            print(f"{failures} images failed to download and will be retried next run", file=sys.stderr)

    # Remove pictures and saved pixels of dates that are no longer used.
    for folder in (IMAGES, CACHE):
        for f in folder.glob("*") if folder.exists() else []:
            if f.name[:10] not in history:
                f.unlink()

    write_csv(HISTORY_FILE, [history[d] for d in sorted(history)], HISTORY_COLS)
    write_csv(SCENES_FILE, sorted(scenes.values(), key=lambda r: (r["date"], r["scene_id"])), SCENE_COLS)
    write_site_json(cfg, lake, grid, history, scenes)
    print(f"History now has {len(history)} clear dates.")


if __name__ == "__main__":
    main()
