"""Passe la base en WAL + ajoute les index manquants (lecture concurrente pendant le scrape)."""
import os
import sqlite3

DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "flux_studio.db")
conn = sqlite3.connect(DB, timeout=120)
c = conn.cursor()
print("journal_mode ->", c.execute("PRAGMA journal_mode=WAL").fetchone()[0])
c.execute("PRAGMA synchronous=NORMAL")
c.execute("PRAGMA busy_timeout=60000")

idx = [
    "CREATE INDEX IF NOT EXISTS idx_img_created ON images(created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_img_nsfw   ON images(nsfw_level)",
    "CREATE INDEX IF NOT EXISTS idx_img_mv     ON images(model_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_img_nsfwflag ON images(nsfw)",
    "CREATE INDEX IF NOT EXISTS idx_mv_model   ON model_versions(model_id)",
    "CREATE INDEX IF NOT EXISTS idx_mv_base    ON model_versions(base_model)",
    "CREATE INDEX IF NOT EXISTS idx_m_base     ON models(base_model)",
    "CREATE INDEX IF NOT EXISTS idx_m_type     ON models(type)",
]
for s in idx:
    try:
        c.execute(s)
        print("ok:", s.split(" ON ")[1].split("(")[0])
    except Exception as e:
        print("err:", e)
conn.commit()
print("index:", [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")])
conn.close()
