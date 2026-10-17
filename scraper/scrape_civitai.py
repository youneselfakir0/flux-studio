#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Scrape REEL Civitai -> C:\\Users\\administrator\\flux2_klein_4b_prompts.db

Bases = celles installees chez l'utilisateur :
    Flux.2 Klein 4B, Flux.1 D, SDXL (+Pony/Illustrious/NoobAI),
    SD 1.5, Qwen 2.1, Z-Image (ZImageTurbo), LTX Video (LTXV)

NSFW : jusqu'a X  ->  le niveau XXX est EXCLU.
Pas d'hommes : filtre sur le prompt positif + noms de LoRA.
Prompt + parametres + workflow (ComfyUI/A1111) + ressources stockes.
Resumable : INSERT OR IGNORE, relancable sans doublon.

3 phases :
  1) FEED       : flux global d'images (images?withMeta=true&nsfw=X) pagine en profondeur.
  2) MODELES    : enumeration des modeles par base (metadonnees + fichiers de telechargement).
  3) VERSIONS   : images par version (model-versions/<id>) pour completer les bases rares.
"""
import json
import os
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "flux_studio.db")
TOKEN = os.environ.get("CIVITAI_TOKEN", "")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
HEADERS = {"Authorization": "Bearer " + TOKEN, "User-Agent": UA}

# civitai baseModel -> groupe canonique (ce que l'UI affiche)
ACCEPT = {
    "Flux.2 Klein 4B": "Flux.2 Klein 4B",
    "Flux.1 D": "Flux.1 D", "Flux.1 S": "Flux.1 D", "Flux.1 Krea": "Flux.1 D",
    "SDXL 1.0": "SDXL", "Pony": "Pony", "Illustrious": "Illustrious",
    "NoobAI": "NoobAI", "SD 1.5": "SD 1.5", "SD 1.4": "SD 1.5",
    "Qwen 2.1": "Qwen", "Qwen": "Qwen",
    "ZImageTurbo": "Z-Image", "Z-Image": "Z-Image",
    "LTXV 2.3": "LTX Video", "LTXV 2.5": "LTX Video",
}

# bases a enumerer (metadonnees modeles + fichiers) : (base Civitai, cap modeles)
MODEL_BASES = [
    ("Flux.2 Klein 4B", 500),
    ("Flux.1 D", 500),
    ("SDXL 1.0", 600),
    ("Illustrious", 600),
    ("Pony", 500),
    ("NoobAI", 300),
    ("SD 1.5", 500),
    ("Qwen 2.1", 300),
    ("ZImageTurbo", 300),
    ("LTXV 2.3", 200),
    ("LTXV 2.5", 150),
]

# combos de tri du flux global : (sort, period)
FEED_COMBOS = [
    ("Most Reactions", "AllTime"),
    ("Most Reactions", "Year"),
    ("Most Reactions", "Month"),
    ("Most Reactions", "Week"),
    ("Most Comments", "AllTime"),
    ("Newest", None),
]
FEED_PAGES = 70          # 100 images / page -> ~7000 images par combo
SLEEP = 0.15
GLOBAL_IMG_CAP = 60000
TIME_BUDGET = 5400        # 90 min

# phase 3 : bases a completer par version (base, nb max de versions a interroger)
VERSION_FILL = [("Flux.2 Klein 4B", 1200), ("Flux.1 D", 500)]

MALE_KW = [
    r"\bman\b", r"\bmen\b", r"\bmale\b", r"\bboys?\b", r"\bguys?\b", r"\bguys\b",
    r"\b1boy\b", r"\b\d+boys\b", r"\bmale focus\b", r"\byaoi\b", r"\bandro\b",
    r"\bdick\b", r"\bcocks?\b", r"\bpenis\b", r"\btesticle", r"\bscrotum\b",
    r"\bsemen\b", r"\bejaculat", r"\bsperm\b", r"\bforeskin\b", r"\bglans\b",
    r"\bfuta\b", r"\bfutanari\b", r"\bshemale\b", r"\btranny\b",
    r"\bcrossdress", r"\bfemboy\b", r"\bsissy\b", r"\bbara\b",
]
MALE_RE = re.compile("|".join(MALE_KW), re.IGNORECASE)

LEVEL_STR = {"None": 1, "Soft": 2, "Mature": 3, "X": 4, "XXX": 5}


def norm_level(v):
    if isinstance(v, str):
        return LEVEL_STR.get(v, 1)
    if isinstance(v, (int, float)):
        v = int(v)
        if v & 16:
            return 5
        if v & 8:
            return 4
        if v & 4:
            return 3
        if v & 2:
            return 2
        return 1
    return 1


def contains_male(t):
    return bool(t) and bool(MALE_RE.search(t))


# ---------------- API ----------------
def api_get(path, params, tries=4):
    url = "https://civitai.com/api/v1/" + path + "?" + urllib.parse.urlencode(params)
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(2 + a * 3)
                continue
            return None
        except Exception:
            time.sleep(1.5 + a * 2)
    return None


# ---------------- extraction prompt (A1111 + ComfyUI) ----------------
def _link_text(graph, nid, depth=0):
    if depth > 8:
        return ""
    node = graph.get(str(nid))
    if not isinstance(node, dict):
        return ""
    ct = node.get("class_type") or ""
    ins = node.get("inputs") or {}
    if "PromptStyler" in ct:
        v = ins.get("text_positive")
        return v if isinstance(v, str) else ""
    for key in ("text", "text_positive", "string", "value"):
        v = ins.get(key)
        if isinstance(v, str) and v.strip():
            return v
        if isinstance(v, list) and v:
            return _link_text(graph, v[0], depth + 1)
    return ""


def _from_comfy(graph):
    cands = {}
    for nid, node in (graph or {}).items():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type") or ""
        if "CLIPTextEncode" in ct or "TextEncode" in ct or "PromptStyler" in ct:
            t = _link_text(graph, nid)
            if t and t.strip():
                cands[str(nid)] = t.strip()
    if not cands:
        return "", ""
    pos_id = neg_id = None
    for node in graph.values():
        if not isinstance(node, dict):
            continue
        for k, v in (node.get("inputs") or {}).items():
            if isinstance(v, list) and v and str(v[0]) in cands:
                if k == "positive" and pos_id is None:
                    pos_id = str(v[0])
                elif k == "negative" and neg_id is None:
                    neg_id = str(v[0])
    positive = cands.get(pos_id) if pos_id else None
    if not positive:
        positive = max(cands.values(), key=len)
    return positive, (cands.get(neg_id, "") if neg_id else "")


def extract_prompt(meta):
    if not isinstance(meta, dict):
        return "", ""
    neg = meta.get("negativePrompt", meta.get("negative_prompt", "")) or ""
    p = meta.get("prompt")
    if isinstance(p, str) and p.strip():
        return p, neg
    if isinstance(p, dict):
        tp = p.get("text_positive") or p.get("text") or ""
        if tp:
            return tp, (p.get("text_negative") or neg)
    comfy = meta.get("comfy")
    if comfy:
        try:
            g = json.loads(comfy) if isinstance(comfy, str) else comfy
            graph = g.get("prompt") if isinstance(g, dict) else None
            pos, n2 = _from_comfy(graph or {})
            if pos:
                return pos, (n2 or neg)
        except Exception:
            pass
    return "", ""


def extract_params(meta):
    d = {"seed": "", "steps": 0, "sampler": "", "cfg_scale": 1.0,
         "scheduler": "", "width": 0, "height": 0}
    if not isinstance(meta, dict):
        return d
    for k in d:
        if k in meta and meta[k] is not None:
            d[k] = meta[k]
    comfy = meta.get("comfy")
    if comfy:
        try:
            g = json.loads(comfy) if isinstance(comfy, str) else comfy
            graph = g.get("prompt") if isinstance(g, dict) else None
            for node in (graph or {}).values():
                if not isinstance(node, dict):
                    continue
                ct = node.get("class_type") or ""
                ins = node.get("inputs") or {}
                if ct in ("RandomNoise", "KSampler", "SamplerCustom") and not d["seed"]:
                    if "noise_seed" in ins:
                        d["seed"] = ins["noise_seed"]
                    elif "seed" in ins:
                        d["seed"] = ins["seed"]
                if ct in ("Flux2Scheduler", "BasicScheduler") and not d["steps"]:
                    if isinstance(ins.get("steps"), (int, float, str)):
                        d["steps"] = ins["steps"]
                if ct in ("KSamplerSelect",) and not d["sampler"]:
                    d["sampler"] = ins.get("sampler_name") or d["sampler"]
                if ct in ("KSampler", "KSamplerAdvanced") and not d["sampler"]:
                    d["sampler"] = ins.get("sampler_name") or d["sampler"]
                if ct in ("CFGGuider", "KSampler", "KSamplerAdvanced") and d["cfg_scale"] == 1.0:
                    if isinstance(ins.get("cfg"), (int, float)):
                        d["cfg_scale"] = ins["cfg"]
                if ct in ("Flux2Scheduler", "BasicScheduler", "KSampler") and not d["scheduler"]:
                    d["scheduler"] = ins.get("scheduler") or d["scheduler"]
                if "width" in ins and not d["width"] and isinstance(ins["width"], (int, float, str)):
                    d["width"] = ins["width"]
                if "height" in ins and not d["height"] and isinstance(ins["height"], (int, float, str)):
                    d["height"] = ins["height"]
        except Exception:
            pass
    return d


def extract_resources(meta):
    out = []
    if not isinstance(meta, dict):
        return out
    for key in ("civitaiResources", "additionalResources", "resources"):
        for r in meta.get(key) or []:
            if isinstance(r, dict):
                out.append({"type": r.get("type", ""),
                            "name": r.get("modelName") or r.get("name") or "",
                            "weight": r.get("weight", r.get("strength", 1.0))})
    return out


# ---------------- DB ----------------
def db():
    c = sqlite3.connect(DB_PATH, timeout=60)
    c.row_factory = sqlite3.Row
    return c


def upsert_model(conn, m):
    cid = m.get("id")
    conn.execute("""INSERT OR IGNORE INTO models
        (civitai_model_id,name,type,base_model,nsfw_level,creator,tags,download_count,description)
        VALUES (?,?,?,?,?,?,?,?,?)""", (
        cid, m.get("name", ""), m.get("type", ""),
        m.get("canon_base") or (m.get("baseModels") or [""])[0],
        norm_level(m.get("nsfwLevel")),
        (m.get("creator") or {}).get("username", ""),
        json.dumps(m.get("tags") or []),
        (m.get("stats") or {}).get("downloadCount", 0) or 0,
        (m.get("description") or "")[:800]))
    r = conn.execute("SELECT id FROM models WHERE civitai_model_id=?", (cid,)).fetchone()
    return r[0]


def upsert_version(conn, model_id, v):
    vid = v.get("id")
    conn.execute("""INSERT OR IGNORE INTO model_versions
        (model_id,civitai_version_id,name,base_model,published_at,nsfw_level,files)
        VALUES (?,?,?,?,?,?,?)""", (
        model_id, vid, v.get("name", ""), v.get("baseModel", ""),
        (v.get("publishedAt") or ""), norm_level(v.get("nsfwLevel")),
        json.dumps(v.get("files") or [])))
    r = conn.execute("SELECT id FROM model_versions WHERE civitai_version_id=?", (vid,)).fetchone()
    return r[0] if r else None


def synth_version(conn, vid, group, synth_ids):
    r = conn.execute("SELECT id FROM model_versions WHERE civitai_version_id=?", (vid,)).fetchone()
    if r:
        return r[0]
    mid = synth_ids.get(group)
    if mid is None:
        sid = -(len(synth_ids) + 1)
        conn.execute("""INSERT OR IGNORE INTO models
            (civitai_model_id,name,type,base_model,nsfw_level,creator,tags,download_count,description)
            VALUES (?,?,?,?,?,?,?,?,?)""",
            (sid, "Flux Civitai \u2022 " + group, "Feed", group, 1, "civitai", "[]", 0,
             "Images du flux Civitai (base %s)" % group))
        mid = conn.execute("SELECT id FROM models WHERE civitai_model_id=?", (sid,)).fetchone()[0]
        synth_ids[group] = mid
    conn.execute("""INSERT OR IGNORE INTO model_versions
        (model_id,civitai_version_id,name,base_model,published_at,nsfw_level,files)
        VALUES (?,?,?,?,?,?,?)""", (mid, vid, "#%s" % vid, group, "", 1, "[]"))
    return conn.execute("SELECT id FROM model_versions WHERE civitai_version_id=?", (vid,)).fetchone()[0]


def insert_image(conn, mv_id, img, base_group):
    meta = img.get("meta")
    if not isinstance(meta, dict):
        return "noprompt"
    pos, neg = extract_prompt(meta)
    if not pos:
        return "noprompt"
    res = extract_resources(meta)
    if contains_male(pos):
        return "male"
    for r in res:
        if r.get("type") == "lora" and contains_male(r.get("name", "")):
            return "male"
    lvl = norm_level(img.get("browsingLevel") if img.get("browsingLevel") is not None
                     else img.get("nsfwLevel"))
    if lvl >= 5:
        return "xxx"
    p = extract_params(meta)
    w = img.get("width") or p.get("width") or 0
    h = img.get("height") or p.get("height") or 0
    wf = "ComfyUI" if (isinstance(meta, dict) and "comfy" in meta) else "A1111/Other"
    cur = conn.execute("""INSERT OR IGNORE INTO images
        (model_version_id,civitai_image_id,url,width,height,nsfw_level,nsfw,
         created_at,username,meta,positive_prompt,negative_prompt,
         seed,steps,sampler,cfg_scale,scheduler,aspect_ratio,resources,workflow)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
        mv_id, img.get("id"), img.get("url", ""), w, h, lvl, 1 if lvl >= 2 else 0,
        img.get("createdAt", ""), img.get("username", ""), json.dumps(meta),
        pos, neg, str(p["seed"]), p["steps"], str(p["sampler"]),
        p["cfg_scale"], str(p["scheduler"]),
        "%s:%s" % (w, h) if w and h else "",
        json.dumps(res), json.dumps({"workflow": wf})))
    return "added" if cur.rowcount else "dup"


