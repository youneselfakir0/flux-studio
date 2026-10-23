"""Configuration centralisee pour Flux Studio.

Les valeurs peuvent etre surchargees par variables d'environnement :
- FLUX_COMFYUI_ROOT : racine ComfyUI (defaut F:\\f\\ComfyUI)
- FLUX_PORT : port HTTP (defaut 8080)
- FLUX_DB_PATH : chemin SQLite (defaut data/flux_studio.db)
- FLUX_MAX_GENERATE / FLUX_MAX_DOWNLOADS / FLUX_MAX_VISION :
  plafonds de taches lourdes simultanees (defaut 2)
- FLUX_MAX_PROXY / FLUX_MAX_SCAN : plafonds reseau/scan (defaut 8 / 1)
- FLUX_MAX_CONNECTIONS : connexions HTTP simultanees (defaut 64)
"""
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

COMFYUI_ROOT = os.environ.get("FLUX_COMFYUI_ROOT", r"F:\f\ComfyUI")
PORT = int(os.environ.get("FLUX_PORT", "8080"))
DB_PATH = os.environ.get("FLUX_DB_PATH", os.path.join(BASE_DIR, "data", "flux_studio.db"))
THUMB_CACHE_DIR = os.path.join(BASE_DIR, "data", "thumb_cache")


def _env_int(name, default):
    """Lit un entier positif ; retombe sur la valeur par defaut si invalide."""
    try:
        return max(1, int(os.environ.get(name, str(default))))
    except (TypeError, ValueError):
        return default


MAX_CONCURRENT_GENERATE = _env_int("FLUX_MAX_GENERATE", 2)
MAX_CONCURRENT_DOWNLOADS = _env_int("FLUX_MAX_DOWNLOADS", 2)
MAX_CONCURRENT_VISION = _env_int("FLUX_MAX_VISION", 2)
MAX_CONCURRENT_PROXY = _env_int("FLUX_MAX_PROXY", 8)
MAX_CONCURRENT_SCAN = _env_int("FLUX_MAX_SCAN", 1)
MAX_CONCURRENT_CONNECTIONS = _env_int("FLUX_MAX_CONNECTIONS", 64)
