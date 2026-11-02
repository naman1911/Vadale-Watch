import csv
import datetime as dt
import json
from types import SimpleNamespace

from pipeline import run, sentinel
from tests.test_classify import LAKE, synthetic_scene


def fake_item(id_, date, weed, cloud=0.0):
    return SimpleNamespace(id=id_, datetime=dt.datetime.fromisoformat(date + "T05:40:00+00:00"),
                           properties={"eo:cloud_cover": 10.0, "s2:processing_baseline": "05.11",
                                       "proj:epsg": 32643},
                           _scene=(weed, cloud))


def test_main_end_to_end(tmp_path, monkeypatch):
    for name, val in {"DATA": tmp_path, "HISTORY_FILE": tmp_path / "history.csv",
                      "SCENES_FILE": tmp_path / "scenes.csv", "IMAGES": tmp_path / "images",
                      "CACHE": tmp_path / "cache"}.items():
        monkeypatch.setattr(run, name, val)
    monkeypatch.setattr(run, "load_lake", lambda: LAKE)
    items = [fake_item("A", "2025-09-03", 0.2, cloud=0.7),     # too cloudy
             fake_item("B", "2025-09-08", 0.3),                # used
             fake_item("C", "2025-09-08", 0.3, cloud=0.25),    # same day, less visible
             fake_item("D", "2025-09-13", 0.6),
             fake_item("E", "2025-09-18", 0.1)]                # download error
    monkeypatch.setattr(sentinel, "search", lambda *a, **k: items)

    def fake_read(item, bounds):
        if item.id == "E":
            raise OSError("network down")
        arrs, _, _, tr = synthetic_scene(*item._scene)
        return {**arrs, "transform": tr}
    monkeypatch.setattr(sentinel, "read_window", fake_read)

    run.main(["--start", "2025-09-01", "--end", "2025-09-30"])
    hist = list(csv.DictReader(open(tmp_path / "history.csv")))
    assert [h["date"] for h in hist] == ["2025-09-08", "2025-09-13"]
    assert float(hist[1]["weed_pct"]) > float(hist[0]["weed_pct"])
    scenes = {r["scene_id"]: r["status"] for r in csv.DictReader(open(tmp_path / "scenes.csv"))}
    assert scenes == {"A": "too_cloudy", "B": "used", "C": "duplicate_date", "D": "used"}
    assert (tmp_path / "images" / "2025-09-13_weed.png").exists()
    site = json.load(open(tmp_path / "site.json"))
    assert len(site["entries"]) == 2 and site["scenes_checked"] == 4

    # Second run: only E (previous failure) is retried; reclassify works from cache.
    run.main(["--start", "2025-09-01", "--end", "2025-09-30"])
    run.main(["--reclassify"])
    hist2 = list(csv.DictReader(open(tmp_path / "history.csv")))
    assert hist2 == hist
    assert sorted(p.name for p in (tmp_path / "images").iterdir()) == [
        "2025-09-08_rgb.jpg", "2025-09-08_weed.png", "2025-09-13_rgb.jpg", "2025-09-13_weed.png"]

    # Forced re-check with a stricter visibility rule drops dates that now fail.
    cfg = run.load_config()
    cfg["satellite"]["min_visible_pct"] = 101
    monkeypatch.setattr(run, "load_config", lambda: cfg)
    run.main(["--start", "2025-09-01", "--end", "2025-09-30", "--force"])
    assert list(csv.DictReader(open(tmp_path / "history.csv"))) == []
    assert not any((tmp_path / "images").iterdir())


def test_baseline_start_drops_older(tmp_path, monkeypatch):
    for name, val in {"DATA": tmp_path, "HISTORY_FILE": tmp_path / "history.csv",
                      "SCENES_FILE": tmp_path / "scenes.csv", "IMAGES": tmp_path / "images",
                      "CACHE": tmp_path / "cache"}.items():
        monkeypatch.setattr(run, name, val)
    monkeypatch.setattr(run, "load_lake", lambda: LAKE)
    items = [fake_item("OLD", "2019-12-30", 0.2), fake_item("NEW", "2020-01-04", 0.3)]
    seen = {}
    monkeypatch.setattr(sentinel, "search", lambda cfg, lake, start, end: seen.setdefault("start", start) and items)

    def fake_read(item, bounds):
        arrs, _, _, tr = synthetic_scene(*item._scene)
        return {**arrs, "transform": tr}
    monkeypatch.setattr(sentinel, "read_window", fake_read)
    run.main(["--start", "2019-01-01", "--end", "2020-02-01"])
    assert seen["start"] == "2020-01-01"
    hist = [r["date"] for r in csv.DictReader(open(tmp_path / "history.csv"))]
    assert hist == ["2020-01-04"]
    # an older row left over from a previous run is removed on the next run
    with open(tmp_path / "history.csv", "a") as f:
        f.write("2019-06-01,50,1,100,40,60,1,0,X\n")
    run.main(["--reclassify"])
    hist = [r["date"] for r in csv.DictReader(open(tmp_path / "history.csv"))]
    assert hist == ["2020-01-04"]


