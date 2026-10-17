"""FLUX.2 Klein 4B (distilled) — pipeline issu du template officiel ComfyUI.

Cle : l'encodeur texte est Qwen 3 4B via CLIPLoader(type='flux2'), pas
T5XXL+CLIP-L. Et le sampler est CFGGuider + SamplerCustomAdvanced avec
Flux2Scheduler. C'etait la source de l'erreur 512x4096 vs 7680x3072.
"""
import json
import sys
import time
import io
import urllib.request
import urllib.error

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
COMFY = "http://127.0.0.1:8188"

PROMPT = ("a beautiful woman, professional portrait, soft studio lighting, "
          "detailed skin, 85mm lens")


def run(prompt, steps, width, height, prefix):
    p = {
        "1": {"class_type": "UNETLoader",
              "inputs": {"unet_name": "flux-2-klein-4b.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "flux2", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": PROMPT, "clip": ["2", 0]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["2", 0]}},
        "6": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
        "7": {"class_type": "Flux2Scheduler",
              "inputs": {"steps": steps, "width": width, "height": height}},
        "8": {"class_type": "CFGGuider",
              "inputs": {"model": ["1", 0], "positive": ["4", 0], "negative": ["5", 0], "cfg": 1.0}},
        "9": {"class_type": "RandomNoise", "inputs": {"noise_seed": 12345}},
        "10": {"class_type": "EmptyFlux2LatentImage",
               "inputs": {"width": width, "height": height, "batch_size": 1}},
        "11": {"class_type": "SamplerCustomAdvanced",
               "inputs": {"noise": ["9", 0], "guider": ["8", 0], "sampler": ["6", 0],
                          "sigmas": ["7", 0], "latent_image": ["10", 0]}},
        "12": {"class_type": "VAEDecode", "inputs": {"samples": ["11", 0], "vae": ["3", 0]}},
        "13": {"class_type": "SaveImage", "inputs": {"filename_prefix": prefix, "images": ["12", 0]}},
    }
    req = urllib.request.Request(
        COMFY + "/prompt", data=json.dumps({"prompt": p}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        try:
            det = json.loads(e.read())
        except Exception:
            det = {"error": str(e)}
        print(f"  REFUS : {json.dumps(det, ensure_ascii=False)[:400]}")
        return None

    pid = data.get("prompt_id")
    if not pid:
        print(f"  REFUS : {json.dumps(data)[:300]}")
        return None

    while time.time() - t0 < 420:
        time.sleep(3)
        with urllib.request.urlopen(COMFY + "/history/" + pid, timeout=30) as r:
            h = json.load(r)
        e = h.get(pid)
        if not e:
            continue
        st = e.get("status", {})
        if st.get("status_str") in ("success", "error"):
            el = time.time() - t0
            imgs = [im for o in (e.get("outputs") or {}).values() for im in (o.get("images") or [])]
            print(f"  -> {st.get('status_str')}  {el:.0f}s  {len(imgs)} image(s)")
            for im in imgs:
                print(f"     {im.get('filename')}  ({im.get('subfolder','')})")
            if st.get("status_str") == "error":
                for m in st.get("messages", []):
                    if isinstance(m, (list, tuple)) and m and m[0] == "execution_error":
                        print("     ", str((m[1] or {}).get("exception_message", ""))[:400])
                return None
            return imgs
    print("  TIMEOUT")
    return None


print("=== FLUX.2 Klein 4B distilled — 4 steps 1024x1024 ===")
r = run(PROMPT, 4, 1024, 1024, "flux_studio/klein_4step")
if r:
    print("\n*** REUSSIS ***")
    with open(r"C:\Users\administrator\flux-studio\data\klein_workflow.json",
              "w", encoding="utf-8") as f:
        json.dump({
            "1": {"class_type": "UNETLoader",
                  "inputs": {"unet_name": "flux-2-klein-4b.safetensors", "weight_dtype": "default"}},
            "2": {"class_type": "CLIPLoader",
                  "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "flux2", "device": "default"}},
            "3": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
            "4": {"class_type": "CLIPTextEncode", "inputs": {"text": PROMPT, "clip": ["2", 0]}},
            "5": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["2", 0]}},
            "6": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
            "7": {"class_type": "Flux2Scheduler",
                  "inputs": {"steps": 4, "width": 1024, "height": 1024}},
            "8": {"class_type": "CFGGuider",
                  "inputs": {"model": ["1", 0], "positive": ["4", 0], "negative": ["5", 0], "cfg": 1.0}},
            "9": {"class_type": "RandomNoise", "inputs": {"noise_seed": 12345}},
            "10": {"class_type": "EmptyFlux2LatentImage",
                   "inputs": {"width": 1024, "height": 1024, "batch_size": 1}},
            "11": {"class_type": "SamplerCustomAdvanced",
                   "inputs": {"noise": ["9", 0], "guider": ["8", 0], "sampler": ["6", 0],
                              "sigmas": ["7", 0], "latent_image": ["10", 0]}},
            "12": {"class_type": "VAEDecode", "inputs": {"samples": ["11", 0], "vae": ["3", 0]}},
            "13": {"class_type": "SaveImage",
                   "inputs": {"filename_prefix": "flux_studio", "images": ["12", 0]}},
        }, f, indent=1)
    print("Workflow enregistre : data/klein_workflow.json")
else:
    print("\n*** ECHEC ***")