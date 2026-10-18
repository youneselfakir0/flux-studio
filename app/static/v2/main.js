/**
 * Flux Studio v2 — Main Entry Point
 * Boots all modules, wires views, handles navigation
 */

import { api, ComfyWS } from '../core/api.js';
import { bus, Events } from '../core/events.js';
import { Signal, effect } from '../core/state.js';
import { initStorage } from '../core/storage.js';
import { graph, graphToComfyUI } from '../editor/graph.js';
import { initCatalog } from '../nodes/catalog.js';
import { createQuickStart } from '../workflows/quickstart.js';
import { initLoraPalette, openLoraPalette } from '../loras/palette-ui.js';
import { suggestLoras, applyLora as applyLoraToGraph } from '../loras/palette.js';
import { LoraIndex } from '../loras/palette.js';
import { createCanvas } from '../editor/canvas.js';
import { createPalette } from '../editor/palette.js';
import { createInspector } from '../editor/inspector.js';
import { createGallery } from '../gallery/grid.js';
import { createModelBrowser } from '../models/browser.js';
import { createCanvas2D } from '../canvas/editor.js';
import { createWorkflowLibrary } from '../workflows/library.js';
import { Templates, getTemplate, getAllTemplates } from '../workflows/templates.js';
import { applyCatalogWorkflow, primeCacheNode } from '../workflows/builder.js';
import { WorkflowCatalog } from '../workflows/catalog.js';

