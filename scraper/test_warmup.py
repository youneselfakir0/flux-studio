import json, urllib.request, io, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
payload = json.dumps({"base": "klein"}).encode()
req = urllib.request.Request('http://localhost:8080/api/comfyui/warmup', data=payload,
                            headers={'Content-Type': 'application/json'}, method='POST')
with urllib.request.urlopen(req, timeout=10) as r:
    print(r.read().decode())