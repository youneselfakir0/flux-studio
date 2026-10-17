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