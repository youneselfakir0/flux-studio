# AGENTS.md — Flux Studio v2

## Structure réelle du repo

```
flux-studio/
├── app/
│   ├── server.py              # API + bridge ComfyUI (port 8080)
│   └── static/
│       ├── v2/                # SPA v2 (main.js, editor.css, vision.css)
│       ├── core/              # api, state, storage, events
│       ├── editor/            # graphe nodal (graph.js, canvas.js, palette.js, inspector.js)
│       ├── nodes/             # registre + catalogue
│       ├── workflows/         # builder + catalog + quickstart + library + templates
│       ├── loras/             # palette + UI
│       ├── gallery/           # galerie Civitai
│       ├── models/            # browser
│       └── canvas/            # éditeur 2D
├── data/
│   ├── lora_index.json        # 475 LoRA
│   ├── klein_workflow.json    # payload ComfyUI valide (FLUX.2 Klein)
│   └── flux_studio.db         # SQLite (prompts Civitai)
├── docs/
│   ├── REPORT.md
│   ├── TODO.md
│   └── PLAN_CORRECTION.md
├── scraper/                   # scripts de scraping/indexation
├── design/                    # maquettes Stitch
├── .env.example
└── .gitignore
```

## Lancement

- ComfyUI (terminal 1) :
  ```
  cd <chemin-ComfyUI>
  .venv\Scripts\python.exe main.py --listen 127.0.0.1 --port 8188 --enable-cors-header http://127.0.0.1:8080
  ```
- Flux Studio (terminal 2, depuis la racine du repo) :
  ```
  python app/server.py
  ```
- Ouvrir : http://localhost:8080
- Le serveur bind sur 127.0.0.1 par défaut (jamais 0.0.0.0 sans flag --host explicite).
- ComfyUI : CORS restreint à http://127.0.0.1:8080, jamais `*`.

## Commandes

- Vérifier ComfyUI : `curl http://127.0.0.1:8188/object_info`

## Conventions

- Frontend : Vanilla JS ES6+ uniquement, pas de framework.
- Backend : Python `ThreadingHTTPServer` (port 8080).
- Pas de `jq`, pas de heredocs sous PowerShell. Utiliser Python ou l'outil `edit` pour modifier des fichiers.
- `Set-Content -Encoding UTF8` corrompt l'UTF-8 : utiliser Python ou l'outil `edit`.

- **Pas de système de profil/compte.** App mono-utilisateur locale.
- **Préférences dans `localStorage` (client) ou `data/preferences.json` (serveur).**
- **Topbar = Logo, TabGroup, ToggleAdvanced, VramIndicator, IconFolder, IconLogs, IconSettings.**
- **Ne jamais ajouter de login, avatar, ou écran "compte".**

## Fichiers critiques à ne pas casser

- `app/server.py` — API + bridge ComfyUI
- `data/klein_workflow.json` — payload ComfyUI valide (ne pas modifier sans validation explicite)
- `data/lora_index.json` — 475 LoRA (ne pas réécrire sans raison)
- `data/preferences.json` — préférences utilisateur (optionnel, sinon localStorage)

## ComfyUI

- `/api/comfyui/queue` est en **lecture seule**. Ne jamais écrire dedans (interrompt le job en cours).
- Toute exécution passe par `POST /prompt` (via `/api/comfyui/run` ou `comfy_run`).
- Interruption explicite via `POST /api/comfyui/interrupt`.

## Windows

- Chemins de fichiers locaux : `/` dans le code envoyé au serveur.
- Valeurs de combo (modèles, VAEs, LoRAs) : envoyées TELLES QUELLES depuis /object_info, jamais transformées (sinon `Value not in list`).
- Fallback disque de comfy_models_list : documenté, limité aux extensions valides (.safetensors, .ckpt), ne jamais exposer un fichier absent de /object_info si une option existe.
- Les combos de modèles sont lus depuis `/object_info` (jamais depuis le disque) pour éviter les erreurs `Value not in list`.

## Critères "Done"

- Done (fixture) : `klein_workflow.json` exécuté tel quel via `/prompt` → image OK.
- Done (App) : prompt saisi dans l'UI + Générer → job visible dans `/queue` → image dans la galerie.
- Les deux sont des checks séparés.
- `init_db()` crée TOUTES les tables utilisées par les endpoints (pas seulement comfyui_downloads).
- Fresh clone : `rm data/flux_studio.db && python app/server.py` boote sans 500 sur /api/stats.
- Le mode App charge sans erreur console.
- Ctrl+K reste instantané sur 475 LoRAs.
- Aucune régression sur le mode Workflow nodal.

## Règles Figma MCP

Flux obligatoire : `get_design_context` → `get_screenshot` → validation visuelle → implémentation.
- Utiliser les composants existants, jamais de hardcode de couleurs.
- Suivre les tokens de `editor.css` / `vision.css`.

## Règles Stitch MCP

Si un design system existe au niveau projet, ne **jamais** inclure couleurs/polices/tokens dans le prompt de génération.
Le prompt décrit uniquement structure/layout/contenu.
Si aucun design system projet n'existe, déléguer d'abord au skill `manage-design-system`.
