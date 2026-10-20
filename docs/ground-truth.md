# Checking the satellite against photos from the lake

The weed/water thresholds in `config.yaml` start from values in published
studies. Photos from the lake tell us whether they suit Vadale Lake.

## When to take photos

- **On a satellite pass day.** The website lists the next passes under the
  headline numbers. Sentinel-2 passes over Panvel at about **11:00 am IST**.
  A photo taken the same day (ideally 10 am – 1 pm) is best. Within 2 days is
  still useful because the weed moves slowly.
- **On a clear day.** If it's cloudy or hazy, the satellite image will be
  skipped and there is nothing to compare.

## How to take them

1. Stand somewhere high with a wide view: temple steps, a terrace, a building
   overlooking the lake. Take the same shots from the same spots each time.
2. Take a wide photo of the whole lake, then close-ups of:
   - the edge between weed and open water (is it a sharp line or scattered?),
   - any thin or patchy weed,
   - any green-looking water (algae) without floating plants.
3. Keep the original files. Photos store the date and time inside them.
4. Note roughly what share of the lake you think is covered (for example
   "about 70%, open water in the north-east corner").

## How to compare

Open the website, pick the same date in the map's date list, and compare the
green area with your photo.

| What you see | What it means | Setting to change in `config.yaml` |
|---|---|---|
| Real weed patches not shown green | Threshold too strict | lower `ndvi_weed` (e.g. 0.20 → 0.15) |
| Open or algae-green water shown green | Threshold too loose | raise `ndvi_weed` (e.g. 0.20 → 0.25), or lower `water_index_max_for_weed` |
| Thin/scattered weed missed, dense mats fine | Expected at 10 m | no change; mention it as a limitation |

After changing `config.yaml`, run *Actions → Update lake data & website → Run
workflow* with **reclassify** ticked. The whole history is recalculated with
the new values, so all dates stay comparable.