// ===================== UTILS =====================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtBytes = (b) => { b = +b || 0; const u = ["o", "Ko", "Mo", "Go", "To"]; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return b.toFixed(i ? 1 : 0) + " " + u[i]; };
const LEVELS = { 1: ["none", "None"], 2: ["soft", "Soft"], 3: ["mature", "Mature"], 4: ["x", "X"] };
const lvlClass = (l) => (LEVELS[l] || LEVELS[1])[0];
const lvlName = (l) => (LEVELS[l] || LEVELS[1])[1];
const isVideo = (url) => /\.(mp4|webm)(\?|$)/i.test(String(url || ""));
function derivative(url, w) {
  if (!url) return "";
  if (url.indexOf("original=true") >= 0) return url.replace("original=true", `width=${w},optimized=true`);
  if (/\/width=\d+[^/]*\//.test(url)) return url.replace(/\/width=\d+[^/]*\//, `/width=${w},optimized=true/`);
  return url;
}
const proxy = (u) => "/api/proxy?url=" + encodeURIComponent(u);
const thumb = (url) => url ? proxy(derivative(url, 450)) : "";
const bigThumb = (url) => url ? proxy(derivative(url, 1100)) : "";
const kv = (k, v) => (v == null || v === "") ? "" : `<div class="item"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;

// Global toast
window.showToast = (msg, type = 'info') => {
  const t = $("#toast"); if (!t) return;
  t.textContent = msg; t.classList.add("on");
  clearTimeout(window._toastT); window._toastT = setTimeout(() => t.classList.remove("on"), 2200);
};
function toast(msg, type) { window.showToast(msg, type); }

// ===================== STATE =====================
const state = {
  view: 'workflow', base: '', type: '', tag: '', men: 'only',
  nsfwMax: 4, search: '', offset: 0, limit: 48, safe: true, images: []
};

// ===================== MODULES =====================
let canvas = null, palette = null, inspector = null, gallery = null, modelBrowser = null, canvas2d = null, wfLibrary = null, quickstart = null;
let imgAbort = null;

/* ===================== Palette de mots-clés (Ctrl+K) ===================== */
function mountLoraPalette() {
  const box = $("#canvasWrapper");
  if (!box || document.querySelector(".lora-chip-btn")) return;
  const btn = document.createElement("button");
  btn.className = "lora-chip-btn";
  btn.title = "Palette de mots-clés — poser un LoRA sans chercher le fichier";
  btn.innerHTML = `✦ Mots-clés <kbd>Ctrl K</kbd>`;
  btn.onclick = () => openLoraPalette();
  box.appendChild(btn);
}

function mountLoraInventory() {
  const panel = $("#loraInvPanel");
  if (!panel || panel.dataset.mounted) return;
  panel.dataset.mounted = "1";
  panel.className = "lora-inv";
  panel.innerHTML = `
    <div class="lora-inv-head">
      <h3>Inventaire LoRA</h3>
      <div class="lora-stats" id="loraStats"><div class="spinner" style="margin:0 auto"></div></div>
    </div>
    <div class="lora-bars" id="loraBars"></div>
    <div style="padding:0 12px 12px">
      <button class="btn primary" style="width:100%" id="loraOpen">✦ Ouvrir la palette</button>
    </div>`;
  panel.querySelector("#loraOpen").onclick = () => openLoraPalette();

  LoraIndex.load().then(() => {
    const s = LoraIndex.stats || {};
    const byBase = s.by_base || {};
    panel.querySelector("#loraStats").innerHTML = `
      <div class="lora-stat"><b>${LoraIndex.items.length}</b><span>LoRA</span></div>
      <div class="lora-stat"><b>${s.with_trigger || 0}</b><span>avec trigger</span></div>`;
    const entries = Object.entries(byBase).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const max = Math.max(1, ...entries.map(e => e[1]));
    panel.querySelector("#loraBars").innerHTML = entries.map(([b, n]) => `
      <div class="lora-bar">
        <div class="lora-bar-row"><span>${esc(b || 'Inconnu')}</span><span>${n}</span></div>
        <div class="lora-bar-track"><div class="lora-bar-fill" style="width:${Math.round(100 * n / max)}%"></div></div>
      </div>`).join('');
  });
}

/* ===================== Onglets du panneau gauche ===================== */
$$(".ptab").forEach(b => b.onclick = () => {
  $$(".ptab").forEach(x => x.classList.toggle("active", x === b));
  const tab = b.dataset.ptab;
  $("#quickPanel").classList.toggle("active", tab === "quick");
  $("#palettePanel").classList.toggle("active", tab === "nodes");
  $("#loraInvPanel").classList.toggle("active", tab === "lora");
});

// ===================== NAVIGATION =====================
function go(view) {
  $$(".topnav-tab").forEach(t => t.classList.toggle("active", t.dataset.view === view));
  $$(".view").forEach(v => v.classList.remove("active"));
  const el = $("#view-" + view);
  if (el) el.classList.add("active");

  // Sync "Mode avance" toggle with workflow view
  const advBtn = $("#advancedModeToggle");
  if (advBtn) {
    const isAdv = view === "workflow";
    advBtn.classList.toggle("on", isAdv);
    advBtn.textContent = isAdv ? "Mode avance ON" : "Mode avance";
  }
  const tb = $("#wfToolbar");
  if (tb) tb.style.display = (view === "workflow") ? "" : "none";

  if (view === "gallery" && !gallery) gallery = createGallery($("#galleryRoot"));
  if (view === "models" && !modelBrowser) modelBrowser = createModelBrowser($("#modelsRoot"));
  if (view === "canvas2d" && !canvas2d) canvas2d = createCanvas2D($("#canvas2dRoot"));
  if (view === "workflow") setTimeout(() => canvas?.resize(), 50);
  if (view === "app") populateAppLoras();
}
$$(".topnav-tab").forEach(t => t.onclick = () => go(t.dataset.view));

// ===================== SAFE MODE / NSFW =====================
function applySafe() { document.body.classList.toggle("safe", state.safe !== false); }
function setSafe(on) {
  state.safe = !!on;
  const s = $("#safeToggle"); if (s) s.checked = state.safe;
  const p = $("#prefSafe"); if (p) p.checked = state.safe;
  try { localStorage.setItem("flux_safe", state.safe ? "1" : "0"); } catch {}
  applySafe();
}
$("#safeToggle").onchange = (e) => setSafe(e.target.checked);

$$("#nsfwSeg button").forEach(b => b.onclick = () => {
  $$("#nsfwSeg button").forEach(x => x.classList.remove("on"));
  b.classList.add("on");
  state.nsfwMax = { "None": 1, "Soft": 2, "Mature": 3, "X": 4 }[b.textContent.trim()] || 4;
  loadImages(true);
});

$$(".chip[data-men]").forEach(c => c.onclick = () => {
  $$(".chip[data-men]").forEach(x => x.classList.remove("on"));
  c.classList.add("on");
  state.men = c.dataset.men;
  loadImages(true);
});

// ===================== STATS / CATEGORIES =====================
async function loadStats() {
  try {
    const s = await api.stats();
    $("#statBadge").textContent = `${s.models} modèles · ${s.versions} versions · ${s.images} images`;
  } catch {}
}

const BASE_COLORS = { "Flux.2 Klein 4B": "#7c5cff", "Flux.1 D": "#00f0ff", "SDXL": "#10b981", "Pony": "#f97316", "Illustrious": "#e11d48", "NoobAI": "#f59e0b", "SD 1.5": "#3b82f6", "Qwen": "#8b5cf6", "Z-Image": "#06b6d4", "LTX Video": "#ef4444" };
const baseColor = (b) => BASE_COLORS[b] || "#7c5cff";

async function loadCategories() {
  try {
    const c = await api.categories();
    const bases = (c.base_models || []).filter(Boolean).sort();
    const types = (c.types || []).filter(Boolean).sort();
    const fBase = $("#fBase"); if (fBase) fBase.innerHTML = '<option value="">Toutes les bases</option>' + bases.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join("");
    const fType = $("#fType"); if (fType) fType.innerHTML = '<option value="">Tous types</option>' + types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
    const fTag = $("#fTag"); if (fTag) fTag.innerHTML = '<option value="">Tous tags</option>' + (c.tags || []).slice(0, 200).map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
    const civBase = $("#civBase"); if (civBase) civBase.innerHTML = '<option value="">Toutes bases</option>' + bases.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join("");
    const bl = $("#baseList"); if (bl) {
      bl.innerHTML = bases.map(b => {
        const col = baseColor(b);
        return `<div class="base-chip" data-base="${esc(b)}" style="--bc:${col}"><span class="dot" style="background:${col};color:${col}"></span>${esc(b)}</div>`;
      }).join("");
      $$("#baseList .base-chip").forEach(n => n.onclick = () => {
        go('prompts');
        state.base = (n.dataset.base === state.base) ? "" : n.dataset.base;
        if ($("#fBase")) $("#fBase").value = state.base;
        $$("#baseList .base-chip").forEach(x => x.classList.toggle("on", x.dataset.base === state.base));
        loadImages(true);
      });
    }
    const tc = $("#tagCloud"); if (tc) {
      tc.innerHTML = (c.tags || []).slice(0, 14).map(t => `<span class="chip" data-tag="${esc(t)}">${esc(t)}</span>`).join("");
      $$("#tagCloud .chip").forEach(n => n.onclick = () => {
        go('prompts');
        state.tag = (n.dataset.tag === state.tag) ? "" : n.dataset.tag;
        if ($("#fTag")) $("#fTag").value = state.tag;
        loadImages(true);
      });
    }
  } catch {}
}

// ===================== PROMPTS (classic view) =====================
$("#fBase")?.addEventListener("change", (e) => { state.base = e.target.value; loadImages(true); });
$("#fType")?.addEventListener("change", (e) => { state.type = e.target.value; loadImages(true); });
$("#fTag")?.addEventListener("change", (e) => { state.tag = e.target.value; loadImages(true); });
let searchTimer;
$("#railSearch")?.addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.search = e.target.value.trim(); go('prompts'); loadImages(true); }, 350);
});

async function loadImages(reset) {
  const grid = $("#promptGrid"); if (!grid) return;
  if (imgAbort) imgAbort.abort();
  const ctl = new AbortController();
  imgAbort = ctl;
  if (reset) { state.offset = 0; state.images = []; const m = $("#promptMore"); if (m) m.innerHTML = ""; }
  const first = reset || !state.images.length;
  if (first) grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="spinner" style="margin:0 auto"></div></div>`;
  else { const m = $("#promptMore"); if (m) m.innerHTML = `<span class="faint">Chargement…</span>`; }
  const offset = state.offset;
  const q = new URLSearchParams({ limit: state.limit, offset });
  if (state.base) q.set("base_model", state.base);
  if (state.type) q.set("type", state.type);
  if (state.tag) q.set("tag", state.tag);
  if (state.search) q.set("search", state.search);
  if (state.men) q.set("men", state.men);
  q.set("nsfw_max", state.nsfwMax);
  let rows = [];
  try { rows = await fetch("/api/images?" + q.toString(), { signal: ctl.signal }).then(r => r.json()); }
  catch (e) { if (e?.name === "AbortError") return; }
  if (ctl !== imgAbort) return;
  rows = rows || [];
  state.images = reset ? rows : state.images.concat(rows);
  state.offset = offset + state.limit;
  renderPrompts(rows.length >= state.limit);
}

