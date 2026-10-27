"""Experiment: does Sentinel-1 radar agree with the Sentinel-2 weed estimates?

Radar sees through cloud and haze. Open water is smooth and looks dark to
radar; a mat of floating weed is rougher and looks brighter. This script
checks how well that idea matches the Sentinel-2 (optical) weed figures.

It only writes to experiments/radar/ and never touches data/ or the website.

    python -m experiments.radar_compare --start 2023-01-01

Method
  1. Every Sentinel-1 GRD radar image (VV and VH, 10 m) of the lake from
     Microsoft Planetary Computer, calibrated to backscatter (sigma0) with the
     calibration tables shipped with each image.
  2. Each one is paired with a reliable Sentinel-2 reading taken within
     --max-days days.
  3. A radar rule ("a pixel is weed if its VV (or VH) backscatter is above
     T dB") is chosen using only pairs before --split (training).
  4. That rule is then scored on the later pairs it never saw (test).
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import math
import warnings
from pathlib import Path

import numpy as np

from pipeline.common import HISTORY_FILE, ROOT, load_lake
from pipeline.run import read_csv

OUT = ROOT / "experiments" / "radar"
STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
# The terrain-corrected "sentinel-1-rtc" collection needs an approved account,
# so this uses the open "sentinel-1-grd" images and calibrates them here
# (terrain correction does not matter for a lake on flat ground).
COLLECTION = "sentinel-1-grd"
VV_THRESHOLDS = list(range(-24, -5))   # dB
VH_THRESHOLDS = list(range(-32, -13))  # dB
MIN_VALID = 0.8                        # share of lake pixels the radar image must cover


# ---------------------------------------------------------------- statistics

def to_db(linear: np.ndarray) -> np.ndarray:
    return 10 * np.log10(np.clip(linear, 1e-6, None))


def smooth3(a: np.ndarray) -> np.ndarray:
    """3x3 mean (ignoring NaN) to tame radar speckle."""
    p = np.pad(a, 1, constant_values=np.nan)
    stack = np.stack([p[i:i + a.shape[0], j:j + a.shape[1]] for i in range(3) for j in range(3)])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)   # all-NaN corners outside the image
        return np.nanmean(stack, axis=0)


def scene_stats(vv: np.ndarray, vh: np.ndarray, core: np.ndarray) -> dict | None:
    """Backscatter summary over the lake (core = lake minus a shore buffer)."""
    ok = core & np.isfinite(vv) & np.isfinite(vh) & (vv > 0) & (vh > 0)
    if ok.sum() < MIN_VALID * core.sum() or core.sum() == 0:
        return None
    vv_db = to_db(smooth3(np.where(ok, vv, np.nan)))[ok]
    vh_db = to_db(smooth3(np.where(ok, vh, np.nan)))[ok]
    out = {"pixels": int(ok.sum()), "vv_med": float(np.median(vv_db)), "vh_med": float(np.median(vh_db))}
    for t in VV_THRESHOLDS:
        out[f"vv>{t}"] = float((vv_db > t).mean() * 100)
    for t in VH_THRESHOLDS:
        out[f"vh>{t}"] = float((vh_db > t).mean() * 100)
    return out


def pair_with_s2(rows: list[dict], history: dict, max_days: int) -> list[dict]:
    good = {dt.date.fromisoformat(d): float(r["weed_pct"]) for d, r in history.items() if not r.get("flag")}
    pairs = []
    for r in rows:
        d = dt.date.fromisoformat(r["date"])
        near = [g for g in good if abs((g - d).days) <= max_days]
        if near:
            g = min(near, key=lambda x: abs((x - d).days))
            pairs.append({**r, "s2_date": g.isoformat(), "s2_weed": good[g], "gap_days": abs((g - d).days)})
    return pairs


def score(est: np.ndarray, ref: np.ndarray) -> dict:
    err = est - ref
    r = float(np.corrcoef(est, ref)[0, 1]) if len(est) > 2 and est.std() > 0 and ref.std() > 0 else float("nan")
    return {"n": len(est), "mae": float(np.abs(err).mean()), "bias": float(err.mean()), "r": r}


def evaluate(pairs: list[dict], split: str) -> dict:
    train = [p for p in pairs if p["date"] < split]
    test = [p for p in pairs if p["date"] >= split]
    cands = [f"vv>{t}" for t in VV_THRESHOLDS] + [f"vh>{t}" for t in VH_THRESHOLDS]
    ref_tr = np.array([p["s2_weed"] for p in train])
    best = min(cands, key=lambda c: np.abs(np.array([p[c] for p in train]) - ref_tr).mean()) if train else cands[0]
    res = {"rule": best, "train": score(np.array([p[best] for p in train]), ref_tr) if train else None}
    if test:
        ref_te = np.array([p["s2_weed"] for p in test])
        res["test"] = score(np.array([p[best] for p in test]), ref_te)
        # Context: how good is "always guess the training average"?
        res["baseline_mae"] = float(np.abs(ref_te - (ref_tr.mean() if train else ref_te.mean())).mean())
        for orbit in sorted({p["orbit"] for p in test}):
            sub = [p for p in test if p["orbit"] == orbit]
            res[f"test_{orbit}"] = score(np.array([p[best] for p in sub]), np.array([p["s2_weed"] for p in sub]))
    return res


def verdict(res: dict) -> str:
    t = res.get("test")
    if not t or t["n"] < 5:
        return "Not enough test pairs to judge."
    if t["mae"] <= 8 and t["r"] >= 0.8:
        return "Promising: radar tracks the optical figures closely."
    if t["mae"] <= 15 and t["r"] >= 0.6:
        return "Rough indicator only: useful to flag big changes on cloudy days, not for exact figures."
    return "Not reliable for this lake: radar does not track the optical figures well enough."


# ---------------------------------------------------------------- data access

def calibration_factor(xml_text: str, row: float, col: float) -> float:
    """sigma0 calibration constant A at (row, col) from a Sentinel-1 calibration
    XML (sigma0 = DN^2 / A^2). A varies slowly, so nearest line + interpolation
    across pixels is plenty for a lake-sized area."""
    import xml.etree.ElementTree as ET
    vecs = ET.fromstring(xml_text).iter("calibrationVector")
    best = min(vecs, key=lambda v: abs(int(v.findtext("line")) - row))
    pix = np.array(best.findtext("pixel").split(), dtype=float)
    sig = np.array(best.findtext("sigmaNought").split(), dtype=float)
    return float(np.interp(col, pix, sig))


def lake_in_image(lake, gcps):
    """Lake outline in the raw radar image's (col, row) coordinates."""
    from rasterio.transform import GCPTransformer
    from shapely.geometry import Polygon

    xs, ys = zip(*lake.exterior.coords)
    with GCPTransformer(gcps, tps=True) as t:
        rows, cols = t.rowcol(list(xs), list(ys), op=lambda v: v)
    return Polygon(zip(np.asarray(cols, float), np.asarray(rows, float)))


