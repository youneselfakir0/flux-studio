# Flux Studio — Plan de travail

État final au 16/10/2026. Tous les P0/P1/P2/P3 traités (sauf exceptions explicitement documentées).

## P0 — Bloquant ✓
- `validate_only` route + bouton UI. Valide sans polluer la file.

## P1 ✓
- Scanner GET→POST.
- Galerie : exécution réelle + polling `/history`, validation avant run.
- Route SSE fantôme supprimée → polling.
- workflows.delete fonctionnel.
- browser.js double-décodage corrigé.
- Boutons openFolder/deleteModel implémentés.

## P2 ✓
- Upload d'image pour LoadImage.
- Persistance des filtres (gallery + models).
- WebSocket client ComfyWS au boot.
- Bouton « Libérer la mémoire » + détection VRAM faible (toast).
- PreviewImage rendu local dans `showRunResult()` (PreviewImage → output `temp/`).

## P3 ✓
- Pré-chargement Klein (`/api/comfyui/warmup` + bouton).
- Pipeline Klein optimisé : negative conditioning réutilise pPos (cfg=1.0), économise une passe Qwen.
- Reroute/Primitive masqués de la palette (réservation à l'export).

## Hors scope (documenté)
- Cache d'encodeur persistant : nécessiterait un custom node ComfyUI.
- PreviewImage n'a pas de poller `temp/` dédié (le résultat s'affiche au run-global, pas per-node).

## Suivi audit technique (P0/P1)

### Sécurité
- SEC-01 — CORS : plus de `Access-Control-Allow-Origin: *` par défaut ; origines locales strictes (`ALLOWED_ORIGINS`) + contrôle `Host` (anti DNS-rebinding).
- SEC-02 — Proxy HTTP : liste blanche d'hôtes (HTTPS Civitai/HF) et refus loopback/privé/link-local, limite de taille.
- SEC-03 — Suppression de modèle : confinement par `commonpath` (`is_within`) et non plus par préfixe.
- SEC-04 — Téléchargement : `safe_download_filename()` réduit le nom distant à un nom de fichier simple + confinement final de la destination.
- `read-header` : chemin confiné à `MODELS_DIR`. `open-folder` : confiné à `COMFYUI_ROOT`/`BASE_DIR`.
- Limite globale du corps des requêtes POST (30 Mo) + upload image (25 Mo).

### Fiabilité ComfyUI
- BUG-01/02 — Générateurs du mode App alignés sur les pipelines réels :
  - Klein : `UNETLoader` + `CLIPLoader(flux2)` + `Flux2Scheduler` + `CFGGuider` + `SamplerCustomAdvanced`.
  - FLUX.1 : `UNETLoader` + `DualCLIPLoader(flux)` + `KSampler` + `VAELoader`.
  - Les noms de modèles sont résolus depuis l'installation (`_pick_installed_model`, préférence `.safetensors`).
- BUG-03 — `validate` n'envoie plus `/interrupt` global : une génération utilisateur n'est plus stoppée.
- BUG-04 — Bornes d'entrée sur `/api/comfyui/generate` : steps 1-80, dimensions 64-2048, CFG 0-30, prompt ≤ 10 000 caractères.

### Tests
- `tests/test_security.py` : 18 tests (chemins, proxy/CORS, noms de fichiers, générateurs de workflows), `tests/run_tests.ps1`.