# ---------------- phases ----------------
STATS = {"added": 0, "male": 0, "xxx": 0, "noprompt": 0, "dup": 0, "img": 0}
START = time.time()


def log(m):
    print("[%s] %s" % (time.strftime("%H:%M:%S"), m), flush=True)


def budget_ok():
    return STATS["added"] < GLOBAL_IMG_CAP and (time.time() - START) < TIME_BUDGET


def count_result(res):
    STATS[res] = STATS.get(res, 0) + 1


def feed_phase(conn, synth_ids):
    log("=== PHASE 1 : flux global d'images ===")
    for sort, period in FEED_COMBOS:
        if not budget_ok():
            break
        cursor = None
        for page in range(FEED_PAGES):
            if not budget_ok():
                break
            p = {"limit": 100, "nsfw": "X", "withMeta": "true", "sort": sort}
            if period:
                p["period"] = period
            if cursor:
                p["cursor"] = cursor
            d = api_get("images", p)
            if not d:
                break
            items = d.get("items") or []
            if not items:
                break
            for img in items:
                if img.get("type") not in (None, "image"):
                    continue
                group = ACCEPT.get(img.get("baseModel"))
                if not group:
                    continue
                STATS["img"] += 1
                vids = img.get("modelVersionIds") or []
                if not vids:
                    continue
                mv_id = synth_version(conn, vids[0], group, synth_ids)
                count_result(insert_image(conn, mv_id, img, group))
            conn.commit()
            cursor = (d.get("metadata") or {}).get("nextCursor")
            if not cursor:
                break
            time.sleep(SLEEP)
        log("  feed %s/%s -> total ajoute=%d (vus=%d, H=%d, XXX=%d, sans prompt=%d)"
            % (sort, period, STATS["added"], STATS["img"], STATS["male"], STATS["xxx"], STATS["noprompt"]))


