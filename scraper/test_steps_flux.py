"""Verifie que 24 steps est le bon reglage pour FLUX.1 Dev (vs 4)."""
import json
import sys
import time
import io
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = "http://localhost:8080"


def post(p, payload):
    req = urllib.request.Request(BASE + p, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def get(p):
    with urllib.request.urlopen(BASE + p, timeout=60) as r:
        return json.load(r)


def build(steps, prefix):
    return {
        "1": {"class_type": "UNETLoader",
              "inputs": {"unet_name": "flux1-dev-fp8.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "DualCLIPLoader",
              "inputs": {"clip_name1": "t5xxl_fp8_e4m3fn.safetensors",
                         "clip_name2": "clip_l.safetensors", "type": "flux"}},
        "3": {"class_type": "CLIPTextEncode",
              "inputs": {"text": "a beautiful woman, realistic skin texture, natural pores, "
                                 "studio softbox lighting, 85mm", "clip": ["2", 0]}},
        "4": {"class_type": "CLIPTextEncode",
              "inputs": {"text": "plastic skin, over-smoothed, blurry, airbrushed", "clip": ["2", 0]}},
        "5": {"class_type": "EmptyFlux2LatentImage",
              "inputs": {"width": 768, "height": 1024, "batch_size": 1}},
        "6": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
        "7": {"class_type": "BasicScheduler",
              "inputs": {"scheduler": "simple", "steps": steps, "denoise": 1, "model": ["1", 0]}},
        "8": {"class_type": "SamplerCustom",
              "inputs": {"add_noise": True, "noise_seed": 42, "cfg": 1, "model": ["1", 0],
                         "positive": ["3", 0], "negative": ["4", 0], "sampler": ["6", 0],
                         "sigmas": ["7", 0], "latent_image": ["5", 0]}},
        "9": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "10": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["9", 0]}},
        "11": {"class_type": "SaveImage", "inputs": {"filename_prefix": prefix, "images": ["10", 0]}},
    }


print("=== liberation memoire ===")
print("  ", json.dumps(post("/api/comfyui/free", {}), ensure_ascii=False))

for steps in (24,):
    prefix = f"flux_studio/steps{steps}"
    print(f"\n=== FLUX.1 Dev — {steps} steps ===")
    t0 = time.time()
    r = post("/api/comfyui/run", {"prompt": build(steps, prefix)})
    if not r.get("ok"):
        print("  REFUS :", r)
        continue
    pid = r["prompt_id"]
    while time.time() - t0 < 500:
        time.sleep(3)
        h = get(f"/api/comfyui/history?id={pid}")
        if h.get("error"):
            print("  ERREUR :", h["error"])
            break
        if h.get("status") in ("done", "error"):
            el = time.time() - t0
            print(f"  statut={h['status']}  {el:.0f}s")
            for im in h.get("images") or []:
                print("  IMAGE :", f"F:/f/ComfyUI/output/{im.get('subfolder','')}/{im['filename']}")
            if h.get("error"):
                print("  detail :", h["error"])
            break
    else:
        print("  TIMEOUT")