function cardHTML(im) {
  const lvl = im.nsfw_level || (im.nsfw ? 3 : 1);
  const video = isVideo(im.url);
  const url = video ? "" : thumb(im.url);
  const fallback = "this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'▣'}))";
  const pic = video ? `<div class="ph" style="font-size:26px">▶</div>` : (url ? `<img loading="lazy" src="${esc(url)}" onerror="${fallback}">` : `<div class="ph">▣</div>`);
  return `
  <article class="card" data-id="${esc(im.civitai_image_id)}">
    <div class="thumb ${lvl > 1 ? "nsfw" : ""}">${pic}
      <div class="badges"><span class="badge ${lvlClass(lvl)}">${lvlName(lvl)}</span>${im.base_model ? `<span class="badge">${esc(im.base_model)}</span>` : ""}</div>
    </div>
    <div class="body">
      <div class="title">${esc(im.model_name || "—")}</div>
      <div class="prompt">${esc((im.positive_prompt || "").slice(0, 180)) || "<i>pas de prompt</i>"}</div>
      <div class="meta"><span>${im.width || "?"}×${im.height || "?"}</span><span>·</span><span>${esc(im.sampler || "")}</span></div>
      <div class="actions"><button class="btn sm ghost" data-copy="${esc(im.civitai_image_id)}">Copier</button><button class="btn sm">Détails</button></div>
    </div>
  </article>`;
}

function renderPrompts(hasMore) {
  const g = $("#promptGrid"); if (!g) return;
  if (!state.images.length) {
    g.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">✦</div><b>Aucun prompt</b><div class="mt">Élargis les filtres ou lance le scraper.</div></div>`;
    const m = $("#promptMore"); if (m) m.innerHTML = ""; return;
  }
  g.innerHTML = state.images.map(cardHTML).join("");
  $$("#promptGrid .card").forEach(c => c.onclick = (e) => { if (!e.target.closest('[data-copy]')) openDrawer(c.dataset.id); });
  $$("#promptGrid [data-copy]").forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const im = state.images.find(x => String(x.civitai_image_id) === b.dataset.copy);
    if (im) navigator.clipboard.writeText(im.positive_prompt || "").then(() => toast("Prompt copié ✓"));
  });
  const m = $("#promptMore"); if (m) m.innerHTML = (hasMore ? `<button class="btn ghost" id="moreBtn">Charger plus</button>` : "") + `<span class="faint" style="margin-left:14px">${state.images.length} affichées</span>`;
  const mb = $("#moreBtn"); if (mb) mb.onclick = () => loadImages(false);
}

// ===================== DRAWER =====================
let histItems = [];
async function openDrawer(id) {
  $("#drawer").classList.add("on"); $("#scrim").classList.add("on");
  $("#drawer .db").innerHTML = `<div class="empty"><div class="spinner" style="margin:0 auto"></div></div>`;
  let im;
  try { im = await api.image(id); } catch { $("#drawer .db").innerHTML = `<div class="empty">Erreur</div>`; return; }
  if (im.error) { $("#drawer .db").innerHTML = `<div class="empty">Introuvable</div>`; return; }
  const lvl = im.nsfw_level || (im.nsfw ? 3 : 1);
  $("#drawer .db").innerHTML = `
    <div class="col-media">${isVideo(im.url) ? `<video src="${esc(bigThumb(im.url))}" controls style="width:100%;border-radius:var(--r-lg)"></video>` : `<img src="${esc(bigThumb(im.url))}" style="width:100%;border-radius:var(--r-lg)" onerror="this.style.display='none'">`}
      <div class="row wrap" style="margin-top:12px"><span class="badge ${lvlClass(lvl)}">${lvlName(lvl)}</span><span class="badge">${esc(im.base_model || "?")}</span></div>
    </div>
    <div>
      <div class="field"><label>Prompt positif <button class="btn sm ghost" data-cp="pos" style="margin-left:8px">Copier</button></label><div class="codebox mono">${esc(im.positive_prompt || "—")}</div></div>
      <div class="field"><label>Prompt négatif <button class="btn sm ghost" data-cp="neg" style="margin-left:8px">Copier</button></label><div class="codebox mono">${esc(im.negative_prompt || "—")}</div></div>
      <div class="field"><label>Paramètres</label><div class="kv">${kv("Sampler", im.sampler)}${kv("Steps", im.steps)}${kv("CFG", im.cfg_scale)}${kv("Seed", im.seed)}${kv("Résolution", im.width && im.height ? im.width + "×" + im.height : "")}</div></div>
      <div class="row wrap mt"><button class="btn primary" data-gen>✦ Générer une variation</button></div>
    </div>`;
  $$("[data-cp]", $("#drawer")).forEach(b => b.onclick = () => navigator.clipboard.writeText(b.dataset.cp === "pos" ? im.positive_prompt : im.negative_prompt).then(() => toast("Copié ✓")));
  const genBtn = $("[data-gen]", $("#drawer")); if (genBtn) genBtn.onclick = () => { $("#genPrompt").value = im.positive_prompt || ""; $("#genModal").classList.add("on"); };
  // add to history
  histItems = histItems.filter(h => h.civitai_image_id !== im.civitai_image_id);
  histItems.unshift({ id: im.civitai_image_id, name: im.model_name, base: im.base_model, url: im.url });
  histItems = histItems.slice(0, 12);
  renderHistory();
}
function renderHistory() {
  const el = $("#histList"); if (!el) return;
  el.innerHTML = histItems.map(h => `<div class="hist-item" data-id="${esc(h.id)}"><div class="tb">▣</div><div class="g"><b>${esc(h.name || "—")}</b><small>${esc(h.base || "")}</small></div></div>`).join("");
  $$("#histList .hist-item").forEach(n => n.onclick = () => openDrawer(n.dataset.id));
}
$("#drawerClose").onclick = () => { $("#drawer").classList.remove("on"); $("#scrim").classList.remove("on"); };
$("#scrim").onclick = () => { $("#drawer").classList.remove("on"); $("#scrim").classList.remove("on"); };

