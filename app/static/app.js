/* ==========================================================================
   Flux Studio — app.js (vanilla JS, sans dépendance)
   ========================================================================== */
"use strict";

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const api = async (p, o) => { const r = await fetch(p, o); if (!r.ok) throw new Error(await r.text()); return r.json(); };
const fmtBytes = (b) => { b = +b || 0; const u = ["o", "Ko", "Mo", "Go", "To"]; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return b.toFixed(i ? 1 : 0) + " " + u[i]; };
const LEVELS = { 1: ["none", "None"], 2: ["soft", "Soft"], 3: ["mature", "Mature"], 4: ["x", "X"] };
const lvlClass = (l) => (LEVELS[l] || LEVELS[1])[0];
const lvlName  = (l) => (LEVELS[l] || LEVELS[1])[1];
const isVideo = (url) => /\.(mp4|webm)(\?|$)/i.test(String(url || ""));
/* Civitai sert l'original pleine résolution (2-3 Mo). On demande une version
   derivee large=w optimisee (30-70 Ko) : vignettes instantanees. */
function derivative(url, w) {
  if (!url) return "";
  if (url.indexOf("original=true") >= 0) return url.replace("original=true", `width=${w},optimized=true`);
  if (/\/width=\d+[^/]*\//.test(url)) return url.replace(/\/width=\d+[^/]*\//, `/width=${w},optimized=true/`);
  return url;
}
const proxy = (u) => "/api/proxy?url=" + encodeURIComponent(u);
const thumb    = (url) => url ? proxy(derivative(url, 450))  : "";
const bigThumb = (url) => url ? proxy(derivative(url, 1100)) : "";
const kv = (k, v) => (v == null || v === "") ? "" : `<div class="item"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), 2200);
}
async function copy(text, label) {
  try { await navigator.clipboard.writeText(text || ""); toast((label || "Copié") + " ✓"); }
  catch { toast("Copie impossible"); }
}

/* ============================ État ============================ */
const state = { view: "prompts", base: "", type: "", tag: "", men: "only", nsfwMax: 4, search: "", offset: 0, limit: 48, safe: true, images: [] };
const comfy = { loaded: false, data: null, searchCursor: null, searchRows: [] };
const prof  = { loaded: false };
const imgS  = { loaded: false, file: null, models: [] };

/* ============================ Navigation ============================ */
function go(view) {
  $$(".nav-item[data-view]").forEach(n => n.classList.toggle("active", n.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("on", v.id === "view-" + view));
  state.view = view;
  if (view === "comfyui") loadComfy();
  if (view === "profil") loadProfil();
  if (view === "image" && !imgS.loaded) loadOllama();
}
$$(".nav-item[data-view]").forEach(n => n.onclick = () => go(n.dataset.view));

/* ============================ Safe mode / NSFW ============================ */
function applySafe() { document.body.classList.toggle("safe", state.safe !== false); }
function setSafe(on) {
  state.safe = !!on;
  $("#safeToggle").checked = state.safe;
  const p = $("#prefSafe"); if (p) p.checked = state.safe;
  try { localStorage.setItem("flux_safe", state.safe ? "1" : "0"); } catch (e) {}
  applySafe();
}
$("#safeToggle").onchange = (e) => setSafe(e.target.checked);

$$("#nsfwSeg button").forEach(b => b.onclick = () => {
  $$("#nsfwSeg button").forEach(x => x.classList.remove("on"));
  b.classList.add("on");
  state.nsfwMax = { "None": 1, "Soft": 2, "Mature": 3, "X": 4 }[b.textContent.trim()] || 4;
  loadImages(true);
});

$$(".chip[data-men]").forEach(c => {
  const act = () => {
    $$(".chip[data-men]").forEach(x => x.classList.remove("on"));
    c.classList.add("on");
    state.men = c.dataset.men;
    loadImages(true);
  };
  c.setAttribute("role","button");
  c.setAttribute("tabindex","0");
  c.onclick = act;
  c.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } };
});

/* ============================ PROMPTS ============================ */
const BASE_COLORS = {
  "Flux.2 Klein 4B": "#7c5cff",
  "Flux.1 D": "#00f0ff",
  "SDXL": "#10b981",
  "Pony": "#f97316",
  "Illustrious": "#e11d48",
  "NoobAI": "#f59e0b",
  "SD 1.5": "#3b82f6",
  "Qwen": "#8b5cf6",
  "Z-Image": "#06b6d4",
  "LTX Video": "#ef4444",
};
const baseColor = (b) => BASE_COLORS[b] || "#7c5cff";

async function loadCategories() {
  const c = await api("/api/categories");
  const bases = (c.base_models || []).filter(Boolean).sort();
  const types = (c.types || []).filter(Boolean).sort();
  $("#fBase").innerHTML = '<option value="">Toutes les bases</option>' + bases.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join("");
  $("#fType").innerHTML = '<option value="">Tous types</option>' + types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  $("#fTag").innerHTML  = '<option value="">Tous tags</option>' + (c.tags || []).slice(0, 200).map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  $("#civBase").innerHTML = '<option value="">Toutes bases</option>' + bases.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join("");
  $("#baseList").innerHTML = bases.map(b => {
    const col = baseColor(b);
    return `<div class="base-chip" role="button" tabindex="0" data-base="${esc(b)}" style="--bc:${col}">
      <span class="dot" style="background:${col};color:${col}"></span>
      ${esc(b)}
      <span class="count">${esc((c.base_counts && c.base_counts[b]) || "")}</span>
    </div>`;
  }).join("");
  $$("#baseList .base-chip").forEach(n => {
    const act = () => {
      go("prompts");
      state.base = (n.dataset.base === state.base) ? "" : n.dataset.base;
      $("#fBase").value = state.base;
      $$("#baseList .base-chip").forEach(x => x.classList.toggle("on", x.dataset.base === state.base));
      loadImages(true);
    };
    n.onclick = act;
    n.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } };
  });
  // Tags populaires
  const tags = (c.tags || []).slice(0, 14);
  $("#tagCloud").innerHTML = tags.map(t => `<span class="chip" data-tag="${esc(t)}">${esc(t)}</span>`).join("");
  $$("#tagCloud .chip").forEach(n => {
    n.setAttribute("role","button");
    n.setAttribute("tabindex","0");
    const act = () => {
      go("prompts");
      state.tag = (n.dataset.tag === state.tag) ? "" : n.dataset.tag;
      $("#fTag").value = state.tag;
      loadImages(true);
    };
    n.onclick = act;
    n.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } };
  });
}

async function loadStats() {
  const s = await api("/api/stats");
  $("#sImages").textContent = (s.images || 0).toLocaleString("fr-FR");
  $("#sNsfw").textContent = (s.nsfw_images || 0).toLocaleString("fr-FR");
  $("#statBadge").textContent = `${s.models} modèles · ${s.versions} versions · ${s.images} images`;
  $("#cPrompts").textContent = s.images || "";
}

$("#fBase").onchange = (e) => { state.base = e.target.value; loadImages(true); };
$("#fType").onchange = (e) => { state.type = e.target.value; loadImages(true); };
$("#fTag").onchange  = (e) => { state.tag  = e.target.value; loadImages(true); };
let searchTimer;
$("#globalSearch").oninput = (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.search = e.target.value.trim(); loadImages(true); }, 350);
};

let imgAbort = null;
async function loadImages(reset) {
  if (imgAbort) imgAbort.abort();
  const ctl = new AbortController();
  imgAbort = ctl;

  if (reset) { state.offset = 0; state.images = []; $("#promptMore").innerHTML = ""; }
  const first = reset || !state.images.length;
  if (first) $("#promptGrid").innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="spinner" style="margin:0 auto"></div></div>`;
  else $("#promptMore").innerHTML = `<span class="faint">Chargement…</span>`;

  const offset = state.offset;
  const q = new URLSearchParams({ limit: state.limit, offset });
  if (state.base) q.set("base_model", state.base);
  if (state.type) q.set("type", state.type);
  if (state.tag)  q.set("tag", state.tag);
  if (state.search) q.set("search", state.search);
  if (state.men) q.set("men", state.men);
  q.set("nsfw_max", state.nsfwMax);

  let rows = [];
  try { rows = await api("/api/images?" + q.toString(), { signal: ctl.signal }); }
  catch (e) { if (e && e.name === "AbortError") return; console.warn(e); }
  if (ctl !== imgAbort) return;  // une requête plus recente a pris le relais

  rows = rows || [];
  state.images = reset ? rows : state.images.concat(rows);
  state.offset = offset + state.limit;
  renderPrompts(rows.length >= state.limit);
}

