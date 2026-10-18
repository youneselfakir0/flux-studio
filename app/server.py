#!/usr/bin/env python3
"""
Prompt Browser + ComfyUI Model Manager  (single server, port 8080)
Run: python server.py   ->   http://localhost:8080
"""

import sqlite3
import json
import os
import re
import sys
import base64
import struct
import threading
import time
import uuid
import urllib.request
import urllib.parse
import hashlib
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "data", "flux_studio.db")
THUMB_CACHE_DIR = os.path.join(BASE_DIR, "data", "thumb_cache")
PORT = 8080
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def cache_path_for(url):
    """Chemin de cache disque pour une URL distante (sha1, 2 niveaux)."""
    h = hashlib.sha1(url.encode("utf-8")).hexdigest()
    return os.path.join(THUMB_CACHE_DIR, h[:2], h)

# ---------- ComfyUI ----------
COMFYUI_ROOT = r"F:\f\ComfyUI"
MODELS_DIR = os.path.join(COMFYUI_ROOT, "models")
WORKFLOWS_DIR = os.path.join(COMFYUI_ROOT, "user", "default", "workflows")
CIVITAI_TOKEN = os.environ.get("CIVITAI_TOKEN", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-lite")
CIVITAI_HEADERS = {
    "Authorization": f"Bearer {CIVITAI_TOKEN}",
    "User-Agent": "ComfyUI-Model-Manager/1.0 (+local)",
    "Accept": "application/json",
}

MODEL_FOLDERS = {
    "checkpoints":       [".safetensors", ".ckpt", ".pt", ".pth", ".gguf"],
    "loras":             [".safetensors", ".pt", ".pth"],
    "vae":               [".safetensors", ".pt", ".pth"],
    "controlnet":        [".safetensors", ".pth"],
    "clip":              [".safetensors", ".gguf"],
    "clip_vision":       [".safetensors", ".pt"],
    "unet":              [".safetensors", ".gguf"],
    "diffusion_models":  [".safetensors", ".gguf"],
    "upscale_models":    [".safetensors", ".pth"],
    "embeddings":        [".safetensors", ".pt", ".bin"],
    "hypernetworks":     [".safetensors", ".pt"],
    "style_models":      [".safetensors"],
    "ipadapter":         [".safetensors"],
    "text_encoders":     [".safetensors", ".gguf"],
    "model_patches":     [".safetensors"],
}

CIVITAI_TO_COMFYUI = {
    "Checkpoint": "checkpoints", "LORA": "loras", "LoCon": "loras", "DoRA": "loras",
    "VAE": "vae", "Controlnet": "controlnet", "ControlNet": "controlnet",
    "TextualInversion": "embeddings", "Hypernetwork": "hypernetworks",
    "Upscaler": "upscale_models", "UNET": "unet", "CLIP": "clip",
    "CLIPVision": "clip_vision", "DiffusionModel": "diffusion_models",
    "StyleModel": "style_models", "IPAdapter": "ipadapter",
    "MotionModule": "motion_modules", "Other": "misc",
    "Workflows": "workflows", "Poses": "workflows",
}

_WORKFLOW_EXT = (".json", ".zip")
_IMAGE_EXT = (".safetensors", ".ckpt", ".pt", ".pth", ".gguf", ".bin")
_META_SUFFIXES = (".metadata.json", ".civitai.json", ".json")


def derive_base_model(text, meta=None):
    """Local files often lack baseModel metadata -> infer from filename."""
    if meta:
        bm = meta.get("baseModel") or meta.get("base_model")
        if bm:
            return bm
    t = (text or "").lower()
    if "klein" in t and "flux" in t:
        return "Flux.2 Klein 4B"
    if "flux2" in t or "flux-2" in t or "flux_2" in t:
        return "Flux.2"
    if "z_image" in t or "zimage" in t or "z-image" in t:
        return "Z-Image"
    if "qwen" in t:
        return "Qwen"
    if "ltx" in t:
        return "LTX Video"
    if "flux" in t:
        return "Flux.1 D"
    if "sdxl" in t or "xl_" in t or "_xl" in t or "pony" in t:
        return "SDXL"
    if "sd15" in t or "sd_15" in t or "v1-5" in t or "sd1.5" in t:
        return "SD 1.5"
    return ""


_gpu_cache = {"t": 0.0, "data": None}


def gpu_info():
    if _gpu_cache["data"] and time.time() - _gpu_cache["t"] < 300:
        return _gpu_cache["data"]
    info = {"name": "", "vram_mb": 0, "driver": "", "max_gb": 8}
    try:
        import subprocess
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
            timeout=8, stderr=subprocess.DEVNULL).decode("utf-8", "replace").strip().splitlines()
        if out:
            parts = [p.strip() for p in out[0].split(",")]
            info["name"] = parts[0] if len(parts) > 0 else ""
            info["vram_mb"] = int(parts[1].split()[0]) if len(parts) > 1 and parts[1].split() else 0
            info["driver"] = parts[2] if len(parts) > 2 else ""
    except Exception as e:
        info["error"] = str(e)
    vram = info["vram_mb"]
    if vram >= 24000:
        info["max_gb"] = 22
    elif vram >= 16000:
        info["max_gb"] = 14
    elif vram >= 12000:
        info["max_gb"] = 9
    elif vram >= 8000:
        info["max_gb"] = 6
    elif vram:
        info["max_gb"] = 4
    _gpu_cache["data"] = info
    _gpu_cache["t"] = time.time()
    return info

# ---------- Men / Women filtering ----------
MALE_KEYWORDS = [
    "man", "men", "male", "boy", "boys", "guy", "guys", "penis", "cock",
    "dick", "testicle", "testicles", "scrotum", "prostate", "semen",
    "ejaculat", "sperm", "foreskin", "glans", "futa", "futanari", "shemale",
    "tranny", "crossdress", "femboy", "trap", "sissy", "muscular man",
    "male focus", "1boy", "2boys", "3boys", "multiple boys", "yaoi", "gay",
]
FEMALE_KEYWORDS = [
    "woman", "women", "female", "girl", "girls", "she", "her", "1girl",
    "2girls", "3girls", "multiple girls", "lady", "ladies", "wife",
    "milf", "boobs", "breasts", "pussy", "vagina", "nipples", "cleavage",
    "bikini", "lingerie", "yuri", "lesbian", "nun", "mommy", "mother",
]

_MALE_RE = re.compile(r"(?<![a-z])(" + "|".join(re.escape(k) for k in MALE_KEYWORDS) + r")(?![a-z])", re.I)
_FEMALE_RE = re.compile(r"(?<![a-z])(" + "|".join(re.escape(k) for k in FEMALE_KEYWORDS) + r")(?![a-z])", re.I)


def _text_of(*values):
    parts = []
    for v in values:
        if not v:
            continue
        if isinstance(v, (list, tuple)):
            parts.append(_text_of(*v))
        elif isinstance(v, dict):
            parts.append(json.dumps(v, ensure_ascii=False))
        else:
            parts.append(str(v))
    return " ".join(parts)


def has_male(*values):
    return 1 if _MALE_RE.search(_text_of(*values)) else 0


def has_female(*values):
    return 1 if _FEMALE_RE.search(_text_of(*values)) else 0


# ---------- ComfyUI scan (fast, cached) ----------
_scan_cache = {"t": 0.0, "data": None}


def _load_meta(path):
    meta = {}
    for suf in _META_SUFFIXES:
        p = path + suf
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    d = json.load(f)
                if isinstance(d, dict):
                    meta.update(d)
            except Exception:
                pass
    return meta


def scan_comfyui_models(force=False):
    now = time.time()
    if not force and _scan_cache["data"] is not None and now - _scan_cache["t"] < 60:
        return _scan_cache["data"]

    result = {}
    for mt, exts in MODEL_FOLDERS.items():
        folder = os.path.join(MODELS_DIR, mt)
        items = []
        if os.path.isdir(folder):
            for root, _dirs, files in os.walk(folder):
                for fn in files:
                    low = fn.lower()
                    if not low.endswith(tuple(exts)):
                        continue
                    fp = os.path.join(root, fn)
                    try:
                        st = os.stat(fp)
                    except OSError:
                        continue
                    meta = _load_meta(fp)
                    items.append({
                        "filename": fn,
                        "filepath": fp,
                        "rel_path": os.path.relpath(fp, MODELS_DIR).replace("\\", "/"),
                        "model_type": mt,
                        "size_bytes": st.st_size,
                        "modified": st.st_mtime,
                        "name": meta.get("name") or meta.get("modelName") or fn,
                        "base_model": derive_base_model(fn, meta),
                        "civitai_model_id": meta.get("modelId") or meta.get("civitai_model_id"),
                        "civitai_version_id": meta.get("modelVersionId") or meta.get("civitai_version_id") or meta.get("id"),
                        "tags": meta.get("tags") or meta.get("trainedWords") or [],
                    })
        items.sort(key=lambda x: x["filename"].lower())
        result[mt] = items

    # Local workflows (ComfyUI sync)
    wf_items = []
    if os.path.isdir(WORKFLOWS_DIR):
        for root, _dirs, files in os.walk(WORKFLOWS_DIR):
            for fn in files:
                if not fn.lower().endswith(".json"):
                    continue
                fp = os.path.join(root, fn)
                try:
                    st = os.stat(fp)
                except OSError:
                    continue
                wf_items.append({
                    "filename": fn, "filepath": fp,
                    "rel_path": os.path.relpath(fp, WORKFLOWS_DIR).replace("\\", "/"),
                    "model_type": "workflows", "size_bytes": st.st_size, "modified": st.st_mtime,
                    "name": fn, "base_model": "", "civitai_model_id": None,
                    "civitai_version_id": None, "tags": [],
                })
    wf_items.sort(key=lambda x: x["filename"].lower())
    result["workflows"] = wf_items

    _scan_cache["data"] = result
    _scan_cache["t"] = now
    return result


