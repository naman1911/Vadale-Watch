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
