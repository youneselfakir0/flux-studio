"""Verifie que /api/comfyui/validate ne pollue PAS la file ComfyUI."""
import json
import sys
import time
import io
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = "http://localhost:8080"
COMFY = "http://127.0.0.1:8188"

WORKFLOWS = [
    ("sdxl-base", "sd_xl_base_1.0.safetensors"),
    ("sdxl-lora-mj52", None),
    ("flux1-dev", None),
    ("flux2-klein", None),
    ("flux-realistic", None),
    ("flux-skin-detail", None),
    ("sd15-base", None),
]


def get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


def post(url, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def queue():
    q = get(COMFY + "/queue")
    return len(q.get("queue_running") or []), len(q.get("queue_pending") or [])


# Prompts minimaux representant chaque pipeline du catalogue
SDXL = {
    "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sd_xl_base_1.0.safetensors"}},
    "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "a woman", "clip": ["1", 1]}},
    "3": {"class_type": "EmptyLatentImage", "inputs": {"width": 1024, "height": 1024, "batch_size": 1}},
    "4": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "seed": 1, "steps": 24, "cfg": 7,
                                               "sampler_name": "euler", "scheduler": "normal",
                                               "positive": ["2", 0], "negative": ["2", 0],
                                               "latent_image": ["3", 0], "denoise": 1}},
    "5": {"class_type": "VAEDecode", "inputs": {"samples": ["4", 0], "vae": ["1", 2]}},
    "6": {"class_type": "SaveImage", "inputs": {"filename_prefix": "flux_studio", "images": ["5", 0]}},
}

FLUX1 = {
    "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux1-dev-fp8.safetensors", "weight_dtype": "default"}},
    "2": {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": "t5xxl_fp8_e4m3fn.safetensors",
                                                     "clip_name2": "clip_l.safetensors", "type": "flux"}},
    "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "a woman", "clip": ["2", 0]}},
    "4": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": 768, "height": 1024, "batch_size": 1}},
    "5": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
    "6": {"class_type": "BasicScheduler", "inputs": {"scheduler": "simple", "steps": 24,
                                                     "denoise": 1, "model": ["1", 0]}},
    "7": {"class_type": "SamplerCustom", "inputs": {"add_noise": True, "noise_seed": 1, "cfg": 1,
                                                    "model": ["1", 0], "positive": ["3", 0],
                                                    "negative": ["3", 0], "sampler": ["5", 0],
                                                    "sigmas": ["6", 0], "latent_image": ["4", 0]}},
    "8": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
    "9": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["8", 0]}},
    "10": {"class_type": "SaveImage", "inputs": {"filename_prefix": "flux_studio", "images": ["9", 0]}},
}

KLEIN = {
    "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux-2-klein-4b.safetensors", "weight_dtype": "default"}},
    "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "flux2"}},
    "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "a woman", "clip": ["2", 0]}},
    "4": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": 1024, "height": 1024, "batch_size": 1}},
    "5": {"class_type": "Flux2Scheduler", "inputs": {"steps": 4, "width": 1024, "height": 1024}},
    "6": {"class_type": "CFGGuider", "inputs": {"model": ["1", 0], "positive": ["3", 0],
                                                "negative": ["3", 0], "cfg": 1}},
    "7": {"class_type": "RandomNoise", "inputs": {"noise_seed": 1}},
    "8": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
    "9": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["7", 0], "guider": ["6", 0],
                                                            "sampler": ["8", 0], "sigmas": ["5", 0],
                                                            "latent_image": ["4", 0]}},
    "10": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
    "11": {"class_type": "VAEDecode", "inputs": {"samples": ["9", 0], "vae": ["10", 0]}},
    "12": {"class_type": "SaveImage", "inputs": {"filename_prefix": "flux_studio", "images": ["11", 0]}},
}

# Volontairement casses
CASSE_LORA = dict(FLUX1)
CASSE_LORA = json.loads(json.dumps(FLUX1))
CASSE_LORA["9"] = {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0]}}   # vae manquant

CASSE_VIDE = json.loads(json.dumps(SDXL))
CASSE_VIDE["2"] = {"class_type": "CLIPTextEncode", "inputs": {"clip": ["1", 1]}}  # text absent

CASSE_LORA_NOM = json.loads(json.dumps(FLUX1))
CASSE_LORA_NOM["1"] = {"class_type": "UNETLoader", "inputs": {"unet_name": "pas/un/modele.safetensors"}}

TESTS = [
    ("SDXL", SDXL, True),
    ("FLUX.1 Dev", FLUX1, True),
    ("FLUX.2 Klein", KLEIN, True),
    ("LoRA casse (vae manquant)", CASSE_LORA, False),
    ("Prompt vide (text absent)", CASSE_VIDE, False),
    ("Nom de modele invalide", CASSE_LORA_NOM, False),
]

print("=== etat initial de la file ===")
print("  running/pending :", queue())

print("\n=== validation (la file doit rester vide) ===")
ok = True
for name, prompt, attendu in TESTS:
    t0 = time.time()
    r = post(BASE + "/api/comfyui/validate", {"prompt": prompt})
    ms = (time.time() - t0) * 1000
    bon = (r.get("valid") is attendu)
    ok = ok and bon
    marque = "OK " if bon else "KO "
    print(f"  {marque}{name:28} valid={str(r.get('valid')):5} ({ms:5.0f} ms)")
    if r.get("valid") is False:
        for m in (r.get("messages") or [])[:1]:
            print(f"        -> {m[:120]}")
    time.sleep(1.0)

print("\n=== etat de la file apres 6 validations ===")
run, pend = queue()
print(f"  running={run}  pending={pend}")
file_propre = (run == 0 and pend == 0)
print(f"  {'OK  file intacte' if file_propre else 'KO  FILE POLLUEE'}")

print("\n=== historique : aucune generation ne doit avoir demarre ===")
h = get(COMFY + "/history")
print(f"  entrees : {len(h)}")

print("\nRESULTAT :", "conforme" if (ok and file_propre) else "ECHEC")