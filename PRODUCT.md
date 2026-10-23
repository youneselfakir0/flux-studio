# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Créateur solo (l'utilisateur) sur une station Windows (Core, RTX 3060 12 Go). Génère des images IA de personnages féminins (NSFW jusqu'au niveau X) avec ComfyUI, piloté depuis un navigateur local. Pas de compte, pas de multi-utilisateur : une seule personne, sur sa machine.

## Product Purpose

Flux Studio est un studio local « asset-first » pour piloter ComfyUI : gérer une base de prompts Civitai, une palette de LoRAs, un navigateur de modèles, et générer des images soit par un éditeur nodal (Mode Workflow) soit par une interface simplifiée (Mode App). L'objectif est de rendre la production d'images répétable et rapide sur 12 Go de VRAM, sans passer par le cloud.

## Positioning

Studio local asset-first : les LoRAs et les modèles sont des entrées de premier plan ; le graphe ComfyUI est un détail d'implémentation géré par l'application. Mono-utilisateur, offline-first, sans budget GPU cloud. Différenciant par rapport aux interfaces nodales génériques : la LoRA palette (recherche < 1 ms, Ctrl+K) et le Mode App (génération one-click sans toucher aux nœuds).

## Operating Context

- OS : Windows 11, GPU NVIDIA RTX 3060 12 Go.
- ComfyUI tourne localement sur le port 8188 (`F:\f\ComfyUI`), CORS restreint à `http://127.0.0.1:8080`.
- Flux Studio tourne sur le port 8080 (`ThreadingHTTPServer`, bind 127.0.0.1 par défaut).
- Données locales : `data/lora_index.json` (475 LoRAs), `data/flux_studio.db` (SQLite, prompts Civitai, vide tant que le scraper n'a pas tourné), `data/klein_workflow.json`.
- Vision : API Gemini (`gemini-3.1-flash-lite`) pour la description d'image.
- Scraping Civitai : optionnel, nécessite `CIVITAI_TOKEN`.

## Capabilities and Constraints

**Capacités actuelles**
- Mode Workflow : éditeur nodal, undo/redo, validation sans polluer la file, pré-chargement/libération VRAM.
- Mode App : génération one-click (modèle, prompt, taille, steps, CFG, seed, LoRA).
- Galerie Civitai : découverte, filtres NSFW (niveaux 1-4, Safe strictest-wins) et de genre (men).
- Palette LoRA : recherche instantanée, filtre par base active, Ctrl+K.
- Navigateur de modèles : installation, scan, gestion checkpoints/VAE/UNET.
- Prompt Studio : CRUD de templates, recherche, tags, injection vers le Mode App.
- Vision (drop d'image) : description Gemini + envoi au workflow.
- Gouvernance NSFW globale : toggle Safe et étiquetage des assets.

**Capacité à construire**
- Générateur de prompts à partir de l'index LoRA local (475 entrées avec triggers et tags) : assembler des prompts en combinant les triggers des LoRAs sélectionnés, les tags et une base textuelle.

**Contraintes techniques (durables)**
- VRAM 12 Go : appels `/free` automatiques lors des swaps de modèles lourds.
- Frontend vanilla JS ES6+ uniquement, aucun framework.
- Backend Python `ThreadingHTTPServer`, port 8080.
- CORS restreint, jamais `*`.
- Mono-utilisateur local, aucune donnée cloud pour les prompts/LoRAs.
- Pas de système de profil/compte.
- Préférences dans `localStorage` (client) ou `data/preferences.json` (serveur).
- Encodage UTF-8 : écrire via Python ou l'outil d'édition, jamais `Set-Content -Encoding UTF8`.

## Brand Commitments

Nom : Flux Studio. Aesthetic « Dark Studio Pro » documentée dans `DESIGN.md` et `.impeccable/design.json` (violet électrique #7c5cff, cyan néon #00f0ff, obsidian #0b0d10). Les tokens visuels sont la source de vérité côté UI.

## Evidence on Hand

- `data/lora_index.json` : 475 LoRAs indexés (triggers, tags, base, civitai_id, preview).
- `data/flux_studio.db` : schéma SQLite pour les prompts Civitai (tables models, model_versions, images, comfyui_downloads) — vide, à peupler par `scraper/scrape_civitai.py`.
- `data/klein_workflow.json` : payload ComfyUI valide (FLUX.2 Klein).
- `DESIGN.md` + `.impeccable/design.json` : design system.
- `docs/REPORT.md`, `docs/TODO.md`, `docs/PLAN_CORRECTION.md`.

## Product Principles

1. Asset-first : les LoRAs et modèles sont des entrées de premier plan ; le graphe est un détail d'implémentation.
2. Local-first : tout tourne sur la machine de l'utilisateur, sans cloud GPU.
3. VRAM-aware : chaque opération lourde libère la VRAM automatiquement.
4. Vérification par mesure : un agent qui dit « OK » n'est pas une preuve ; on vérifie l'artefact.
5. Gouvernance NSFW de premier plan : sécurité et étiquetage comme fonctionnalités à part entière.

## Accessibility & Inclusion

- Gouvernance NSFW : toggle Safe (niveau le plus strict gagne), niveaux 1-4, filtre de genre (men).
- Aucune norme d'accessibilité externe (WCAG) n'a été établie comme exigence produit à ce jour ; à confirmer.