// ===================== MINI-GENERATOR =====================
$("#genBtn")?.addEventListener("click", () => $("#genModal").classList.add("on"));
$("#genCancel")?.addEventListener("click", () => $("#genModal").classList.remove("on"));
$("#genSteps")?.addEventListener("input", (e) => $("#genStepsV").textContent = e.target.value);
$("#genCfg")?.addEventListener("input", (e) => $("#genCfgV").textContent = (+e.target.value).toFixed(1));
$("#genRun")?.addEventListener("click", async () => {
  const prompt = $("#genPrompt").value.trim();
  if (!prompt) { toast("Écris un prompt d'abord"); return; }
  const btn = $("#genRun"); btn.disabled = true; btn.textContent = "Envoi…";
  try {
    const [w, h] = ($("#genRatio").value || "768×1152").split("×").map(Number);
    await api.comfy.generate({ prompt, steps: +$("#genSteps").value, cfg: +$("#genCfg").value, model: $("#genModel").value, width: w, height: h, sampler: $("#genSampler")?.value || "euler", scheduler: $("#genScheduler")?.value || "simple", seed: +$("#genSeed")?.value || -1, vae: $("#genVae")?.value || "auto" });
    $("#genModal").classList.remove("on"); $("#genPrompt").value = ""; toast("Envoyé à ComfyUI ✓");
  } catch (e) { toast("Échec — ComfyUI est-il lancé ?"); }
  btn.disabled = false; btn.textContent = "Lancer → ComfyUI";
});

// ===================== WORKFLOW TOOLBAR =====================
$("#wfUndo")?.addEventListener("click", () => { graph.undo(); canvas?.rebuildNodes(); });
$("#wfRedo")?.addEventListener("click", () => { graph.redo(); canvas?.rebuildNodes(); });
$("#wfAutoLayout")?.addEventListener("click", () => { graph.autoLayout('horizontal'); canvas?.rebuildNodes(); });
$("#wfCenter")?.addEventListener("click", () => {
  if (!canvas) return;
  const vp = graph.centerView();
  canvas.viewport.value = { x: canvas.container.clientWidth / 2 - vp.x, y: canvas.container.clientHeight / 2 - vp.y, zoom: 1 };
  canvas.dirty = true;
});
$("#wfZoomIn")?.addEventListener("click", () => { if (canvas) { const vp = canvas.viewport.value; canvas.viewport.value = { ...vp, zoom: Math.min(3, vp.zoom * 1.2) }; canvas.dirty = true; } });
$("#wfZoomOut")?.addEventListener("click", () => { if (canvas) { const vp = canvas.viewport.value; canvas.viewport.value = { ...vp, zoom: Math.max(0.1, vp.zoom / 1.2) }; canvas.dirty = true; } });
$("#wfSave")?.addEventListener("click", () => wfLibrary?.save("Untitled Workflow"));
$("#executeGraphBtn")?.addEventListener("click", () => runGraph());
$("#validateGraphBtn")?.addEventListener("click", () => validateGraph());

// Vitesse de génération
(function wireSpeed() {
  const seg = $("#speedSeg");
  if (!seg) return;
  let speed = "balanced";
  try { speed = localStorage.getItem("flux_speed") || "balanced"; } catch {}
  seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.speed === speed));
  seg.addEventListener("click", e => {
    const btn = e.target.closest("button[data-speed]");
    if (!btn) return;
    speed = btn.dataset.speed;
    try { localStorage.setItem("flux_speed", speed); } catch {}
    seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.speed === speed));
    toast(`Vitesse : ${btn.textContent}`);
  });
  window.__fluxSpeed = () => speed;
})();

// Récents prompts
$("#recentPromptsBtn")?.addEventListener("click", async () => {
  try {
    const { prompts } = await import("../core/storage.js");
    const list = await prompts.recent(12);
    const dd = $("#recentPromptsDropdown");
    if (!dd) return;
    if (!list.length) { dd.innerHTML = "<div class='recent-empty'>Aucun prompt récent</div>"; dd.style.display="block"; return; }
    dd.innerHTML = list.map(p => `<div class="recent-item" data-text="${esc(p.text)}">${esc((p.text||"").slice(0,80))}</div>`).join("");
    dd.style.display = "block";
    dd.querySelectorAll(".recent-item").forEach(it => it.addEventListener("click", () => {
      const t = it.dataset.text;
      const ta = document.querySelector("#visionPrompt") || document.querySelector("textarea.widget-input");
      if (ta) ta.value = t;
      try { navigator.clipboard.writeText(t); toast("Prompt copié"); } catch {}
      dd.style.display = "none";
    }));
  } catch(e) { toast("Erreur : " + e.message, "error"); }
});
document.addEventListener("click", e => {
  const dd = $("#recentPromptsDropdown");
  if (dd && !dd.contains(e.target) && e.target.id !== "recentPromptsBtn") dd.style.display = "none";
  const ad = $("#autoLoraDropdown");
  if (ad && !ad.contains(e.target) && e.target.id !== "autoLoraBtn") ad.style.display = "none";
});