function renderPrompts(hasMore) {
  const g = $("#promptGrid");
  if (!state.images.length) {
    g.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">✦</div><b>Aucun prompt</b><div class="mt">Élargis les filtres ou lance le scraper.</div></div>`;
    $("#promptMore").innerHTML = "";
    return;
  }
  g.innerHTML = state.images.map(cardHTML).join("");
  $$("#promptGrid .card").forEach(c => c.onclick = () => openDrawer(c.dataset.id));
  $$("#promptGrid [data-copy]").forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const im = state.images.find(x => String(x.civitai_image_id) === b.dataset.copy);
    if (im) copy(im.positive_prompt, "Prompt copié");
  });
  $("#promptMore").innerHTML =
    (hasMore ? `<button class="btn ghost" id="moreBtn">Charger plus</button>` : "") +
    `<span class="faint" style="margin-left:14px">${state.images.length} affichées</span>`;
  const mb = $("#moreBtn"); if (mb) mb.onclick = () => loadImages(false);
}

function cardHTML(im) {
  const lvl = im.nsfw_level || (im.nsfw ? 3 : 1);
  const video = isVideo(im.url);
  const url = video ? "" : thumb(im.url);
  const fallback = "this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'▣'}))";
  const pic = video
    ? `<div class="ph" style="font-size:26px">▶</div>`
    : (url ? `<img loading="lazy" src="${esc(url)}" onerror="${fallback}">` : `<div class="ph">▣</div>`);
  return `
  <article class="card" role="button" tabindex="0" data-id="${esc(im.civitai_image_id)}">
    <div class="thumb ${lvl > 1 ? "nsfw" : ""}">
      ${pic}
      <div class="badges">
        <span class="badge ${lvlClass(lvl)}">${lvlName(lvl)}</span>
        ${im.base_model ? `<span class="badge">${esc(im.base_model)}</span>` : ""}
      </div>
    </div>
    <div class="body">
      <div class="title">${esc(im.model_name || "—")}</div>
      <div class="prompt">${esc((im.positive_prompt || "").slice(0, 180)) || "<i>pas de prompt</i>"}</div>
      <div class="meta"><span>${im.width || "?"}×${im.height || "?"}</span><span>·</span><span>${esc(im.sampler || "")}</span></div>
      <div class="actions">
        <button class="btn sm ghost" data-copy="${esc(im.civitai_image_id)}">Copier</button>
        <button class="btn sm">Détails</button>
      </div>
    </div>
  </article>`;
}