def read_lake(href: str, cal_href: str, lake, buffer_m: float, margin: int = 8):
    """Calibrated sigma0 (linear) around the lake + the lake 'core' mask."""
    import requests
    import rasterio
    from affine import Affine
    from rasterio.features import geometry_mask
    from rasterio.windows import Window

    with rasterio.open(href) as ds:
        gcps, _ = ds.gcps
        poly = lake_in_image(lake, gcps)
        c0, r0, c1, r1 = poly.bounds
        c0, r0 = int(math.floor(c0)) - margin, int(math.floor(r0)) - margin
        c1, r1 = int(math.ceil(c1)) + margin, int(math.ceil(r1)) + margin
        if c0 < 0 or r0 < 0 or c1 > ds.width or r1 > ds.height:
            return None
        dn = ds.read(1, window=Window(c0, r0, c1 - c0, r1 - r0)).astype("float64")
    a = calibration_factor(requests.get(cal_href, timeout=60).text, (r0 + r1) / 2, (c0 + c1) / 2)
    sigma0 = np.where(dn > 0, dn ** 2 / a ** 2, np.nan)
    local = Polygon_shift(poly, -c0, -r0)
    core_geom = local.buffer(-buffer_m / 10)   # GRD pixels are ~10 m
    core = geometry_mask([core_geom if not core_geom.is_empty else local], dn.shape,
                         Affine.identity(), invert=True)
    return sigma0, core


