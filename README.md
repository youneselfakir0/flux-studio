# Flux Studio v2

Studio local (Windows) pour gérer une base de prompts Civitai (femmes IA, NSFW jusqu'à X) et piloter ComfyUI (RTX 3060 12 Go) avec un éditeur nodal, des workflows one-click et une palette LoRA instantanée.

- **Frontend** : SPA vanilla JS (pas de framework), design dark studio pro (tokens Stitch).
- **Backend** : Python `ThreadingHTTPServer` (port 8080) + bridge ComfyUI (port 8188).
- **Vision** : Gemini API (`gemini-3.1-flash-lite`).
- **LoRA** : 475 indexés, recherche < 1 ms, Ctrl+K.

## Prérequis

- Windows 10/11
- Python 3.11+
- ComfyUI installé dans `F:\f\ComfyUI` (ou ajuster `COMFYUI_ROOT` dans `app/server.py`)
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
GEMINI_API_KEY=...        # Google AI Studio
CIVITAI_TOKEN=...         # Civitai API token
GEMINI_MODEL=gemini-3.1-flash-lite
```

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
- Recherche Civitai + téléchargement one-click vers le bon dossier.

## Pipelines validés

- **FLUX.2 Klein** (4 steps distillé) : `CLIPLoader(qwen_3_4b, type=flux2)` + `Flux2Scheduler` + `CFGGuider` + `SamplerCustomAdvanced`
- **FLUX.1 Dev** (24 steps)
- **SDXL** (24 steps), SD 1.5, LTX Video, Z-Image, Qwen

## Points techniques importants

- **VRAM 12 Go** : le frontend auto-libère la VRAM si insuffisante avant un run, et détecte la VRAM faible au démarrage.
- **Séparateurs Windows** : le serveur lit les combos depuis `/object_info` (jamais depuis le disque), pour éviter les erreurs `Value not in list`.
- **Empty string widgets** envoyés à ComfyUI (inputs requis).
- **`/api/comfyui/queue`** en lecture seule (interrompait le job en cours).
- **PowerShell** : pas de `jq`, pas de heredocs. `Set-Content -Encoding UTF8` corrompt l'UTF-8 → utiliser Python ou l'outil `edit`.

## Structure du repo

```
flux-studio/
├── app/
│   ├── server.py              # API + bridge ComfyUI
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
├── design/                    # maquettes Stitch
├── .env.example
└── .gitignore
```

## Licence

Projet personnel — usage local.

---

*Généré le 17/10/2026.*