async function openDrawer(id) {
  $("#drawer").classList.add("on");
  $("#scrim").classList.add("on");
  $("#drawer .db").innerHTML = `<div class="empty"><div class="spinner" style="margin:0 auto"></div></div>`;
  let im;
  try { im = await api("/api/image?id=" + encodeURIComponent(id)); }
  catch (e) { $("#drawer .db").innerHTML = `<div class="empty">Erreur de chargement</div>`; return; }
  if (im.error) { $("#drawer .db").innerHTML = `<div class="empty">Introuvable</div>`; return; }

  const lvl = im.nsfw_level || (im.nsfw ? 3 : 1);
  $("#drawer .db").innerHTML = `
    <div class="col-media">${isVideo(im.url)
      ? `<video src="${esc(bigThumb(im.url))}" controls preload="metadata" playsinline style="width:100%;border-radius:var(--r-lg);border:1px solid var(--line)"></video>`
      : `<img src="${esc(bigThumb(im.url))}" loading="lazy" style="width:100%;border-radius:var(--r-lg);border:1px solid var(--line)" onerror="this.style.display='none'">`}
      <div class="row wrap" style="margin-top:12px">
        <span class="badge ${lvlClass(lvl)}">${lvlName(lvl)}</span>
        <span class="badge">${esc(im.base_model || "?")}</span>
        ${im.model_type ? `<span class="badge">${esc(im.model_type)}</span>` : ""}
        <span class="faint">${esc(im.username || "")}</span>
      </div>
    </div>
    <div>
      <div class="field">
        <label>Prompt positif <button class="btn sm ghost" data-cp="pos" style="margin-left:8px">Copier</button></label>
        <div class="codebox mono">${esc(im.positive_prompt || "—")}</div>
      </div>
      <div class="field">
        <label>Prompt négatif <button class="btn sm ghost" data-cp="neg" style="margin-left:8px">Copier</button></label>
        <div class="codebox mono">${esc(im.negative_prompt || "—")}</div>
      </div>
      <div class="field">
        <label>Paramètres</label>
        <div class="kv">
          ${kv("Sampler", im.sampler)}${kv("Steps", im.steps)}${kv("CFG", im.cfg_scale)}
          ${kv("Seed", im.seed)}${kv("Scheduler", im.scheduler)}${kv("Ratio", im.aspect_ratio)}
          ${kv("Résolution", (im.width && im.height) ? im.width + "×" + im.height : "")}
        </div>
      </div>
      ${(im.resources && im.resources.length) ? `
      <div class="field">
        <label>Ressources (LoRA / checkpoint)</label>
        ${im.resources.map(r => `<div class="list-item"><div class="g"><b>${esc(r.name || r.hash || "?")}</b><small>${esc(r.type || "")}${r.weight != null ? " · poids " + r.weight : ""}</small></div></div>`).join("")}
      </div>` : ""}
      <div class="row wrap mt">
        <button class="btn primary" data-all>Copier prompt + paramètres</button>
        ${im.workflow ? `<button class="btn ghost" data-wf>Enregistrer le workflow dans ComfyUI</button>` : ""}
      </div>
    </div>`;

  $$("[data-cp]", $("#drawer")).forEach(b => b.onclick = () => copy(b.dataset.cp === "pos" ? im.positive_prompt : im.negative_prompt, "Copié"));
  const all = $("[data-all]", $("#drawer")); if (all) all.onclick = () => copy(fullPrompt(im), "Prompt complet copié");
  const wf = $("[data-wf]", $("#drawer")); if (wf) wf.onclick = () => saveWorkflow(im);
}
function closeDrawer() { $("#drawer").classList.remove("on"); $("#scrim").classList.remove("on"); }
$("#scrim").onclick = closeDrawer;