def models_phase(conn):
    log("=== PHASE 2 : enumeration des modeles ===")
    versions_by_group = {}
    for base, cap in MODEL_BASES:
        if not budget_ok():
            break
        group = ACCEPT.get(base, base)
        n = 0
        cursor = None
        while n < cap:
            p = {"limit": 100, "baseModels": base, "nsfw": "true", "sort": "Most Downloaded"}
            if cursor:
                p["cursor"] = cursor
            d = api_get("models", p)
            if not d:
                break
            items = d.get("items") or []
            if not items:
                break
            for m in items:
                m["canon_base"] = group
                mid = upsert_model(conn, m)
                for v in m.get("modelVersions") or []:
                    vid_db = upsert_version(conn, mid, v)
                    if vid_db and v.get("baseModel") in ACCEPT:
                        pass
                    if v.get("id"):
                        base_grp = ACCEPT.get(v.get("baseModel"), group)
                        lst = versions_by_base.setdefault(base_grp, [])
                        if len(lst) < 3000:
                            lst.append(v.get("id"))
                n += 1
            conn.commit()
            cursor = (d.get("metadata") or {}).get("nextCursor")
            if not cursor:
                break
            time.sleep(SLEEP)
        log("  base %-18s : %d modeles" % (base, n))
    return versions_by_base


