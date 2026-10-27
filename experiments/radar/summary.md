# Radar (Sentinel-1) vs optical (Sentinel-2) weed estimates

*Generated 2026-10-27 08:18 UTC. Experiment only — not used on the website.*

**Verdict:** Not reliable for this lake: radar does not track the optical figures well enough.

- Radar images found: 125 (2023-01-01 to today)
- Paired with a reliable Sentinel-2 reading within 3 days: 77
- Best radar rule (learned on pairs before 2025-01-01): a pixel is weed if **VV backscatter > -8 dB**
- Training: 37 pairs · average difference 19.3 points · bias +4.3 · correlation 0.27
- **Test (unseen, 2025-01-01 onwards): 40 pairs · average difference 19.8 points · bias -13.2 · correlation -0.02**
- For comparison, always guessing the training average would be off by 24.0 points on the test pairs.
  - descending passes: 40 pairs · average difference 19.8 points · bias -13.2 · correlation -0.02

"Average difference" is in percentage points of weed cover (e.g. radar 80% vs optical 90% = 10).
Sentinel-2 figures are themselves estimates, so this measures agreement, not ground truth.