def comfyui_profile():
    models = scan_comfyui_models()
    counts = {k: len(v) for k, v in models.items()}
    total_bytes = sum(m["size_bytes"] for v in models.values() for m in v)
    # Base models present locally (from checkpoints / diffusion / unet)
    base_models = {}
    for k in ("checkpoints", "diffusion_models", "unet"):
        for m in models.get(k, []):
            bm = m["base_model"] or "?"
            base_models[bm] = base_models.get(bm, 0) + 1
    # LoRAs grouped by inferred base model
    lora_by_base = {}
    for m in models.get("loras", []):
        bm = m["base_model"] or "Inconnu"
        lora_by_base[bm] = lora_by_base.get(bm, 0) + 1
    return {
        "gpu": gpu_info(),
        "comfyui_root": COMFYUI_ROOT,
        "models_dir": MODELS_DIR,
        "workflows_dir": WORKFLOWS_DIR,
        "counts": counts,
        "total_bytes": total_bytes,
        "base_models": dict(sorted(base_models.items(), key=lambda x: -x[1])),
        "lora_by_base": dict(sorted(lora_by_base.items(), key=lambda x: -x[1])),
        "profile": {
            "recommended_base": "Flux.2 Klein 4B",
            "max_gb": gpu_info().get("max_gb", 9),
        },
    }


# ---------- Downloads ----------
_dl_lock = threading.Lock()
_downloads = {}


def _add_column_if_missing(conn, table, column, decl):
    """Migration idempotente : ajoute une colonne si elle n'existe pas."""
    cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in cols:
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
        except sqlite3.OperationalError:
            pass