def Polygon_shift(poly, dx, dy):
    from shapely import affinity
    return affinity.translate(poly, dx, dy)


def fetch(lake, start: str, end: str, buffer_m: float) -> list[dict]:
    import planetary_computer
    import pystac_client
    from shapely.geometry import shape

    client = pystac_client.Client.open(STAC_URL)
    # A bounding-box search (the polygon search returned nothing for this
    # collection), then keep only scenes whose footprint covers the lake.
    found = list(client.search(collections=[COLLECTION], bbox=list(lake.bounds),
                               datetime=f"{start}/{end}").items())
    items = sorted((i for i in found if shape(i.geometry).contains(lake)), key=lambda i: i.datetime)
    print(f"Found {len(found)} Sentinel-1 images near the lake {start}..{end}; {len(items)} cover it fully")
    rows = []
    for it in items:
        try:
            s = planetary_computer.sign(it)
            vv = read_lake(s.assets["vv"].href, s.assets["schema-calibration-vv"].href, lake, buffer_m)
            vh = read_lake(s.assets["vh"].href, s.assets["schema-calibration-vh"].href, lake, buffer_m)
            if vv is None or vh is None:
                print(f"{it.datetime.date()} {it.id}: lake at image edge, skipped")
                continue
            st = scene_stats(vv[0], vh[0], vv[1])
        except Exception as e:  # skip unreadable scenes
            print(f"{it.datetime.date()} {it.id}: ERROR {str(e)[:160]}")
            continue
        if st is None:
            print(f"{it.datetime.date()} {it.id}: lake not fully covered, skipped")
            continue
        p = it.properties
        rows.append({"date": it.datetime.date().isoformat(), "scene_id": it.id,
                     "platform": p.get("platform", ""), "orbit": p.get("sat:orbit_state", ""),
                     "rel_orbit": p.get("sat:relative_orbit", ""), **st})
        print(f"{rows[-1]['date']} {rows[-1]['platform']:<12} {rows[-1]['orbit']:<10} "
              f"VV {st['vv_med']:6.1f} dB  VH {st['vh_med']:6.1f} dB")
    return rows


# ---------------------------------------------------------------- outputs

