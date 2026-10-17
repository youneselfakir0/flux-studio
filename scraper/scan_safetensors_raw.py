#!/usr/bin/env python3
"""
Scanner headers safetensors SANS torch -> classifier les LoRA "Inconnu".
Lit les 8 premiers octets (taille header) + header JSON (metadata + tensor_info).
"""
import os
import sys
import json
import sqlite3
import struct
from pathlib import Path

COMFYUI_ROOT = r"F:\f\ComfyUI"
MODELS_DIR = os.path.join(COMFYUI_ROOT, "models")
DB_PATH = r"C:\Users\administrator\flux-studio\data\flux_studio.db"

SCAN_DIRS = [
    os.path.join(MODELS_DIR, "loras"),
    os.path.join(MODELS_DIR, "checkpoints"),
    os.path.join(MODELS_DIR, "vae"),
    os.path.join(MODELS_DIR, "controlnet"),
    os.path.join(MODELS_DIR, "clip"),
    os.path.join(MODELS_DIR, "clip_vision"),
    os.path.join(MODELS_DIR, "unet"),
    os.path.join(MODELS_DIR, "embeddings"),
]

ARCH_PATTERNS = {
    "Flux.2 Klein 4B": [
        "double_blocks", "single_blocks", "lora_te1", "lora_te2",
        "flux", "transformer_blocks", "img_in", "txt_in", "final_layer",
        "lora_double", "lora_single", "guidance_embedder",
        "lora_transformer", "transformer.", "double_block", "single_block",
    ],
    "Flux.1 D": [
        "double_blocks", "single_blocks", "lora_te1", "lora_te2",
        "flux", "transformer_blocks", "img_in", "txt_in", "final_layer",
        "lora_double", "lora_single", "guidance_embedder",
        "lora_transformer", "transformer.", "double_block", "single_block",
    ],
    "SDXL": [
        "lora_unet", "lora_te1", "lora_te2", "conditioner", "add_embedding",
        "label_emb", "text_encoders", "transformer_blocks", "down_blocks", "up_blocks",
        "mid_block", "conv_in", "conv_out", "time_embedding",
        "diffusion_model", "model.diffusion_model", "input_blocks", "output_blocks",
    ],
    "Pony": [
        "lora_unet", "lora_te1", "lora_te2", "pony", "xl_",
    ],
    "Illustrious": [
        "lora_unet", "lora_te1", "lora_te2", "illustrious", "xl_",
    ],
    "NoobAI": [
        "lora_unet", "lora_te1", "lora_te2", "noobai", "xl_",
    ],
    "SD 1.5": [
        "lora_unet", "lora_te", "model.diffusion_model", "cond_stage_model",
        "first_stage_model", "input_blocks", "output_blocks", "middle_block",
        "model_ema", "control_model",
    ],
    "Qwen": [
        "qwen", "lora_qwen", "transformer_blocks", "patch_embed",
        "img_in", "txt_in", "final_layer", "guidance_embedder",
        "lora_transformer", "transformer.", "double_blocks", "single_blocks",
    ],
    "Z-Image": [
        "zimage", "lora_zimage", "double_blocks", "single_blocks",
    ],
    "LTX Video": [
        "ltx", "lora_ltx", "video", "temporal", "transformer_blocks",
    ],
}

ARCH_ORDER = [
    "Flux.2 Klein 4B",
    "Flux.1 D",
    "Qwen",
    "Z-Image",
    "LTX Video",
    "SDXL",
    "Pony",
    "Illustrious",
    "NoobAI",
    "SD 1.5",
]

CANONICAL_BASES = {
    "Flux.2 Klein 4B", "Flux.1 D", "SDXL", "Pony", "Illustrious",
    "NoobAI", "SD 1.5", "Qwen", "Z-Image", "LTX Video"
}

def read_safetensors_header(filepath):
    """Lit le header safetensors (JSON) sans torch. Retourne (metadata_dict, tensor_names_list)."""
    try:
        with open(filepath, "rb") as f:
            # 8 premiers octets = taille du header JSON (little-endian uint64)
            header_size_bytes = f.read(8)
            if len(header_size_bytes) < 8:
                return {"error": "fichier trop court"}, []
            header_size = struct.unpack("<Q", header_size_bytes)[0]
            if header_size > 10_000_000:  # sécurité
                return {"error": f"header trop gros ({header_size} octets)"}, []
            header_json = f.read(header_size)
            if len(header_json) < header_size:
                return {"error": "header tronque"}, []
            header = json.loads(header_json.decode("utf-8"))
        
        metadata = header.get("__metadata__", {})
        tensors = list(header.keys())
        # Filtrer __metadata__
        tensors = [t for t in tensors if t != "__metadata__"]
        return metadata, tensors
    except Exception as e:
        return {"error": str(e)}, []