def init_db():
    """Cree TOUTES les tables utilisees par les endpoints (fresh clone OK).

    - Contraintes UNIQUE sur les IDs Civitai (evite les doublons).
    - Migration idempotente pour les bases existantes (colonnes manquantes).
    - Indexes pour les jointures/tris de get_images().
    """
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS models (
            id INTEGER PRIMARY KEY,
            civitai_model_id INTEGER UNIQUE,
            name TEXT,
            type TEXT,
            base_model TEXT,
            nsfw_level INTEGER,
            creator TEXT,
            tags TEXT,
            download_count INTEGER,
            description TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS model_versions (
            id INTEGER PRIMARY KEY,
            model_id INTEGER,
            civitai_version_id INTEGER UNIQUE,
            name TEXT,
            base_model TEXT,
            published_at TEXT,
            nsfw_level INTEGER,
            files TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY,
            model_version_id INTEGER,
            civitai_image_id INTEGER UNIQUE,
            url TEXT,
            width INTEGER,
            height INTEGER,
            nsfw_level INTEGER,
            nsfw BOOLEAN,
            created_at TEXT,
            username TEXT,
            meta TEXT,
            positive_prompt TEXT,
            negative_prompt TEXT,
            seed TEXT,
            steps INTEGER,
            sampler TEXT,
            cfg_scale REAL,
            scheduler TEXT,
            aspect_ratio TEXT,
            resources TEXT,
            workflow TEXT,
            male INTEGER,
            female INTEGER
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS comfyui_downloads (
            id TEXT PRIMARY KEY,
            civitai_model_id INTEGER, civitai_version_id INTEGER,
            name TEXT, filename TEXT, dest_folder TEXT, dest_path TEXT,
            status TEXT, total_bytes INTEGER DEFAULT 0, downloaded_bytes INTEGER DEFAULT 0,
            error TEXT, started_at REAL, completed_at REAL
        )
    """)

    # Migration idempotente pour bases existantes (colonnes manquantes)
    for col, decl in (("male", "INTEGER"), ("female", "INTEGER")):
        _add_column_if_missing(conn, "images", col, decl)
    for col, decl in (("civitai_model_id", "INTEGER"),):
        _add_column_if_missing(conn, "models", col, decl)
    for col, decl in (("civitai_version_id", "INTEGER"),):
        _add_column_if_missing(conn, "model_versions", col, decl)
    for col, decl in (("civitai_image_id", "INTEGER"),):
        _add_column_if_missing(conn, "images", col, decl)

    # Indexes pour les jointures/tris de get_images() et les contraintes uniques
    index_sql = [
        "CREATE INDEX IF NOT EXISTS idx_images_model_version ON images(model_version_id)",
        "CREATE INDEX IF NOT EXISTS idx_images_civitai ON images(civitai_image_id)",
        "CREATE INDEX IF NOT EXISTS idx_mv_model ON model_versions(model_id)",
        "CREATE INDEX IF NOT EXISTS idx_models_civitai ON models(civitai_model_id)",
        "CREATE INDEX IF NOT EXISTS idx_mv_civitai ON model_versions(civitai_version_id)",
    ]
    # Contraintes uniques (best-effort sur bases existantes)
    unique_sql = [
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_models_civitai ON models(civitai_model_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_civitai ON model_versions(civitai_version_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_images_civitai ON images(civitai_image_id)",
    ]
    for sql in index_sql + unique_sql:
        try:
            conn.execute(sql)
        except sqlite3.OperationalError:
            # doublons existants : on ignore pour ne pas casser le boot
            pass

    conn.commit()
    conn.close()




def _progress(did, **kw):
    with _dl_lock:
        d = _downloads.get(did)
        if d:
            d.update(kw)


def start_download(model_id, version_id, file_id=None):
    did = uuid.uuid4().hex[:12]
    rec = {
        "id": did, "civitai_model_id": model_id, "civitai_version_id": version_id,
        "name": "", "filename": "", "dest_folder": "", "dest_path": "",
        "status": "pending", "total_bytes": 0, "downloaded_bytes": 0,
        "error": None, "started_at": time.time(), "completed_at": None,
    }
    with _dl_lock:
        _downloads[did] = rec
    t = threading.Thread(target=_do_download, args=(did, model_id, version_id, file_id), daemon=True)
    t.start()
    return did


def _do_download(did, model_id, version_id, file_id):
    try:
        m_resp = urllib.request.urlopen(urllib.request.Request(
            f"https://civitai.com/api/v1/models/{model_id}", headers=CIVITAI_HEADERS), timeout=30)
        model = json.loads(m_resp.read())
        version = next((v for v in model.get("modelVersions", []) if v["id"] == version_id), None)
        if not version:
            _progress(did, status="error", error="version introuvable")
            return

        files = version.get("files", [])
        f = None
        if file_id is not None:
            f = next((x for x in files if x.get("id") == file_id), None)
        if f is None:
            valid = [x for x in files if x.get("name", "").lower().endswith(_IMAGE_EXT + _WORKFLOW_EXT)]
            f = (valid or files or [None])[0]
        if f is None:
            _progress(did, status="error", error="aucun fichier")
            return

        ctype = model.get("type", "Checkpoint")
        dest_folder = CIVITAI_TO_COMFYUI.get(ctype, "checkpoints")
        filename = f.get("name") or f"model_{version_id}.safetensors"
        if dest_folder == "workflows":
            dest_dir = WORKFLOWS_DIR
        else:
            dest_dir = os.path.join(MODELS_DIR, dest_folder)
        os.makedirs(dest_dir, exist_ok=True)
        dest_path = os.path.join(dest_dir, filename)

        url = f.get("downloadUrl") or f"https://civitai.com/api/download/models/{version_id}?fileId={f.get('id')}"
        _progress(did, name=f"{model.get('name')} / {version.get('name')}",
                  filename=filename, dest_folder=dest_folder, dest_path=dest_path,
                  status="downloading")

        tmp = dest_path + ".part"
        req = urllib.request.Request(url, headers=CIVITAI_HEADERS)
        with urllib.request.urlopen(req, timeout=60) as resp:
            total = int(resp.headers.get("content-length") or f.get("sizeKB", 0) * 1024 or 0)
            _progress(did, total_bytes=total)
            downloaded = 0
            with open(tmp, "wb") as out:
                while True:
                    chunk = resp.read(1024 * 256)
                    if not chunk:
                        break
                    out.write(chunk)
                    downloaded += len(chunk)
                    _progress(did, downloaded_bytes=downloaded)
        os.replace(tmp, dest_path)

        # write metadata sidecar
        meta = {
            "name": model.get("name"), "modelId": model_id, "modelVersionId": version_id,
            "baseModel": version.get("baseModel"),
            "description": (version.get("description") or "")[:2000],
            "trainedWords": version.get("trainedWords", []),
            "nsfwLevel": version.get("nsfwLevel", 1),
            "files": files,
        }
        try:
            with open(dest_path + ".metadata.json", "w", encoding="utf-8") as mf:
                json.dump(meta, mf, ensure_ascii=False, indent=2)
        except Exception:
            pass

        _progress(did, status="completed", completed_at=time.time())
        scan_comfyui_models(force=True)
    except Exception as e:
        _progress(did, status="error", error=str(e))


# ---------- Image metadata extraction ----------
def _png_text_chunks(data):
    out = {}
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return out
    i = 8
    n = len(data)
    while i + 8 <= n:
        (length,) = struct.unpack(">I", data[i:i + 4])
        ctype = data[i + 4:i + 8]
        chunk = data[i + 8:i + 8 + length]
        i += 12 + length
        try:
            if ctype == b"tEXt":
                key, _, val = chunk.partition(b"\x00")
                out[key.decode("latin-1", "replace")] = val.decode("latin-1", "replace")
            elif ctype == b"iTXt":
                key, _, rest = chunk.partition(b"\x00")
                parts = rest.split(b"\x00", 3)
                txt = parts[3] if len(parts) > 3 else b""
                out[key.decode("latin-1", "replace")] = txt.decode("utf-8", "replace")
            elif ctype == b"zTXt":
                import zlib
                key, _, rest = chunk.partition(b"\x00")
                if rest:
                    try:
                        out[key.decode("latin-1", "replace")] = zlib.decompress(rest[1:]).decode("utf-8", "replace")
                    except Exception:
                        pass
        except Exception:
            pass
        if ctype == b"IEND":
            break
    return out


def _jpeg_exif_text(data):
    out = {}
    try:
        i = data.find(b"\xff\xe1")
        if i < 0:
            return out
        seg_len = struct.unpack(">H", data[i + 2:i + 4])[0]
        exif = data[i + 4:i + 2 + seg_len]
        if not exif.startswith(b"Exif\x00\x00"):
            return out
        tiff = exif[6:]
        endian = "<" if tiff[:2] == b"II" else ">"
        off = struct.unpack(endian + "I", tiff[4:8])[0]
        count = struct.unpack(endian + "H", tiff[off:off + 2])[0]
        for k in range(count):
            e = off + 2 + k * 12
            tag = struct.unpack(endian + "H", tiff[e:e + 2])[0]
            if tag in (0x010E, 0x010F, 0x9286):
                size = struct.unpack(endian + "I", tiff[e + 4:e + 8])[0]
                valoff = struct.unpack(endian + "I", tiff[e + 8:e + 12])[0]
                raw = tiff[valoff:valoff + size]
                out[{0x010E: "ImageDescription", 0x010F: "Make", 0x9286: "UserComment"}[tag]] = \
                    raw.decode("utf-8", "replace").strip("\x00 ")
    except Exception:
        pass
    return out


def describe_image(data, filename):
    name = (filename or "").lower()
    raw = {}
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        raw = _png_text_chunks(data)
    elif name.endswith((".jpg", ".jpeg")) or data[:2] == b"\xff\xd8":
        raw = _jpeg_exif_text(data)

    result = {"source": "png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "jpeg" if raw else "unknown",
              "params": {}, "positive_prompt": "", "negative_prompt": "",
              "workflow_nodes": 0, "raw_keys": list(raw.keys())}

    params_text = raw.get("parameters") or raw.get("Comment") or raw.get("UserComment") or ""
    if params_text:
        result["positive_prompt"] = params_text.split("Negative prompt:")[0].strip()
        if "Negative prompt:" in params_text:
            neg = params_text.split("Negative prompt:", 1)[1]
            result["negative_prompt"] = neg.split("Steps:")[0].strip()
        for line in params_text.splitlines():
            m = re.search(r"(Steps|Sampler|CFG scale|Seed|Size|Model hash|Model|Clip skip|Denoising strength):\s*([^,]+)", line)
            if m:
                params_text_key = m.group(1)
                result["params"][params_text_key] = m.group(2).strip()

    wf = raw.get("workflow")
    if wf:
        try:
            j = json.loads(wf)
            nodes = j.get("nodes", []) if isinstance(j, dict) else []
            result["workflow_nodes"] = len(nodes)
            texts = []
            for nd in nodes:
                wv = nd.get("widgets_values")
                if isinstance(wv, list):
                    for x in wv:
                        if isinstance(x, str) and len(x) > 25:
                            texts.append(x)
            if texts and not result["positive_prompt"]:
                result["positive_prompt"] = texts[0]
        except Exception:
            pass

    # ComfyUI API format  (text chunk "prompt": {node_id: {class_type, inputs}})
    ap = raw.get("prompt")
    if ap:
        try:
            j = json.loads(ap)
            if isinstance(j, dict) and "nodes" not in j:
                result["workflow_nodes"] = len(j)
                texts = []
                for node in j.values():
                    if not isinstance(node, dict):
                        continue
                    ins = node.get("inputs") or {}
                    ct = (node.get("class_type") or "").lower()
                    for key in ("text", "text_g", "text_l", "positive", "prompt", "string"):
                        v = ins.get(key)
                        if isinstance(v, str) and len(v) > 6:
                            texts.append((ct, v))
                # positive = CLIPTextEncode without "negative" in title, negative otherwise
                pos = [t for ct, t in texts if "negative" not in ct]
                neg = [t for ct, t in texts if "negative" in ct]
                # prefer known text-encode node types
                enc_pos = [t for ct, t in texts if ct in ("cliptextencode", "text encode (positive)") and "negative" not in ct]
                if not result["positive_prompt"]:
                    result["positive_prompt"] = (enc_pos or pos or [""])[0]
                if not result["negative_prompt"]:
                    result["negative_prompt"] = (neg or [""])[0]
                result["node_types"] = sorted({(n.get("class_type") or "") for n in j.values() if isinstance(n, dict)})
        except Exception:
            pass

    return result


def try_ollama_vision(image_path, prompt="Describe this image in detail."):
    try:
        tags = json.loads(urllib.request.urlopen("http://localhost:11434/api/tags", timeout=3).read())
        models = [m["name"] for m in tags.get("models", [])]
        vision = [m for m in models if any(v in m.lower() for v in
                  ("llava", "vision", "moondream", "bakllava", "minicpm-v", "gemma3", "qwen2.5vl", "qwen2-vl"))]
        if not vision:
            return {"available": False, "models": models}
        with open(image_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        payload = json.dumps({"model": vision[0], "prompt": prompt, "images": [b64], "stream": False}).encode()
        req = urllib.request.Request("http://localhost:11434/api/generate", data=payload,
                                     headers={"Content-Type": "application/json"})
        resp = json.loads(urllib.request.urlopen(req, timeout=180).read())
        return {"available": True, "model": vision[0], "description": resp.get("response", "")}
    except Exception as e:
        return {"available": False, "error": str(e)}


def try_gemini_vision(image_path, prompt="Describe this image in detail."):
    """Vision via l'API Gemini (Google AI Studio)."""
    if not GEMINI_API_KEY:
        return {"available": False, "error": "GEMINI_API_KEY manquante"}
    try:
        with open(image_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        mime = "image/png" if image_path.lower().endswith(".png") else "image/jpeg"
        payload = json.dumps({
            "contents": [{"parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": mime, "data": b64}},
            ]}],
        }).encode()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
        req = urllib.request.Request(url, data=payload,
                                     headers={"Content-Type": "application/json"})
        resp = json.loads(urllib.request.urlopen(req, timeout=60).read())
        text = resp["candidates"][0]["content"]["parts"][0]["text"]
        return {"available": True, "model": GEMINI_MODEL, "description": text}
    except Exception as e:
        return {"available": False, "error": str(e)}


def describe_with_vision(image_path, prompt="Describe this image in detail."):
    """Gemini en priorite, Ollama en fallback. Retourne le premier resultat utilisable."""
    g = try_gemini_vision(image_path, prompt)
    if g.get("available") and (g.get("description") or "").strip():
        return g
    o = try_ollama_vision(image_path, prompt)
    if o.get("available") and (o.get("description") or "").strip():
        return o
    # aucun n'a produit de texte : on renvoie l'erreur la plus parlante
    return g if g.get("error") else o