def write_outputs(rows: list[dict], pairs: list[dict], res: dict, args) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    if pairs:
        cols = list(pairs[0].keys())
        with open(OUT / "pairs.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(pairs)
    rule = res["rule"]
    pol, t = rule.split(">")
    fmt = lambda s: "n/a" if not s else (f"{s['n']} pairs · average difference {s['mae']:.1f} points · "
                                         f"bias {s['bias']:+.1f} · correlation {s['r']:.2f}")
    lines = [
        "# Radar (Sentinel-1) vs optical (Sentinel-2) weed estimates",
        "",
        f"*Generated {dt.datetime.now(dt.timezone.utc):%Y-%m-%d %H:%M} UTC. Experiment only — not used on the website.*",
        "",
        f"**Verdict:** {verdict(res)}",
        "",
        f"- Radar images found: {len(rows)} ({args.start} to {args.end or 'today'})",
        f"- Paired with a reliable Sentinel-2 reading within {args.max_days} days: {len(pairs)}",
        f"- Best radar rule (learned on pairs before {args.split}): a pixel is weed if "
        f"**{pol.upper()} backscatter > {t} dB**",
        f"- Training: {fmt(res.get('train'))}",
        f"- **Test (unseen, {args.split} onwards): {fmt(res.get('test'))}**",
    ]
    if res.get("test"):
        lines.append(f"- For comparison, always guessing the training average would be off by "
                     f"{res['baseline_mae']:.1f} points on the test pairs.")
        for k, v in res.items():
            if k.startswith("test_") and v:
                lines.append(f"  - {k[5:]} passes: {fmt(v)}")
    lines += ["", "\"Average difference\" is in percentage points of weed cover (e.g. radar 80% vs optical 90% = 10).",
              "Sentinel-2 figures are themselves estimates, so this measures agreement, not ground truth."]
    (OUT / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    if pairs:
        plot(pairs, rule, args.split)
    print("\n".join(lines))


def plot(pairs: list[dict], rule: str, split: str) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    opt, rad, ink, muted = "#008300", "#eb6834", "#0b0b0b", "#52514e"
    d = [dt.date.fromisoformat(p["date"]) for p in pairs]
    s2 = [p["s2_weed"] for p in pairs]
    s1 = [p[rule] for p in pairs]
    test = [p["date"] >= split for p in pairs]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(13, 4.8), gridspec_kw={"width_ratios": [2.2, 1]})
    a1.plot(d, s2, "o-", color=opt, ms=4, lw=1.5, label="Sentinel-2 (optical, used on site)")
    a1.plot(d, s1, "o-", color=rad, ms=4, lw=1.5, label="Sentinel-1 (radar, experiment)")
    a1.axvline(dt.date.fromisoformat(split), color=muted, ls="--", lw=1)
    a1.text(dt.date.fromisoformat(split), 103, "  test period →", color=muted, fontsize=9, va="bottom")
    a1.set_ylim(0, 108); a1.set_ylabel("Weed cover (% of lake)", color=muted)
    a1.legend(loc="lower left", frameon=False, fontsize=9)
    a2.plot([0, 100], [0, 100], color=muted, lw=1, ls=":")
    a2.scatter([x for x, t in zip(s2, test) if not t], [y for y, t in zip(s1, test) if not t],
               s=22, color="#bbbbbb", label="training pairs")
    a2.scatter([x for x, t in zip(s2, test) if t], [y for y, t in zip(s1, test) if t],
               s=26, color=rad, label="test pairs")
    a2.set_xlim(0, 100); a2.set_ylim(0, 100); a2.set_aspect("equal")
    a2.set_xlabel("Sentinel-2 weed %", color=muted); a2.set_ylabel("Radar weed %", color=muted)
    a2.legend(loc="upper left", frameon=False, fontsize=9)
    for a in (a1, a2):
        a.grid(color="#e6e6e6", lw=0.8); a.tick_params(colors=muted)
        for s in a.spines.values():
            s.set_visible(False)
    fig.suptitle(f"Radar vs optical weed estimates · radar rule: {rule.replace('>', ' > ')} dB",
                 color=ink, fontsize=12, x=0.01, ha="left")
    fig.tight_layout()
    fig.savefig(OUT / "comparison.png", dpi=130)


def probe(lake) -> None:
    """Print what the catalogue holds for Sentinel-1 around the lake (diagnostics)."""
    import pystac_client
    client = pystac_client.Client.open(STAC_URL)
    lon, lat = lake.centroid.x, lake.centroid.y
    bbox = [lon - 0.5, lat - 0.5, lon + 0.5, lat + 0.5]
    for coll in ("sentinel-1-rtc", "sentinel-1-grd"):
        try:
            c = client.get_collection(coll)
            print(f"{coll}: temporal extent {c.extent.temporal.intervals}")
        except Exception as e:
            print(f"{coll}: cannot read collection ({e})")
            continue
        for rng in ("2023-01-01/2023-12-31", "2025-01-01/2025-12-31", "2026-09-01/2026-10-31"):
            items = list(client.search(collections=[coll], bbox=bbox, datetime=rng, max_items=500).items())
            first = items[0] if items else None
            print(f"  {rng}: {len(items)} items near the lake"
                  + (f"; e.g. {first.id} assets={sorted(first.assets)[:6]}" if first else ""))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", default="2023-01-01")
    ap.add_argument("--end", default=None)
    ap.add_argument("--split", default="2025-01-01", help="pairs before this date train the rule; later ones test it")
    ap.add_argument("--max-days", type=int, default=3)
    ap.add_argument("--buffer", type=float, default=20, help="shore buffer in metres (radar picks up walls/trees)")
    ap.add_argument("--probe", action="store_true", help="only list what the catalogue holds")
    args = ap.parse_args(argv)
    lake = load_lake()
    if args.probe:
        return probe(lake)
    rows = fetch(lake, args.start, args.end or dt.date.today().isoformat(), args.buffer)
    pairs = pair_with_s2(rows, read_csv(HISTORY_FILE, "date"), args.max_days)
    res = evaluate(pairs, args.split) if pairs else {"rule": "vv>-15"}
    write_outputs(rows, pairs, res, args)


if __name__ == "__main__":
    main()
