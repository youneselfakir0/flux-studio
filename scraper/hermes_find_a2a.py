import urllib.request, io, sys, json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
with urllib.request.urlopen('http://127.0.0.1:61580/openapi.json', timeout=15) as r:
    data = json.loads(r.read())
paths = list(data.get('paths', {}).keys())
for p in paths:
    lower = p.lower()
    if 'a2a' in lower or 'agent/card' in lower or 'tasks/get' in lower:
        print(p)
print('--- count a2a:', sum(1 for p in paths if 'a2a' in p.lower()))
print('--- count total:', len(paths))