function fullPrompt(im) {
  const out = [im.positive_prompt || ""];
  if (im.negative_prompt) out.push("\nNegative prompt: " + im.negative_prompt);
  const s = [];
  if (im.steps) s.push("Steps: " + im.steps);
  if (im.sampler) s.push("Sampler: " + im.sampler);
  if (im.cfg_scale) s.push("CFG scale: " + im.cfg_scale);
  if (im.seed) s.push("Seed: " + im.seed);
  if (im.scheduler) s.push("Scheduler: " + im.scheduler);
  if (im.width && im.height) s.push("Size: " + im.width + "x" + im.height);
  if (s.length) out.push("\n" + s.join(", "));
  return out.join("");
}
async function saveWorkflow(im) {
  try {
    await api("/api/comfyui/save_workflow", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: (im.model_name || "workflow") + " - " + im.civitai_image_id, workflow: im.workflow })
    });
    toast("Workflow enregistré dans ComfyUI ✓");
  } catch (e) { toast("Échec de l'enregistrement"); }
}

/* ============================ COMFYUI ============================ */
$$("#comfyTabs button").forEach(b => b.onclick = () => {
  $$("#comfyTabs button").forEach(x => x.classList.remove("on"));
  b.classList.add("on");
  ["installed", "search", "downloads", "workflows"].forEach(t => $("#tab-" + t).classList.toggle("hidden", t !== b.dataset.tab));
  if (b.dataset.tab === "downloads") loadDownloads();
});

let comfyRootCache = null;
async function comfyRoot() {
  if (comfyRootCache) return comfyRootCache;
  try { const p = await api("/api/comfyui/profile"); comfyRootCache = p.comfyui_root || ""; } catch (e) {}
  return comfyRootCache;
}

async function loadComfy(force) {
  try { comfy.data = await api("/api/comfyui/local" + (force ? "?force=1" : "")); }
  catch (e) { console.warn(e); if (!comfy.data) comfy.data = {}; }
  comfy.loaded = true;
  renderLocalTypes();
  renderComfyStats();
  renderLocal();
  renderWorkflows();
  loadDownloads();
  comfyRoot().then(r => { if (r) $("#comfyPath").textContent = "Synchronisé avec " + r; });
}