$("#autoLoraBtn")?.addEventListener("click", async () => {
  const dd = $("#autoLoraDropdown");
  if (!dd) return;
  // collect prompt from graph
  const promptText = graph.getAllNodes()
    .filter(n => n.type === "CLIPTextEncode")
    .map(n => n.getWidget("text")).filter(Boolean).join(" ");
  const base = (window.__fluxSpeed && "balanced") ; // placeholder
  const suggestions = suggestLoras(promptText);
  if (!suggestions.length) {
    dd.innerHTML = "<div class='recent-empty'>Aucune suggestion (ajoute un workflow + prompt)</div>";
    dd.style.display = "block"; return;
  }
  dd.innerHTML = suggestions.map(s => `
    <div class="recent-item auto-lora-item" data-path="${esc(s.path)}">
      <div style="display:flex;align-items:center;gap:8px;">
        ${s.preview ? `<img src="${esc(s.preview)}" style="width:32px;height:32px;border-radius:6px;object-fit:cover;" alt="">` : "<span style='width:32px;height:32px;display:inline-block;background:#222;border-radius:6px;'></span>"}
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;color:#e6e9ef;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(s.name)}</div>
          <div style="font-size:11px;color:#6b7280;">score ${s.score} · ${esc(s.base_model || "")}</div>
        </div>
        <button class="btn primary sm" data-apply="${esc(s.path)}">Appliquer</button>
      </div>
    </div>
  `).join("");
  dd.style.display = "block";
  dd.querySelectorAll("[data-apply]").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    try {
      applyLoraToGraph(b.dataset.apply, 0.85);
      toast("LoRA appliqué ✓");
      dd.style.display = "none";
    } catch(err){ toast("Erreur : " + err.message, "error"); }
  }));
});
$("#warmupBtn")?.addEventListener("click", async () => {
  const btn = $("#warmupBtn");
  btn.disabled = true; btn.textContent = "🔥…";
  try {
    const r = await fetch('/api/comfyui/warmup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base: 'klein' })
    }).then(x => x.json());
    if (r.ok) toast("🔥 Pré-chargement lancé (Klein). Patientez ~1 min avant de générer");
    else toast("Erreur : " + (r.error || ''), 'error');
  } catch (e) { toast("Erreur : " + e.message, 'error'); }
  setTimeout(() => { btn.disabled = false; btn.textContent = "🔥 Pré-charge"; }, 3000);
});
$("#freeMemoryBtn")?.addEventListener("click", async () => {
  const btn = $("#freeMemoryBtn");
  btn.disabled = true; btn.textContent = "⏳";
  try {
    const r = await fetch('/api/comfyui/free', { method: 'POST' }).then(x => x.json());
    const free = r.vram_free != null ? Math.round(r.vram_free / (1024*1024)) : '?';
    toast(`🧹 Mémoire libérée — VRAM libre ${free} Mo`);
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
  btn.disabled = false; btn.textContent = "🧹 Libérer";
});

/**
 * Valide le graphe cote ComfyUI SANS le faire tourner.
 *
 * ComfyUI n'a pas de mode dry-run : la seule facon de valider est d'envoyer
 * le prompt, puis de le retirer de la file. C'est ce que fait
 * POST /api/comfyui/validate. Ne jamais utiliser runGraph() pour tester :
 * chaque appel remplit la file de l'utilisateur.
 */
async function validateGraph() {
  if (!graph.getAllNodes().length) { toast("Workflow vide"); return; }
  const btn = $("#validateGraphBtn");
  btn.disabled = true; btn.textContent = "⏳ Validation…";

  // Validation locale d'abord : gratuite, et messages plus lisibles
  const v = graph.validate();
  if (!v.valid) {
    const first = v.errors[0];
    toast(`Graphe invalide : ${first.message}`, 'error');
    if (first.nodeId) { graph.select(first.nodeId); go('workflow'); }
    btn.disabled = false; btn.textContent = "✓ Valider";
    return;
  }

  try {
    const prompt = graphToComfyUI(graph);
    const r = await fetch('/api/comfyui/validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    }).then(x => x.json());

    if (r.valid) {
      toast(`✓ Graphe accepté par ComfyUI (${Object.keys(prompt).length} nœuds)`);
    } else {
      const msgs = (r.messages || []).slice(0, 3);
      toast(msgs.length ? msgs.join(' · ') : 'Graphe refusé par ComfyUI', 'error');
    }
  } catch (e) {
    toast('Erreur de validation : ' + e.message, 'error');
  }
  btn.disabled = false; btn.textContent = "✓ Valider";
}

/** Estime la VRAM minimale requise (Go) selon les nœuds du graphe. */
function requiredVRAMForGraph() {
  const types = new Set(graph.getAllNodes().map(n => n.type));
  if (types.has("UNETLoader") && types.has("CLIPLoader")) {
    // Klein (Qwen 3 4B + UNET)
    const unet = graph.getAllNodes().find(n => n.type === "UNETLoader");
    const name = (unet?.getWidget?.("unet_name") || "").toLowerCase();
    if (name.includes("klein")) return 9;
    return 10; // FLUX.1 dev
  }
  if (types.has("CheckpointLoaderSimple")) return 6; // SDXL
  if (types.has("UNETLoader") && types.has("DualCLIPLoader")) return 10;
  return 4;
}

async function runGraph() {
  if (!graph.getAllNodes().length) { toast("Workflow vide"); return; }
  const btn = $("#executeGraphBtn");
  btn.disabled = true; btn.textContent = "⏳ Génération…";

  // Feedback immédiat sur les erreurs de validation
  const v = graph.validate();
  if (!v.valid) {
    const first = v.errors[0];
    toast(`Graphe invalide : ${first.message}`, 'error');
    if (first.nodeId) { graph.select(first.nodeId); go('workflow'); }
    btn.disabled = false; btn.textContent = "▶ Run";
    return;
  }
  const warns = v.warnings.length;
  if (warns) console.warn(`[graph] ${warns} avertissement(s)`, v.warnings);

  // --- Logique VRAM ---
  try {
    const prof = await fetch("/api/comfyui/profile").then(r=>r.json());
    const freeGB = ((prof?.devices?.[0]?.vram_free) || 0) / (1024*1024*1024);
    const required = requiredVRAMForGraph();
    if (freeGB < required) {
      toast(`🧹 VRAM insuffisante (${freeGB.toFixed(1)} Go < ${required} Go) — libération…`);
      await fetch("/api/comfyui/free", { method: "POST" });
    }
  } catch(e) {}
  // --- Vitesse : scaling des steps selon préférence ---
  const speed = (window.__fluxSpeed && window.__fluxSpeed()) || "balanced";
  const scale = speed === "fast" ? 0.5 : speed === "quality" ? 1.5 : 1.0;
  const savedSteps = new Map();
  if (scale !== 1.0) {
    graph.getAllNodes().forEach(n => {
      ["steps"].forEach(w => {
        const cur = n.getWidget ? n.getWidget(w) : null;
        if (cur != null && !isNaN(cur)) {
          savedSteps.set(n.id + ":" + w, cur);
          n.setWidget(w, Math.max(1, Math.round(cur * scale)));
        }
      });
    });
  }
  try {
    const res = await graph.execute();
    if (res && res.ok) {
      const n = (res.images || []).length;
      toast(`Génération terminée ✓ ${n} image${n > 1 ? 's' : ''}`);
      showRunResult(res.images || []);
    } else {
      const msg = (res && res.error) || 'Erreur inconnue';
      toast(msg, 'error');
      if (res && res.promptId) console.warn('[graph] promptId', res.promptId);
    }
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
  // Restaurer les steps d'origine
  savedSteps.forEach((v, k) => {
    const [nid, w] = k.split(":");
    const n = graph.getAllNodes().find(x => x.id === nid);
    if (n) n.setWidget(w, v);
  });
  btn.disabled = false; btn.textContent = "▶ Run";
  // Historique de prompts (logique)
  try {
    const promptText = graph.getAllNodes()
      .filter(n => n.type === "CLIPTextEncode")
      .map(n => n.getWidget("text")).filter(Boolean).join(" | ");
    if (promptText) {
      const { prompts } = await import("../core/storage.js");
      await prompts.save({ text: promptText, model: "graph", createdAt: Date.now() });
    }
  } catch(e) {}
}

/** Affiche le résultat d'une génération dans un panneau flottant sur le canvas. */
/** Apple-style "image → prompt" sheet. */
function openVisionSheet(file) {
  const existing = $("#visionSheet");
  if (existing) existing.remove();
  const modal = document.createElement("div");
  modal.id = "visionSheet";
  modal.className = "vision-sheet";
  document.body.appendChild(modal);

  const reader = new FileReader();
  modal.innerHTML = `
    <div class="vision-backdrop" data-action="close"></div>
    <div class="vision-card">
      <button class="btn icon ghost sm vision-close" data-action="close">✕</button>
      <div class="vision-preview">
        <div class="vision-preview-shimmer"></div>
      </div>
      <div class="vision-status">Analyse…</div>
      <div class="vision-prompt-wrap">
        <label>Prompt généré</label>
        <textarea id="visionPrompt" rows="4" placeholder="L'IA décrive ici…"></textarea>
      </div>
      <div class="vision-actions">
        <button class="btn sm" id="visionCopy">Copier</button>
        <select id="visionDestination">
          <option value="sdxl-base">SDXL — Base</option>
          <option value="flux1-dev">FLUX.1 Dev</option>
          <option value="flux2-klein">FLUX.2 Klein</option>
        </select>
        <label class="vision-checkbox"><input type="checkbox" id="visionGenerateNow"> Générer maintenant</label>
        <button class="btn primary sm" id="visionGenerate">→ Envoyer au workflow</button>
      </div>
    </div>
  `;
  function close() { modal.classList.add("vision-sheet-out"); setTimeout(()=>modal.remove(), 260); }
  modal.querySelectorAll("[data-action=\"close\"]").forEach(b => b.addEventListener("click", close));

  modal.querySelector("#visionCopy")?.addEventListener("click", async () => {
    const txt = modal.querySelector("#visionPrompt").value;
    try { await navigator.clipboard.writeText(txt); toast("Copié"); } catch(e){ toast("Erreur copier", "error"); }
  });
  modal.querySelector("#visionGenerate")?.addEventListener("click", async () => {
    const txt = modal.querySelector("#visionPrompt").value.trim();
    if (!txt) { toast("Prompt vide", "error"); return; }
    const id = modal.querySelector("#visionDestination").value;
    const cb = modal.querySelector("#visionGenerateNow");
    try {
      if (graph.getAllNodes().length && !confirm("Remplacer le workflow actuel par " + id + " ?")) return;
      applyCatalogWorkflow(id);
      // injection sélective : 1er CLIPTextEncode = positive, 2nd = négatif.
      const clips = graph.getAllNodes().filter(n => n.type === "CLIPTextEncode");
      const neg = (id === "flux1-dev" || id === "flux2-klein")
        ? "blurry, bad anatomy, low quality"   // Flux tolère peu de négatif
        : "blurry, bad anatomy, watermark, low quality, extra fingers, deformed";
      if (clips[0]) clips[0].setWidget("text", txt);
      if (clips[1]) clips[1].setWidget("text", neg);
      toast(`Workflow ${id} prêt — prompt injecté`);
      close();
      go("workflow");
      canvas?.rebuildNodes && canvas.rebuildNodes();
      if (cb && cb.checked) { toast("Lancement…"); await runGraph(); }
    } catch(e){ toast("Erreur : " + e.message, "error"); }
  });

  const shimmer = modal.querySelector(".vision-preview-shimmer");
  reader.onload = async (ev) => {
    modal.querySelector(".vision-preview").innerHTML =
      `<img class="vision-img" src="${esc(ev.target.result)}" alt="upload">`;
    // Describe (Gemini Vision)
    const fd = new FormData();
    fd.append("file", file, file.name || "image.png");
    try {
      const r = await fetch("/api/comfyui/describe", { method: "POST", headers: { "X-AI-Describe": "1" }, body: fd });
      const j = await r.json();
      const caption = (j?.ai?.description || j?.positive_prompt || "").trim();

      // VRAM detection pour auto-dest
      let freeVRAMGB = 8;
      try {
        const prof = await fetch("/api/comfyui/profile").then(x=>x.json());
        freeVRAMGB = ((prof?.devices?.[0]?.vram_free) || 0) / (1024*1024*1024);
      } catch(e){}

      const lower = caption.toLowerCase();
      const isAnime = /anime|cartoon|manga|2d/.test(lower);
      const isPhoto = /photograph|real ?human|portrait|skin/.test(lower);
      const isFast = /quick|draft/.test(lower);
      let dest = "sdxl-base";
      if (isAnime || freeVRAMGB < 6) dest = "sdxl-base";
      else if (isPhoto && freeVRAMGB >= 9) dest = (isFast ? "flux2-klein" : "flux1-dev");
      else if (freeVRAMGB >= 9) dest = "flux2-klein";
      else if (freeVRAMGB >= 5) dest = "sdxl-base";

      modal.querySelector("#visionPrompt").value = caption || "a beautiful woman, detailed portrait";
      modal.querySelector("#visionDestination").value = dest;
      modal.querySelector("#visionDestination").title =
        `auto: ${dest} (VRAM ${freeVRAMGB.toFixed(1)}Go — ${isAnime?"anime":isPhoto?"photo":"général"})`;
      modal.querySelector(".vision-status").textContent = "✓ Description générée";
    } catch(e) {
      modal.querySelector(".vision-status").textContent = "Erreur : " + e.message;
    }
  };
  reader.readAsDataURL(file);
  requestAnimationFrame(() => modal.classList.add("vision-sheet-in"));

  // reader not auto-defined; declare
  return modal;
}

function showRunResult(images) {
  const box = $("#canvasWrapper");
  if (!box) return;
  let panel = $("#runResult");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "runResult";
    panel.className = "run-result";
    document.body.appendChild(panel);
  }
  const cards = images.map(im => {
    const src = "/api/comfyui/image?filename=" + encodeURIComponent(im.filename) +
      "&subfolder=" + encodeURIComponent(im.subfolder || "") +
      "&type=" + encodeURIComponent(im.type || "output");
    return `<div class="hist-item"><img class="tb" src="${esc(src)}" alt=""><div class="g"><b>${esc(im.filename)}</b><small>nœud ${esc(im.node)}</small></div></div>`;
  }).join("");
  panel.innerHTML =
    `<div class="run-result-head"><span>Résultat</span><button class="btn icon ghost sm" id="runResultClose">✕</button></div>` +
    cards;
  panel.style.display = "block";
  const close = document.querySelector("#runResultClose");
  if (close) close.onclick = () => { panel.style.display = "none"; };
}

// Update stats
function updateWfStats() {
  const el = $("#wfStats"); if (!el) return;
  el.textContent = `${graph.getAllNodes().length} nodes · ${graph.getEdges().length} edges`;
}
Events.graph.on('graph:node-add', updateWfStats);
Events.graph.on('graph:node-remove', updateWfStats);
Events.graph.on('graph:connect', updateWfStats);
Events.graph.on('graph:disconnect', updateWfStats);

/* ---------------------------------------------------------------- App view */
function populateAppLoras() {
  const sel = $("#appLora");
  if (!sel) return;
  const model = $("#appModel")?.value || "";
  let base = "SDXL";
  if (model.includes("flux2") || model.includes("klein")) base = "Flux.2 Klein 4B-base";
  else if (model.includes("flux1")) base = "Flux.1 D";
  else if (model.includes("sd15")) base = "SD 1.5";
  else base = "SDXL";
  const norm = (b) => (b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const gb = norm(base);
  const opts = (window.LoraIndex?.items || LoraIndex?.items || [])
    .filter(l => !gb || norm(l.base_model).includes(gb.slice(0, 5)))
    .slice(0, 60);
  sel.innerHTML = "<option value=''>Aucun</option>" +
    opts.map(l => `<option value="${esc(l.path)}">${esc(l.name)}</option>`).join("");
}

async function appGenerate() {
  const btn = $("#appGenerate");
  btn.disabled = true; btn.textContent = "⏳ Génération…";
  const model = $("#appModel").value;
  const prompt = $("#appPrompt").value.trim() || "a beautiful woman, portrait, soft light, 8k";
  const neg = $("#appNeg").value.trim() || "blurry, bad anatomy, watermark, low quality";
  const w = parseInt($("#appW").value, 10);
  const h = parseInt($("#appH").value, 10);
  const steps = parseInt($("#appSteps").value, 10);
  const cfg = parseFloat($("#appCfg").value);
  const seedRaw = $("#appSeed").value.trim();
  const seed = seedRaw ? parseInt(seedRaw, 10) : Math.floor(Math.random() * 1e9);
  const lora = $("#appLora").value;

  try {
    applyCatalogWorkflow(model);
    const clips = graph.getAllNodes().filter(n => n.type === "CLIPTextEncode");
    if (clips[0]) clips[0].setWidget("text", prompt);
    if (clips[1]) clips[1].setWidget("text", neg);

    // taille + steps + cfg + seed
    graph.getAllNodes().forEach(n => {
      if (n.setWidget) {
        if (n.type === "EmptyLatentImage" || n.type === "EmptyFlux2LatentImage") {
          n.setWidget("width", w); n.setWidget("height", h);
        }
        if (n.type === "KSampler") {
          n.setWidget("steps", steps); n.setWidget("cfg", cfg); n.setWidget("seed", seed);
        }
        if (n.type === "BasicScheduler" || n.type === "Flux2Scheduler") {
          n.setWidget("steps", steps);
        }
        if (n.type === "CFGGuider") n.setWidget("cfg", cfg);
        if (n.type === "SamplerCustom" || n.type === "SamplerCustomAdvanced") {
          // seed on RandomNoise
        }
        if (n.type === "RandomNoise") n.setWidget("noise_seed", seed);
      }
    });

    // LoRA
    if (lora) {
      const { applyLora } = await import("../loras/palette.js");
      try { applyLora(lora, 0.85); } catch(e) { console.warn(e); }
    }

    canvas?.rebuildNodes && canvas.rebuildNodes();
    toast("Génération…");
    const res = await graph.execute();
    if (res && res.ok) {
      const imgs = res.images || [];
      const box = $("#appResult");
      const imgBox = $("#appResultImg");
      box.style.display = "block";
      imgBox.innerHTML = imgs.map(im => {
        const src = "/api/comfyui/image?filename=" + encodeURIComponent(im.filename) +
          "&subfolder=" + encodeURIComponent(im.subfolder || "") +
          "&type=" + encodeURIComponent(im.type || "output");
        return `<img class="app-result-img" src="${esc(src)}" alt="">`;
      }).join("");
      toast(`✓ ${imgs.length} image${imgs.length>1?"s":""}`);
    } else {
      toast((res && res.error) || "Erreur", "error");
    }
  } catch(e) {
    toast("Erreur : " + e.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "▶ Générer";
  }
}

$("#appGenerate")?.addEventListener("click", appGenerate);
$("#appDescribe")?.addEventListener("click", () => {
  // reuse vision sheet by creating a file input
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*";
  inp.onchange = () => { if (inp.files && inp.files[0]) openVisionSheet(inp.files[0]); };
  inp.click();
});
$("#appModel")?.addEventListener("change", populateAppLoras);

// ===================== DRAG & DROP IMAGE (Apple sheet) =====================
(function wireDragDrop() {
  let dragDepth = 0;
  const overlay = document.createElement("div");
  overlay.id = "dragOverlay";
  overlay.className = "drag-overlay";
  overlay.innerHTML = "<div class=\"drag-overlay-inner\"><div class=\"drag-icon\">🖼</div><div>Drop an image to describe &amp; recreate it</div></div>";
  document.body.appendChild(overlay);

  function show(show) { overlay.style.opacity = show ? "1" : "0";
                        overlay.style.pointerEvents = show ? "all" : "none";
                        overlay.classList.toggle("drag-overlay-show", show); }
  document.addEventListener("dragenter", e => { if (e.dataTransfer?.types?.includes("Files")) { dragDepth++; show(true); e.preventDefault(); } });
  document.addEventListener("dragover", e => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); } });
  document.addEventListener("dragleave", e => { if (e.dataTransfer?.types?.includes("Files")) { dragDepth = Math.max(0, dragDepth-1); if (dragDepth === 0) show(false); } });
  document.addEventListener("drop", e => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault(); show(false); dragDepth = 0;
    const f = [...e.dataTransfer.files].find(x => x.type.startsWith("image/"));
    if (f) openVisionSheet(f);
  });
})();

