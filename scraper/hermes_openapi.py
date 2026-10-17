import urllib.request, io, sys, json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
with urllib.request.urlopen('http://127.0.0.1:61580/openapi.json', timeout=15) as r:
    data = json.loads(r.read())
paths = list(data.get('paths', {}).keys())
for p in paths:
    if 'a2a' in p.lower() or 'agent' in p.lower() or 'card' in p.lower() or 'rpc' in p.lower():
        print(p)
print('--- total paths:', len(paths))
# print a sample of all endpoints
for p in paths[:20]:
    print(p)