def test_cdse_ids_match_planetary_computer():
    from pipeline import cdse
    assert cdse.scene_id("S2B_MSIL2A_20261028T053929_N0511_R005_T43QCB_20261028T093505.SAFE") == \
        "S2B_MSIL2A_20261028T053929_R005_T43QCB_20261028T093505"
    assert cdse.tile_epsg("S2B_MSIL2A_20261028T053929_R005_T43QCB_20261028T093505") == 32643
    assert cdse.tile_epsg("S2A_MSIL2A_20200101T000000_R005_T21HUB_20200101T000000") == 32721


def test_second_source(tmp_path, monkeypatch):
    """ESA's copy fills in images Planetary Computer hasn't published, and
    replaces a damaged Planetary Computer file; if ESA fails, nothing breaks."""
    from pipeline import cdse
    for name, val in {"DATA": tmp_path, "HISTORY_FILE": tmp_path / "history.csv",
                      "SCENES_FILE": tmp_path / "scenes.csv", "IMAGES": tmp_path / "images",
                      "CACHE": tmp_path / "cache"}.items():
        monkeypatch.setattr(run, name, val)
    monkeypatch.setattr(run, "load_lake", lambda: LAKE)
    pc = [fake_item("BROKEN", "2025-09-08", 0.3), fake_item("PCONLY", "2025-09-13", 0.5)]
    monkeypatch.setattr(sentinel, "search", lambda *a, **k: pc)

    def pc_read(item, bounds):
        arrs, _, _, tr = synthetic_scene(*item._scene)
        if item.id in ("BROKEN", "OLDBAD"):  # like 28 Oct 2026: every value 0-255
            arrs = {b: (v % 256 if b != "SCL" else v) for b, v in arrs.items()}
        return {**arrs, "transform": tr}
    monkeypatch.setattr(sentinel, "read_window", pc_read)

    esa = [fake_item("BROKEN", "2025-09-08", 0.3), fake_item("NEW", "2025-09-18", 0.7),
           fake_item("ESACLOUDY", "2025-09-16", 0.2, cloud=0.7)]  # not recorded: wait for PC's copy
    for it in esa:
        it.properties["s2:processing_baseline"] = cdse.NO_OFFSET_BASELINE
    monkeypatch.setattr(cdse, "enabled", lambda: True)
    monkeypatch.setattr(cdse, "search", lambda *a, **k: esa)

    def esa_read(item, bounds):  # harmonised: ESA's +1000 offset already removed
        arrs, _, _, tr = synthetic_scene(*item._scene)
        return {**{b: (v - 1000 if b != "SCL" else v) for b, v in arrs.items()}, "transform": tr}
    monkeypatch.setattr(cdse, "read_window", esa_read)

    run.main(["--start", "2025-09-01", "--end", "2025-09-30"])
    scenes = {r["scene_id"]: (r["status"], r["source"]) for r in csv.DictReader(open(tmp_path / "scenes.csv"))}
    assert scenes == {"BROKEN": ("used", "cdse"), "PCONLY": ("used", "planetary"), "NEW": ("used", "cdse")}
    hist = {h["date"]: float(h["weed_pct"]) for h in csv.DictReader(open(tmp_path / "history.csv"))}
    assert list(hist) == ["2025-09-08", "2025-09-13", "2025-09-18"]
    assert hist["2025-09-08"] < hist["2025-09-13"] < hist["2025-09-18"]
    # ESA's copy missing part of the lake (as near the edge of a satellite strip):
    # used for now, then replaced by Planetary Computer's fuller copy.
    def partial(item, bounds):
        arrs = esa_read(item, bounds)
        if item.id == "PARTIAL":
            arrs = {**arrs, **{b: arrs[b].copy() for b in ("B04", "SCL")}}
            arrs["B04"][12:18] = 0   # rows inside the lake (12 px margin)
            arrs["SCL"][12:18] = 0
        return arrs
    monkeypatch.setattr(cdse, "read_window", partial)
    esa.append(fake_item("PARTIAL", "2025-09-28", 0.5))
    esa[-1].properties["s2:processing_baseline"] = cdse.NO_OFFSET_BASELINE
    run.main(["--start", "2025-09-01", "--end", "2025-09-30"])
    first_vis = next(r for r in csv.DictReader(open(tmp_path / "scenes.csv")) if r["scene_id"] == "PARTIAL")
    assert first_vis["source"] == "cdse" and 70 <= float(first_vis["lake_visible_pct"]) < 99.5
    pc.append(fake_item("PARTIAL", "2025-09-28", 0.5))
    run.main(["--start", "2025-09-01", "--end", "2025-09-30"])
    row = next(r for r in csv.DictReader(open(tmp_path / "scenes.csv")) if r["scene_id"] == "PARTIAL")
    assert (row["status"], row["source"], row["lake_visible_pct"]) == ("used", "planetary", "100.0")
    hist = {h["date"]: float(h["weed_pct"]) for h in csv.DictReader(open(tmp_path / "history.csv"))}
    assert float(next(h for h in csv.DictReader(open(tmp_path / "history.csv")) if h["date"] == "2025-09-28")["visible_pct"]) == 100
    run.main(["--start", "2025-09-01", "--end", "2025-09-30"])  # nothing left to upgrade
    assert {h["date"]: float(h["weed_pct"]) for h in csv.DictReader(open(tmp_path / "history.csv"))} == hist

    run.main(["--reclassify"])  # images saved from ESA re-classify the same way
    assert {h["date"]: float(h["weed_pct"]) for h in csv.DictReader(open(tmp_path / "history.csv"))} == hist

    # ESA unreachable: Planetary Computer results still come through.
    def down(*a, **k):
        raise OSError("ESA down")
    monkeypatch.setattr(cdse, "search", down)
    pc.extend([fake_item("OLDBAD", "2025-09-20", 0.4), fake_item("LATER", "2025-09-23", 0.4)])
    run.main(["--end", "2025-09-30"])
    hist = {h["date"] for h in csv.DictReader(open(tmp_path / "history.csv"))}
    assert "2025-09-23" in hist and "2025-09-20" not in hist   # damaged, no other copy yet

    # ESA back: the damaged date is retried from ESA's copy (once), the rest is not re-read.
    esa.append(fake_item("OLDBAD", "2025-09-20", 0.4))
    esa[-1].properties["s2:processing_baseline"] = cdse.NO_OFFSET_BASELINE
    monkeypatch.setattr(cdse, "search", lambda *a, **k: esa)
    run.main(["--end", "2025-09-30"])
    scenes = {r["scene_id"]: (r["status"], r["source"]) for r in csv.DictReader(open(tmp_path / "scenes.csv"))}
    assert scenes["OLDBAD"] == ("used", "cdse") and scenes["LATER"] == ("used", "planetary")