// ===================== KEYBOARD =====================
window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runGraph(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); wfLibrary?.save(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault(); openLoraPalette();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !typing) {
    e.preventDefault();
    if (e.shiftKey) { if (graph.redo()) { canvas?.rebuildNodes(); toast("Rétabli"); } }
    else { if (graph.undo()) { canvas?.rebuildNodes(); toast("Annulé"); } }
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y') && !typing) {
    e.preventDefault();
    if (graph.redo()) { canvas?.rebuildNodes(); toast("Rétabli"); }
  }
});

// ===================== BOOT =====================
async function boot() {
  let saved = null;
  try { saved = localStorage.getItem("flux_safe"); } catch {}
  setSafe(saved === null ? true : saved === "1");

  await initStorage();
  // Catalogue des fichiers réellement installés (remplit les widgets dynamic)
  try { await initCatalog(); } catch (e) { console.warn('[catalog]', e); }
  try { await primeCacheNode(); } catch (e) { console.warn('[cache-node]', e); }

  // Workflow editor
  canvas = createCanvas($("#canvasWrapper"));
  palette = createPalette($("#palettePanel"));
  inspector = createInspector($("#inspectorPanel"));
  wfLibrary = createWorkflowLibrary();
  wfLibrary.startAutoSave();

  // Panneau « workflows prêts à l'emploi » : un clic = graphe câblé
  quickstart = createQuickStart($("#quickPanel"), { toast: (m, t) => toast(m, t) });
  mountLoraPalette();
  mountLoraInventory();
  initLoraPalette();

  // Template par défaut : SDXL (pipeline validé sur cette machine)
  try { getTemplate('sdxl-txt2img')?.build(); canvas.rebuildNodes(); } catch (e) { console.warn('[template]', e); }

  await Promise.allSettled([loadStats(), loadCategories()]);
  await loadImages(true);

  // Détection VRAM faible au démarrage
  try {
    const prof = await fetch('/api/comfyui/profile').then(r => r.json());
    const vramFree = (prof?.devices?.[0]?.vram_free || 0);
    if (vramFree && vramFree < 4 * 1024 * 1024 * 1024) {
      toast(`⚠ VRAM faible : ${Math.round(vramFree / (1024*1024*1024))} Go disponibles`, 'error');
    }
  } catch {}
  // WebSocket ComfyUI désactivé par défaut : les connexions ws://127.0.0.1:8188
  // sont bloquées par l’environnement (proxy Windows). La progression se fait
  // par polling HTTP, qui fonctionne. Réactiver ici si le WS est autorisé :
  // (try { const ws = new ComfyWS(); ws.connect(); } catch {})

  go('app');
  updateWfStats();

  console.log('[Flux Studio v2] Booted ✓');
}

boot();