def version_phase(conn, versions_by_base):
    log("=== PHASE 3 : images par version (bases faibles) ===")
    for base_grp, cap in [("Flux.2 Klein 4B", 900), ("Flux.1 D", 500), ("SDXL", 400),
                          ("Illustrious", 400), ("Pony", 400), ("SD 1.5", 300),
                          ("Qwen", 250), ("Z-Image", 250), ("LTX Video", 200)]:
        if not budget_ok():
            break
        vids = versions_by_base.get(base_grp, [])[:cap]
        got0 = STATS["added"]
        for vid in vids:
            if not budget_ok():
                break
            d = api_get("model-versions/%s" % vid, {})
            if not d:
                continue
            mv = conn.execute("SELECT id FROM model_versions WHERE civitai_version_id=?", (vid,)).fetchone()
            if not mv:
                continue
            for img in (d.get("images") or []):
                STATS["img"] += 1
                count_result(insert_image(conn, mv[0], img, base_grp))
            conn.commit()
            time.sleep(SLEEP)
        log("  %-18s : +%d images sur %d versions" % (base_grp, STATS["added"] - got0, len(vids)))


def main():
    conn = db()
    versions_by_base = {}
    synth_ids = {}
    log("DEBUT scrape. bases=%s" % ",".join(sorted(set(ACCEPT.values()))))

    # --- phase 2 : peupler modeles/versions (necessaire pour rattacher les images) ---
    log("=== PHASE 2 : enumeration des modeles ===")
    for base, cap in MODEL_BASES:
        if not budget_ok():
            break
        n = 0
        cursor = None
        while n < cap:
            p = {"limit": 100, "baseModels": base, "nsfw": "true", "sort": "Most Downloaded"}
            if cursor:
                p["cursor"] = cursor
            d = api_get("models", p)
            if not d:
                break
            items = d.get("items") or []
            if not items:
                break
            for m in items:
                grp = ACCEPT.get(base, base)
                m["canon_base"] = grp
                mid = upsert_model(conn, m)
                for v in m.get("modelVersions") or []:
                    upsert_version(conn, mid, v)
                    if v.get("id"):
                        bg = ACCEPT.get(v.get("baseModel"), grp)
                        lst = versions_by_base.setdefault(bg, [])
                        if len(lst) < 4000:
                            lst.append(v["id"])
                n += 1
            conn.commit()
            cursor = (d.get("metadata") or {}).get("nextCursor")
            if not cursor:
                break
            time.sleep(SLEEP)
        log("  base %-18s : %d modeles" % (base, n))

    log("modeles=%d versions=%d images=%d" % (
        conn.execute("SELECT count(*) FROM models").fetchone()[0],
        conn.execute("SELECT count(*) FROM model_versions").fetchone()[0],
        conn.execute("SELECT count(*) FROM images").fetchone()[0]))

    # --- phase 1 ---
    log("=== PHASE 1 : flux global d'images ===")
    for sort, period in FEED_COMBOS:
        if not budget_ok():
            break
        cursor = None
        for page in range(FEED_PAGES):
            if not budget_ok():
                break
            p = {"limit": 100, "nsfw": "X", "withMeta": "true", "sort": sort}
            if period:
                p["period"] = period
            if cursor:
                p["cursor"] = cursor
            d = api_get("images", p)
            if not d:
                break
            items = d.get("items") or []
            if not items:
                break
            for img in items:
                if img.get("type") not in (None, "image"):
                    continue
                grp = ACCEPT.get(img.get("baseModel"))
                if not grp:
                    continue
                STATS["img"] += 1
                vids = img.get("modelVersionIds") or []
                if not vids:
                    continue
                mv_id = synth_version(conn, vids[0], grp, synth_ids)
                count_result(insert_image(conn, mv_id, img, grp))
            conn.commit()
            cursor = (d.get("metadata") or {}).get("nextCursor")
            if not cursor:
                break
            time.sleep(SLEEP)
        log("  feed %-15s/%-8s : +total=%d (scannes=%d H=%d XXX=%d vide=%d dup=%d)"
            % (sort, period or "-", STATS["added"], STATS["img"], STATS["male"],
               STATS["xxx"], STATS["noprompt"], STATS["dup"]))

    # --- phase 3 ---
    log("=== PHASE 3 : images par version (comble les bases faibles) ===")
    for grp, cap in [("Flux.2 Klein 4B", 1200), ("Flux.1 D", 600), ("Z-Image", 300),
                     ("Qwen", 300), ("LTX Video", 250), ("SD 1.5", 300)]:
        if not budget_ok():
            break
        vids = versions_by_base.get(grp, [])[:cap]
        g0 = STATS["added"]
        for vid in vids:
            if not budget_ok():
                break
            d = api_get("model-versions/%s" % vid, {})
            if not d:
                continue
            mv = conn.execute("SELECT id FROM model_versions WHERE civitai_version_id=?", (vid,)).fetchone()
            if not mv:
                continue
            for img in (d.get("images") or []):
                STATS["img"] += 1
                count_result(insert_image(conn, mv[0], img, grp))
            conn.commit()
            time.sleep(SLEEP)
        log("  %-16s : +%d images (%d versions)" % (grp, STATS["added"] - g0, len(vids)))

    conn.close()
    log("FINI. ajoutees=%d | scannees=%d | hommes=%d | XXX=%d | sans prompt=%d | doublons=%d"
        % (STATS["added"], STATS["img"], STATS["male"], STATS["xxx"],
           STATS["noprompt"], STATS["dup"]))


if __name__ == "__main__":
    main()