# ---------- Civitai search ----------
def civitai_search(query, model_type=None, base_model=None, nsfw_max=4, limit=40, men=None, max_gb=None, cursor=None):
    params = {"limit": limit, "nsfw": "true"}
    if query:
        params["query"] = query
    if model_type:
        params["types"] = model_type
    if base_model:
        params["baseModels"] = base_model
    if cursor:
        params["cursor"] = cursor
    url = "https://civitai.com/api/v1/models?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=CIVITAI_HEADERS)
    data = json.loads(urllib.request.urlopen(req, timeout=30).read())
    items = data.get("items", [])
    out = []
    for m in items:
        t = m.get("type")
        if t not in CIVITAI_TO_COMFYUI:
            continue
        exts = _WORKFLOW_EXT if t in ("Workflows", "Poses") else _IMAGE_EXT
        lvl = m.get("nsfwLevel", 1)
        lvl = {"None": 1, "Soft": 2, "Mature": 4, "Explicit": 5}.get(lvl, lvl) if isinstance(lvl, str) else lvl
        if isinstance(lvl, (int, float)) and lvl > nsfw_max:
            continue
        versions = []
        for v in m.get("modelVersions", [])[:6]:
            vfiles = []
            for f in v.get("files", []):
                if not f.get("name", "").lower().endswith(exts):
                    continue
                if max_gb:
                    gb = (f.get("sizeKB") or 0) * 1024 / (1024 ** 3)
                    if gb > max_gb:
                        continue
                vfiles.append({"id": f.get("id"), "name": f.get("name"),
                               "sizeKB": f.get("sizeKB"), "format": (f.get("metadata") or {}).get("format")})
            if vfiles:
                versions.append({"id": v.get("id"), "name": v.get("name"), "baseModel": v.get("baseModel"),
                                 "files": vfiles})
        if not versions:
            continue

        # Gender filter on name + tags
        label = (m.get("name", "") + " " + " ".join(m.get("tags") or []))
        if men == "0" and has_male(name_text := (m.get("name", ""), " ".join(m.get("tags") or []))):
            continue
        if men == "only":
            if has_male(m.get("name", ""), m.get("tags") or []):
                continue
            if not has_female(m.get("name", ""), m.get("tags") or []):
                continue

        out.append({
            "id": m.get("id"), "name": m.get("name"), "type": t, "nsfwLevel": lvl,
            "folder": CIVITAI_TO_COMFYUI.get(t, "checkpoints"),
            "creator": (m.get("creator") or {}).get("username", ""),
            "downloads": (m.get("stats") or {}).get("downloadCount", 0),
            "baseModels": m.get("baseModels") or [],
            "tags": (m.get("tags") or [])[:12],
            "thumbnail": (m.get("modelVersions") or [{}])[0].get("images", [{}])[0].get("url", "") if m.get("modelVersions") else "",
            "versions": versions,
        })
    # Return paginated response with nextCursor
    return {"items": out, "nextCursor": data.get("metadata", {}).get("nextCursor")}


# ---------- Prompt DB helpers ----------
def _db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.create_function("has_male", -1, has_male)
    conn.create_function("has_female", -1, has_female)
    return conn


def get_models():
    conn = _db()
    c = conn.cursor()
    c.execute("""
        SELECT m.*, COUNT(i.id) as image_count
        FROM models m
        LEFT JOIN model_versions mv ON m.id = mv.model_id
        LEFT JOIN images i ON mv.id = i.model_version_id
        GROUP BY m.id
        ORDER BY m.nsfw_level DESC, m.download_count DESC
    """)
    rows = [dict(r) for r in c.fetchall()]
    for r in rows:
        r["tags"] = json.loads(r["tags"]) if r["tags"] else []
    conn.close()
    return rows


def get_categories():
    conn = _db()
    c = conn.cursor()
    c.execute("SELECT DISTINCT type FROM models")
    types = [r[0] for r in c.fetchall()]
    c.execute("SELECT DISTINCT base_model FROM models")
    base_models = [r[0] for r in c.fetchall()]
    c.execute("SELECT DISTINCT tags FROM models")
    tags = set()
    for r in c.fetchall():
        if r[0]:
            tags.update(json.loads(r[0]))
    conn.close()
    return {"types": types, "base_models": base_models, "tags": sorted(tags)}


def get_images(query):
    conn = _db()
    c = conn.cursor()
    where = ["1=1"]
    params = []

    if query.get("model_id"):
        where.append("m.id = ?"); params.append(query["model_id"][0])
    if query.get("type"):
        where.append("m.type = ?"); params.append(query["type"][0])
    if query.get("base_model"):
        where.append("m.base_model = ?"); params.append(query["base_model"][0])
    if query.get("tag"):
        where.append("EXISTS (SELECT 1 FROM json_each(m.tags) WHERE value = ?)"); params.append(query["tag"][0])
    if query.get("search"):
        term = f"%{query['search'][0]}%"
        where.append("(i.positive_prompt LIKE ? OR i.negative_prompt LIKE ? OR m.name LIKE ?)")
        params.extend([term, term, term])
    if query.get("nsfw", ["1"])[0] in ("0", "false", "off"):
        where.append("i.nsfw = 0")
    if query.get("nsfw_max"):
        try:
            where.append("COALESCE(i.nsfw_level, 1) <= ?")
            params.append(int(query["nsfw_max"][0]))
        except (ValueError, TypeError):
            pass

    # Men / Women server-side filter
    men = query.get("men", [None])[0]
    if men == "0":  # exclude men
        where.append("COALESCE(i.male, has_male(i.positive_prompt, i.negative_prompt, i.resources)) = 0")
    elif men == "only":  # women only
        where.append("COALESCE(i.male, has_male(i.positive_prompt, i.negative_prompt, i.resources)) = 0")
        where.append("COALESCE(i.female, has_female(i.positive_prompt, i.negative_prompt, i.resources)) = 1")

    limit = int(query.get("limit", [50])[0])
    offset = int(query.get("offset", [0])[0])
    where_sql = " AND ".join(where)

    c.execute(f"""
        SELECT i.*, m.name as model_name, m.type as model_type, m.base_model,
               mv.name as version_name
        FROM images i
        JOIN model_versions mv ON i.model_version_id = mv.id
        JOIN models m ON mv.model_id = m.id
        WHERE {where_sql}
        ORDER BY i.created_at DESC
        LIMIT ? OFFSET ?
    """, params + [limit, offset])
    rows = [dict(r) for r in c.fetchall()]
    for r in rows:
        r["meta"] = json.loads(r["meta"]) if r["meta"] else {}
        r["resources"] = json.loads(r["resources"]) if r["resources"] else []
        r["workflow"] = json.loads(r["workflow"]) if r["workflow"] else {}
    conn.close()
    return rows


def get_image_detail(img_id):
    conn = _db()
    c = conn.cursor()
    c.execute("""
        SELECT i.*, m.name as model_name, m.type as model_type, m.base_model,
               mv.name as version_name, m.tags as model_tags, m.creator
        FROM images i
        JOIN model_versions mv ON i.model_version_id = mv.id
        JOIN models m ON mv.model_id = m.id
        WHERE i.civitai_image_id = ?
    """, (img_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        return {"error": "Not found"}
    r = dict(row)
    for k in ("meta", "resources", "workflow", "model_tags"):
        r[k] = json.loads(r[k]) if r.get(k) else ([] if k != "meta" else {})
    return r


def get_stats():
    conn = _db()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM models"); models = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM model_versions"); versions = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM images"); images = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM images WHERE nsfw = 1"); nsfw = c.fetchone()[0]
    c.execute("SELECT AVG(steps), AVG(cfg_scale) FROM images WHERE steps BETWEEN 1 AND 200")
    avg_steps, avg_cfg = c.fetchone()
    c.execute("SELECT COUNT(*) FROM images WHERE steps BETWEEN 1 AND 200")
    steps_with_data = c.fetchone()[0]
    conn.close()
    return {"models": models, "versions": versions, "images": images, "nsfw_images": nsfw,
            "avg_steps": round(avg_steps, 1) if avg_steps else 0,
            "avg_cfg": round(avg_cfg, 2) if avg_cfg else 0,
            "steps_with_data": steps_with_data}


# ---------- Prompt enhancement (Gemini) ----------
def enhance_prompt(system_prompt, user_prompt):
    """Ameliore un prompt via l'API Gemini."""
    if not GEMINI_API_KEY:
        return {"error": "GEMINI_API_KEY non configure"}
    try:
        payload = json.dumps({
            "contents": [{"parts": [{"text": user_prompt}]}],
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "generationConfig": {
                "temperature": 0.9,
                "maxOutputTokens": 1024,
                "responseMimeType": "application/json",
            },
        }).encode()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        resp = json.loads(urllib.request.urlopen(req, timeout=60).read())
        text = resp["candidates"][0]["content"]["parts"][0]["text"]
        # Nettoyer le JSON (parfois Gemini ajoute du markdown)
        text = text.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        try:
            parsed = json.loads(text)
            return parsed
        except json.JSONDecodeError:
            return {"positive": text, "negative": ""}
    except Exception as e:
        return {"error": str(e)}


# ---------- Safetensors header reading ----------
def read_safetensors_header(filepath):
    """Lit le header d'un fichier .safetensors sans torch."""
    try:
        if not os.path.isfile(filepath):
            return {"error": "fichier introuvable", "filepath": filepath}
        with open(filepath, "rb") as f:
            header_size_bytes = f.read(8)
            if len(header_size_bytes) < 8:
                return {"error": "fichier trop court"}
            header_size = struct.unpack("<Q", header_size_bytes)[0]
            if header_size > 50_000_000:
                return {"error": "header trop gros"}
            header_json = f.read(header_size)
            if len(header_json) < header_size:
                return {"error": "header tronque"}
            header = json.loads(header_json.decode("utf-8", errors="replace"))
        metadata = header.get("__metadata__", {})
        tensors = [k for k in header.keys() if k != "__metadata__"]
        return {"metadata": metadata, "tensors": tensors[:200], "tensor_count": len(tensors)}
    except Exception as e:
        return {"error": str(e)}


