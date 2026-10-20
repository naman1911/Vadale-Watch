"""Link-preview card (data/og.jpg): the picture WhatsApp, Instagram DMs and
other apps show when someone shares the website link. Redrawn after every
run, so it always shows the latest reliable weed figure."""
from __future__ import annotations

import datetime as dt
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .common import DATA, IMAGES, lonlat_to_merc

FONTS = Path(__file__).resolve().parent / "fonts"
W, H = 1200, 630
NEON, WHITE, MUTED, YELLOW = (57, 255, 20), (242, 251, 249), (170, 205, 199), (255, 212, 0)


def _font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    name = {"x": "NotoSans_800ExtraBold.ttf", "b": "NotoSans_600SemiBold.ttf", "r": "NotoSans_400Regular.ttf"}[weight]
    try:
        return ImageFont.truetype(str(FONTS / name), size)
    except OSError:
        return ImageFont.truetype("DejaVuSans-Bold.ttf" if weight != "r" else "DejaVuSans.ttf", size)


def _wrap(draw, text, font, width):
    lines, line = [], ""
    for word in text.split():
        test = f"{line} {word}".strip()
        if draw.textlength(test, font=font) > width and line:
            lines.append(line)
            line = word
        else:
            line = test
    return lines + [line]


def _lake_panel(weed_png: Path, lake, grid: dict, box: tuple[int, int, int, int]) -> Image.Image:
    """The pixel map, cropped to the lake, with the outline, fitted into box."""
    weed = Image.open(weed_png).convert("RGBA")
    t = grid["transform"]
    k = weed.width / grid["width"]           # the weed map is drawn at extra detail
    to_px = lambda lon, lat: ((lonlat_to_merc(lon, lat)[0] - t.c) / t.a * k, (lonlat_to_merc(lon, lat)[1] - t.f) / t.e * k)
    minx, miny, maxx, maxy = lake.bounds
    (x0, y0), (x1, y1) = to_px(minx, maxy), to_px(maxx, miny)
    pad = 0.06 * max(x1 - x0, y1 - y0)
    crop = (int(x0 - pad), int(y0 - pad), int(math.ceil(x1 + pad)), int(math.ceil(y1 + pad)))
    bw, bh = box[2] - box[0], box[3] - box[1]
    s = min(bw / (crop[2] - crop[0]), bh / (crop[3] - crop[1]))
    panel = weed.crop(crop).resize((round((crop[2] - crop[0]) * s), round((crop[3] - crop[1]) * s)), Image.LANCZOS)
    d = ImageDraw.Draw(panel)
    polys = lake.geoms if hasattr(lake, "geoms") else [lake]
    for poly in polys:
        for ring in [poly.exterior, *poly.interiors]:
            pts = [((px - crop[0]) * s, (py - crop[1]) * s) for px, py in (to_px(*c) for c in ring.coords)]
            d.line(pts + [pts[0]], fill=YELLOW + (255,), width=5, joint="curve")
    return panel


def make_preview(history: dict, lake, grid: dict, images: Path = IMAGES, path: Path = DATA / "og.jpg") -> Path | None:
    good = [r for d, r in sorted(history.items()) if not r.get("flag")]
    if not good:
        return None
    e = good[-1]
    # Background: dark teal gradient with a faint satellite grid.
    yy, xx = np.mgrid[0:H, 0:W]
    f = xx / W * 0.4 + yy / H * 0.6
    bg = np.dstack([11 - 6 * f, 65 - 43 * f, 82 - 55 * f]).astype("uint8")
    bg[::40, :] = (16, 52, 60)
    bg[:, ::40] = (16, 52, 60)
    img = Image.fromarray(bg, "RGB")

    # Right: the lake as satellite pixels.
    box = (790, 40, 1160, 590)
    panel = _lake_panel(images / f"{e['date']}_weed.png", lake, grid, box)
    card = Image.new("RGBA", (box[2] - box[0] + 24, box[3] - box[1] + 24), (6, 22, 26, 235))
    mask = Image.new("L", card.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, card.width - 1, card.height - 1), 22, fill=255)
    cx, cy = box[0] - 12, box[1] - 12
    img.paste(card, (cx, cy), mask)
    img.paste(panel, (cx + (card.width - panel.width) // 2, cy + (card.height - panel.height) // 2), panel)

    # Left: the headline number with a soft neon glow.
    d = ImageDraw.Draw(img)
    left, width = 64, 680
    d.text((left, 58), "VADALE LAKE WATCH", font=_font("b", 30), fill=NEON)
    pct = f"{round(float(e['weed_pct']))}%"
    big = _font("x", 200)
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).text((left - 6, 92), pct, font=big, fill=NEON + (190,))
    img.paste(glow.filter(ImageFilter.GaussianBlur(18)), (0, 0), glow.filter(ImageFilter.GaussianBlur(18)))
    d.text((left - 6, 92), pct, font=big, fill=NEON)
    y = 340
    head = _font("x", 46)
    lines = ["of Vadale Lake is", "covered by weed"]
    if any(d.textlength(t_, font=head) > width for t_ in lines):
        lines = _wrap(d, " ".join(lines), head, width)
    for line in lines:
        d.text((left, y), line, font=head, fill=WHITE)
        y += 58
    date = dt.date.fromisoformat(e["date"]).strftime("%-d %b %Y")
    d.text((left, y + 10), f"Satellite image · {date}", font=_font("r", 28), fill=MUTED)
    d.text((left, 538), "@savevadalelake", font=_font("x", 38), fill=WHITE)
    d.text((left, 588), "Satellite estimate · updated every 5 days", font=_font("r", 22), fill=MUTED)
    img.save(path, quality=88, optimize=True, progressive=True)
    return path
