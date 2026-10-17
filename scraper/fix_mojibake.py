"""Repare le mojibake UTF-8.span par span, sans casser le texte valide."""
import os
import re
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = r"C:\Users\administrator\flux-studio\app\static"
EXT = {".js", ".html", ".css", ".json"}

# Un run suspect = un caractere "lead" suivi d'un octet UTF-8 casse.
# Attention : i-grave / i-diaerese / e-circonflexe sont du francais LEGITIME.
# On ne les declenche que s'ils sont suivis d'un AUTRE octet >= 0x80
# (le francais valide est suivi d'une lettre ASCII : "maitre", "noel").
LEAD = "\u00c2\u00c3\u00e2\u00e3\u00e4\u00e5\u00e8\u00e9\u00ea\u00eb\u00ec\u00ed\u00ee\u00ef" \
       "\u00f2\u00f3\u00f4\u00f5\u00f8\u00f9\u00fa\u00fb\u00fc"
# 2e octet UTF-8 : Latin-1 (80-BF) + supplement (A0-FF) + plage cp1252
# (em-dash = 20AC en cp1252 -> "â€”") + ligatures/marques de ponctuation.
TAIL = (r"\u0080-\u00bf\u00a0-\u00ff\u2000-\u20ff\u2100-\u21ff"
        r"\u0152\u0153\u0160\u0161\u0178\u017d\u017e")
RUN = re.compile(f"[{LEAD}][{TAIL}](?:[{TAIL}]|(?=[{LEAD}]))*")


def repair_run(run):
    for codec in ("latin-1", "cp1252"):
        try:
            out = run.encode(codec).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        # Un vrai mot francais ne doit pas contenir de marque de controle
        if not re.search(r"[\u0080-\u009f\u0000-\u0008]", out):
            return out
    return None


DRY = "--apply" not in sys.argv
total_spans, total_files = 0, 0
for root, _dirs, files in os.walk(ROOT):
    for fn in files:
        if os.path.splitext(fn)[1] not in EXT:
            continue
        p = os.path.join(root, fn)
        with open(p, "r", encoding="utf-8-sig") as f:
            raw = f.read()
        txt = raw.lstrip("\ufeff")
        bom = raw != txt
        if bom and not DRY:
            pass  # ecrit plus bas sans BOM
        if not RUN.search(txt) and not bom:
            continue

        changed, used, failed, samples = txt, 0, 0, []
        for m in list(RUN.finditer(txt)):
            fixed = repair_run(m.group(0))
            if fixed is None:
                failed += 1
                samples.append(m.group(0))
                continue
            changed = changed.replace(m.group(0), fixed)
            used += 1

        if used or bom:
            if not DRY:
                with open(p, "w", encoding="utf-8", newline="") as f:
                    f.write(changed)
            total_spans += used
            total_files += 1
            tag = f"{used} corriges" if used else "BOM retire"
            print(f"  {os.path.relpath(p, ROOT):28} {tag}"
                  + (f", {failed} laisses {samples[:2]}" if failed else ""))
        if failed and not used:
            print(f"  {os.path.relpath(p, ROOT):28} {failed} irreparable(s) : {samples[:3]}")

print(f"\ntotal : {total_spans} spans dans {total_files} fichiers")

# Verification finale
print("\n--- controle final ---")
left = []
for root, _dirs, files in os.walk(ROOT):
    for fn in files:
        if os.path.splitext(fn)[1] not in EXT:
            continue
        p = os.path.join(root, fn)
        with open(p, "r", encoding="utf-8-sig") as f:
            t = f.read()
        if RUN.search(t) or t.startswith("\ufeff"):
            left.append(os.path.relpath(p, ROOT))
print("restants :", left or "aucun")