# ---------- File listing pour scanner frontend ----------
def list_model_files():
    """Liste tous les fichiers modeles dans ComfyUI pour le scanner frontend."""
    files = []
    if not os.path.isdir(MODELS_DIR):
        return files
    for root, dirs, filenames in os.walk(MODELS_DIR):
        for fn in filenames:
            if not fn.lower().endswith((".safetensors", ".ckpt", ".pt", ".pth", ".gguf")):
                continue
            full = os.path.join(root, fn)
            try:
                size = os.path.getsize(full)
            except OSError:
                size = 0
            rel = os.path.relpath(full, MODELS_DIR)
            folder = rel.split(os.sep)[0] if os.sep in rel else "root"
            files.append({
                "path": full,
                "name": fn,
                "stem": os.path.splitext(fn)[0],
                "folder": folder,
                "rel_path": rel.replace(os.sep, "/"),
                "size": size,
                "ext": os.path.splitext(fn)[1].lower(),
            })
    return files


# ---------- ComfyUI execution bridge ----------
COMFYUI_URL = "http://127.0.0.1:8188"


def _comfy_get(path, timeout=20):
    """GET vers ComfyUI, leve en cas d'echec."""
    with urllib.request.urlopen(f"{COMFYUI_URL}{path}", timeout=timeout) as r:
        return json.loads(r.read())


def _comfy_post_prompt(prompt_dict, force_validate=False):
    """POST /prompt. Retourne {ok, prompt_id} ou {ok:False, error, node_errors, messages}."""
    payload = json.dumps({"prompt": prompt_dict}).encode()
    req = urllib.request.Request(f"{COMFYUI_URL}/prompt", data=payload,
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            data = json.loads(r.read())
        return {"ok": True, "prompt_id": data.get("prompt_id"),
                "node_errors": data.get("node_errors") or {}}
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read())
        except Exception:
            detail = {}
        # Analyse les erreurs de validation pour un message lisible
        node_errors = detail.get("node_errors") or {}
        msgs = []
        for nid, info in node_errors.items():
            for err in (info.get("errors") or []):
                field = (err.get("extra_info") or {}).get("input_name")
                msgs.append(f"nœud {nid} ({info.get('class_type', '?')})"
                            + (f" · champ « {field} »" if field else "")
                            + f" : {err.get('message', '')}")
        return {"ok": False, "error": detail.get("error", {}).get("message", str(e)),
                "node_errors": node_errors, "messages": msgs}
    except Exception as e:
        return {"ok": False, "error": f"ComfyUI injoignable : {e}"}


def comfy_run(prompt_dict):
    """Envoie un graphe (format ComfyUI) a ComfyUI pour EXECUTION."""
    return _comfy_post_prompt(prompt_dict)


def comfy_validate(prompt_dict):
    """Valide un graphe sans le laisser s'executer.

    ComfyUI n'a pas de mode dry-run (ni validate_only dans le corps, ni
    header) : la seule facon de valider un graphe est de l'envoyer. On le
    retire donc aussitot, puis on attend que la file soit vide pour ne pas
    laisser le prochain appel se mettre derriere un job qui meurt.
    """
    res = _comfy_post_prompt(prompt_dict)
    if not (res.get("ok") and res.get("prompt_id")):
        return {"valid": False, "error": res.get("error"),
                "node_errors": res.get("node_errors") or {},
                "messages": res.get("messages") or []}
    _drop_prompt(res["prompt_id"])
    return {"valid": True, "prompt_id": res["prompt_id"],
            "node_errors": res.get("node_errors") or {}, "messages": []}


def _drop_prompt(prompt_id, wait_empty=True):
    """Retire un prompt de la file et attend qu'elle soit vide.

    ComfyUI execute un prompt a la fois : sans cette attente, valider N
    workflows enchaines fait s'empiler les jobs et le dernier met 2 s par
    workflow a attendre que le precedent meure.
    """
    # 1. Retirer de la file d'attente si possible (non bloquant)
    try:
        body = json.dumps({"delete": [prompt_id]}).encode()
        req = urllib.request.Request(f"{COMFYUI_URL}/queue", data=body,
                                     headers={"Content-Type": "application/json"},
                                     method="POST")
        urllib.request.urlopen(req, timeout=5).read()
    except Exception:
        pass
    # 2. Il est probablement deja en cours -> on interrompt
    try:
        req = urllib.request.Request(f"{COMFYUI_URL}/interrupt", data=b"{}",
                                     headers={"Content-Type": "application/json"},
                                     method="POST")
        urllib.request.urlopen(req, timeout=5).read()
    except Exception:
        pass
    if not wait_empty:
        return False
    # 3. Attendre que la file soit vide (max 5 s)
    deadline = time.time() + 5
    while time.time() < deadline:
        try:
            q = _comfy_get("/queue", timeout=3)
        except Exception:
            return False
        if not (q.get("queue_running") or q.get("queue_pending")):
            return True
        time.sleep(0.15)
    return False


def _warmup_prompt(base="klein"):
    '''Renvoie un graph ComfyUI minimal chargeur de modele base.

    Objectif : declencher le chargement lazy du UNET + CLIP en VRAM sans
    produire d effit utile cote utilisateur. Sert au pre-chargement.'''
    try:
        if base == "klein":
            last = str(9000)
            return {
                "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux-2-klein-4b.safetensors", "weight_dtype": "default"}},
                "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "flux2"}},
                "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "a woman", "clip": ["2", 0]}},
                "4": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": 256, "height": 256, "batch_size": 1}},
                "5": {"class_type": "Flux2Scheduler", "inputs": {"steps": 1, "width": 256, "height": 256}},
                "6": {"class_type": "CFGGuider", "inputs": {"model": ["1", 0], "positive": ["3", 0], "negative": ["3", 0], "cfg": 1}},
                "7": {"class_type": "RandomNoise", "inputs": {"noise_seed": 1}},
                "8": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
                "9": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["7", 0], "guider": ["6", 0], "sampler": ["8", 0], "sigmas": ["5", 0], "latent_image": ["4", 0]}},
                "10": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
                "11": {"class_type": "VAEDecode", "inputs": {"samples": ["9", 0], "vae": ["10", 0]}},
                "12": {"class_type": "SaveImage", "inputs": {"filename_prefix": "flux_studio/_warmup", "images": ["11", 0]}},
            }
        if base == "sdxl":
            return {
                "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sd_xl_base_1.0.safetensors"}},
                "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "a woman", "clip": ["1", 1]}},
                "3": {"class_type": "EmptyLatentImage", "inputs": {"width": 256, "height": 256, "batch_size": 1}},
                "4": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "seed": 1, "steps": 1, "cfg": 7,
                                           "sampler_name": "euler", "scheduler": "normal",
                                           "positive": ["2", 0], "negative": ["2", 0],
                                           "latent_image": ["3", 0], "denoise": 1}},
                "5": {"class_type": "VAEDecode", "inputs": {"samples": ["4", 0], "vae": ["1", 2]}},
                "6": {"class_type": "SaveImage", "inputs": {"filename_prefix": "flux_studio/_warmup", "images": ["5", 0]}},
            }
    except Exception:
        return None


def _run_warmup(prompt):
    '''Lance le prompt en arriere-plan pour charger les modeles.'''
    try:
        _comfy_post_prompt(prompt)
        # Attendre que la file soit vide (max 3 min)
        deadline = time.time() + 180
        while time.time() < deadline:
            try:
                q = _comfy_get("/queue", timeout=10)
            except Exception:
                return
            if not (q.get("queue_running") or q.get("queue_pending")):
                # Libère la mémoire pour ne pas laisser tout chargé
                try:
                    body = json.dumps({"unload_models": False, "free_memory": False}).encode()
                    urllib.request.Request(_COMFYUI_URL if False else COMFYUI_URL + "/free",
                                       data=body,
                                       headers={"Content-Type": "application/json"},
                                       method="POST")
                except Exception:
                    pass
                return
            time.sleep(1.0)
    except Exception:
        pass


def comfy_history(prompt_id):
    """Etat d'une execution : pending / done / error + images produites."""
    try:
        data = _comfy_get(f"/history/{urllib.parse.quote(prompt_id)}", timeout=20)
    except Exception as e:
        return {"status": "error", "error": f"ComfyUI injoignable : {e}"}
    entry = data.get(prompt_id)
    if not entry:
        return {"status": "pending"}
    st = entry.get("status") or {}
    imgs = []
    for nid, out in (entry.get("outputs") or {}).items():
        for key in ("images", "gifs"):
            for im in out.get(key, []) or []:
                imgs.append({"node": nid, "filename": im.get("filename"),
                             "subfolder": im.get("subfolder", ""), "type": im.get("type", "output")})
    err_msg = None
    err_node = None
    for m in st.get("messages", []) or []:
        if isinstance(m, (list, tuple)) and len(m) >= 2 and m[0] == "execution_error":
            d = m[1] or {}
            err_msg = d.get("exception_message") or "erreur d'execution"
            err_node = f"{d.get('node_type', '?')}#{d.get('node_id', '?')}"
    if st.get("status_str") == "error":
        return {"status": "error", "error": err_msg, "node": err_node, "images": imgs}
    if st.get("completed"):
        return {"status": "done", "images": imgs}
    return {"status": "pending", "images": imgs}


