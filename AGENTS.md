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

## Commandes

- Lancer ComfyUI (terminal 1) :
  ```powershell
  cd F:\f\ComfyUI
  .venv\Scripts\python.exe main.py --listen 127.0.0.1 --port 8188 --enable-cors-header
  ```
- Lancer Flux Studio (terminal 2) :
  ```powershell
  cd C:\Users\administrator\flux-studio
  python app\server.py
  ```
- Ouvrir : http://localhost:8080
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

- Chemins avec `/` dans le code envoyé au serveur, jamais `\`.
- Les combos de modèles sont lus depuis `/object_info` (jamais depuis le disque) pour éviter les erreurs `Value not in list`.

## Critères "Done"

- Le mode App charge sans erreur console.
- Un prompt génère via `klein_workflow.json`.
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
