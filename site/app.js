/* Vadale Lake Watch: front-end. Reads data/site.json + data/lake.geojson. */
(() => {
  "use strict";
  const GAP_DAYS = 25;          // longer than this between clear images = shown as a gap
  const DAY = 86400000;
  const $ = (s) => document.querySelector(s);
  const state = { lang: "en", range: "campaign", site: null, lake: null, map: null, chart: null };

  // ---------- helpers --------------------------------------------------------
  const t = (k, ...a) => {
    const v = (I18N[state.lang] && I18N[state.lang][k]) ?? I18N.en[k];
    return typeof v === "function" ? v(...a) : v;
  };
  const ms = (d) => Date.parse(d + "T00:00:00Z");
  const locale = () => (state.lang === "mr" ? "mr-IN-u-nu-deva" : "en-GB");
  const fmtDate = (d, opts = { day: "numeric", month: "short", year: "numeric" }) =>
    new Intl.DateTimeFormat(locale(), { ...opts, timeZone: "UTC" }).format(new Date(ms(d)));
  const fmt = (v, n = 1) => (v == null ? "–" : new Intl.NumberFormat(locale(),
    { minimumFractionDigits: n, maximumFractionDigits: n, useGrouping: false }).format(v));
  // Pictures carry the data version (data/site.json is always fetched fresh), so a
  // phone never shows an old cached picture after the images are redrawn.
  const img = (d, kind) => `data/images/${d}_${kind === "rgb" ? "rgb.jpg" : "weed.png"}` +
    `?v=${encodeURIComponent(state.site?.generated || "")}`;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const entries = () => state.site?.entries ?? [];
  // Dates flagged as low confidence are shown faded, never used for headline numbers.
  const good = () => entries().filter((e) => !e.flag);
  const inCampaign = (list) => list.filter((e) => e.date >= state.site.campaign_start);

  // ---------- language -------------------------------------------------------
  function applyLang(lang) {
    state.lang = lang;
    document.documentElement.lang = lang;
    try { localStorage.setItem("lang", lang); } catch (_) { /* private mode */ }
    document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.lang === lang));
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    document.title = t("title");
    if (state.site) { renderStats(); renderSelects(); renderChart(); renderTable(); renderCompare(); }
    if (state.map) buildStrip(hero.list[hero.idx]?.date);
  }

  // ---------- headline numbers ----------------------------------------------
  function renderStats() {
    const all = good();
    if (!all.length) { $("#s-cover").textContent = "–"; $("#s-cover-date").textContent = t("no_data"); return; }
    const last = all[all.length - 1];
    const base = inCampaign(all)[0];
    $("#s-cover").innerHTML = `${fmt(last.weed_pct)}<span class="unit">%</span>`;
    $("#s-cover-range").textContent = t("range", fmt(last.weed_pct_low), fmt(last.weed_pct_high));
    $("#s-cover-date").textContent = t("image_of", fmtDate(last.date)) +
      (last.visible_pct < 99 ? ` (${t("visible_note", fmt(last.visible_pct, 0))})` : "");
    if (base && base.date !== last.date) {
      const d = last.weed_pct - base.weed_pct;
      $("#s-change").innerHTML = `${d > 0 ? "+" : d < 0 ? "−" : "±"}${fmt(Math.abs(d))}<span class="unit"> ${t("change_pts")}</span>`;
      $("#s-change-detail").textContent = t("change_detail", fmt(base.weed_pct), fmtDate(base.date), fmt(last.weed_pct));
    } else {
      $("#s-change").textContent = "–";
      $("#s-change-detail").textContent = t("change_none");
    }
    $("#s-water").innerHTML = `${fmt(last.open_water_ha, 1)}<span class="unit"> ha</span>`;
    $("#s-water-detail").textContent = t("water_of", fmt(state.site.lake.area_ha, 1));
    const checked = state.site.generated.slice(0, 10);
    const next = (state.site.next_passes || []).slice(0, 4).map((d) => fmtDate(d, { day: "numeric", month: "short" }));
    $("#s-checked").textContent = t("checked", fmtDate(checked), state.site.scenes_checked) +
      (next.length ? " " + t("next_passes", next.join(", ")) : "");
  }

  // ---------- date pickers ---------------------------------------------------
  function fillSelect(sel, value) {
    sel.innerHTML = "";
    [...entries()].reverse().forEach((e) => {
      const o = document.createElement("option");
      o.value = e.date;
      o.textContent = `${fmtDate(e.date)} · ${fmt(e.weed_pct)}%${e.flag ? " ⚠" : ""}`;
      sel.appendChild(o);
    });
    if (value) sel.value = value;
  }
  function renderSelects() {
    const all = good();
    if (!all.length) return;
    const last = all[all.length - 1].date;
    const first = (inCampaign(all)[0] || all[0]).date;
    fillSelect($("#cmp-a"), $("#cmp-a").value || first);
    fillSelect($("#cmp-b"), $("#cmp-b").value || last);
  }

  // ---------- hero map + date strip ------------------------------------------
  // Opens on the latest image. Earlier dates live in a swipeable strip
  // (newest on the right); tapping a date shows that day's map and numbers.
  const layers = {};
  const hero = { layer: "weed", list: [], idx: 0 };
  const wide = () => window.matchMedia("(min-width: 900px)").matches;
  const fitOpts = () => (wide() ? { paddingTopLeft: [470, 90], paddingBottomRight: [40, 40] }
                                : { paddingTopLeft: [20, 80], paddingBottomRight: [20, 36] });

  function initMap() {
    const map = L.map("map", { zoomSnap: 0.25, zoomControl: !L.Browser.mobile, scrollWheelZoom: false });
    if (map.zoomControl) map.zoomControl.setPosition("topright");
    map.on("click", () => map.scrollWheelZoom.enable());   // wheel zoom only after the user engages
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, maxNativeZoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics · Sentinel-2: Copernicus",
    }).addTo(map);
    const b = state.site?.image_bounds;
    const latest = good().at(-1)?.date;
    if (b && latest) {
      layers.photo = L.imageOverlay(img(latest, "rgb"), b, { className: "photo-layer" });
      layers.weed = L.imageOverlay(img(latest, "weed"), b, { opacity: 0.9, className: "weed-layer" }).addTo(map);
    }
    const glow = L.geoJSON(state.lake, { style: { color: "#ffd400", weight: 7, opacity: 0.35, fill: false, className: "lake-glow" }, interactive: false }).addTo(map);
    L.geoJSON(state.lake, { style: { color: "#fff6b0", weight: 2.5, fill: false, className: "lake-line" }, interactive: false }).addTo(map);
    map.fitBounds(glow.getBounds(), fitOpts());
    state.map = map;
    buildStrip();
  }

  function buildStrip(keepDate) {
    hero.list = good();
    const list = hero.list, strip = $("#strip");
    strip.innerHTML = "";
    if (!list.length) { $("#p-sub").textContent = t("no_data"); return; }
    const monthKey = (d) => d.slice(0, 7);
    list.forEach((e, i) => {
      const prev = list[i - 1];
      if (prev && ms(e.date) - ms(prev.date) > GAP_DAYS * DAY) {
        const g = document.createElement("div");
        g.className = "gapmark";
        g.innerHTML = `<b>☁</b><span>${t("gap_short")}</span>`;
        strip.appendChild(g);
      }
      if (!prev || monthKey(prev.date) !== monthKey(e.date)) {
        const sep = document.createElement("div");
        sep.className = "sep";
        sep.innerHTML = `<span>${fmtDate(e.date, { month: "short", year: "numeric" })}</span>`;
        strip.appendChild(sep);
      }
      const c = document.createElement("button");
      c.type = "button";
      c.className = "chip" + (i === list.length - 1 ? " latest" : "");
      c.setAttribute("role", "option");
      c.dataset.i = i;
      c.innerHTML = `<span class="d">${fmtDate(e.date, { day: "numeric" })}</span>` +
        `<span class="m">${fmtDate(e.date, { month: "short" })}</span>` +
        `<span class="bar"><i style="height:${Math.min(100, e.weed_pct)}%"></i></span>` +
        `<span class="v">${fmt(e.weed_pct, 0)}%</span>`;
      c.setAttribute("aria-label", `${fmtDate(e.date)}: ${fmt(e.weed_pct, 0)}%`);
      strip.appendChild(c);
    });
    const i = keepDate ? list.findIndex((e) => e.date === keepDate) : -1;
    select(i >= 0 ? i : list.length - 1, false);
    strip.scrollLeft = strip.scrollWidth;   // newest on screen first
    if (i >= 0) scrollToChip(false);
  }

  function scrollToChip(smooth = true) {
    const c = $(`#strip .chip[data-i="${hero.idx}"]`), strip = $("#strip");
    if (!c) return;
    const left = c.offsetLeft - strip.clientWidth / 2 + c.offsetWidth / 2;
    strip.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
  }

  function select(i, scroll = true) {
    const e = hero.list[i];
    if (!e) return;
    hero.idx = i;
    const isLatest = i === hero.list.length - 1;
    document.querySelectorAll("#strip .chip").forEach((c) => c.setAttribute("aria-selected", +c.dataset.i === i));
    if (layers.weed) layers.weed.setUrl(img(e.date, "weed"));
    if (layers.photo && hero.layer === "photo") layers.photo.setUrl(img(e.date, "rgb"));
    const label = $("#p-label");
    label.textContent = isLatest ? t("right_now") : t("on_date", fmtDate(e.date));
    label.classList.toggle("past", !isLatest);
    $("#p-pct").textContent = fmt(e.weed_pct, 0);
    $("#p-sub").textContent = (isLatest ? t("latest_image", fmtDate(e.date)) + "\n" : "") +
      t("range_short", fmt(e.weed_pct_low, 0), fmt(e.weed_pct_high, 0)) +
      (e.visible_pct < 99 ? ` · ${t("visible_short", fmt(e.visible_pct, 0))}` : "");
    $("#to-latest").hidden = isLatest;
    $("#map-key").hidden = hero.layer === "photo";
    $("#key-mud").hidden = !(e.other_pct >= 0.5);
    $("#key-hidden").hidden = !(e.visible_pct < 99.5);
    const stamp = $("#map-stamp");
    stamp.textContent = fmtDate(e.date, { day: "numeric", month: "short", year: "numeric" });
    stamp.classList.toggle("on", !isLatest);
    if (scroll) scrollToChip();
  }

  function setLayer(layer) {
    hero.layer = layer;
    document.querySelectorAll("[data-layer]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.layer === layer));
    if (!layers.weed) return;
    if (layer === "photo") { state.map.removeLayer(layers.weed); layers.photo.addTo(state.map); }
    else { state.map.removeLayer(layers.photo); layers.weed.addTo(state.map); }
    select(hero.idx, false);
  }

  function initHeroControls() {
    const strip = $("#strip");
    strip.addEventListener("click", (ev) => {
      const c = ev.target.closest(".chip");
      if (c) select(+c.dataset.i);
    });
    // Hide the swipe hint once someone has scrolled the strip.
    const start = () => strip.scrollLeft;
    let s0 = null;
    strip.addEventListener("scroll", () => {
      if (s0 === null) s0 = start();
      if (Math.abs(strip.scrollLeft - s0) > 40) $("#swipe-hint").classList.add("gone");
    }, { passive: true });
    // Mouse wheel scrolls the strip sideways on desktop.
    strip.addEventListener("wheel", (ev) => {
      if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) { strip.scrollLeft += ev.deltaY; ev.preventDefault(); }
    }, { passive: false });
    strip.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowLeft") { select(Math.max(0, hero.idx - 1)); ev.preventDefault(); }
      if (ev.key === "ArrowRight") { select(Math.min(hero.list.length - 1, hero.idx + 1)); ev.preventDefault(); }
    });
    $("#strip-prev").addEventListener("click", () => strip.scrollBy({ left: -strip.clientWidth * 0.8, behavior: "smooth" }));
    $("#strip-next").addEventListener("click", () => strip.scrollBy({ left: strip.clientWidth * 0.8, behavior: "smooth" }));
    $("#to-latest").addEventListener("click", () => select(hero.list.length - 1));
    document.querySelectorAll("[data-layer]").forEach((b) => b.addEventListener("click", () => setLayer(b.dataset.layer)));
  }

  // ---------- chart ----------------------------------------------------------
  // Draws a light band over long periods without clear images, so gaps read as gaps.
  const gapPlugin = {
    id: "gaps",
    beforeDatasetsDraw(chart) {
      const gaps = chart.options.plugins.gaps?.list || [];
      const { ctx, chartArea: a, scales: { x } } = chart;
      ctx.save();
      gaps.forEach(([g0, g1]) => {
        const x0 = Math.max(x.getPixelForValue(g0), a.left), x1 = Math.min(x.getPixelForValue(g1), a.right);
        if (x1 - x0 < 2) return;
        ctx.fillStyle = "rgba(128,128,128,0.10)";
        ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
        if (x1 - x0 > 54) {
          ctx.fillStyle = css("--muted");
          ctx.font = `11px ${css("--font")}`;
          ctx.textAlign = "center";
          ctx.fillText(t("chart_gap"), (x0 + x1) / 2, a.bottom - 8);
        }
      });
      ctx.restore();
    },
  };

  // Insert null points between images further apart than GAP_DAYS -> broken line.
  function withGaps(list, xOf) {
    const pts = { main: [], lo: [], hi: [] }, gaps = [];
    list.forEach((e, i) => {
      if (i > 0 && ms(e.date) - ms(list[i - 1].date) > GAP_DAYS * DAY) {
        const mid = (xOf(list[i - 1]) + xOf(e)) / 2;
        ["main", "lo", "hi"].forEach((k) => pts[k].push({ x: mid, y: null }));
        gaps.push([xOf(list[i - 1]), xOf(e)]);
      }
      const x = xOf(e);
      pts.main.push({ x, y: e.weed_pct, e });
      pts.lo.push({ x, y: e.weed_pct_low, e });
      pts.hi.push({ x, y: e.weed_pct_high, e });
    });
    return { pts, gaps };
  }

  function renderChart() {
    const ink2 = css("--ink-2"), line = css("--line"), accent = css("--accent"), band = css("--accent-band");
    const font = { family: css("--font"), size: 12 };
    if (state.chart) state.chart.destroy();
    const note = $("#chart-note");
    note.dataset.i18n = state.range === "years" ? "chart_note_years" : "chart_note";
    note.textContent = t(note.dataset.i18n);
    const all = good();
    let datasets = [], gaps = [], xOpts, legend = false;

    if (state.range === "years") {
      // One point per month (median of that month's clear images). Seasons run
      // June -> May so the dry season (Oct-May) is one continuous stretch.
      const seasonOf = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return m >= 6 ? y : y - 1; };
      const monthIdx = (d) => (+d.slice(5, 7) + 6) % 12;            // Jun = 0 ... May = 11
      const median = (v) => { const a = [...v].sort((x, y) => x - y), h = a.length >> 1; return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2; };
      const bySeason = {};
      all.forEach((e) => (((bySeason[seasonOf(e.date)] ||= {})[monthIdx(e.date)] ||= []).push(e.weed_pct)));
      const seasons = Object.keys(bySeason).map(Number).sort();
      const cur = seasons[seasons.length - 1], prev = seasons[seasons.length - 2];
      const blue = css("--series-2");
      let greyLabelled = false;
      seasons.forEach((y) => {
        const role = y === cur ? "cur" : y === prev ? "prev" : "old";
        const data = Array.from({ length: 12 }, (_, m) => {
          const v = bySeason[y][m];
          return { x: m + 0.5, y: v ? median(v) : null, m: { season: y, month: m, n: v ? v.length : 0 } };
        });
        const color = role === "cur" ? accent : role === "prev" ? blue : "rgba(128,128,128,0.45)";
        let label = t("season", y);
        if (role === "old") { label = greyLabelled ? "" : t("earlier_years"); greyLabelled = true; }
        datasets.push({ label, data, spanGaps: false, borderColor: color, backgroundColor: color,
          borderWidth: role === "old" ? 1.25 : 2.5, pointRadius: role === "old" ? 0 : 3.5, pointHoverRadius: 5,
          order: role === "cur" ? 0 : role === "prev" ? 1 : 2 });
      });
      legend = true;
      const monthName = (m) => new Intl.DateTimeFormat(locale(), { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2001, 5 + m, 15)));
      state.monthName = monthName;
      xOpts = {
        type: "linear", min: 0, max: 12,
        afterBuildTicks: (ax) => { ax.ticks = Array.from({ length: 12 }, (_, i) => ({ value: i + 0.5 })); },
        ticks: { color: ink2, font, autoSkip: true, maxRotation: 0, callback: (v) => monthName(Math.floor(v)) },
        grid: { color: line },
      };
    } else {
      const pick = (l) => (state.range === "campaign" ? inCampaign(l) : l);
      const list = pick(all), flagged = pick(entries()).filter((e) => e.flag);
      const r = withGaps(list, (e) => ms(e.date));
      // Grey "no clear images" bands only where there is no image at all.
      gaps = withGaps(pick(entries()), (e) => ms(e.date)).gaps;
      datasets = [
        { label: "high", data: r.pts.hi, borderWidth: 0, pointRadius: 0, fill: "+1", backgroundColor: band, spanGaps: false },
        { label: "low", data: r.pts.lo, borderWidth: 0, pointRadius: 0, fill: false, spanGaps: false },
        { label: t("tip_weed"), data: r.pts.main, borderColor: accent, backgroundColor: accent, borderWidth: 2,
          pointRadius: list.length > 120 ? 1.5 : 3, pointHoverRadius: 6, spanGaps: false },
      ];
      if (flagged.length) {
        datasets.push({ label: t("low_conf"), data: flagged.map((e) => ({ x: ms(e.date), y: e.weed_pct, e })),
          showLine: false, pointRadius: 3.5, pointHoverRadius: 6, borderWidth: 1.5,
          borderColor: "rgba(128,128,128,0.8)", backgroundColor: "transparent", pointStyle: "circle" });
        datasets[2].label = t("good_conf");
        legend = true;
      }
      const xs = pick(entries()).map((e) => ms(e.date));
      const pad = 3 * DAY;
      xOpts = {
        type: "linear",
        min: state.range === "campaign" ? Math.min(ms(state.site.campaign_start), ...xs) - pad : Math.min(...xs) - pad,
        max: Math.max(...xs, Date.now() - DAY) + pad,
        ticks: { color: ink2, font, maxRotation: 0, autoSkip: true, maxTicksLimit: 7,
          callback: (v) => new Intl.DateTimeFormat(locale(), { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(v)) },
        grid: { color: line },
      };
    }

    state.chart = new Chart($("#chart"), {
      type: "line",
      data: { datasets },
      plugins: [gapPlugin],
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        parsing: false, normalized: true,
        interaction: { mode: "nearest", intersect: false, axis: "x" },
        scales: {
          x: xOpts,
          y: { min: 0, suggestedMax: 60, ticks: { color: ink2, font, callback: (v) => fmt(v, 0) + "%" }, grid: { color: line },
               title: { display: true, text: t("chart_y"), color: ink2, font } },
        },
        plugins: {
          gaps: { list: gaps },
          legend: { display: legend, labels: { color: ink2, font, boxWidth: 14, boxHeight: 2,
            filter: (item) => item.text && item.text !== "high" && item.text !== "low" } },
          tooltip: {
            filter: (item) => item.raw && (item.raw.e || (item.raw.m && item.raw.y != null)) && item.dataset.label !== "high" && item.dataset.label !== "low",
            callbacks: {
              title: (items) => !items.length ? "" : items[0].raw.e ? fmtDate(items[0].raw.e.date) : state.monthName(items[0].raw.m.month),
              label: (item) => {
                if (item.raw.m) return `${t("season", item.raw.m.season)}: ${fmt(item.raw.y)}% (${t("median_of", item.raw.m.n)})`;
                const e = item.raw.e;
                const lines = [`${t("tip_weed")}: ${fmt(e.weed_pct)}%`, `${t("tip_range")}: ${fmt(e.weed_pct_low)}–${fmt(e.weed_pct_high)}%`,
                        `${t("tip_visible")}: ${fmt(e.visible_pct, 0)}%`];
                if (e.flag) lines.push(`⚠ ${t("flag_" + e.flag)}`);
                return lines;
              },
            },
          },
        },
      },
    });
  }

  function renderTable() {
    const tb = $("#table tbody");
    tb.innerHTML = "";
    [...entries()].reverse().forEach((e) => {
      const tr = document.createElement("tr");
      if (e.flag) tr.className = "flagged";
      [fmtDate(e.date), fmt(e.weed_pct), `${fmt(e.weed_pct_low)}–${fmt(e.weed_pct_high)}`, fmt(e.open_water_ha, 2), `${fmt(e.visible_pct, 0)}%`,
       e.flag ? `⚠ ${t("flag_" + e.flag)}` : ""]
        .forEach((v) => { const td = document.createElement("td"); td.textContent = v; tr.appendChild(td); });
      tb.appendChild(tr);
    });
  }

  // ---------- before / after -------------------------------------------------
  function renderCompare() {
    const a = $("#cmp-a").value, b = $("#cmp-b").value;
    if (!a || !b) return;
    const show = $("#cmp-overlay").checked;
    [["#cmp-a-layer", a], ["#cmp-b-layer", b]].forEach(([sel, d]) => {
      const [rgb, ov] = document.querySelectorAll(`${sel} img`);
      rgb.src = img(d, "rgb");
      ov.src = img(d, "weed");
      ov.hidden = !show;
    });
    const ea = entries().find((e) => e.date === a), eb = entries().find((e) => e.date === b);
    $("#cmp-a-tag").textContent = `${fmtDate(a)} · ${fmt(ea?.weed_pct)}%`;
    $("#cmp-b-tag").textContent = `${fmtDate(b)} · ${fmt(eb?.weed_pct)}%`;
  }
  function setSlider(v) {
    $("#cmp-a-layer").style.clipPath = `inset(0 ${100 - v}% 0 0)`;
    $("#cmp-handle").style.left = `${v}%`;
  }

  // ---------- Instagram card -------------------------------------------------
  const loadImg = (src) => new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = src; });

  function wrapText(ctx, text, x, y, maxW, lineH) {
    const words = text.split(" ");
    let lineStr = "";
    for (const w of words) {
      const test = lineStr ? `${lineStr} ${w}` : w;
      if (ctx.measureText(test).width > maxW && lineStr) { ctx.fillText(lineStr, x, y); y += lineH; lineStr = w; } else lineStr = test;
    }
    if (lineStr) ctx.fillText(lineStr, x, y);
    return y + lineH;
  }

  async function makeCard() {
    const all = good();
    if (!all.length) return;
    const btn = $("#ig-btn");
    btn.disabled = true;
    try {
      const last = all[all.length - 1], base = inCampaign(all)[0];
      const F = state.lang === "mr" ? '"Noto Sans Devanagari", "Noto Sans", sans-serif' : '"Noto Sans", sans-serif';
      await Promise.all(["800 100px", "600 40px", "400 30px"].map((w) => document.fonts.load(`${w} ${F.split(",")[0]}`).catch(() => {})));
      const [rgb, weed] = await Promise.all([loadImg(img(last.date, "rgb")), loadImg(img(last.date, "weed"))]);
      const c = $("#ig-canvas"), ctx = c.getContext("2d");
      const W = 1080;
      const g = ctx.createLinearGradient(0, 0, 0, W);
      g.addColorStop(0, "#0b4152"); g.addColorStop(1, "#062a35");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, W);

      // satellite picture (right side), aspect preserved
      const box = { x: 560, y: 150, w: 470, h: 760 };
      const s = Math.min(box.w / rgb.width, box.h / rgb.height);
      const iw = rgb.width * s, ih = rgb.height * s, ix = box.x + (box.w - iw) / 2, iy = box.y + (box.h - ih) / 2;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(rgb, ix, iy, iw, ih);
      ctx.globalAlpha = 0.92; ctx.drawImage(weed, ix, iy, iw, ih); ctx.globalAlpha = 1;
      // lake outline
      const [[S, Wl], [N, E]] = state.site.image_bounds;
      const my = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
      const px = ([lon, lat]) => [ix + ((lon - Wl) / (E - Wl)) * iw, iy + ((my(N) - my(lat)) / (my(N) - my(S))) * ih];
      ctx.strokeStyle = "#ffd400"; ctx.lineWidth = 3;
      state.lake.features.forEach((f) => {
        const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
        polys.forEach((p) => p.forEach((ring) => { ctx.beginPath(); ring.forEach((pt, i) => ctx[i ? "lineTo" : "moveTo"](...px(pt))); ctx.stroke(); }));
      });
      ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 2; ctx.strokeRect(ix, iy, iw, ih);

      // text (left side)
      ctx.fillStyle = "#ffffff"; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
      ctx.font = `800 46px ${F}`; ctx.fillText(t("title"), 56, 92);
      ctx.font = `400 30px ${F}`; ctx.fillStyle = "#bfe3ea"; ctx.fillText(t("image_of", fmtDate(last.date)), 56, 138);
      ctx.fillStyle = "#39ff14"; ctx.font = `800 170px ${F}`;
      ctx.fillText(`${Math.round(last.weed_pct)}%`, 48, 380);
      ctx.fillStyle = "#ffffff"; ctx.font = `600 40px ${F}`;
      let y = wrapText(ctx, t("ig_cover"), 56, 440, 470, 52);
      ctx.font = `400 28px ${F}`; ctx.fillStyle = "#bfe3ea";
      y = wrapText(ctx, t("range", fmt(last.weed_pct_low, 0), fmt(last.weed_pct_high, 0)), 56, y + 4, 470, 38);
      if (last.visible_pct < 99) y = wrapText(ctx, `(${t("visible_note", fmt(last.visible_pct, 0))})`, 56, y, 470, 38);
      ctx.font = `600 34px ${F}`; ctx.fillStyle = "#ffffff";
      if (base && base.date !== last.date) {
        const d = last.weed_pct - base.weed_pct;
        y = wrapText(ctx, t("ig_change", `${d >= 0 ? "+" : "−"}${fmt(Math.abs(d))}`, fmtDate(base.date)), 56, y + 40, 470, 46);
      }
      y = wrapText(ctx, t("ig_water", fmt(last.open_water_ha, 1), fmt(state.site.lake.area_ha, 1)), 56, y + 20, 470, 46);

      ctx.font = `400 26px ${F}`; ctx.fillStyle = "#ffe08a";
      wrapText(ctx, t("ig_note"), 56, 930, 470, 34);
      ctx.fillStyle = "#ffffff"; ctx.font = `800 44px ${F}`; ctx.fillText("@savevadalelake", 56, 1020);
      ctx.font = `400 18px ${F}`; ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.textAlign = "right";
      ctx.fillText("Contains modified Copernicus Sentinel data", 1030, 1040);
      ctx.fillText("© OpenStreetMap contributors", 1030, 1062);

      const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `vadale-lake-${last.date}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) {
      console.error(e);
      alert("Sorry, the image could not be created.");
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- start ----------------------------------------------------------
  async function init() {
    let lang = "en";
    try { lang = localStorage.getItem("lang") || (navigator.language || "").startsWith("mr") && "mr" || "en"; } catch (_) { /* ignore */ }
    const [site, lake] = await Promise.all([
      fetch("data/site.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("data/lake.geojson").then((r) => r.json()),
    ]);
    state.site = site || { entries: [], campaign_start: "2025-09-01", lake: { area_ha: 0 }, generated: "", scenes_checked: 0 };
    state.lake = lake;
    document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => applyLang(b.dataset.lang)));
    document.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => {
      state.range = b.dataset.range;
      document.querySelectorAll("[data-range]").forEach((x) => x.setAttribute("aria-pressed", x === b));
      renderChart();
    }));
    ["#cmp-a", "#cmp-b", "#cmp-overlay"].forEach((s) => $(s).addEventListener("change", renderCompare));
    $("#cmp-slider").addEventListener("input", (e) => setSlider(+e.target.value));
    $("#ig-btn").addEventListener("click", makeCard);
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", renderChart);
    applyLang(lang);
    initMap();
    initHeroControls();
    setSlider(50);
  }
  init();
})();
