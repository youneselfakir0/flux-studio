import json, urllib.request, io, sys, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
prompt = {
    "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sd_xl_base_1.0.safetensors"}},
    "2": {"class_type": "FluxStudioCachedConditioning", "inputs": {"clip": ["1", 1], "text": "a beautiful woman portrait", "cache_name": "sdxl"}},
    "3": {"class_type": "EmptyLatentImage", "inputs": {"width": 256, "height": 256, "batch_size": 1}},
    "4": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "seed": 1, "steps": 2, "cfg": 7.0,
                                               "sampler_name": "euler", "scheduler": "normal",
                                               "positive": ["2", 0], "negative": ["2", 0],
                                               "latent_image": ["3", 0], "denoise": 1.0}},
    "5": {"class_type": "VAEDecode", "inputs": {"samples": ["4", 0], "vae": ["1", 2]}},
    "6": {"class_type": "SaveImage", "inputs": {"filename_prefix": "flux_studio/_cache_test2", "images": ["5", 0]}},
}
req = urllib.request.Request('http://127.0.0.1:8188/prompt', data=json.dumps({"prompt": prompt}).encode(),
                            headers={"Content-Type": "application/json"}, method="POST")
with urllib.request.urlopen(req, timeout=60) as r:
    pid = json.loads(r.read())["prompt_id"]
print("queued", pid)

# poll
for _ in range(60):
    time.sleep(2)
    q = json.loads(urllib.request.urlopen('http://127.0.0.1:8188/queue', timeout=10).read())
    if not (q.get("queue_running") or q.get("queue_pending")):
        break
h = json.loads(urllib.request.urlopen('http://127.0.0.1:8188/history', timeout=10).read())
st = h.get(pid, {}).get("status", {})
print("status:", st.get("status_str"), "completed:", st.get("completed"))
# search cache file
import os, glob
for root in ["F:/f/ComfyUI"]:
    for p in glob.glob(os.path.join(root, "**", "flux_studio_cond", "*.pt"), recursive=True):
        print("CACHE FILE:", p)