function renderComfyStats() {
  const d = comfy.data || {};
  const n = (t) => (d[t] || []).length;
  const total = Object.values(d).flat().reduce((s, x) => s + (x.size_bytes || 0), 0);
  const items = [["Checkpoints", n("checkpoints")], ["LoRA", n("loras")], ["VAE", n("vae")], ["Workflows", n("workflows")], ["Total", fmtBytes(total)]];
  $("#comfyStats").innerHTML = items.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  $("#cComfy").textContent = n("checkpoints") + n("loras");
}

function renderLocalTypes() {
  const types = Object.keys(comfy.data || {}).filter(t => t !== "workflows");
  $("#localType").innerHTML = '<option value="">Tous types</option>' + types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
}

function renderLocal() {
  const d = comfy.data || {};
  const ty = $("#localType").value;
  const q = $("#localSearch").value.trim().toLowerCase();
  let rows = [];
  Object.entries(d).forEach(([type, items]) => {
    if (type === "workflows") return;
    if (ty && type !== ty) return;
    (items || []).forEach(it => {
      if (q && !((it.filename || "") + " " + (it.base_model || "")).toLowerCase().includes(q)) return;
      rows.push(it);
    });
  });
  if (!rows.length) { $("#localBody").innerHTML = `<tr><td colspan="5" class="faint" style="text-align:center;padding:30px">Aucun fichier</td></tr>`; return; }
  rows.sort((a, b) => (b.size_bytes || 0) - (a.size_bytes || 0));
  $("#localBody").innerHTML = rows.slice(0, 400).map(it => `
    <tr>
      <td class="nm">${esc(it.filename)}</td>
      <td><span class="badge">${esc(it.model_type)}</span></td>
      <td>${esc(it.base_model || "—")}</td>
      <td class="mono">${fmtBytes(it.size_bytes)}</td>
      <td class="mono">${esc(it.rel_path)}</td>
    </tr>`).join("");
}
$("#localSearch").oninput = renderLocal;
$("#localType").onchange = renderLocal;

/* --- Recherche Civitai + téléchargement --- */
async function civitaiSearch(append = false) {
  const box = $("#civResults");
  if (!append) {
    box.innerHTML = `<div class="empty"><div class="spinner" style="margin:0 auto"></div>Recherche Civitai…</div>`;
    comfy.searchRows = [];
  }
  const q = new URLSearchParams({ q: $("#civSearch").value.trim(), limit: "30", nsfw_max: state.nsfwMax });
  if ($("#civType").value) q.set("type", $("#civType").value);
  if ($("#civBase").value) { q.set("base", $("#civBase").value); }
  if ($("#civWomen").checked) q.set("men", "0");
  if (append && comfy.searchCursor) q.set("cursor", comfy.searchCursor);
  let res = { items: [], nextCursor: null };
  try { res = await api("/api/comfyui/search?" + q.toString()); }
  catch (e) { if (!append) $("#civResults").innerHTML = `<div class="empty">Erreur Civitai</div>`; return; }
  const rows = res.items || [];
  if (!append && !rows.length) { $("#civResults").innerHTML = `<div class="empty">Aucun résultat</div>`; return; }
  comfy.searchCursor = res.nextCursor || null;
  comfy.searchRows = comfy.searchRows.concat(rows);
  renderCivitaiResults();
  if (comfy.searchCursor) {
    const moreBtn = `<div class="center mt"><button class="btn ghost" id="civMoreBtn">Plus de résultats</button></div>`;
    box.insertAdjacentHTML("beforeend", moreBtn);
    $("#civMoreBtn").onclick = () => civitaiSearch(true);
  }
}
function renderCivitaiResults() {
  const box = $("#civResults");
  const rows = comfy.searchRows;
  box.innerHTML = rows.map((m, i) => `
    <div class="list-item" role="button" tabindex="0">
      ${(m.thumbnail && !isVideo(m.thumbnail))
        ? `<img class="tb" loading="lazy" src="${esc(thumb(m.thumbnail))}" onerror="this.style.visibility='hidden'">`
        : `<div class="tb" style="display:grid;place-items:center;font-size:20px">${m.thumbnail ? "▶" : "▣"}</div>`}
      <div class="g">
        <b>${esc(m.name)}</b>
        <small>${esc(m.type)} · ${esc((m.baseModels || []).join(", "))} · ${(m.downloads || 0).toLocaleString("fr-FR")} dl</small>
        <div class="row wrap" style="margin-top:6px">
          ${(m.versions || []).slice(0, 3).map((v, vi) => (v.files || []).slice(0, 1).map(f => `
            <button class="btn sm" data-dl="${i}|${vi}|${f.id}">↓ ${esc(f.name)} (${fmtBytes((f.sizeKB || 0) * 1024)}) → ${esc(m.folder)}</button>
          `).join("")).join("")}
        </div>
      </div>
    </div>`).join("");
  $$("#civResults [data-dl]").forEach(b => b.onclick = async () => {
    const [i, vi, fid] = b.dataset.dl.split("|");
    const m = rows[+i], v = m.versions[+vi];
    b.disabled = true; b.textContent = "Téléchargement…";
    try {
      await api("/api/comfyui/download", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: m.id, version_id: v.id, file_id: +fid }) });
      toast("Téléchargement lancé");
    } catch (e) { toast("Échec"); b.disabled = false; }
  });
}
$("#civGo").onclick = civitaiSearch;
$("#civSearch").onkeydown = (e) => { if (e.key === "Enter") civitaiSearch(); };

