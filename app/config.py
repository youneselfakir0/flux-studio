"""Configuration centralisee pour Flux Studio.

Les valeurs peuvent etre surchargees par variables d'environnement :
- FLUX_COMFYUI_ROOT : racine ComfyUI (defaut F:\\f\\ComfyUI)
- FLUX_PORT : port HTTP (defaut 8080)
- FLUX_DB_PATH : chemin SQLite (defaut data/flux_studio.db)
"""
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

COMFYUI_ROOT = os.environ.get("FLUX_COMFYUI_ROOT", r"F:\f\ComfyUI")
PORT = int(os.environ.get("FLUX_PORT", "8080"))
DB_PATH = os.environ.get("FLUX_DB_PATH", os.path.join(BASE_DIR, "data", "flux_studio.db"))
THUMB_CACHE_DIR = os.path.join(BASE_DIR, "data", "thumb_cache")