def comfy_queue():
    """Lecture seule de la file d'attente ComfyUI.

    NE DOIT PAS interrompre le job en cours : le client polling cette route
    toutes les secondes tuerait sa propre generation. L'interruption est
    exposee via comfy_interrupt() sur POST /api/comfyui/interrupt.
    """
    try:
        q = _comfy_get("/queue", timeout=10)
    except Exception as e:
        return {"error": f"ComfyUI injoignable : {e}", "queue_running": [], "queue_pending": []}
    running = q.get("queue_running") or []
    pending = q.get("queue_pending") or []
    # Numero de prompt en cours d'execution, si identifiable
    current = None
    for item in running:
        try:
            current = item[1]
            break
        except (TypeError, IndexError):
            pass
    return {
        "queue_running": running,
        "queue_pending": pending,
        "running": len(running),
        "pending": len(pending),
        "current_prompt_id": current,
        "busy": bool(running),
    }


def comfy_free(unload_models=True, free_memory=True):
    """Decharge les modeles charges par ComfyUI.

    Indispensable sur une carte 12 Go : en enchainant les modeles (FLUX.1 ->
    Klein -> SDXL), ComfyUI garde le precedent en cache et le GPU sature,
    ce qui fait tomber la generation a 10x plus lentement.
    """
    try:
        body = json.dumps({"unload_models": bool(unload_models),
                           "free_memory": bool(free_memory)}).encode()
        req = urllib.request.Request(f"{COMFYUI_URL}/free", data=body,
                                     headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as e:
        return {"ok": False, "error": str(e)}
    try:
        st = _comfy_get("/system_stats", timeout=10)
        dev = (st.get("devices") or [{}])[0]
        return {
            "ok": True,
            "vram_total": dev.get("vram_total"),
            "vram_free": dev.get("vram_free"),
            "ram_free": (st.get("system") or {}).get("ram_free"),
        }
    except Exception:
        return {"ok": True}


def comfy_interrupt():
    """Arrete le job en cours (POST explicite uniquement)."""
    try:
        req = urllib.request.Request(f"{COMFYUI_URL}/interrupt", data=b"{}",
                                     headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=5).read()
        return {"ok": True, "interrupted": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def comfy_models_list():
    """Noms de fichiers reellement installes, par categorie (pour les widgets)."""
    cats = {
        "checkpoints": (os.path.join(MODELS_DIR, "checkpoints"), ".safetensors"),
        "diffusion_models": (os.path.join(MODELS_DIR, "diffusion_models"), ".safetensors"),
        "unet": (os.path.join(MODELS_DIR, "unet"), ".safetensors"),
        "loras": (os.path.join(MODELS_DIR, "loras"), ".safetensors"),
        "vae": (os.path.join(MODELS_DIR, "vae"), ".safetensors"),
        "clip": (os.path.join(MODELS_DIR, "clip"), ".safetensors"),
        "controlnet": (os.path.join(MODELS_DIR, "controlnet"), ".safetensors"),
        "upscale_models": (os.path.join(MODELS_DIR, "upscale_models"), ".pth"),
        "clip_vision": (os.path.join(MODELS_DIR, "clip_vision"), ".safetensors"),
        "embeddings": (os.path.join(MODELS_DIR, "embeddings"), ".safetensors"),
    }

    # Source de verite = les listes de validation de ComfyUI lui-meme.
    # Sous Windows, ComfyUI renvoie des separateurs "\", et /prompt refuse
    # toute valeur absente de ces listes ("Value not in list"). Un scan
    # disque maison avec "/" echouerait sur les 473/475 LoRA en sous-dossier.
    #
    # Plusieurs noeuds peuvent alimenter la meme categorie : on prend
    # l'union, ce qui est sur-ensemble (donc sur pour un selecteur) mais
    # reste correct tant que l'utilisateur choisit un modele compatible.
    sources = {
        "checkpoints": [("CheckpointLoaderSimple", "ckpt_name")],
        # UNETLoader et UnetLoaderGGUF ne partagent PAS les memes fichiers :
        # on les garde separees sinon un .gguf serait propose a UNETLoader.
        "diffusion_models": [("UNETLoader", "unet_name")],
        "unet_gguf": [("UnetLoaderGGUF", "unet_name")],
        "unet": [("UNETLoader", "unet_name")],
        "loras": [("LoraLoader", "lora_name")],
        "vae": [("VAELoader", "vae_name")],
        "clip": [("DualCLIPLoader", "clip_name1"), ("CLIPLoader", "clip_name")],
        "controlnet": [("ControlNetLoader", "control_net_name")],
        # Le noeud natif UpscaleModelLoader serialise son combo en "COMBO"
        # dans object_info (nouveau schema io.Combo) : on complete avec les
        # packs custom qui exposent la vraie liste.
        "upscale_models": [("UpscaleModelLoader", "model_name"),
                           ("Upscale Model Loader", "model_name")],
        "clip_vision": [("CLIPVisionLoader", "clip_name")],
        "embeddings": [],
    }

    try:
        oi = _comfy_get("/object_info", timeout=60)
    except Exception:
        oi = {}

    def from_comfy(cat):
        names = []
        for node, field in sources.get(cat, []):
            d = (oi or {}).get(node)
            if not d:
                continue
            spec = ((d.get("input") or {}).get("required") or {}).get(field)
            if isinstance(spec, (list, tuple)) and spec:
                spec = spec[0]
            if isinstance(spec, list):
                names.extend(x for x in spec if isinstance(x, str))
        return sorted(set(names))

    cats.setdefault("unet_gguf", (os.path.join(MODELS_DIR, "unet"), ".gguf"))
    out = {}
    sources_used = {}
    for cat, (folder, ext) in cats.items():
        names = from_comfy(cat)
        source = "comfyui"
        if not names:
            # Repli : scan disque, mais on garde os.sep pour rester compatible
            source = "disque"
            if os.path.isdir(folder):
                for root, _dirs, files in os.walk(folder):
                    for fn in files:
                        if fn.lower().endswith(ext):
                            names.append(os.path.relpath(os.path.join(root, fn), folder))
        out[cat] = sorted(set(names))
        sources_used[cat] = source
    out["_source"] = sources_used
    return out


def comfy_node_info():
    """Signatures des noeuds ComfyUI disponibles (entrees/sorties), pour le registre."""
    try:
        oi = _comfy_get("/object_info", timeout=60)
    except Exception as e:
        return {"error": f"ComfyUI injoignable : {e}"}
    out = {}
    for name, d in oi.items():
        inp = d.get("input") or {}
        req = list((inp.get("required") or {}).keys())
        opt = list((inp.get("optional") or {}).keys())
        combos = {}
        for sect in ("required", "optional"):
            for k, v in (inp.get(sect) or {}).items():
                o = v[0] if isinstance(v, (list, tuple)) else v
                if isinstance(o, list) and all(isinstance(x, str) for x in o):
                    combos[k] = o[:80]
        out[name] = {
            "required": req, "optional": opt,
            "output": d.get("output") or [],
            "combo": combos,
        }
    return out


LORA_INDEX_PATH = os.path.join(BASE_DIR, "data", "lora_index.json")
_LORA_INDEX_CACHE = {"mtime": None, "data": None}


def load_lora_index():
    """Charge data/lora_index.json en cache, invalide sur modification."""
    try:
        mtime = os.path.getmtime(LORA_INDEX_PATH)
    except OSError:
        return {"count": 0, "stats": {}, "items": [], "error": "index absent — lance scraper/build_lora_index.py"}
    if _LORA_INDEX_CACHE["mtime"] != mtime:
        with open(LORA_INDEX_PATH, "r", encoding="utf-8") as f:
            _LORA_INDEX_CACHE["data"] = json.load(f)
        _LORA_INDEX_CACHE["mtime"] = mtime
    return _LORA_INDEX_CACHE["data"] or {"count": 0, "stats": {}, "items": []}


# ---------- Workflow builders ----------
def build_generate_workflow(model, prompt, width, height, steps, cfg, sampler, scheduler, seed, vae, clip):
    """Construit un workflow ComfyUI selon le modèle choisi."""
    neg_prompt = ""
    
    # Defaults par modèle
    if model == "Flux.2 Klein 4B":
        ckpt = "flux2_klein_4b.safetensors"
        vae_name = vae if vae != "auto" else "ae.safetensors"
        clip1 = "t5xxl_fp8_e4m3fn.safetensors"
        clip2 = "clip_l.safetensors"
        loader = "DualCLIPLoader"
        latent = "EmptyFlux2LatentImage"
        guider = "BasicGuider"
        sampler_node = "KSampler"
        return {
            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
            "2": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
            "3": {"class_type": "CLIPTextEncode", "inputs": {"text": neg_prompt, "clip": ["4", 1]}},
            "4": {"class_type": loader, "inputs": {"clip_name1": clip1, "clip_name2": clip2}},
            "5": {"class_type": sampler_node, "inputs": {"model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["6", 0], "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": sampler, "scheduler": scheduler}},
            "6": {"class_type": latent, "inputs": {"width": width, "height": height, "batch_size": 1}},
            "7": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["8", 0]}},
            "8": {"class_type": "VAELoader", "inputs": {"vae_name": vae_name}},
            "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "flux_studio", "images": ["7", 0]}},
        }
    
    elif model == "Flux.1 D":
        ckpt = "flux1-dev.safetensors"
        vae_name = vae if vae != "auto" else "ae.safetensors"
        clip1 = "t5xxl_fp8_e4m3fn.safetensors"
        clip2 = "clip_l.safetensors"
        return {
            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
            "2": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
            "3": {"class_type": "CLIPTextEncode", "inputs": {"text": neg_prompt, "clip": ["4", 1]}},
            "4": {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": clip1, "clip_name2": clip2}},
            "5": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["6", 0], "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": sampler, "scheduler": scheduler}},
            "6": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
            "7": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["8", 0]}},
            "8": {"class_type": "VAELoader", "inputs": {"vae_name": vae_name}},
            "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "flux_studio", "images": ["7", 0]}},
        }
    
    elif model == "SDXL":
        ckpt = "juggernautXL_v9.safetensors"
        vae_name = vae if vae != "auto" else "sdxl_vae.safetensors"
        return {
            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
            "2": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
            "3": {"class_type": "CLIPTextEncode", "inputs": {"text": neg_prompt, "clip": ["4", 2]}},
            "4": {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": "clip_g.safetensors", "clip_name2": "clip_l.safetensors"}},
            "5": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["6", 0], "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": sampler, "scheduler": scheduler}},
            "6": {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
            "7": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["8", 0]}},
            "8": {"class_type": "VAELoader", "inputs": {"vae_name": vae_name}},
            "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "flux_studio", "images": ["7", 0]}},
        }
    
    else:
        # Fallback Flux
        ckpt = "flux2_klein_4b.safetensors"
        vae_name = "ae.safetensors"
        return {
            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
            "2": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
            "3": {"class_type": "CLIPTextEncode", "inputs": {"text": neg_prompt, "clip": ["4", 1]}},
            "4": {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": "t5xxl_fp8_e4m3fn.safetensors", "clip_name2": "clip_l.safetensors"}},
            "5": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0], "latent_image": ["6", 0], "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": sampler, "scheduler": scheduler}},
            "6": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
            "7": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["8", 0]}},
            "8": {"class_type": "VAELoader", "inputs": {"vae_name": vae_name}},
            "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "flux_studio", "images": ["7", 0]}},
        }


