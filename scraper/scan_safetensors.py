#!/usr/bin/env python3
"""
Scanner headers safetensors -> classifier les LoRA "Inconnu" par architecture.
Lit les métadonnées du header + noms des tenseurs pour détecter :
- Flux (double_blocks, single_blocks, lora_te, lora_unet)
- SDXL (lora_unet, lora_te1, lora_te2, diffusers)
- SD 1.5 (lora_unet, lora_te)
- Pony/Illustrious/NoobAI (basés SDXL)
- Qwen (qwen_, lora_qwen)
- Z-Image (zimage, lora_zimage)
- LTX Video (ltx_, lora_ltx)
"""
import os
import sys
import json
import sqlite3
from pathlib import Path

COMFYUI_ROOT = r"F:\f\ComfyUI"
MODELS_DIR = os.path.join(COMFYUI_ROOT, "models")
DB_PATH = r"C:\Users\administrator\flux-studio\data\flux_studio.db"

# Dossiers à scanner (LoRA + checkpoints + VAE + etc.)
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

# Mots-clés pour identifier l'architecture depuis les noms de tenseurs / metadata
ARCH_PATTERNS = {
    "Flux.2 Klein 4B": [
        "double_blocks", "single_blocks", "lora_te1", "lora_te2",
        "flux", "transformer_blocks", "img_in", "txt_in", "final_layer",
        "lora_double", "lora_single", "guidance_embedder",
    ],
    "Flux.1 D": [
        "double_blocks", "single_blocks", "lora_te1", "lora_te2",
        "flux", "transformer_blocks", "img_in", "txt_in", "final_layer",
        "lora_double", "lora_single", "guidance_embedder",
    ],
    "SDXL": [
        "lora_unet", "lora_te1", "lora_te2", "conditioner", "add_embedding",
        "label_emb", "text_encoders", "transformer_blocks", "down_blocks", "up_blocks",
        "mid_block", "conv_in", "conv_out", "time_embedding",
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
    ],
    "Qwen": [
        "qwen", "lora_qwen", "transformer_blocks", "patch_embed",
        "img_in", "txt_in", "final_layer", "guidance_embedder",
    ],
    "Z-Image": [
        "zimage", "lora_zimage", "double_blocks", "single_blocks",
    ],
    "LTX Video": [
        "ltx", "lora_ltx", "video", "temporal", "transformer_blocks",
    ],
}

# Priorité : plus spécifique d'abord (Flux avant SDXL car Flux a des noms uniques)
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

# Bases canoniques du projet
CANONICAL_BASES = {
    "Flux.2 Klein 4B", "Flux.1 D", "SDXL", "Pony", "Illustrious",
    "NoobAI", "SD 1.5", "Qwen", "Z-Image", "LTX Video"
}

def load_metadata(filepath):
    """Lit le header safetensors et retourne (metadata_dict, tensor_names_list)."""
    try:
        from safetensors import safe_open
        with safe_open(filepath, framework="pt", device="cpu") as f:
            metadata = f.metadata() or {}
            tensors = list(f.keys())
        return metadata, tensors
    except Exception as e:
        return {"error": str(e)}, []

def detect_arch(metadata, tensors):
    """Détecte l'architecture depuis metadata + noms de tenseurs."""
    # 1. Check metadata explicite (kohya-ss, etc.)
    meta_str = json.dumps(metadata, ensure_ascii=False).lower()
    for base in ARCH_ORDER:
        if base in ("Flux.2 Klein 4B", "Flux.1 D"):
            if any(k in meta_str for k in ("flux", "double_blocks", "single_blocks")):
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
            if any(k in meta_str for k in ("sdxl", "xl_", "sdxl_", "stable diffusion xl")):
                return base

    # 2. Check noms de tenseurs (plus fiable)
    tensor_str = " ".join(tensors).lower()
    scores = {}
    for base in ARCH_ORDER:
        patterns = ARCH_PATTERNS.get(base, [])
        score = sum(1 for p in patterns if p in tensor_str)
        if score > 0:
            scores[base] = score

    if scores:
        # Prendre celui avec le plus de matches
        return max(scores, key=scores.get)

    return "Inconnu"

def main():
    print(f"=== Scan safetensors dans {MODELS_DIR} ===")
    
    # 1. Collecter tous les .safetensors
    files = []
    for d in SCAN_DIRS:
        if os.path.isdir(d):
            for p in Path(d).rglob("*.safetensors"):
                files.append(p)
    
    print(f"Fichiers trouves: {len(files)}")
    
    # 2. Charger les modèles existants en DB
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    # Map filename(stem) -> model_id pour LoRA existants
    cur.execute("SELECT id, name, base_model FROM models WHERE type='LORA'")
    db_loras = {row[1].lower(): (row[0], row[2]) for row in cur.fetchall()}
    
    # Map pour checkpoints aussi
    cur.execute("SELECT id, name, base_model FROM models WHERE type='Checkpoint'")
    db_ckpts = {row[1].lower(): (row[0], row[2]) for row in cur.fetchall()}
    
    all_db = {**db_loras, **db_ckpts}
    
    print(f"LoRA en DB: {len(db_loras)} | Checkpoints: {len(db_ckpts)}")
    
    # 3. Scanner chaque fichier
    updates = []
    unknown_files = []
    
    for i, fpath in enumerate(files):
        if i % 50 == 0:
            print(f"  [{i}/{len(files)}]")
        
        fname = fpath.stem.lower()
        rel_path = fpath.relative_to(MODELS_DIR).as_posix()
        
        metadata, tensors = load_metadata(fpath)
        arch = detect_arch(metadata, tensors)
        
        # Vérifier si déjà en DB
        if fname in all_db:
            model_id, current_base = all_db[fname]
            if current_base != arch and arch != "Inconnu":
                updates.append((model_id, arch, rel_path))
                print(f"  UPDATE: {fname} -> {arch} (etait {current_base})")
            elif arch == "Inconnu":
                unknown_files.append((fname, rel_path, metadata, tensors))
        else:
            # Nouveau fichier pas en DB
            if arch != "Inconnu":
                print(f"  NEW: {fname} -> {arch} ({rel_path})")
            else:
                unknown_files.append((fname, rel_path, metadata, tensors))
    
    # 4. Appliquer les mises à jour
    if updates:
        print(f"\n=== Application de {len(updates)} mises a jour ===")
        for model_id, arch, _ in updates:
            cur.execute("UPDATE models SET base_model=? WHERE id=?", (arch, model_id))
        conn.commit()
        print("OK")
    else:
        print("\nAucune mise a jour necessaire.")
    
    # 5. Rapport Inconnus
    if unknown_files:
        print(f"\n=== {len(unknown_files)} fichiers Inconnu ===")
        for fname, rel, meta, tensors in unknown_files[:20]:
            print(f"  {fname} ({rel})")
            print(f"    meta: {json.dumps(meta, ensure_ascii=False)[:120]}")
            print(f"    tensors: {tensors[:10]}")
        if len(unknown_files) > 20:
            print(f"  ... et {len(unknown_files) - 20} autres")
    
    # 6. Stats finales
    cur.execute("SELECT base_model, count(*) FROM models WHERE type='LORA' GROUP BY base_model ORDER BY count(*) DESC")
    print("\n=== LoRA par base (apres scan) ===")
    for base, cnt in cur.fetchall():
        print(f"  {base or 'NULL'}: {cnt}")
    
    conn.close()

if __name__ == "__main__":
    main()