def detect_arch(metadata, tensors):
    """Détecte l'architecture depuis metadata + noms de tenseurs."""
    meta_str = json.dumps(metadata, ensure_ascii=False).lower()
    tensor_str = " ".join(tensors).lower()
    
    # 1. Metadata explicite (kohya-ss, etc.)
    for base in ARCH_ORDER:
        if base in ("Flux.2 Klein 4B", "Flux.1 D"):
            if any(k in meta_str for k in ("flux", "double_blocks", "single_blocks", "flux1", "flux2")):
                return base
        elif base == "Qwen":
            if "qwen" in meta_str:
                return base
        elif base == "Z-Image":
            if "zimage" in meta_str:
                return base
        elif base == "LTX Video":
            if "ltx" in meta_str:
                return base
        elif base == "Pony":
            if "pony" in meta_str:
                return base
        elif base == "Illustrious":
            if "illustrious" in meta_str:
                return base
        elif base == "NoobAI":
            if "noobai" in meta_str:
                return base
        elif base == "SDXL":
            if any(k in meta_str for k in ("sdxl", "xl_", "sdxl_", "stable diffusion xl", "xl-")):
                return base

    # 2. Noms de tenseurs (plus fiable)
    scores = {}
    for base in ARCH_ORDER:
        patterns = ARCH_PATTERNS.get(base, [])
        score = 0
        for p in patterns:
            if p in tensor_str:
                score += 1
            # aussi check dans metadata
            if p in meta_str:
                score += 2
        if score > 0:
            scores[base] = score

    if scores:
        return max(scores, key=scores.get)

    # 3. Heuristique sur le nom de fichier
    return "Inconnu"

def main():
    print(f"=== Scan safetensors (raw header) dans {MODELS_DIR} ===")
    
    files = []
    for d in SCAN_DIRS:
        if os.path.isdir(d):
            for p in Path(d).rglob("*.safetensors"):
                files.append(p)
    
    print(f"Fichiers trouves: {len(files)}")
    
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    # DB models: map filename(stem).lower() -> (id, base_model)
    cur.execute("SELECT id, name, base_model FROM models WHERE type IN ('LORA','Checkpoint')")
    db_models = {row[1].lower(): (row[0], row[2]) for row in cur.fetchall()}
    print(f"Modeles en DB (LORA+Checkpoint): {len(db_models)}")
    
    updates = []
    unknown = []
    
    for i, fpath in enumerate(files):
        if i % 50 == 0:
            print(f"  [{i}/{len(files)}]")
        
        fname = fpath.stem.lower()
        rel_path = fpath.relative_to(MODELS_DIR).as_posix()
        
        metadata, tensors = read_safetensors_header(fpath)
        arch = detect_arch(metadata, tensors)
        
        if fname in db_models:
            model_id, current_base = db_models[fname]
            if current_base != arch and arch != "Inconnu":
                updates.append((model_id, arch, fname, rel_path))
            elif arch == "Inconnu":
                unknown.append((fname, rel_path, metadata, tensors[:10]))
        else:
            if arch != "Inconnu":
                pass  # nouveau fichier, pas en DB
            else:
                unknown.append((fname, rel_path, metadata, tensors[:10]))
    
    if updates:
        print(f"\n=== Application de {len(updates)} mises a jour ===")
        for model_id, arch, fname, _ in updates:
            cur.execute("UPDATE models SET base_model=? WHERE id=?", (arch, model_id))
            print(f"  {fname} -> {arch}")
        conn.commit()
        print("OK")
    else:
        print("\nAucune mise a jour necessaire.")
    
    if unknown:
        print(f"\n=== {len(unknown)} fichiers Inconnu (header lu mais architecture non detectee) ===")
        for fname, rel, meta, tensors in unknown[:30]:
            print(f"  {fname} ({rel})")
            if isinstance(meta, dict) and "error" not in meta and meta:
                print(f"    meta: {json.dumps(meta, ensure_ascii=False)[:150]}")
            print(f"    tensors: {tensors}")
        if len(unknown) > 30:
            print(f"  ... et {len(unknown) - 30} autres")
    
    # Stats finales
    cur.execute("SELECT base_model, count(*) FROM models WHERE type IN ('LORA','Checkpoint') GROUP BY base_model ORDER BY count(*) DESC")
    print("\n=== Modeles par base (apres scan) ===")
    for base, cnt in cur.fetchall():
        print(f"  {base or 'NULL'}: {cnt}")
    
    conn.close()

if __name__ == "__main__":
    main()