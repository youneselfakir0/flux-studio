# Flux Studio

Studio local (Windows) pour **créer des femmes en IA** : base de prompts Civitai réels
(femmes uniquement, NSFW jusqu'au niveau **X**, **XXX exclu**) + gestionnaire **ComfyUI**
synchronisé avec `F:\f\ComfyUI`.

Interface : **SPA vanilla** (aucun framework), thème **« Dark Studio Pro »** généré avec
**Stitch**. Serveur unique en Python (bibliothèque standard).

---

## Démarrage

```powershell
cd C:\Users\administrator\flux-studio
python app\server.py
# -> http://localhost:8080
```

## Fonctionnalités

| Vue | Contenu |
|---|---|
| **Prompts** | grille de prompts Civitai · filtres base model / type / tag · `♀ Femmes seulement` · niveau NSFW max · copie du prompt ou du prompt complet · détail (prompt + négatif + paramètres + ressources) · enregistrement du workflow dans ComfyUI |
| **ComfyUI** | scan des modèles installés (rapide), recherche Civitai, téléchargement vers le bon dossier `models/…`, file de téléchargements avec progression, liste des workflows |
| **Image → Prompt** | dépôt d'image → métadonnées lues (PNG/EXIF) + description Ollama si un modèle vision est disponible |
| **Profil** | GPU + VRAM, volumes, répartition des LoRA par base, préférences |

**NSFW** : collecte jusqu'à **X**, jamais XXX (`browsingLevel & 16` rejeté). Badges colorés
(None/Soft/Mature/X). **Safe mode** : les vignettes NSFW sont floutées jusqu'au survol.

## Structure

```
flux-studio/
  app/
    server.py            # serveur HTTP unique (port 8080)
    static/              # index.html · app.css · app.js
  data/flux_studio.db    # base SQLite
  scraper/scrape_civitai.py
  design/
    DESIGN.md            # tokens de design (Stitch)
    screens/             # exports Stitch (PNG + HTML)
  docs/                  # captures
  skill/SKILL.md         # skill agent
```

## API

Voir `../.agents/skills/flux-studio/SKILL.md` (§3) ou le tableau complet dans le README de
la skill. En bref : `/api/images`, `/api/image`, `/api/stats`, `/api/categories`,
`/api/proxy`, `/api/comfyui/{local,profile,search,downloads,download,describe,ollama,save_workflow}`.

## Scraper

```powershell
python scraper\scrape_civitai.py
```

Relançable sans doublon. Voir la skill pour les pièges de l'API Civitai
(`withMeta=true`, `model-versions/<id>`, `nextCursor`, noms de bases réels).

## Design

Le design system vient du projet Stitch **Flux Studio**
(`projects/2383638101138649318`, design system `Dark Studio Pro`).
Les tokens sont centralisés dans `:root` au début de `app/static/app.css`.

| Token | Valeur |
|---|---|
| Fond | `#0c0e11` |
| Surface / Surface-2 | `#111317` / `#1e2023` |
| Primaire | `#cabeff` / `#947dff` / `#603ce2` |
| Accent | `#00eefc` |
| Polices | Space Grotesk · Inter · JetBrains Mono |
| NSFW | none `#10b981` · soft `#f59e0b` · mature `#f97316` · x `#ef4444` |