def test_cdse_requests(monkeypatch):
    """The ESA login, catalogue paging and image decoding, against fake replies."""
    import numpy as np
    from rasterio.io import MemoryFile
    from pipeline import cdse
    monkeypatch.setenv("CDSE_CLIENT_ID", "id")
    monkeypatch.setenv("CDSE_CLIENT_SECRET", "secret")
    cdse._token.clear()
    pages = [{"features": [{"id": "S2B_MSIL2A_20261028T053929_N0511_R005_T43QCB_20261028T093505.SAFE",
                            "properties": {"datetime": "2026-10-28T05:39:29Z", "eo:cloud_cover": 27.3}}],
              "context": {"next": 1}},
             {"features": [{"id": "S2B_MSIL2A_20261028T053929_N0511_R005_T43QBB_20261028T093505.SAFE",
                            "properties": {"datetime": "2026-10-28T05:39:29Z", "eo:cloud_cover": 99.0}}],
              "context": {}}]
    tif = np.arange(6 * 4 * 3, dtype="uint16").reshape(6, 4, 3)
    with MemoryFile() as mf:
        with mf.open(driver="GTiff", width=3, height=4, count=6, dtype="uint16") as ds:
            ds.write(tif)
        tif_bytes = mf.read()
    calls = []

    class Reply:
        def __init__(self, j=None, content=b""):
            self._j, self.content, self.status_code = j, content, 200
        def json(self):
            return self._j
        def raise_for_status(self):
            pass

    def post(url, json=None, data=None, headers=None, timeout=None):
        calls.append((url, json))
        if url == cdse.TOKEN_URL:
            assert data["client_secret"] == "secret"
            return Reply({"access_token": "T", "expires_in": 600})
        assert headers["Authorization"] == "Bearer T"
        if url == cdse.CATALOG_URL:
            return Reply(pages[json.get("next", 0)])
        assert json["input"]["data"][0]["processing"]["harmonizeValues"] is True
        assert (json["output"]["width"], json["output"]["height"]) == (3, 4)
        return Reply(content=tif_bytes)
    monkeypatch.setattr(cdse.requests, "post", post)

    items = cdse.search(LAKE, "2026-10-28", "2026-10-28", 95)
    assert [it.id for it in items] == ["S2B_MSIL2A_20261028T053929_R005_T43QCB_20261028T093505"]  # 99% cloud dropped
    assert items[0].properties["proj:epsg"] == 32643
    arrs = cdse.read_window(items[0], (0, 0, 30, 40))
    assert arrs["B02"].tolist() == tif[0].tolist() and arrs["SCL"].dtype == np.uint8
    assert sum(u == cdse.TOKEN_URL for u, _ in calls) == 1   # one login reused