let dlTimer = null;
const DL_STATUS = {
  pending:     ["En attente", "soft"],
  queued:      ["En attente", "soft"],
  downloading: ["Téléchargement…", "soft"],
  completed:   ["Terminé", "none"],
  done:        ["Terminé", "none"],
  error:       ["Erreur", "x"],
};

async function loadDownloads() {
  let list = [];
  try { list = await api("/api/comfyui/downloads"); } catch (e) {}
  const el = $("#dlList");
  if (!list.length) { el.innerHTML = `<div class="empty"><div class="big">↓</div>Aucun téléchargement en cours</div>`; return; }
  el.innerHTML = list.map(d => {
    const pct = d.total_bytes ? Math.round(100 * d.downloaded_bytes / d.total_bytes) : 0;
    const [label, cls] = DL_STATUS[d.status] || [d.status || "?", "soft"];
    return `<div class="list-item" role="button" tabindex="0" style="align-items:flex-start;flex-direction:column;gap:8px">
      <div class="row" style="width:100%"><b class="grow">${esc(d.name || d.filename || d.id)}</b>
        <span class="badge ${cls}">${esc(label)}</span></div>
      <div style="width:100%"><div class="progress"><i style="width:${pct}%"></i></div></div>
      <div class="faint" style="font-size:11px">${fmtBytes(d.downloaded_bytes)} / ${fmtBytes(d.total_bytes)} · ${esc(d.dest_folder || "")} ${d.error ? "· " + esc(d.error) : ""}</div>
    </div>`;
  }).join("");
  clearTimeout(dlTimer);
  if (list.some(d => !["completed", "done", "error"].includes(d.status))) dlTimer = setTimeout(loadDownloads, 1500);
}

function renderWorkflows() {
  const wfs = (comfy.data && comfy.data.workflows) || [];
  if (!wfs.length) { $("#wfList").innerHTML = `<div class="empty"><div class="big">❖</div>Aucun workflow local</div>`; return; }
  $("#wfList").innerHTML = wfs.map(w => `
    <div class="list-item">
      <div class="g"><b>${esc(w.filename)}</b><small>${esc(w.rel_path)} · ${fmtBytes(w.size_bytes)}</small></div>
    </div>`).join("");
}

$("#rescan").onclick = async () => {
  $("#syncBadge").textContent = "● Scan…";
  await loadComfy(true);
  $("#syncBadge").textContent = "● Synchronisé";
  toast("ComfyUI synchronisé ✓");
};

/* ============================ IMAGE -> PROMPT ============================ */
async function loadOllama() {
  imgS.loaded = true;
  const sel = $("#visionModel");
  try {
    const o = await api("/api/comfyui/ollama");
    const g = o.gemini || {};
    const ol = o.ollama || {};
    if (g.available) {
      sel.innerHTML = `<option value="gemini">${esc(g.model || "Gemini")} ✓</option>` +
        (ol.available && ol.models ? ol.models.map(m => `<option>${esc(m)}</option>`).join("") : "");
    } else if (ol.available && ol.models && ol.models.length) {
      sel.innerHTML = ol.models.map(m => `<option>${esc(m)}</option>`).join("");
    } else { sel.innerHTML = `<option value="">Aucun modèle vision détecté</option>`; }
  } catch (e) { sel.innerHTML = `<option value="">Détection impossible</option>`; }
}

