"""Assemble the website for GitHub Pages (used by the workflow's deploy step).

Copies site/ and the data files into _site/, gives CSS/JS a version tag so
browsers never mix old and new files, and fills in the link-preview tags
(the card WhatsApp/Instagram show) with the latest weed figure.
Standard library only, so it runs without installing anything.

    python3 -m pipeline.publish            # builds ./_site
"""
from __future__ import annotations

import datetime as dt
import html
import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def site_url() -> str:
    if os.environ.get("SITE_URL"):
        return os.environ["SITE_URL"].rstrip("/") + "/"
    owner, _, repo = os.environ.get("GITHUB_REPOSITORY", "naman1911/Vadale-Watch").partition("/")
    return f"https://{owner.lower()}.github.io/{repo}/"


def main(out: Path = ROOT / "_site"):
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "site", out)
    (out / "data").mkdir()
    data = ROOT / "data"
    shutil.copytree(data / "images", out / "data" / "images")
    for f in ("site.json", "history.csv", "lake.geojson"):
        shutil.copy2(data / f, out / "data" / f)
    if (data / "og.jpg").exists():
        shutil.copy2(data / "og.jpg", out / "og.jpg")

    site = json.loads((data / "site.json").read_text(encoding="utf-8"))
    good = [e for e in site["entries"] if not e.get("flag")]
    url = site_url()
    if good:
        e = good[-1]
        pct = round(e["weed_pct"])
        day = dt.date.fromisoformat(e["date"]).strftime("%-d %b %Y")
        title = f"Vadale Lake Watch: {pct}% weed cover now"
        desc = (f"Satellite estimate: {pct}% of Vadale Lake, Old Panvel, is covered by invasive weed "
                f"(image of {day}). Updated automatically every 5 days. @savevadalelake")
    else:
        title = "Vadale Lake Watch"
        desc = "How much of Vadale Lake is covered by weed? Satellite estimates, updated every 5 days."
    version = os.environ.get("GITHUB_SHA", "local")[:8]
    stamp = "".join(ch for ch in site.get("generated", "") if ch.isalnum())
    page = (out / "index.html").read_text(encoding="utf-8")
    page = (page.replace("?v=dev", f"?v={version}")
                .replace("__OG_TITLE__", html.escape(title))
                .replace("__OG_DESC__", html.escape(desc))
                .replace("__OG_URL__", url)
                .replace("__OG_IMAGE__", f"{url}og.jpg?v={stamp}"))
    (out / "index.html").write_text(page, encoding="utf-8")
    print(f"Built {out} for {url}\n  {title}\n  {desc}")


if __name__ == "__main__":
    main()
