"""Ajoute les colonnes male/female a `images` et les pre-calcule (au lieu du UDF a chaque requete)."""
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "app"))
from server import has_male, has_female  # regex exactes, reutilisees

DB = os.path.join(ROOT, "data", "flux_studio.db")
conn = sqlite3.connect(DB, timeout=120)
c = conn.cursor()

cols = [r[1] for r in c.execute("PRAGMA table_info(images)")]
if "male" not in cols:
    c.execute("ALTER TABLE images ADD COLUMN male INTEGER")
if "female" not in cols:
    c.execute("ALTER TABLE images ADD COLUMN female INTEGER")
conn.commit()

rows = c.execute(
    "SELECT id, positive_prompt, negative_prompt, resources FROM images "
    "WHERE male IS NULL OR female IS NULL"
).fetchall()
for i, (rid, pos, neg, res) in enumerate(rows, 1):
    c.execute("UPDATE images SET male=?, female=? WHERE id=?",
              (has_male(pos, neg, res), has_female(pos, neg, res), rid))
    if i % 1000 == 0:
        conn.commit()
        print("  ...", i)
conn.commit()
c.execute("CREATE INDEX IF NOT EXISTS idx_img_female ON images(female)")
c.execute("CREATE INDEX IF NOT EXISTS idx_img_male   ON images(male)")
conn.commit()
print("traitees:", len(rows))
print("female=1:", c.execute("SELECT count(*) FROM images WHERE female=1").fetchone()[0])
print("male=1  :", c.execute("SELECT count(*) FROM images WHERE male=1").fetchone()[0])
print("total   :", c.execute("SELECT count(*) FROM images").fetchone()[0])
conn.close()
