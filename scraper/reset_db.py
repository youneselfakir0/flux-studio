"""Remet a zero les tables de donnees (garde comfyui_downloads)."""
import os
import sqlite3

DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "flux_studio.db")
conn = sqlite3.connect(DB, timeout=60)
c = conn.cursor()
for t in ("images", "model_versions", "models"):
    c.execute("DELETE FROM " + t)
    print("vide:", t)
conn.commit()
c.execute("VACUUM")
conn.commit()
print("--- compteurs ---")
for t in ("models", "model_versions", "images", "comfyui_downloads"):
    print(t, c.execute("SELECT count(*) FROM " + t).fetchone()[0])
conn.close()
