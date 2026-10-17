---
name: flux-studio
description: Développer et maintenir Flux Studio — studio local (Windows) de prompts Civitai pour créer des femmes en IA (NSFW jusqu'à X, XXX exclu) + gestionnaire ComfyUI synchronisé. Utiliser dès qu'on parle de Flux Studio, du navigateur de prompts, du scraper Civitai, des téléchargements LoRA/checkpoint vers F:\f\ComfyUI, des workflows, du safe mode NSFW, ou de l'UI dark studio. Couvre le serveur Python (app/server.py), la base SQLite, le scraper et le design (tokens Stitch).
---

# Flux Studio

Studio local (http://localhost:8080) qui réunit :
1. **Prompts** — base de prompts Civitai réels (femmes uniquement), filtres base model / type / tag / NSFW / femmes.
2. **ComfyUI** — scan des modèles installés, recherche Civitai, téléchargements vers le bon dossier, workflows.
3. **Image → Prompt** — dépose une image, lit les métadonnées + description (Ollama vision si dispo).
4. **Profil** — GPU, volumes, répartition des LoRA.

Le design vient de **Stitch** (projet « Flux Studio », design system « Dark Studio Pro »).

## 0. Avant tout

- Racine projet : `C:\Users\administrator\flux-studio`
- Lancer : `python app\server.py` puis http://localhost:8080
- Base : `data\flux_studio.db` (SQLite)
- ComfyUI : `F:\f\ComfyUI` (models/, user/default/workflows/)
- Token Civitai : en dur dans `app/server.py` (`CIVITAI_TOKEN`) et `scraper/scrape_civitai.py` (`TOKEN`).
- Windows / PowerShell : pas de `&&`, pas de heredoc. Pour du Python inline, écrire un `.py` puis l'exécuter.

## 1. Ce qu'il ne faut jamais casser

- **NSFW** : on va **jusqu'au niveau X inclus**, **XXX toujours exclu**. Niveaux : `1=None, 2=Soft, 3=Mature, 4=X`. Ne jamais introduire XXX.
- **Femmes uniquement** : filtre serveur `men=only` (exclut les hommes via mots-clés et noms de LoRA) ; `men=0` = sans hommes ; `men=""` = tout.
- **Safe mode** : les vignettes `nsfw_level > 1` sont floutées (`body.safe`), révélées au survol. C'est le comportement attendu, ne pas le retirer.
- **Dossier de destination** : chaque téléchargement doit atterrir dans le bon sous-dossier de `models/` (checkpoints, loras, vae…).
- **Bases canoniques** : l'UI ne doit montrer que les groupes de l'utilisateur (Flux.2 Klein 4B, Flux.1 D, SDXL, Pony, Illustrious, NoobAI, SD 1.5, Qwen, Z-Image, LTX Video). La table `ACCEPT` du scraper fait ce mapping.

## 2. Structure

```
flux-studio/
  app/
    server.py            # serveur unique (threading HTTP, port 8080)
    static/
      index.html         # coquille SPA (rail + 4 vues + drawer)
      app.css            # design system "Dark Studio Pro" (tokens Stitch)
      app.js             # logique (vanilla JS)
  data/flux_studio.db    # models, model_versions, images, comfyui_downloads
  scraper/scrape_civitai.py
  scraper/tune_db.py     # WAL + index
  scraper/backfill_flags.py  # colonnes male/female
  design/screens/        # exports Stitch (png + html)
  docs/                  # README, captures
  skill/SKILL.md         # copie de cette skill
```

## 3. API du serveur

| Endpoint | Rôle |
|---|---|
| `GET /api/stats` | compteurs (models, versions, images, nsfw_images) |
| `GET /api/categories` | listes types / base_models / tags |
| `GET /api/images` | prompts ; params `model_id, type, base_model, tag, search, nsfw, nsfw_max, men, limit, offset`. **`nsfw_max` filtre côté SQL** (ne pas filtrer côté client : ça casse la pagination) |
| `GET /api/image?id=<civitai_image_id>` | détail complet d'un prompt |
| `GET /api/proxy?url=<url>` | proxy image (les vignettes Civitai exigent l'auth + Referer) |
| `GET /api/comfyui/local[?force=1]` | scan des modèles/workflows installés (cache 60 s) |
| `GET /api/comfyui/profile` | GPU + counts + lora_by_base |
| `GET /api/comfyui/search` | recherche Civitai ; params `q, type, base, nsfw_max, limit, men, max_gb` |
| `POST /api/comfyui/download` | `{model_id, version_id, file_id}` → lance un téléchargement |
| `GET /api/comfyui/downloads` | file de téléchargements. Statuts serveur : `pending` → `downloading` → `completed` / `error` (l'UI mappe en FR ; ne pas réintroduire `done`) |
| `POST /api/comfyui/save_workflow` | `{name, workflow}` → écrit `F:\f\ComfyUI\user\default\workflows\<name>.json` |
| `POST /api/comfyui/describe` | upload `multipart/form-data` (champ `file`) ; header `X-AI-Describe: 1` pour Ollama. **`info.ai` est un objet `{available, description\|error}`**, pas une string : tester `ai.available` avant l'affichage |
| `GET /api/comfyui/ollama` | modèles vision disponibles |

## 4. Design system (tokens Stitch)

- Fonds : `--bg #0c0e11`, `--surface #111317`, `--surface-2 #1e2023`, `--surface-3 #26282c`
- Accents : `--primary-container #947dff`, `--accent #00eefc`, `--tertiary #4edea3`
- NSFW : none `#10b981`, soft `#f59e0b`, mature `#f97316`, x `#ef4444`
- Polices : **Space Grotesk** (titres), **Inter** (texte), **JetBrains Mono** (code)
- Rayons : `--r-sm 8`, `--r-md 12`, `--r-lg 16`, `--r-xl 22`, plein `999`
- Tout est centralisé en tête de `app/static/app.css` dans `:root`. Modifier là d'abord.

## 4b. Régénérer le design (Stitch MCP)

Projet Stitch : `projects/2383638101138649318` · design system `assets/0702ce610ecb4cc482c73fe113669b9d`.
- `tools.stitch.generate_screen_from_text({projectId, prompt, deviceType:"DESKTOP", designSystem})`
- `tools.stitch.get_screen({name})` → `screenshot.downloadUrl` + `htmlCode.downloadUrl`
- `tools.stitch.list_screens` / `edit_screens` / `generate_variants`

## 5. Scraper

`python scraper/scrape_civitai.py` (relançable, `INSERT OR IGNORE`). 3 phases : feed global, modèles par base, versions. Points durs :
- `/images` n'a pas de `totalItems` → paginer via `metadata.nextCursor`.
- `meta` n'est renvoyé **que** si `withMeta=true`, et **disparaît** dès qu'un filtre `modelId`/`modelVersionId` est présent → utiliser `model-versions/<id>` pour ces cas.
- Bases réelles Civitai : `ZImageTurbo` (pas « Z-Image »), `LTXV 2.3/2.5` (pas « LTX Video »), `Qwen 2.1` (pas « Qwen Image »).
- NSFW : `nsfw=X` = jusqu'à X ; rejeter `browsingLevel & 16` (XXX).
- Prompt ComfyUI : `meta["comfy"]` (JSON) → suivre les liens jusqu'à `CLIPTextEncode.text` / `SDXLPromptStyler.text_positive`.

## 6. Vérification rapide

```powershell
python -m py_compile app\server.py scraper\scrape_civitai.py
node --check app\static\app.js
# puis
Invoke-WebRequest http://localhost:8080/api/stats -UseBasicParsing | Select-Object -Expand Content
```

**Redémarrer seulement le serveur** (ne jamais tuer tous les python : le scrape tourne en parallèle) :

```powershell
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -like "*app\server.py*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process python -ArgumentList "app\server.py" -WindowStyle Hidden `
  -RedirectStandardOutput "app\server.out" -RedirectStandardError "app\server.err"
```

## 7. Maintenance de la base

- `python scraper/tune_db.py` — passe la base en **WAL** + crée les index manquants (`images` n'en avait aucun).
- `python scraper/backfill_flags.py` — (re)calcule les colonnes `images.male` / `images.female` avec les **mêmes regex** que le serveur. À relancer après un scrape (les nouvelles lignes arrivent à `NULL`, ce qui re-déclenche l'UDF à chaque requête et ralentit `/api/images`).
- Perf mesurée : requête `men=only` ≈ 160–260 ms à chaud ; 2–3 s = attente du verrou d'écriture du scraper. `/api/images` doit rester **paginé côté SQL** (`LIMIT/OFFSET`, filtre `nsfw_max`, `COALESCE(colonne, UDF)`).
- Pièges données : quelques images ont `steps` absurdes (ex. `8e13`) → `/api/stats` borne à `1..200`.