# ---------- HTTP ----------
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=STATIC_DIR, **k)

    def log_message(self, *a):
        pass

    def end_headers(self):
        # HTML/JS/CSS : toujours revalider (evite de servir un app.js obsoletes)
        try:
            buf = getattr(self, "_headers_buffer", [])
        except Exception:
            buf = []
        if not any(h.lower().startswith(b"cache-control:") for h in buf):
            p = self.path.split("?", 1)[0]
            if p == "/api/proxy":
                pass  # deja géré dans _proxy
            elif (p.startswith("/api/") or p in ("/", "/index.html", "/app.js", "/app.css", "/comfyui")
                  or p.endswith(".js") or p.endswith(".css") or p.endswith(".html")):
                self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass  # client parti (navigation, onglet ferme) : rien a signaler

    def do_GET(self):
        parsed = urlparse(self.path)
        path, query = parsed.path, parse_qs(parsed.query)
        try:
            if path == "/api/models":        return self.send_json(get_models())
            if path == "/api/images":        return self.send_json(get_images(query))
            if path == "/api/image":         return self.send_json(get_image_detail(query.get("id", [None])[0]))
            if path == "/api/stats":         return self.send_json(get_stats())
            if path == "/api/categories":    return self.send_json(get_categories())
            if path == "/api/comfyui/local": return self.send_json(scan_comfyui_models(force=query.get("force") == ["1"]))
            if path == "/api/comfyui/profile": return self.send_json(comfyui_profile())
            if path == "/api/comfyui/search":
                mg = query.get("max_gb", [None])[0]
                return self.send_json(civitai_search(
                    query.get("q", [""])[0],
                    query.get("type", [None])[0],
                    query.get("base", [None])[0],
                    int(query.get("nsfw_max", ["4"])[0]),
                    int(query.get("limit", ["40"])[0]),
                    query.get("men", [None])[0],
                    float(mg) if mg else None,
                    query.get("cursor", [None])[0]))
            if path == "/api/comfyui/downloads":
                with _dl_lock:
                    return self.send_json(sorted(_downloads.values(), key=lambda d: d["started_at"], reverse=True))
            if path == "/api/comfyui/ollama":
                return self.send_json(self._ollama_probe())
            if path == "/api/comfyui/image":
                return self._comfy_image(
                    query.get("filename", [""])[0],
                    query.get("subfolder", [""])[0],
                    query.get("type", ["output"])[0])
            if path == "/api/comfyui/history":
                return self.send_json(comfy_history(query.get("id", [""])[0]))
            if path == "/api/comfyui/queue":
                return self.send_json(comfy_queue())
            if path == "/api/comfyui/scan-files":
                return self.send_json(list_model_files())
            if path == "/api/lora-index":
                return self.send_json(load_lora_index())
            if path == "/api/lora-preview":
                return self._lora_preview(query.get("path", [""])[0])
            if path == "/api/comfyui/models":
                return self.send_json(comfy_models_list())
            if path == "/api/comfyui/nodeinfo":
                return self.send_json(comfy_node_info())
            if path == "/api/proxy":
                return self._proxy(query.get("url", [""])[0])
        except Exception as e:
            return self.send_json({"error": str(e)}, 500)

        if path in ("/", "/index.html", "/comfyui"):
            self.path = "/index.html"
        return super().do_GET()

    def _ollama_probe(self):
        return {
            "gemini": {"available": bool(GEMINI_API_KEY), "model": GEMINI_MODEL, "key_set": bool(GEMINI_API_KEY)},
            "ollama": self._ollama_raw(),
        }

    def _ollama_raw(self):
        try:
            tags = json.loads(urllib.request.urlopen("http://localhost:11434/api/tags", timeout=3).read())
            return {"available": True, "models": [m["name"] for m in tags.get("models", [])]}
        except Exception as e:
            return {"available": False, "error": str(e)}

    def _lora_preview(self, rel):
        """Sert la vignette d'un LoRA (jpeg/webp/png voisin du .safetensors).

        Accepte les deux conventions de separateur : `path` utilise le format
        ComfyUI (\\ sous Windows), `webPath` le format URL (/).
        """
        loras_dir = os.path.normpath(os.path.join(MODELS_DIR, "loras"))
        rel = (rel or "").replace("\\", "/").replace("/", os.sep)
        full = os.path.normpath(os.path.join(loras_dir, rel))
        # Anti-traversement : le chemin resolu doit rester sous loras_dir
        if not (full == loras_dir or full.startswith(loras_dir + os.sep)):
            return self.send_json({"error": "chemin invalide"}, 400)
        stem = os.path.splitext(full)[0]
        for ext in (".jpeg", ".jpg", ".png", ".webp"):
            p = stem + ext
            if os.path.isfile(p):
                ctype = {".jpeg": "image/jpeg", ".jpg": "image/jpeg",
                         ".png": "image/png", ".webp": "image/webp"}[ext]
                try:
                    with open(p, "rb") as f:
                        data = f.read()
                    self.send_response(200)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Cache-Control", "public, max-age=86400")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                    pass
                return
        self.send_json({"error": "pas de vignette"}, 404)

    def _comfy_image(self, filename, subfolder="", itype="output"):
        """Sert une image produite par ComfyUI (via /view)."""
        if not filename:
            return self.send_json({"error": "filename manquant"}, 400)
        params = urllib.parse.urlencode({"filename": filename, "subfolder": subfolder, "type": itype})
        try:
            with urllib.request.urlopen(f"{COMFYUI_URL}/view?{params}", timeout=30) as r:
                data = r.read()
                ctype = r.headers.get("Content-Type", "image/png")
        except Exception as e:
            return self.send_json({"error": str(e)}, 502)
        try:
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "public, max-age=3600")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass

    def _proxy(self, url):
        if not url.startswith("http"):
            return self.send_json({"error": "url invalide"}, 400)

        cp = cache_path_for(url)
        data = None
        ctype = "image/jpeg"
        # 1) cache disque
        try:
            with open(cp, "rb") as f:
                data = f.read()
            with open(cp + ".type", "r", encoding="utf-8") as f:
                ctype = f.read().strip() or ctype
        except OSError:
            data = None

        # 2) telechargement + mise en cache (avec tentatives : Civitai limite le debit)
        if data is None:
            last_err = "erreur inconnue"
            for attempt in range(3):
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": CIVITAI_HEADERS["User-Agent"], "Referer": "https://civitai.com/"})
                    with urllib.request.urlopen(req, timeout=30) as r:
                        data = r.read()
                        ctype = r.headers.get("Content-Type", "image/jpeg")
                    last_err = None
                    break
                except Exception as e:
                    last_err = str(e)
                    time.sleep(0.7 * (attempt + 1))
            if data is None:
                return self.send_json({"error": last_err}, 502)
            try:
                os.makedirs(os.path.dirname(cp), exist_ok=True)
                with open(cp, "wb") as f:
                    f.write(data)
                with open(cp + ".type", "w", encoding="utf-8") as f:
                    f.write(ctype)
            except OSError:
                pass

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "public, max-age=604800")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            if path == "/api/comfyui/interrupt":
                return self.send_json(comfy_interrupt())
            if path == "/api/comfyui/validate":
                n = int(self.headers.get("Content-Length", 0) or 0)
                body = json.loads(self.rfile.read(n) or b"{}")
                prompt = body.get("prompt")
                if not isinstance(prompt, dict) or not prompt:
                    return self.send_json({"valid": False, "error": "prompt vide",
                                           "messages": ["prompt vide"]}, 400)
                return self.send_json(comfy_validate(prompt))
            if path == "/api/comfyui/free":
                n = int(self.headers.get("Content-Length", 0) or 0)
                body = json.loads(self.rfile.read(n) or b"{}")
                return self.send_json(comfy_free(
                    body.get("unload_models", True), body.get("free_memory", True)))
            if path == "/api/comfyui/run":
                n = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(n) or b"{}")
                prompt = body.get("prompt")
                if not isinstance(prompt, dict) or not prompt:
                    return self.send_json({"ok": False, "error": "prompt vide"}, 400)
                res = comfy_run(prompt)
                return self.send_json(res, 200 if res.get("ok") else 400)
            if path == "/api/comfyui/download":
                n = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(n) or b"{}")
                did = start_download(int(body["model_id"]), int(body["version_id"]),
                                     int(body["file_id"]) if body.get("file_id") else None)
                return self.send_json({"download_id": did})
            if path == "/api/comfyui/describe":
                return self._handle_describe()
            if path == "/api/comfyui/enhance-prompt":
                n = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(n) or b"{}")
                return self.send_json(enhance_prompt(
                    body.get("systemPrompt", ""),
                    body.get("userPrompt", "")))
            if path == "/api/comfyui/read-header":
                n = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(n) or b"{}")
                filepath = body.get("filepath", "")
                return self.send_json(read_safetensors_header(filepath))
            if path == "/api/comfyui/upload-image":
                # Proxy vers ComfyUI /upload/image (multipart), enregistre dans input/
                boundary = self.headers.get("Content-Type", "")
                if "multipart/form-data" not in boundary:
                    return self.send_json({"error": "multipart attendu"}, 400)
                length = int(self.headers.get("Content-Length", 0))
                raw = self.rfile.read(length)
                # ComfyUI attend le champ "image" (pas "file")
                raw = raw.replace(b'name="file"', b'name="image"')
                req = urllib.request.Request("http://127.0.0.1:8188/upload/image", data=raw,
                    headers={"Content-Type": boundary}, method="POST")
                try:
                    with urllib.request.urlopen(req, timeout=60) as r:
                        data = json.loads(r.read())
                    return self.send_json(data)
                except Exception as e:
                    return self.send_json({"error": str(e)}, 502)
            if path == "/api/comfyui/warmup":
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0) or 0)) or b"{}")
                base = (body.get("base") or "klein").lower()
                if base not in ("klein", "flux1", "sdxl", "sd15"):
                    base = "klein"
                prompt = _warmup_prompt(base)
                if not prompt:
                    return self.send_json({"ok": False, "error": "base non supportée"})
                # Fire-and-forget : ne bloque pas la reponse, exécution en arrière-plan
                import threading
                threading.Thread(target=_run_warmup, args=(prompt,), daemon=True).start()
                return self.send_json({"ok": True, "message": "Pré-chargement lancé"})

            if path == "/api/comfyui/open-folder":
                n = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(n) or b"{}")
                folder = body.get("folder", "")
                if not folder or not os.path.isdir(folder):
                    return self.send_json({"ok": False, "error": "Dossier introuvable"})
                try:
                    os.startfile(folder)
                    return self.send_json({"ok": True})
                except Exception as e:
                    return self.send_json({"ok": False, "error": str(e)})
            if path == "/api/comfyui/delete-model":
                n = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(n) or b"{}")
                filepath = body.get("filepath", "")
                if not filepath or not os.path.isfile(filepath):
                    return self.send_json({"ok": False, "error": "Fichier introuvable"})
                # Sécurité : ne supprimer que dans le dossier models
                abs_path = os.path.abspath(filepath)
                abs_models = os.path.abspath(MODELS_DIR)
                if not abs_path.startswith(abs_models):
                    return self.send_json({"ok": False, "error": "Hors du dossier models"})
                try:
                    os.remove(filepath)
                    return self.send_json({"ok": True})
                except Exception as e:
                    return self.send_json({"ok": False, "error": str(e)})
            if path == "/api/comfyui/generate":
                n = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(n) or b"{}")
                prompt = (body.get("prompt") or "").strip()
                if not prompt:
                    return self.send_json({"error": "prompt manquant"}, 400)
                steps = int(body.get("steps") or 24)
                cfg = float(body.get("cfg") or 3.5)
                width = int(body.get("width") or 768)
                height = int(body.get("height") or 1152)
                sampler = body.get("sampler") or "euler"
                scheduler = body.get("scheduler") or "simple"
                seed = int(body.get("seed") or -1)
                if seed < 0:
                    import random
                    seed = random.randint(0, 2**31 - 1)
                vae = body.get("vae") or "auto"
                clip = body.get("clip") or "auto"
                model = body.get("model") or "Flux.2 Klein 4B"
                
                # Build workflow based on model
                wf = build_generate_workflow(model, prompt, width, height, steps, cfg, sampler, scheduler, seed, vae, clip)
                
                try:
                    req = urllib.request.Request(
                        "http://127.0.0.1:8188/prompt",
                        data=json.dumps({"prompt": wf}).encode(),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    with urllib.request.urlopen(req, timeout=10) as r:
                        r.read()
                    return self.send_json({"ok": True, "message": "Envoyé à ComfyUI"})
                except Exception as e:
                    return self.send_json({"error": f"ComfyUI injoignable: {e}"}, 502)
            if path == "/api/comfyui/save_workflow":
                n = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(n) or b"{}")
                name = re.sub(r'[^A-Za-z0-9_\-\. ]+', "", (body.get("name") or "workflow")).strip() or "workflow"
                wf = body.get("workflow")
                if wf is None:
                    return self.send_json({"error": "workflow manquant"}, 400)
                os.makedirs(WORKFLOWS_DIR, exist_ok=True)
                dest = os.path.join(WORKFLOWS_DIR, name + ".json")
                with open(dest, "w", encoding="utf-8") as f:
                    json.dump(wf, f, ensure_ascii=False, indent=2)
                scan_comfyui_models(force=True)
                return self.send_json({"ok": True, "path": dest})
        except Exception as e:
            return self.send_json({"error": str(e)}, 500)
        self.send_error(404)

    def _handle_describe(self):
        ctype = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in ctype:
            return self.send_json({"error": "multipart attendu"}, 400)
        boundary = ctype.split("boundary=")[1].strip().strip('"').encode()
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        filename, content = "image.png", b""
        for part in body.split(b"--" + boundary):
            if b"\r\n\r\n" not in part:
                continue
            head, _, data = part.partition(b"\r\n\r\n")
            if b'name="file"' in head:
                m = re.search(rb'filename="([^"]*)"', head)
                if m:
                    filename = m.group(1).decode("utf-8", "replace") or filename
                content = data.rstrip(b"\r\n")
                break
        if not content:
            return self.send_json({"error": "aucun fichier"}, 400)
        info = describe_image(content, filename)
        if self.headers.get("X-AI-Describe") == "1":
            tmp = os.path.join(STATIC_DIR, "_upload_tmp")
            with open(tmp, "wb") as f:
                f.write(content)
            info["ai"] = describe_with_vision(tmp)
            try:
                os.remove(tmp)
            except OSError:
                pass
        return self.send_json(info)


class QuietServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        et, ev, _ = sys.exc_info()
        if isinstance(ev, (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


if __name__ == "__main__":
    os.makedirs(STATIC_DIR, exist_ok=True)
    init_db()
    host = "127.0.0.1"
    if "--host" in sys.argv:
        idx = sys.argv.index("--host")
        if idx + 1 < len(sys.argv):
            host = sys.argv[idx + 1]
    print(f"Flux Studio  ->  http://{host}:{PORT}")
    print(f"DB: {DB_PATH}")
    print(f"ComfyUI: {MODELS_DIR}")
    QuietServer((host, PORT), Handler).serve_forever()
