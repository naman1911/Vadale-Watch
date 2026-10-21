# Vadale Lake Watch

A free website that runs itself and tracks **invasive floating weed on Vadale Lake**
(Vadale Talao, beside Ballaleshwar temple, Old Panvel, Maharashtra) using
Sentinel-2 satellite images. It supports the Instagram campaign
[@savevadalelake](https://instagram.com/savevadalelake).

> **Every number here is a satellite estimate.** It comes from 10 m × 10 m pixels,
> not from measurements on the ground. Read [Limitations](#limitations) before quoting figures.

## What it does

Every day a GitHub Actions job:

1. asks Microsoft Planetary Computer for any new Sentinel-2 images of the lake,
2. skips images where clouds, cloud shadow or haze hide more than 30% of the lake,
3. labels every 10 m pixel inside the lake as **open water**, **weed**, or **other** (mud/mixed),
4. saves the numbers to `data/history.csv` and pictures to `data/images/`,
5. commits the results and republishes the website.

The website shows the current weed cover, the change since September 2025, a map,
monthly charts (this season month by month, and a year-by-year calendar), a before/after slider and a button that makes a 1080×1080 Instagram card.
It is available in English and Marathi.

## The method in plain words

| Step | What happens | Why |
|---|---|---|
| Lake outline | Fixed outline from OpenStreetMap ([way/54228760](https://www.openstreetmap.org/way/54228760), 9.46 ha) in `data/lake.geojson` | A fixed outline means a lake fully covered by weed still counts as lake. |
| Clouds | The image's Scene Classification (SCL) layer marks cloud, shadow and haze pixels; we ignore them. If < 70% of the lake is visible the image is skipped. | Clouds would be mistaken for water or weed. |
| Shore | Pixels within 10 m of the shore are left out. | Their 10 m square mixes in trees, walls and ghats, which look like weed. |
| Greenness | **NDVI** = (near-infrared − red) / (near-infrared + red). Leaves ≈ 0.3–0.8, water < 0.1. | Living leaves reflect strongly in near-infrared; water absorbs it. |
| Wetness | **NDWI** = (green − near-infrared) / (green + near-infrared). Open water > 0; weed-covered < 0. (MNDWI with short-wave infrared is an option.) | Confirms that the surface is no longer open water. |
| Rule | **Weed** = NDVI ≥ 0.20 and NDWI ≤ 0.05. **Water** = not weed and NDWI > −0.15. Everything else = **other** (exposed mud, mixed pixels). | Simple and transparent; tuned against ground photos. |
| Result | Weed % = weed pixels ÷ visible lake pixels. Open water (ha) = water share × 9.46 ha. | |
| Uncertainty | The same calculation is repeated with NDVI thresholds 0.30 (strict) and 0.12 (loose). The website shows this as a range and a shaded band. | Shows how sensitive the answer is to the rule. |

**Haze.** The SCL cloud map misses thick haze and smog, which is common over Panvel in winter.
So a lake pixel brighter than 0.12 in blue light also counts as hidden, and an image is skipped
if the visible lake's median blue is above 0.10 (clean water and weed are both dark in blue).

**Low-confidence dates.** Some clear images still give unreliable numbers. These are kept in
`history.csv` with a `flag`, drawn as hollow grey dots, and never used for the headline numbers:
- `lake_bed_exposed`: more than 15% of the lake is bare mud or dry bed (the lake was partly dry
  for months in 2020 and 2021), so "weed cover" is not meaningful;
- `wide_range`: the strict and loose estimates differ by more than 35 points (thin haze, or
  very sparse/dying weed).

Reflectance is corrected for ESA's +1000 offset in images processed after January 2022
(processing baseline 04.00), so old and new images are comparable.

## Files

```
config.yaml                 all adjustable settings (thresholds, cloud rules, lake)
pipeline/fetch_boundary.py  downloads the lake outline from OpenStreetMap
pipeline/sentinel.py        finds images and reads just the pixels around the lake
pipeline/classify.py        NDVI / NDWI / MNDWI and the water-vs-weed rule
pipeline/render.py          true-colour and weed-overlay pictures
pipeline/run.py             runs everything; writes the files below
pipeline/preview.py         draws the link-preview card (data/og.jpg) shown when the link is shared
pipeline/publish.py         assembles the website and fills in the link-preview text
data/lake.geojson           the fixed lake outline
data/history.csv            one row per clear date: date, weed_pct, open_water_ha, visible_pct, …
data/scenes.csv             every image checked, including the cloudy ones that were skipped
data/images/                YYYY-MM-DD_rgb.jpg (true colour) and YYYY-MM-DD_weed.png (overlay)
data/cache/                 raw lake pixels per date, so thresholds can be re-applied offline
site/                       the website (plain HTML/JS, Leaflet)
.github/workflows/          automation (update.yml) and boundary download (boundary.yml)
```

`history.csv` columns: `date`, `weed_pct` (headline estimate), `open_water_ha`,
`visible_pct` (share of the lake not hidden by cloud), `weed_pct_low` / `weed_pct_high`
(strict/loose range), `weed_ha`, `other_pct` (mud/mixed), `flag` (empty, or why the date is low confidence),
`scene_id` (the Sentinel-2 image used).

## Running and adjusting it

Everything runs on GitHub for free. Nothing needs installing.

- **Automatic:** the *Update lake data & website* workflow runs every day at 07:47 India time (GitHub may delay or occasionally skip a scheduled run; the next day catches up).
- **By hand:** *Actions → Update lake data & website → Run workflow*.
  - Leave the boxes empty to fetch new images.
  - Give a start and end date to process an older period (for example `2020-01-01` to `2025-08-31`; nothing before `baseline_start` in `config.yaml` is kept).
  - Tick **reclassify** after editing thresholds in `config.yaml`. This recalculates the
    whole history from the saved pixels in a minute, with no downloading.
- **Website setup (one time):** *Settings → Pages → Source: GitHub Actions*.

To run it on your own computer (Python 3.10+):

```bash
pip install -r requirements.txt
python -m pipeline.run --start 2025-09-01      # process a date range
python -m pipeline.run --reclassify             # re-apply thresholds
python -m pytest -q tests                        # self-tests (no internet needed)
cd _site && python -m http.server                 # after copying site/ and data/ into _site/
```

## Reusing this for your own lake

1. Fork this repository.
2. In `config.yaml`, set `lake.center_lat`, `center_lon`, `name_patterns` to your lake and set `osm_id: null`.
3. Run *Actions → Fetch lake boundary*. Check `data/lake_preview.png`. If it chose the wrong
   water body, pick the right ID from `data/lake_candidates.json` and set `osm_id`.
4. Delete `data/history.csv`, `data/scenes.csv`, `data/images/` and `data/cache/`.
5. Change the text in `site/i18n.js` (name, Instagram handle) and run *Update lake data & website* with a start date.
6. Turn on GitHub Pages (Settings → Pages → GitHub Actions).

Lakes smaller than about 3 hectares have too few 10 m pixels for reliable numbers.

## Limitations

- **10 m pixels.** Patches smaller than about 10 × 10 m, and narrow strips along the bank, are missed.
  Shore pixels are excluded entirely.
- **Look-alikes.** Thick algal blooms can look like weed. Thin, scattered or newly dying weed
  can look like water. Exposed mud in summer is counted as "other", not water.
- **Clouds.** In the monsoon there may be no usable image for weeks. Those gaps are shown
  as gaps and never filled in.
- **Haze.** The cloud mask is good but not perfect. Odd one-off spikes or dips usually mean
  haze or cloud edges were missed; check that date's true-colour picture.
- **Thresholds.** Starting values come from published studies of floating vegetation
  (water hyacinth, *Salvinia*). They should be checked against photos from the lake;
  see [docs/ground-truth.md](docs/ground-truth.md).

## Data credits

- Contains modified Copernicus Sentinel data, processed by ESA. Accessed via
  [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a).
- Lake outline © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL).
- Website basemap: Esri World Imagery (© Esri, Maxar, Earthstar Geographics).
- Leaflet (BSD-2) is included in `site/vendor/`.
