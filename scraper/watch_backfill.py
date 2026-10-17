"""Backfill periodique des colonnes male/female tant que le scrape ecrit.

S'arrete automatiquement quand logs/scrape.log ne bouge plus (scrape termine).
Usage : python scraper/watch_backfill.py   (lancer en arriere-plan)
"""
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRAPE_LOG = os.path.join(ROOT, "logs", "scrape.log")
OUT_LOG = os.path.join(ROOT, "logs", "backfill.log")
SCRIPT = os.path.join(ROOT, "scraper", "backfill_flags.py")

INTERVAL = 60          # secondes entre deux passes
IDLE_LIMIT = 3         # passes sans bouger le log -> scrape fini


def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(OUT_LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def main():
    log("surveillance demarree")
    last, idle = 0.0, 0
    while True:
        try:
            m = os.path.getmtime(SCRAPE_LOG)
        except OSError:
            m = 0.0
        if m == last:
            idle += 1
        else:
            idle, last = 0, m
        if idle >= IDLE_LIMIT:
            log("scrape termine (log inchange) -> arret")
            return
        r = subprocess.run([sys.executable, SCRIPT], cwd=ROOT,
                           capture_output=True, text=True)
        tail = (r.stdout or "").strip().splitlines()
        log("backfill: " + (tail[-1] if tail else f"code={r.returncode}"))
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
