# Flux Studio v2

Documentation publique : [présentation du projet](https://youneselfakir0.github.io/flux-studio/) · [guide pas à pas](https://youneselfakir0.github.io/flux-studio/guide.html)

Studio local (Windows) pour gérer une base de prompts Civitai (femmes IA, NSFW jusqu'à X) et piloter ComfyUI (RTX 3060 12 Go) avec un éditeur nodal, des workflows one-click et une palette LoRA instantanée. C’est aussi un terrain de pratique de l’IA appliquée au soutien informatique, en explorant la fiabilité des intégrations et les connexions entre outils.

- **Frontend** : SPA vanilla JS (pas de framework), design dark studio pro (tokens Stitch).
- **Backend** : Python `ThreadingHTTPServer` (port 8080) + bridge ComfyUI (port 8188).
- **Vision** : Gemini API (`gemini-3.1-flash-lite`).
- **LoRA** : 475 indexés, recherche < 1 ms, Ctrl+K.

## Prérequis

- Windows 10/11
- Python 3.11+
- ComfyUI installé dans `F:\f\ComfyUI` (ou configurer `COMFYUI_ROOT` dans `.env`)
- NVIDIA GPU (12 Go VRAM recommandé ; 8 Go minimum pour SDXL)
- (optionnel) ComfyUI-Manager pour le custom node de cache

## Installation

```powershell
git clone https://github.com/youneselfakir0/flux-studio.git
cd flux-studio

# Dépendances Python (backend)
pip install -r requirements.txt  # si présent, sinon : aucune dépendance externe requise

# Lancer ComfyUI (terminal 1)
cd F:\f\ComfyUI
.venv\Scripts\python.exe main.py --listen 127.0.0.1 --port 8188 --enable-cors-header

# Lancer Flux Studio (terminal 2)
cd C:\Users\administrator\flux-studio
python app\server.py
```

Ouvrir http://localhost:8080.

## Variables d'environnement

Copier `.env.example` en `.env` et renseigner :

```
FLUX_STUDIO_PORT=8080
FLUX_STUDIO_DATA_DIR=        # optionnel ; dossier par défaut : ./data
FLUX_STUDIO_DB_PATH=         # optionnel ; ./data/flux_studio.db par défaut
FLUX_STUDIO_THUMB_CACHE_DIR= # optionnel ; ./data/thumb_cache par défaut
COMFYUI_ROOT=F:\f\ComfyUI
COMFYUI_URL=http://127.0.0.1:8188
GEMINI_API_KEY=...        # Google AI Studio
CIVITAI_TOKEN=...         # Civitai API token
GEMINI_MODEL=gemini-3.1-flash-lite
```

Les variables du processus prennent priorité sur `.env`. Le serveur écoute sur
`127.0.0.1` par défaut ; l'option `--host` reste nécessaire pour choisir une
adresse d'écoute différente.

Sous Windows PowerShell, avant de lancer :

```powershell
$env:GEMINI_API_KEY = "..."
$env:CIVITAI_TOKEN = "..."
```

Sans ces variables, la description d'image et le scraping Civitai sont désactivés, le reste fonctionne.

## Custom node (cache d'encodeur)

Pour activer le cache de conditioning (gain ~30s sur FLUX.2 Klein / SDXL répétés) :

1. Copier le dossier `custom_nodes/flux_studio_cache/` (fourni dans le repo sous `comfyui_custom_nodes/flux_studio_cache/` si présent, sinon recréer depuis `docs/`) dans `F:\f\ComfyUI\custom_nodes\`.
2. Redémarrer ComfyUI.
3. Vérifier dans les logs : `FluxStudioCachedConditioning` apparaît dans `/object_info`.

Le frontend détecte automatiquement le nœud au boot et bascule les workflows dessus.

## Utilisation

### Mode Workflow (nodal)
- Onglet **Workflow** : éditeur nodal type InvokeAI.
- **Ctrl+K** : palette LoRA (recherche instantanée, filtre par base active).
- **Ctrl+Z / Ctrl+Y** : undo/redo.
- **Ctrl+Enter** : exécuter le graphe.
- Bouton **✓ Valider** : valide sans polluer la file ComfyUI.
- Bouton **🔥 Pré-charge** : charge le modèle en VRAM en arrière-plan.
- Bouton **🧹 Libérer** : décharge les modèles (VRAM).

### Mode App (simple)
- Onglet **App** : pas de nœuds. Choix modèle, prompt, taille, steps, CFG, seed, LoRA. Bouton Générer.
- **Depuis une image** : drop d'image anywhere → vision sheet (description Gemini + envoi au workflow).

### Galerie
- Prompts Civitai réels, filtres base/NSFW/genre.
- Queue de génération avec exécution réelle ComfyUI + polling.

### Modèles
- Scanner local (`↻ Rescan`) des modèles installés dans ComfyUI.
- Recherche Civitai + téléchargement one-click vers le bon dossier (limite de 25 Gio par fichier ; l'espace libre est réservé entre téléchargements concurrents, jusqu'à 25 Gio si la taille est inconnue ; les modèles et métadonnées existants ne sont pas écrasés).

## Pipelines validés

- **FLUX.2 Klein** (4 steps distillé) : `CLIPLoader(qwen_3_4b, type=flux2)` + `Flux2Scheduler` + `CFGGuider` + `SamplerCustomAdvanced`
- **FLUX.1 Dev** (24 steps)
- **SDXL** (24 steps), SD 1.5, LTX Video, Z-Image, Qwen

## Tests de régression

Les tests locaux n'ont pas besoin de ComfyUI ni de GPU :

```powershell
python -m unittest discover -s tests -v
node --test tests_js\graph.test.mjs
```

## Points techniques importants

- Les erreurs API gardent un statut HTTP et renvoient `ok: false`, `error`,
  `code` et `details`. Le client partagé les expose comme `ApiError` ; une
  indisponibilité ComfyUI n'est pas présentée comme une file vide. Les entrées
  invalides renvoient 400, les ressources absentes 404 et les dépendances
  indisponibles 502/503. L'état d'une génération terminée en erreur reste une
  réponse 200 de l'endpoint d'historique, car la requête d'état a réussi.
- **VRAM 12 Go** : le frontend auto-libère la VRAM si insuffisante avant un run, et détecte la VRAM faible au démarrage.
- **Séparateurs Windows** : le serveur lit les combos depuis `/object_info` (jamais depuis le disque), pour éviter les erreurs `Value not in list`.
- **Empty string widgets** envoyés à ComfyUI (inputs requis).
- **`/api/comfyui/queue`** en lecture seule (interrompait le job en cours).
- **PowerShell** : pas de `jq`, pas de heredocs. `Set-Content -Encoding UTF8` corrompt l'UTF-8 → utiliser Python ou l'outil `edit`.

## Structure du repo

```
flux-studio/
├── app/
│   ├── config.py              # configuration locale et variables d'environnement
│   ├── database.py            # schema SQLite et requêtes catalogue
│   ├── server.py              # routes API HTTP et bootstrap
│   ├── comfyui.py             # bridge ComfyUI, modèles, génération et workflows
│   ├── civitai.py             # recherche et téléchargements Civitai
│   ├── vision.py              # métadonnées d'images, Gemini et Ollama
│   └── static/
│       ├── v2/                # SPA v2 (main.js, editor.css, vision.css)
│       ├── editor/            # graphe nodal
│       ├── nodes/             # registre + catalogue
│       ├── workflows/         # builder + catalog + quickstart
│       ├── loras/             # palette + UI
│       ├── gallery/           # galerie Civitai
│       ├── models/            # browser
│       └── core/              # api, state, storage, events
├── data/
│   ├── lora_index.json        # 475 LoRA
│   └── klein_workflow.json    # payload validé
├── docs/
│   ├── REPORT.md
│   ├── TODO.md
│   └── PLAN_CORRECTION.md
├── scraper/                   # scripts de scraping/indexation
├── tests/                     # tests API/configuration (unittest)
├── tests_js/                  # tests graph et flux d'exécution (node:test)
├── design/                    # maquettes Stitch
├── .env.example
└── .gitignore
```

## Licence

Projet personnel — usage local.

---

*Généré le 17/10/2026.*