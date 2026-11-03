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

  // ---------- Instagram card (1080 x 1350, Instagram's tall feed format) -------
  const PITCH_HA = 0.714;   // a football pitch, 105 m x 68 m
  const NEON = "#39ff14", WATER = "#2a8fd6", MUD = "#c4a062", YELLOW = "#ffd400", INK = "#062a35";

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function cloud(ctx, x, y, r, col) {   // a small cloud: "no clear picture"
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x - r * 0.9, y + r * 0.25, r * 0.7, 0, 2 * Math.PI);
    ctx.arc(x, y - r * 0.15, r, 0, 2 * Math.PI);
    ctx.arc(x + r * 0.95, y + r * 0.3, r * 0.65, 0, 2 * Math.PI);
    ctx.fill();
    rrect(ctx, x - r * 1.6, y + r * 0.1, r * 3.2, r * 0.85, r * 0.42); ctx.fill();
  }

  // The level stamp: how bad it is, in one word.
  const stampFor = (p) => (p >= 80 ? ["SOS", "#ff3b3b"] : p >= 50 ? [t("ig_stamp_alert"), "#ff8a00"]
    : p >= 20 ? [t("ig_stamp_spread"), YELLOW] : [t("ig_stamp_better"), WATER]);

  async function drawCard(c) {
    const all = good();
    const last = all[all.length - 1], base = inCampaign(all)[0];
    const F = state.lang === "mr" ? '"Noto Sans Devanagari", "Noto Sans", sans-serif' : '"Noto Sans", sans-serif';
    await Promise.all(["800 100px", "600 40px", "400 30px"].map((w) => document.fonts.load(`${w} ${F.split(",")[0]}`).catch(() => {})));
    const [rgb, weed] = await Promise.all([loadImg(img(last.date, "rgb")), loadImg(img(last.date, "weed"))]);
    const ctx = c.getContext("2d");
    const W = 1080, H = 1350, L = 60;
    c.width = W; c.height = H;
    const font = (w, s) => { ctx.font = `${w} ${s}px ${F}`; };
    const fit = (text, w, s, maxW) => { font(w, s); while (ctx.measureText(text).width > maxW && s > 12) font(w, --s); };

    // Background: deep teal, a faint satellite grid, a green glow behind the number.
    const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, "#0b4152"); g.addColorStop(1, "#04161c");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(120,220,210,.07)"; ctx.lineWidth = 1;
    for (let v = 0; v <= W; v += 54) { ctx.beginPath(); ctx.moveTo(v + .5, 0); ctx.lineTo(v + .5, H); ctx.stroke(); }
    for (let v = 0; v <= H; v += 54) { ctx.beginPath(); ctx.moveTo(0, v + .5); ctx.lineTo(W, v + .5); ctx.stroke(); }
    const glow = ctx.createRadialGradient(270, 330, 20, 270, 330, 420);
    glow.addColorStop(0, "rgba(57,255,20,.22)"); glow.addColorStop(1, "rgba(57,255,20,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    // Header
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    ctx.fillStyle = NEON; font(800, 34);
    ctx.fillText(state.lang === "mr" ? t("title") : t("title").toUpperCase(), L, 92);
    ctx.fillStyle = "#bfe3ea"; font(400, 28); ctx.fillText(t("image_of", fmtDate(last.date)), L, 136);

    // Sticker: where the picture was taken from.
    ctx.save();
    ctx.translate(878, 104); ctx.rotate(-0.07);
    fit(t("ig_sticker"), 800, 26, 300);
    const sw = ctx.measureText(t("ig_sticker")).width + 44;
    ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
    ctx.fillStyle = YELLOW; rrect(ctx, -sw / 2, -30, sw, 60, 14); ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = INK; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t("ig_sticker"), 0, 2);
    ctx.restore();

    // The lake, as satellite pixels, cropped to the lake (right column).
    const [[S, Wl], [N, E]] = state.site.image_bounds;
    const my = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const toImg = ([lon, lat], im) => [((lon - Wl) / (E - Wl)) * im.width, ((my(N) - my(lat)) / (my(N) - my(S))) * im.height];
    const rings = [];
    state.lake.features.forEach((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates)
      .forEach((p) => p.forEach((r) => rings.push(r))));
    const pts = rings.flat().map((p) => toImg(p, rgb));
    let [x0, y0, x1, y1] = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])),
      Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    const pad = 0.07 * Math.max(x1 - x0, y1 - y0);
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(rgb.width, x1 + pad); y1 = Math.min(rgb.height, y1 + pad);
    const box = { x: 590, y: 175, w: 430, h: 655 };
    const s = Math.min(box.w / (x1 - x0), box.h / (y1 - y0));
    const mw = (x1 - x0) * s, mh = (y1 - y0) * s, mx = box.x + (box.w - mw) / 2, my0 = box.y + (box.h - mh) / 2;
    ctx.save();
    ctx.shadowColor = "rgba(57,255,20,.45)"; ctx.shadowBlur = 40;
    ctx.fillStyle = "#06161b"; rrect(ctx, mx - 14, my0 - 14, mw + 28, mh + 28, 26); ctx.fill();
    ctx.restore();
    ctx.save();
    rrect(ctx, mx, my0, mw, mh, 16); ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(rgb, x0, y0, x1 - x0, y1 - y0, mx, my0, mw, mh);
    ctx.fillStyle = "rgba(4,22,28,.45)"; ctx.fillRect(mx, my0, mw, mh);       // dim the surroundings
    const k = weed.width / rgb.width;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(weed, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k, mx, my0, mw, mh);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = YELLOW; ctx.lineWidth = 4; ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(255,212,0,.8)"; ctx.shadowBlur = 12;
    rings.forEach((r) => {
      ctx.beginPath();
      r.forEach((p, i) => { const [u, v] = toImg(p, rgb); ctx[i ? "lineTo" : "moveTo"](mx + (u - x0) * s, my0 + (v - y0) * s); });
      ctx.stroke();
    });
    ctx.restore();
    // The number
    ctx.textBaseline = "alphabetic";
    const pct = `${fmt(last.weed_pct, 0)}%`;
    fit(pct, 800, 250, 500);
    ctx.save();
    ctx.shadowColor = "rgba(57,255,20,.75)"; ctx.shadowBlur = 50;
    ctx.fillStyle = NEON; ctx.fillText(pct, L - 8, 410);
    ctx.shadowBlur = 0; ctx.fillText(pct, L - 8, 410);
    ctx.restore();
    ctx.fillStyle = "#ffffff"; font(800, 50);
    let y = wrapText(ctx, t("ig_cover"), L, 482, 490, 60);

    // Level stamp, slapped on the corner of the map
    const [stamp, scol] = stampFor(last.weed_pct);
    ctx.save();
    ctx.translate(615, 205); ctx.rotate(-0.21);
    fit(stamp, 800, 56, 230);
    const stw = ctx.measureText(stamp).width + 40;
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "rgba(4,22,28,.75)"; rrect(ctx, -stw / 2, -40, stw, 80, 12); ctx.fill();
    ctx.strokeStyle = scol; ctx.lineWidth = 6; rrect(ctx, -stw / 2, -40, stw, 80, 12); ctx.stroke();
    ctx.lineWidth = 2; rrect(ctx, -stw / 2 + 8, -32, stw - 16, 64, 8); ctx.stroke();
    ctx.fillStyle = scol; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(stamp, 0, 3);
    ctx.restore();

    // Fun facts, in football pitches
    const area = state.site.lake.area_ha;
    const weedHa = last.weed_pct / 100 * area, water = last.open_water_ha;
    const nWeed = Math.round(weedHa / PITCH_HA), nWater = water / PITCH_HA;
    const facts = [[NEON, t("ig_fields_weed", fmt(nWeed, 0))],
      [WATER, nWater < 1 ? t("ig_fields_water_lt1") : t("ig_fields_water", fmt(Math.round(nWater), 0))]];
    y = Math.max(y + 18, 640);
    ctx.textBaseline = "alphabetic";
    facts.forEach(([col, text]) => {
      font(600, 30);
      const lines = [];
      let cur = "";
      text.split(" ").forEach((w) => { const tt = cur ? `${cur} ${w}` : w; if (ctx.measureText(tt).width > 400 && cur) { lines.push(cur); cur = w; } else cur = tt; });
      lines.push(cur);
      const h = 34 + lines.length * 40;
      ctx.fillStyle = "rgba(255,255,255,.07)"; rrect(ctx, L, y, 500, h, 18); ctx.fill();
      ctx.fillStyle = col; rrect(ctx, L, y, 8, h, 4); ctx.fill();
      ctx.fillStyle = "#ffffff";
      lines.forEach((ln, i) => ctx.fillText(ln, L + 30, y + 50 + i * 40));
      y += h + 16;
    });

    // Weed / water bar
    const by = 895, bw = W - 2 * L;
    const wp = Math.max(0, Math.min(100, last.weed_pct)), op = Math.max(0, Math.min(100 - wp, water / area * 100));
    ctx.save();
    rrect(ctx, L, by, bw, 46, 23); ctx.clip();
    ctx.fillStyle = MUD; ctx.fillRect(L, by, bw, 46);
    ctx.fillStyle = NEON; ctx.fillRect(L, by, bw * wp / 100, 46);
    ctx.fillStyle = WATER; ctx.fillRect(L + bw * (1 - op / 100), by, bw * op / 100 + 1, 46);
    ctx.restore();
    font(800, 28); ctx.textBaseline = "alphabetic";
    ctx.fillStyle = NEON; ctx.textAlign = "left"; ctx.fillText(t("ig_bar_weed", fmt(weedHa, 1)), L, by - 14);
    ctx.fillStyle = "#7cc4f5"; ctx.textAlign = "right"; ctx.fillText(t("ig_bar_water", fmt(water, 2)), W - L, by - 14);
    ctx.textAlign = "left";

    // Month by month since the campaign started
    const ty = 965, th = 255;
    ctx.fillStyle = "rgba(255,255,255,.06)"; rrect(ctx, L, ty, bw, th, 22); ctx.fill();
    ctx.fillStyle = "#ffffff"; font(800, 26); ctx.fillText(t("ig_trend"), L + 26, ty + 42);
    if (base && base.date !== last.date) {
      const d = last.weed_pct - base.weed_pct;
      ctx.fillStyle = d > 0 ? "#ff7a7a" : NEON; font(800, 24); ctx.textAlign = "right";
      ctx.fillText(t("ig_change", `${d >= 0 ? "+" : "−"}${fmt(Math.abs(d), 0)}`, fmtDate(base.date, { month: "short", year: "numeric" })), W - L - 26, ty + 42);
      ctx.textAlign = "left";
    }
    // legend for the empty months
    ctx.save();
    ctx.setLineDash([4, 3]); ctx.strokeStyle = "rgba(191,227,234,.6)"; ctx.lineWidth = 1.5;
    rrect(ctx, L + 26, ty + 62, 34, 26, 5); ctx.stroke();
    ctx.restore();
    cloud(ctx, L + 43, ty + 75, 6, "#bfe3ea");
    ctx.fillStyle = "#bfe3ea"; fit(t("ig_no_image"), 600, 20, bw - 110); ctx.textAlign = "left"; ctx.fillText(t("ig_no_image"), L + 72, ty + 82);
    const mon = monthly(), keys = monthKeys(state.site.campaign_start.slice(0, 7), last.date.slice(0, 7)).slice(-15);
    const cw = (bw - 52) / keys.length, cb = ty + th - 62, ch = 92;
    keys.forEach((key, i) => {
      const m = mon[key], cx = L + 26 + i * cw, isLast = i === keys.length - 1;
      if (m && m.weed != null) {
        ctx.fillStyle = "rgba(255,255,255,.08)"; rrect(ctx, cx + 5, cb - ch, cw - 10, ch, 6); ctx.fill();
        const hh = Math.max(4, ch * m.weed / 100);
        ctx.fillStyle = isLast ? NEON : "rgba(57,255,20,.55)";
        rrect(ctx, cx + 5, cb - hh, cw - 10, hh, 6); ctx.fill();
      } else {
        // No clear picture that month: a dashed empty bar with a cloud, never a low bar.
        ctx.save();
        ctx.setLineDash([6, 5]); ctx.strokeStyle = "rgba(191,227,234,.45)"; ctx.lineWidth = 2;
        rrect(ctx, cx + 6, cb - ch + 1, cw - 12, ch - 2, 6); ctx.stroke();
        ctx.restore();
        if (m) {  // only low-confidence pictures
          ctx.fillStyle = "#bfe3ea"; font(800, 30); ctx.textAlign = "center"; ctx.fillText("?", cx + cw / 2, cb - ch / 2 + 11);
        } else cloud(ctx, cx + cw / 2, cb - ch / 2, 11, "#bfe3ea");
      }
      ctx.fillStyle = isLast ? NEON : "#9fbfba"; font(isLast ? 800 : 600, 18); ctx.textAlign = "center";
      ctx.fillText(t("months_short")[+key.slice(5) - 1], cx + cw / 2, cb + 26);
      if (i === 0 || key.endsWith("-01")) {   // year mark under the first month of each year
        ctx.fillStyle = "#6f9a94"; font(600, 16); ctx.textAlign = "left";
        ctx.fillText(fmt(+key.slice(0, 4), 0), cx + 5, cb + 50);
      }
      ctx.textAlign = "left";
    });

    // Footer: who, where, credits
    ctx.fillStyle = "#ffffff"; font(800, 50); ctx.fillText("@savevadalelake", L, 1282);
    const url = (location.host + location.pathname).replace(/index\.html$/, "").replace(/\/$/, "");
    ctx.fillStyle = "#bfe3ea"; fit(`${t("ig_live")} ${url}`, 600, 24, 560); ctx.fillText(`${t("ig_live")} ${url}`, L, 1318);
    ctx.textAlign = "right"; ctx.fillStyle = YELLOW; fit(t("ig_cta"), 800, 26, 400); ctx.fillText(t("ig_cta"), W - L, 1282);
    ctx.fillStyle = "rgba(255,255,255,.55)"; font(400, 15);
    ctx.fillText(t("ig_note"), W - L, 1306);
    ctx.fillText("Contains modified Copernicus Sentinel data · © OpenStreetMap", W - L, 1326);
    ctx.textAlign = "left";
    return last;
  }

  async function makeCard() {
    if (!good().length) return;
    const btn = $("#ig-btn");
    btn.disabled = true;
    try {
      const c = $("#ig-canvas");
      const last = await drawCard(c);
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
