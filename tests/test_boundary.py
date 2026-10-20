from pipeline import fetch_boundary as fb

CFG = {"lake": {"center_lat": 18.9935, "center_lon": 73.116, "search_radius_m": 3000,
                "name_patterns": ["vadale", "वडाळे"], "min_area_ha": 2}}


def sq(x0, y0, d):
    pts = [(x0, y0), (x0 + d, y0), (x0 + d, y0 + d), (x0, y0 + d), (x0, y0)]
    return [{"lon": x, "lat": y} for x, y in pts]


def test_name_match_wins_over_distance(monkeypatch):
    fake = {"elements": [
        {"type": "way", "id": 1, "tags": {"natural": "water"}, "geometry": sq(73.115, 18.993, 0.002)},
        {"type": "way", "id": 2, "tags": {"natural": "water", "name": "Vadale Talao"},
         "geometry": sq(73.120, 18.995, 0.003)},
        # relation with an island (inner ring)
        {"type": "relation", "id": 3, "tags": {"natural": "water", "name:mr": "वडाळे तलाव"},
         "members": [{"type": "way", "role": "outer", "geometry": sq(73.10, 18.98, 0.004)},
                     {"type": "way", "role": "inner", "geometry": sq(73.101, 18.981, 0.001)}]},
    ]}
    monkeypatch.setattr(fb, "overpass", lambda q: fake)
    c = fb.find_candidates(CFG)
    assert [x["osm_id"] for x in c][:2] in (["way/2", "relation/3"], ["relation/3", "way/2"])
    rel = next(x for x in c if x["osm_id"] == "relation/3")
    assert rel["name_match"] and len(list(rel["geometry"].interiors)) == 1
    # ~0.004 deg square at 19N: 420 m x 440 m minus island ≈ 17.5 - 1.1 ha
    assert 14 < rel["area_ha"] < 18