const drop = $("#drop"), fileInput = $("#file");
drop.onclick = () => fileInput.click();
drop.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } };
fileInput.onchange = () => { if (fileInput.files[0]) setImage(fileInput.files[0]); };
["dragover", "dragenter"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) setImage(f); });

function setImage(file) {
  imgS.file = file;
  const url = URL.createObjectURL(file);
  $("#imgPreview").innerHTML = `<img src="${url}" style="width:100%;border-radius:var(--r-lg);border:1px solid var(--line)">`;
  $("#analyze").disabled = false;
}

$("#analyze").onclick = async () => {
  if (!imgS.file) { toast("Dépose une image d'abord"); return; }
  const btn = $("#analyze"); btn.disabled = true; btn.textContent = "Analyse…";
  $("#descOut").innerHTML = `<div class="spinner"></div>`;
  const fd = new FormData(); fd.append("file", imgS.file);
  try {
    const info = await api("/api/comfyui/describe", { method: "POST", headers: { "X-AI-Describe": "1" }, body: fd });
    renderDescribe(info);
  } catch (e) { $("#descOut").innerHTML = `<span class="badge x">Erreur d'analyse</span>`; }
  btn.disabled = false; btn.textContent = "Analyser l'image";
};

function renderDescribe(info) {
  const ai = info.ai;
  const aiText = typeof ai === "string"
    ? ai.trim()
    : (ai && ai.available && ai.description ? String(ai.description).trim() : "");
  let html = "";
  if (aiText) {
    html += `<div class="codebox" style="margin-bottom:12px">${esc(aiText)}</div>
    <button class="btn primary sm" id="aiToPrompt">Copier en prompt</button><div class="hr"></div>`;
  }

  const meta = { ...info };
  delete meta.ai;
  const isScalar = (v) => v != null && v !== "" && typeof v !== "object";
  const rows = Object.entries(meta).filter(([, v]) => isScalar(v)).map(([k, v]) => kv(k, v)).join("");
  const hasMeta = Object.keys(meta).length > 0;

  if (!aiText && !hasMeta) {
    html = `<div class="empty"><div class="big">▣</div><b>Aucune métadonnée trouvée</b><div class="mt">Cette image ne contient pas de prompt ComfyUI/A1111.</div></div>`;
  } else {
    if (rows) html += `<div class="kv">${rows}</div>`;
    if (meta.prompt || meta.parameters) {
      html += `<div class="field mt"><label>Prompt détecté dans les métadonnées</label><div class="codebox mono">${esc(meta.prompt || meta.parameters)}</div></div>`;
    }
    if (!aiText) {
      html += `<div class="faint mt" style="font-size:12px">Description IA indisponible — lance Ollama avec un modèle vision (llava, moondream…) pour l'activer.</div>`;
    }
  }
  $("#descOut").innerHTML = html;
  const b = $("#aiToPrompt");
  if (b) b.onclick = () => copy(aiText, "Description copiée");
}

/* ============================ PROFIL ============================ */
async function loadProfil() {
  prof.loaded = true;
  let p = {};
  try { p = await api("/api/comfyui/profile"); } catch (e) {}
  const counts = p.counts || {};
  $("#profStats").innerHTML = [
    ["Checkpoints", counts.checkpoints || 0],
    ["LoRA", counts.loras || 0],
    ["Taille totale", fmtBytes(p.total_bytes)],
    ["Workflows", counts.workflows || 0],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");

  const bars = p.lora_by_base || {};
  const max = Math.max(1, ...Object.values(bars));
  $("#baseBars").innerHTML = Object.entries(bars).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `
    <div style="margin-bottom:10px">
      <div class="row" style="font-size:12px;margin-bottom:4px"><span class="grow">${esc(k)}</span><b>${v}</b></div>
      <div class="progress"><i style="width:${Math.round(100 * v / max)}%"></i></div>
    </div>`).join("") || `<div class="faint">Aucune donnée</div>`;

  const g = p.gpu || {};
  if (g.name) {
    const vram = g.vram_gb || (g.vram_mb ? Math.round(g.vram_mb / 1024) : null);
    $("#profStats").insertAdjacentHTML("afterbegin",
      `<div class="stat"><div class="k">GPU</div><div class="v" style="font-size:15px">${esc(g.name)}<br><small>${vram ? vram + " Go VRAM" : ""}</small></div></div>`);
  }

  $("#prefSafe").checked = state.safe !== false;
  $("#prefSafe").onchange = (e) => setSafe(e.target.checked);
  const root = p.comfyui_root || "";
  comfyRootCache = root || comfyRootCache;
  if (root) $("#comfyPath").textContent = "Synchronisé avec " + root;
  const pp = $("#prefPath"); if (pp) pp.textContent = p.workflows_dir || root || "—";
}
$("#prefSafe") && ($("#prefSafe").onchange = (e) => setSafe(e.target.checked));

