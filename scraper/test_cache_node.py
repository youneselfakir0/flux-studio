import json, urllib.request, io, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
# Build a minimal SDXL workflow using FluxStudioCachedConditioning
prompt = {
    "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sd_xl_base_1.0.safetensors"}},
    "2": {"class_type": "FluxStudioCachedConditioning", "inputs": {"clip": ["1", 1], "text": "a woman", "cache_name": "sdxl"}},
    "3": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 1}},
    "4": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "seed": 1, "steps": 4, "cfg": 7,
                                               "sampler_name": "euler", "scheduler": "normal",
                                               "positive": ["2", 0], "negative": ["2", 0],
                                               "latent_image": ["3", 0], "denoise": 1}},
    "5": {"class_type": "VAEDecode", "inputs": {"samples": ["4", 0], "vae": ["1", 2]}},
    "6": {"class_type": "SaveImage", "inputs": {"filename_prefix": "flux_studio/_cache_test", "images": ["5", 0]}},
}
# validate
req = urllib.request.Request('http://127.0.0.1:8188/prompt', data=json.dumps({"prompt": prompt}).encode(),
                            headers={"Content-Type": "application/json"}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        print("VALIDATE OK:", r.read().decode()[:200])
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode()[:300])
except Exception as e:
    print("ERR", e)