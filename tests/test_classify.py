import numpy as np
from affine import Affine
from rasterio.transform import from_origin
from shapely.geometry import box

from pipeline import classify as C
from pipeline.common import load_config
from pipeline.render import display_grid, true_colour, weed_overlay
from pipeline.run import analyse
from pipeline.sentinel import analysis_bounds, lake_in_crs

CFG = load_config()
# A ~300 m x 400 m rectangular test lake near Panvel
LAKE = box(73.1100, 18.9920, 73.1128, 18.9956)


def test_baseline_offset():
    dn = np.array([1500], dtype="uint16")
    assert np.isclose(C.to_reflectance(dn, "05.10")[0], 0.05)
    assert np.isclose(C.to_reflectance(dn, "03.00")[0], 0.15)


def test_classify_simple_pixels():
    det = CFG["detection"]
    # water, dense weed, mud, algae-ish water
    refl = {"B03": np.array([.06, .08, .10, .09]), "B04": np.array([.04, .04, .14, .05]),
            "B08": np.array([.02, .35, .18, .07]), "B11": np.array([.01, .15, .25, .02])}
    cls = C.classify(C.indices(refl), np.ones(4, bool), np.ones(4, bool), det)
    assert cls.tolist() == [C.WATER, C.WEED, C.OTHER, C.WATER]


def synthetic_scene(weed_fraction, cloud_fraction=0.0, baseline="05.10"):
    epsg = 32643
    bounds = analysis_bounds(lake_in_crs(LAKE, epsg), 120)
    w, h = int((bounds[2] - bounds[0]) / 10), int((bounds[3] - bounds[1]) / 10)
    off = 1000
    arrs = {"B02": np.full((h, w), 500 + off), "B03": np.full((h, w), 600 + off),
            "B04": np.full((h, w), 400 + off), "B08": np.full((h, w), 200 + off),
            "B11": np.full((h, w), 100 + off), "SCL": np.full((h, w), 6)}
    # weed in the top rows of the image
    rows = int(h * weed_fraction)
    arrs["B08"][:rows] = 3500 + off
    arrs["B11"][:rows] = 1500 + off
    crow = int(h * cloud_fraction)
    if crow:
        arrs["SCL"][h - crow:] = 9
    arrs = {k: v.astype("uint16" if k != "SCL" else "uint8") for k, v in arrs.items()}
    return arrs, epsg, baseline, from_origin(bounds[0], bounds[3], 10, 10)


def test_analyse_counts_weed_and_area():
    arrs, epsg, pb, tr = synthetic_scene(0.5)
    res = analyse(arrs, epsg, pb, tr, LAKE, CFG)
    s = res["stats"]
    assert res["visible_pct"] == 100
    assert 25 < s["weed_pct"] < 75
    assert abs(s["weed_ha"] + s["open_water_ha"] - 11.9) < 1.0   # 300x400 m ≈ 11.9 ha
    assert res["weed_pct_low"] <= s["weed_pct"] <= res["weed_pct_high"]


def test_cloud_reduces_visibility():
    arrs, epsg, pb, tr = synthetic_scene(0.0, cloud_fraction=0.6)
    res = analyse(arrs, epsg, pb, tr, LAKE, CFG)
    assert res["visible_pct"] < 70
    assert res["stats"]["weed_pct"] == 0


def test_images_share_grid():
    grid = display_grid(LAKE, 120, 4)
    arrs, epsg, pb, tr = synthetic_scene(0.3, 0.4)
    res = analyse(arrs, epsg, pb, tr, LAKE, CFG)
    rgb = true_colour(res["refl"], tr, epsg, grid)
    ov = np.array(weed_overlay(res["cls"], tr, epsg, grid))
    assert rgb.size == (grid["width"], grid["height"])
    assert (ov[..., 1] == 255).sum() > 0 and (ov[..., 0] == 255).sum() > 0  # weed + cloud drawn
    (s, w), (n, e) = grid["bounds"]
    assert s < 18.9920 and n > 18.9956 and w < 73.1100 and e > 73.1128


def test_haze_is_rejected():
    from pipeline.run import quality_status
    arrs, epsg, pb, tr = synthetic_scene(0.8)
    clear = analyse(arrs, epsg, pb, tr, LAKE, CFG)
    assert quality_status(clear, CFG) is None
    # thick haze: everything bright in blue, washed-out NIR
    hazy = {**arrs, "B02": arrs["B02"] + 1300, "B04": arrs["B04"] + 1000, "B08": arrs["B04"] + 1100}
    res = analyse(hazy, epsg, pb, tr, LAKE, CFG)
    assert quality_status(res, CFG) == "too_cloudy" and res["visible_pct"] == 0
    # moderate haze: passes the pixel test but the lake median is too bright
    mod = {**arrs, "B02": arrs["B02"] + 600}
    assert quality_status(analyse(mod, epsg, pb, tr, LAKE, CFG), CFG) == "hazy"


def test_low_confidence_flag():
    from pipeline.run import low_confidence_flag
    res = lambda other, lo, hi: {"stats": {"other_pct": other}, "weed_pct_low": lo, "weed_pct_high": hi}
    assert low_confidence_flag(res(1, 60, 70), CFG) == ""
    assert low_confidence_flag(res(40, 60, 70), CFG) == "lake_bed_exposed"
    assert low_confidence_flag(res(1, 20, 80), CFG) == "wide_range"


def test_refined_grid_covers_same_area():
    from pipeline.render import refine
    g = display_grid(LAKE, 120, 6)
    f = refine(g, 2)
    t, u = g["transform"], f["transform"]
    assert (f["width"], f["height"]) == (g["width"] * 2, g["height"] * 2)
    assert abs((t.c + t.a * g["width"]) - (u.c + u.a * f["width"])) < 1e-6
    assert abs((t.f + t.e * g["height"]) - (u.f + u.e * f["height"])) < 1e-6