/* ============================ Panneau droit (historique) ============================ */
let histItems = [];
function addToHistory(im) {
  histItems = histItems.filter(h => h.civitai_image_id !== im.civitai_image_id);
  histItems.unshift(im);
  histItems = histItems.slice(0, 12);
  renderHistory();
}
function renderHistory() {
  const el = $("#histList");
  if (!el) return;
  if (!histItems.length) { el.innerHTML = `<div class="faint" style="font-size:11.5px">Ouvrez un prompt pour remplir l'historique.</div>`; return; }
  el.innerHTML = histItems.map(h => {
    const u = thumb(h.url);
    return `<div class="hist-item" role="button" tabindex="0" data-id="${esc(h.civitai_image_id)}">
      ${u ? `<img class="tb" loading="lazy" src="${esc(u)}" onerror="this.style.visibility='hidden'">` : `<div class="tb" style="display:grid;place-items:center;font-size:16px">▶</div>`}
      <div class="g"><b>${esc(h.model_name || "—")}</b><small>${esc(h.base_model || "")}</small></div>
    </div>`;
  }).join("");
  $$("#histList .hist-item").forEach(n => { n.onclick = () => openDrawer(n.dataset.id); n.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrawer(n.dataset.id); } }; });
}
function renderRecent() {
  const el = $("#recentList");
  if (!el) return;
  const rows = state.images.slice(0, 8);
  el.innerHTML = rows.map(h => {
    const u = thumb(h.url);
    return `<div class="hist-item" role="button" tabindex="0" data-id="${esc(h.civitai_image_id)}">
      ${u ? `<img class="tb" loading="lazy" src="${esc(u)}" onerror="this.style.visibility='hidden'">` : `<div class="tb" style="display:grid;place-items:center;font-size:16px">▶</div>`}
      <div class="g"><b>${esc(h.model_name || "—")}</b><small>${esc(h.base_model || "")}</small></div>
    </div>`;
  }).join("");
  $$("#recentList .hist-item").forEach(n => { n.onclick = () => openDrawer(n.dataset.id); n.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrawer(n.dataset.id); } }; });
}

/* ============================ Mini-générateur ============================ */
const genModal = $("#genModal");
$("#genBtn").onclick = () => genModal.classList.add("on");
$("#genCancel").onclick = () => genModal.classList.remove("on");
genModal.onclick = (e) => { if (e.target === genModal) genModal.classList.remove("on"); };
$("#genSteps").oninput = (e) => $("#genStepsV").textContent = e.target.value;
$("#genCfg").oninput = (e) => $("#genCfgV").textContent = (+e.target.value).toFixed(1);
$("#genRun").onclick = async () => {
  const prompt = $("#genPrompt").value.trim();
  if (!prompt) { toast("Écris un prompt d'abord"); return; }
  const btn = $("#genRun"); btn.disabled = true; btn.textContent = "Envoi…";
  try {
    await api("/api/comfyui/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        steps: +$("#genSteps").value,
        cfg: +$("#genCfg").value,
        model: $("#genModel").value,
        width: 768, height: 1152,
      }),
    });
    genModal.classList.remove("on");
    toast("Envoyé à ComfyUI ✓");
    $("#genPrompt").value = "";
  } catch (e) {
    toast("Échec — ComfyUI est-il lancé ?");
  }
  btn.disabled = false; btn.textContent = "Lancer → ComfyUI";
};

/* ============================ Init ============================ */
(async function init() {
  let saved = null;
  try { saved = localStorage.getItem("flux_safe"); } catch (e) {}
  setSafe(saved === null ? true : saved === "1");
  await Promise.allSettled([loadStats(), loadCategories()]);
  await loadImages(true);
  renderHistory();
  renderRecent();
})();
