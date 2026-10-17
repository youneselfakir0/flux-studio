#!/usr/bin/env python3
"""
Construit data/lora_index.json — index de recherche des LoRA locaux.

Sources disponibles sur la machine :
  • <nom>.safetensors.civitai.json  : base_model, tags, description, sha256
  • <nom>.metadata.json             : nom lisible, trainedWords Civitai, preview, stats
  • <nom>.jpeg / .webp / .png       : vignette

475 LoRA  ->  ~120 Ko d'index. La recherche cote client est un filter sur
un tableau plat : < 1 ms.
"""
import os
import json
import re
import unicodedata

LORAS_DIR = r"F:\f\ComfyUI\models\loras"
OUT = r"C:\Users\administrator\flux-studio\data\lora_index.json"

PREVIEW_EXT = (".jpeg", ".jpg", ".png", ".webp")


def find_preview_path(stem):
    """Chemin absolu de la vignette voisine, ou None."""
    for ext in PREVIEW_EXT:
        if os.path.isfile(stem + ext):
            return stem + ext
    return None


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFKD", str(s or ""))
                   if not unicodedata.combining(c))


def norm(s):
    """Minuscules, sans accents, sans separateurs — pour la recherche."""
    s = strip_accents(s).lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def load_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def clean_html(s):
    if not s:
        return ""
    s = re.sub(r"<[^>]+>", " ", str(s))
    s = s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    s = s.replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", s).strip()


def find_preview(stem):
    for ext in PREVIEW_EXT:
        p = stem + ext
        if os.path.isfile(p):
            return p
        # variantes de casse / nom partiel
        d = os.path.dirname(stem)
        b = os.path.basename(stem)
        for f in os.listdir(d) if os.path.isdir(d) else []:
            if os.path.splitext(f)[0].lower() == b.lower() + os.path.splitext(ext)[1] and f.lower().endswith(ext):
                return os.path.join(d, f)
    return None


def main():
    entries = []
    seen = set()

    for root, _dirs, files in os.walk(LORAS_DIR):
        for fn in files:
            if not fn.lower().endswith(".safetensors"):
                continue
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, LORAS_DIR).replace("\\", "/")
            stem = os.path.splitext(full)[0]

            civ = load_json(stem + ".civitai.json") or {}
            meta = load_json(stem + ".metadata.json") or {}
            meta = meta if isinstance(meta, dict) else {}

            civitai = meta.get("civitai") if isinstance(meta.get("civitai"), dict) else {}

            base = (
                civitai.get("baseModel")
                or civ.get("base_model")
                or meta.get("base_model")
                or ""
            )
            trained = (
                civitai.get("trainedWords")
                or meta.get("trainedWords")
                or []
            )
            if isinstance(trained, str):
                trained = [trained]
            tags = (civitai.get("tags") or civ.get("tags") or meta.get("tags") or [])
            tags = [t for t in tags if isinstance(t, str) and t.strip()]

            display = (
                meta.get("model_name")
                or civitai.get("name")
                or os.path.splitext(fn)[0]
            )
            creator = (civitai.get("creator") or {}).get("username", "") if isinstance(civitai.get("creator"), dict) else ""

            # Variantes de nom utiles pour la recherche
            raw_stem = os.path.splitext(fn)[0]
            variants = {raw_stem}
            # retire les conventions de nommage auto-generees
            for pat in (r"-?\d{8,}", r"-\d{4,}$", r"^[\(\)\[\]\s]+", r"[\(\)\[\]\s]+$",
                        r"-step\d+", r"-0000\d+", r"\bv?\d+(\.\d+)?\b"):
                variants.add(re.sub(pat, "", raw_stem).strip(" -_[]()"))
            variants = {v for v in variants if len(v) > 2}

            trigger = trained[0] if trained else ""

            rec = {
                # `path` = valeur EXACTE attendue par le champ lora_name de
                # ComfyUI. Sous Windows ComfyUI renvoie des separateurs "\"
                # et /prompt refuse toute valeur absente de sa liste.
                "path": rel.replace("/", "\\"),
                # `webPath` = version URL (separateurs "/")
                "webPath": rel,
                "name": os.path.splitext(fn)[0],
                "display": display,
                "base": base or "Inconnu",
                "folder": rel.split("/")[0] if "/" in rel else "",
                "size_kb": round(civ.get("size_kb") or (os.path.getsize(full) / 1024), 1),
                "trigger": trigger,
                "triggers": trained[:8],
                "tags": tags[:14],
                "creator": creator,
                "nsfw": bool(civ.get("nsfw")),
                "content": civ.get("content_class") or "sfw",
                "downloads": (civitai.get("stats") or {}).get("downloadCount", 0) if civitai else 0,
                "rating": (civitai.get("stats") or {}).get("thumbsUpCount", 0) if civitai else 0,
                "has_preview": find_preview_path(stem) is not None,
                "civitai_id": civ.get("version_id") or civitai.get("id"),
                "desc": clean_html(civitai.get("description") or civ.get("description"))[:280],
                "_v": sorted(norm(v) for v in variants),
            }
            # champ de recherche unique
            rec["hay"] = norm(" ".join([
                raw_stem, display, trigger, " ".join(trained),
                " ".join(tags), base, creator,
                " ".join(rec["_v"]),
            ]))
            rec.pop("_v")
            entries.append(rec)
            seen.add(rel)

    # Stats
    by_base, with_trigger, with_preview = {}, 0, 0
    for e in entries:
        by_base[e["base"]] = by_base.get(e["base"], 0) + 1
        if e["trigger"]:
            with_trigger += 1
        if e["has_preview"]:
            with_preview += 1

    out = {
        "generated": int(__import__("time").time()),
        "root": LORAS_DIR,
        "count": len(entries),
        "stats": {
            "by_base": by_base,
            "with_trigger": with_trigger,
            "with_preview": with_preview,
            "without_trigger": len(entries) - with_trigger,
        },
        "items": entries,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Index ecrit : {OUT}")
    print(f"  LoRA      : {len(entries)}")
    print(f"  taille    : {os.path.getsize(OUT)/1024:.0f} Ko")
    print(f"  trigger   : {with_trigger} / {len(entries)}")
    print(f"  preview   : {with_preview}")
    print("\n  Repartition base_model (source: metadonnees, pas dossiers) :")
    for b, n in sorted(by_base.items(), key=lambda x: -x[1]):
        print(f"    {b or 'Inconnu':28} {n}")
    print("\n  Top tags :")
    tags = {}
    for e in entries:
        for t in e["tags"]:
            tags[t] = tags.get(t, 0) + 1
    for t, n in sorted(tags.items(), key=lambda x: -x[1])[:20]:
        print(f"    {t:28} {n}")


if __name__ == "__main__":
    main()