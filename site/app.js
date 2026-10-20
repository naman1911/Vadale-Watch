/* Vadale Lake Watch: front-end. Reads data/site.json + data/lake.geojson. */
(() => {
  "use strict";
  const GAP_DAYS = 25;          // longer than this between clear images = shown as a gap
  const DAY = 86400000;
  const $ = (s) => document.querySelector(s);
  const state = { lang: "en", range: "campaign", site: null, lake: null, map: null, cmpMode: "weed" };

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
    if (state.site) { renderStats(); renderSelects(); renderViz(); renderTable(); renderCompare(); }
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

  // ---------- monthly views ---------------------------------------------------
  // Single images wobble by +-5-10 points (haze, light), so the charts show one
  // value per month: the median of that month's clear, reliable images.
  const median = (v) => { const a = [...v].sort((x, y) => x - y), h = a.length >> 1; return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2; };
  const monthName = (key, opts = { month: "short" }) => fmtDate(`${key}-15`, opts);
  const monthYear = (key) => monthName(key, { month: "short", year: "numeric" });

  function monthly() {
    const out = {};
    entries().forEach((e) => {
      const m = (out[e.date.slice(0, 7)] ||= { key: e.date.slice(0, 7), vals: [], flagged: 0 });
      if (e.flag) m.flagged++; else m.vals.push(e.weed_pct);
    });
    Object.values(out).forEach((m) => {
      if (!m.vals.length) return;
      m.weed = median(m.vals);
      m.lo = Math.min(...m.vals);
      m.hi = Math.max(...m.vals);
    });
    return out;
  }
  const monthKeys = (from, to) => {
    const keys = [];
    let [y, m] = from.split("-").map(Number);
    const [ty, tm] = to.split("-").map(Number);
    while (y < ty || (y === ty && m <= tm)) { keys.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } }
    return keys;
  };

  function detailText(key, m) {
    if (!m) return t("detail_none", monthYear(key));
    if (!m.vals.length) return t("detail_flag", monthYear(key));
    return t("detail", monthYear(key), fmt(m.weed, 0), m.vals.length, fmt(m.lo, 0), fmt(m.hi, 0));
  }
  function showDetail(key, m) {
    $("#viz-detail").textContent = detailText(key, m);
    document.querySelectorAll("#viz [data-key]").forEach((el) => el.classList.toggle("sel", el.dataset.key === key));
  }

  function renderViz() {
    const note = $("#chart-note");
    note.dataset.i18n = state.range === "years" ? "chart_note_years" : "chart_note";
    note.textContent = t(note.dataset.i18n);
    const all = entries();
    if (!all.length) { $("#viz").innerHTML = ""; $("#takeaway").textContent = t("no_data"); return; }
    if (state.range === "years") renderHeat(); else renderBars();
  }

  // "Since Sep 2025": one bar per month, filled like the lake (weed green, water blue).
  function renderBars() {
    const mon = monthly(), last = entries().at(-1).date.slice(0, 7);
    const keys = monthKeys(state.site.campaign_start.slice(0, 7), last);
    const withData = keys.filter((k) => mon[k]?.vals.length);
    const a = withData[0], b = withData.at(-1);
    $("#takeaway").innerHTML = a && b && a !== b
      ? t("takeaway", fmt(mon[a].weed, 0), monthYear(a), fmt(mon[b].weed, 0), monthYear(b), mon[b].weed >= mon[a].weed)
      : "";
    $("#viz").className = "viz bars";
    $("#viz").innerHTML = keys.map((k, i) => {
      const m = mon[k], showYear = i === 0 || k.endsWith("-01");
      const lbl = `<span class="lbl">${monthName(k)}${showYear ? `<small>${k.slice(0, 4)}</small>` : ""}</span>`;
      if (!m || !m.vals.length) {
        return `<button type="button" class="mbar empty" data-key="${k}"><span class="pct">${m ? "?" : "☁"}</span><span class="col"></span>${lbl}</button>`;
      }
      const w = Math.round(m.weed);
      return `<button type="button" class="mbar" data-key="${k}" aria-label="${detailText(k, m)}"><span class="pct">${fmt(w, 0)}%</span>` +
        `<span class="col"><i class="water" style="height:${100 - w}%"></i><i class="weed" style="height:${w}%"></i></span>${lbl}</button>`;
    }).join("");
    showDetail(b || keys.at(-1), mon[b || keys.at(-1)]);
  }

  // "Year by year": calendar heatmap, one row per year, darker green = more weed.
  function renderHeat() {
    const mon = monthly(), ents = entries();
    const y0 = +ents[0].date.slice(0, 4), y1 = +ents.at(-1).date.slice(0, 4), lastKey = ents.at(-1).date.slice(0, 7);
    const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
    const shade = (v) => {   // light -> deep green
      const c0 = [232, 245, 226], c1 = [10, 110, 30], f = Math.min(1, Math.max(0, v / 100));
      return `rgb(${c0.map((c, i) => Math.round(c + (c1[i] - c) * f)).join(",")})`;
    };
    let html = `<div class="hm-row hm-head"><span></span>${months.map((m, i) => `<span>${t("months_short")[i]}</span>`).join("")}</div>`;
    for (let y = y1; y >= y0; y--) {
      html += `<div class="hm-row"><span class="yr">${fmt(y, 0)}</span>`;
      months.forEach((mm) => {
        const k = `${y}-${mm}`, m = mon[k];
        if (k > lastKey) { html += `<span class="cell future"></span>`; return; }
        if (!m) { html += `<button type="button" class="cell none" data-key="${k}" aria-label="${detailText(k)}">☁</button>`; return; }
        if (!m.vals.length) { html += `<button type="button" class="cell flag" data-key="${k}" aria-label="${detailText(k, m)}">?</button>`; return; }
        html += `<button type="button" class="cell" data-key="${k}" style="background:${shade(m.weed)};color:${m.weed > 55 ? "#fff" : "#123"}" aria-label="${detailText(k, m)}">${fmt(m.weed, 0)}</button>`;
      });
      html += `</div>`;
    }
    html += `<div class="hm-legend"><span>0%</span><i></i><span>100% ${t("key_weed").toLowerCase()}</span></div>`;
    $("#viz").className = "viz heat";
    $("#viz").innerHTML = html;
    // Takeaway: how the latest month compares with the same month in earlier years.
    const lk = Object.keys(mon).filter((k) => mon[k].vals.length).sort().at(-1);
    const same = Object.keys(mon).filter((k) => k.slice(5) === lk.slice(5) && k !== lk && mon[k].vals.length).map((k) => mon[k].weed);
    const v = mon[lk].weed, mName = monthName(lk, { month: "long" });
    $("#takeaway").innerHTML = !same.length ? "" :
      v >= Math.max(...same) ? t("takeaway_worst", mName, fmt(v, 0), fmt(y0, 0)) :
      v <= Math.min(...same) ? t("takeaway_best", mName, fmt(v, 0), fmt(y0, 0)) :
      t("takeaway_range", monthYear(lk), fmt(v, 0), mName, fmt(Math.min(...same), 0), fmt(Math.max(...same), 0));
    showDetail(lk, mon[lk]);
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
  // Crop the before/after pictures tightly around the lake (no surrounding houses).
  function cmpCrop() {
    const ib = state.site?.image_bounds;
    if (!ib || !state.lake) return;
    const [[S, W], [N, E]] = ib;
    const my = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const fx = (lon) => (lon - W) / (E - W), fy = (lat) => (my(N) - my(lat)) / (my(N) - my(S));
    const rings = [];
    state.lake.features.forEach((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates)
      .forEach((poly) => poly.forEach((ring) => rings.push(ring))));
    const pts = rings.flat();
    let x0 = Math.min(...pts.map((p) => fx(p[0]))), x1 = Math.max(...pts.map((p) => fx(p[0])));
    let y0 = Math.min(...pts.map((p) => fy(p[1]))), y1 = Math.max(...pts.map((p) => fy(p[1])));
    const pad = 0.06 * Math.max(x1 - x0, y1 - y0);
    x0 = Math.max(0, x0 - pad); x1 = Math.min(1, x1 + pad); y0 = Math.max(0, y0 - pad); y1 = Math.min(1, y1 + pad);
    const imgAspect = ((E - W) * Math.PI / 180) / (my(N) - my(S));
    $("#cmp").style.aspectRatio = `${((x1 - x0) * imgAspect) / (y1 - y0)}`;
    document.querySelectorAll("#cmp .cmp-layer img").forEach((im) => {
      im.style.width = `${100 / (x1 - x0)}%`;
      im.style.left = `${(-x0 / (x1 - x0)) * 100}%`;
      im.style.top = `${(-y0 / (y1 - y0)) * 100}%`;
    });
    const sx = (lon) => ((fx(lon) - x0) / (x1 - x0)) * 100, sy = (lat) => ((fy(lat) - y0) / (y1 - y0)) * 100;
    $("#cmp-outline path").setAttribute("d", rings.map((r) => "M" + r.map((p) => `${sx(p[0]).toFixed(2)},${sy(p[1]).toFixed(2)}`).join("L") + "Z").join(""));
  }

  function renderCompare() {
    const a = $("#cmp-a").value, b = $("#cmp-b").value;
    if (!a || !b) return;
    const photo = state.cmpMode === "photo";
    [["#cmp-a-layer", a], ["#cmp-b-layer", b]].forEach(([sel, d]) => {
      const ph = $(`${sel} img.ph`), ov = $(`${sel} img.ov`);
      ph.src = img(d, "rgb");
      ov.src = img(d, "weed");
      ph.hidden = !photo;
      ov.hidden = photo;
    });
    const ea = entries().find((e) => e.date === a), eb = entries().find((e) => e.date === b);
    $("#cmp-a-tag").textContent = `${fmtDate(a)} · ${fmt(ea?.weed_pct, 0)}%`;
    $("#cmp-b-tag").textContent = `${fmtDate(b)} · ${fmt(eb?.weed_pct, 0)}%`;
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
      renderViz();
    }));
    ["#cmp-a", "#cmp-b"].forEach((s) => $(s).addEventListener("change", renderCompare));
    document.querySelectorAll("[data-cmp]").forEach((b) => b.addEventListener("click", () => {
      state.cmpMode = b.dataset.cmp;
      document.querySelectorAll("[data-cmp]").forEach((x) => x.setAttribute("aria-pressed", x === b));
      renderCompare();
    }));
    cmpCrop();
    $("#cmp-slider").addEventListener("input", (e) => setSlider(+e.target.value));
    $("#ig-btn").addEventListener("click", makeCard);
    // Scroll down without adding "#story" to the address bar.
    $(".scroll-cue").addEventListener("click", (ev) => {
      ev.preventDefault();
      $("#story").scrollIntoView({ behavior: "smooth" });
    });
    $("#viz").addEventListener("click", (ev) => {
      const el = ev.target.closest("[data-key]");
      if (el) showDetail(el.dataset.key, monthly()[el.dataset.key]);
    });
    applyLang(lang);
    initMap();
    initHeroControls();
    setSlider(50);
  }
  init();
})();
