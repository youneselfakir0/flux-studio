# Flux Studio — Rapport détaillé

**Date** : 16 octobre 2026
**Statut** : P0, P1, P2, P3 traités (sauf exceptions documentées)
**Lieu** : `C:\Users\administrator\flux-studio`

---

## 1. Objectif du projet

Flux Studio est un studio local (Windows) pour :

1. **Gérer une base de prompts Civitai** (femmes IA, NSFW jusqu'à X, XXX exclu) avec filtres par base modèle, NSFW, genre.
2. **Gérer ComfyUI** (RTX 3060 12 Go) : scanners de modèles/LoRA, téléchargements, workflows one-click par modèle installé.
3. **Éditeur nodal** type InvokeAI pour construire des workflows, avec exécution réelle vers ComfyUI.
4. **Résoudre le problème UX des centaines de LoRA** via une palette Ctrl+K instantanée.
5. **Mode App simplifié** pour les utilisateurs qui ne veulent pas toucher aux nœuds.

---

## 2. Architecture

### 2.1 Stack
- **Backend** : Python (`app/server.py`), `ThreadingHTTPServer`, port 8080.
- **Frontend** : SPA vanilla JS (pas de framework), modules ES6.
- **Design** : tokens Stitch (primary `#7c5cff`, accent `#00f0ff`, bg `#0b0d10`, surface `#13161c`), dark studio pro.
- **Vision** : Gemini API (`gemini-3.1-flash-lite`).
- **Base de données** : SQLite (Civitai), IndexedDB (workflows/images/prompts), JSON (LoRA index).

### 2.2 Fichiers clés

| Fichier | Rôle |
|---|---|
| `app/server.py` | API + bridge ComfyUI (port 8188). Routes `/api/comfyui/*` |
| `app/static/v2/main.js` | Orchestrateur (boot, nav, runGraph, validate, app mode) |
| `app/static/editor/graph.js` | Graphe nodal, `graphToComfyUI()`, export |
| `app/static/nodes/registry.js` | 39 nœuds alignés sur ComfyUI `object_info` |
| `app/static/workflows/catalog.js` | 14 workflows prêts à l'emploi |
| `app/static/workflows/builder.js` | `applyCatalogWorkflow()` (FLUX.1/FLUX.2/Checkpoint/Utility) |
| `app/static/loras/palette.js` | `LoraIndex` (475 LoRA), `searchLoras`, `applyLora`, `suggestLoras` |
| `app/static/loras/palette-ui.js` | Palette Ctrl+K |
| `app/static/gallery/grid.js` | Galerie Civitai + queue de génération réelle |
| `app/static/models/browser.js` | Scanner local de modèles |
| `app/static/core/api.js` | Client HTTP + `pollComfyQueue` + `ComfyWS` |
| `app/static/core/storage.js` | IndexedDB (workflows, images, prompts, templates) |
| `data/lora_index.json` | 475 LoRA, 316 triggers, 425 previews (335 Ko) |
| `docs/TODO.md` | Plan de travail détaillé |

---

## 3. Scraping Civitai

- **17 256 images** / **4 163 modèles** / **19 258 versions**.
- 10 bases canoniques, 0 NULL gender.
- Exclusion hommes via keywords prompt + noms de LoRA.
- NSFW jusqu'à X uniquement (XXX exclu).
- Modèles limités à ceux compatibles RTX 3060 12 Go + ComfyUI.
- 627 images vidéo (`.mp4`) → placeholder ▶.

---

## 4. Pipelines ComfyUI validés

### FLUX.2 Klein (4 steps, distillé)
```
CLIPLoader(qwen_3_4b.safetensors, type="flux2")
+ Flux2Scheduler(steps, width, height)
+ CFGGuider(model, positive, negative, cfg)
+ SamplerCustomAdvanced(noise, guider, sampler, sigmas, latent_image)
+ UNETLoader(flux-2-klein-4b.safetensors)
+ VAELoader(flux2-vae.safetensors)
```
- **Pas** DualCLIPLoader/T5XXL+CLIP-L (donne 4096 dim, Klein veut 3072).
- Optimisé : negative conditioning réutilise pPos (cfg=1.0 distillé).

### FLUX.1 Dev (24 steps)
- UNETLoader + DualCLIPLoader (T5XXL + CLIP-L, type flux) + BasicScheduler + SamplerCustom.

### SDXL (24 steps), SD 1.5, LTX Video, Z-Image, Qwen
- Pipelines validés, 14 workflows constructibles, 11 exécutés en réel.

### Points techniques critiques
- **Windows path separators** : ComfyUI retourne `\`, `/prompt` rejette toute valeur hors de sa liste. Le serveur lit les combos depuis `/object_info`, jamais depuis le disque.
- **Empty string widgets** envoyés à ComfyUI (inputs requis).
- `/api/comfyui/queue` en lecture seule (interrompait le job en cours).
- `/api/comfyui/free` : `{"unload_models":true,"free_memory":true}` — critique sur 12 Go.

---

## 5. LoRA (475 indexés)

- `data/lora_index.json` : 335 Ko, 475 items, 316 triggers, 425 previews.
- `path` utilise `\` (ComfyUI), `webPath` utilise `/` (URL).
- Source réelle : `<nom>.safetensors.civitai.json` (489 fichiers).
- `base_model` est la vérité : 410 LoRA "Flux.1 D" malgré dossier "Unknown/" (349).
- Palette Ctrl+K : 0,74 ms/recherche, filtre auto sur le modèle du graphe, écrit `<lora:trigger:0.9>` dans le prompt.
- `suggestLoras(prompt)` : scoring base + triggers + tags + nom.

---

## 6. Fonctionnalités livrées

### P0 — Bloquant
- **`/api/comfyui/validate`** : valide un graphe sans le pousser dans la file. 6 tests → file intacte, VRAM stable. Bouton « ✓ Valider » dans la toolbar.

### P1 — Fonctionnel cassé (tous corrigés)
- Scanner GET→POST (614 fichiers).
- Galerie : exécution réelle + polling `/history`, validation avant run.
- Route SSE fantôme supprimée → `pollComfyQueue()`.
- `workflows.delete` fonctionnel (test navigateur).
- `models/browser.js` double-décodage corrigé (aplatissement `{checkpoints, loras, ...}`).
- Boutons `openFolder`/`deleteModel` implémentés avec routes serveur.

### P2 — Qualité d'usage
- Upload d'image pour `LoadImage` (route proxy `/api/comfyui/upload-image`).
- Persistance des filtres (gallery + models → localStorage).
- WebSocket client `ComfyWS` (désactivé par défaut, bloqué par l'environnement).
- Bouton « 🧹 Libérer la mémoire » + détection VRAM faible (toast si < 4 Go).
- `PreviewImage` rendu local via `showRunResult()`.

### P3 — Erreurs connues
- Pré-chargement Klein : `/api/comfyui/warmup` + bouton « 🔥 Pré-charge ».
- Pipeline Klein optimisé : negative conditioning réutilise pPos.
- `Reroute`/`PrimitiveNode` masqués de la palette.

### Mode App (nouveau)
- Onglet « ◉ App » : interface simple sans nœuds (modèle, prompt, négatif, taille, steps, CFG, seed, LoRA).
- Construit le graphe en arrière-plan via `applyCatalogWorkflow` + injection.
- Bouton « Depuis une image » réutilise la vision sheet.

### Vision sheet (Apple-style)
- Drop d'image anywhere → overlay blur + modal glassmorphism.
- Description Gemini Vision → prompt éditable.
- Sélection auto de destination selon VRAM + type de prompt (anime/photo/général).
- Injection sélective positive/négatif.
- Confirm avant écraser, option "Générer maintenant".

### Logique métier
- `requiredVRAMForGraph()` : estime la VRAM requise.
- `runGraph()` auto-libère la VRAM si insuffisante.
- Négatif base-aware (Flux court, SDXL complet).
- Vitesse de génération (Rapide/Équilibré/Qualité) : scale les steps.
- Historique de prompts (IndexedDB) + dropdown « Récents ».
- Suggestion LoRA automatique depuis le prompt (scoring).

### Motion layer
- `v2/vision.css` : animations viewFadeIn, toastSlide, panelRise, hover lifts, drag overlay.

---

## 7. Bugs connus / non implémentés

- `PreviewImage` n'a pas de poller `temp/` dédié (résultat affiché au run-global).
- Cache d'encodeur persistant (nécessiterait custom node ComfyUI).
- WebSocket bloqué par l'environnement (proxy Windows) — polling HTTP reste la voie fiable.
- `PrimitiveNode`/`Reroute` encore dans le registre (mais masqués de la palette).

---

## 8. Informations techniques

- **ComfyUI** : `http://127.0.0.1:8188` (v0.39.2). Doit être running.
- **Flux Studio** : `http://localhost:8080`.
- **Gemini key** : défini via env var `GEMINI_API_KEY` (voir `.env.example`).
- **Civitai token** : défini via env var `CIVITAI_TOKEN`.
- **Fichiers réels** : checkpoints `sd_xl_base_1.0.safetensors`, etc.
- **PowerShell** : pas de `jq`, pas de heredocs, `Set-Content -Encoding UTF8` corrompt l'UTF-8.

---

## 9. Prochaines étapes possibles

1. Cache d'encodeur persistant (custom node).
2. Poller `temp/` pour PreviewImage per-node.
3. Undo/redo dans l'éditeur.
4. Tests automatisés (Playwright) pour non-régression.
5. Export/import de workflows en JSON.
6. Multi-langue (EN).

---

*Rapport généré le 16/10/2026.*