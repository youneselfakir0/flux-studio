import urllib.request, io, sys, json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
for path in ['/.well-known/agent-card.json', '/health', '/metrics']:
    try:
        with urllib.request.urlopen('http://127.0.0.1:61580' + path, timeout=10) as r:
            print(path, '->', r.status, r.read().decode('utf-8', 'replace')[:300])
    except Exception as e:
        print(path, '->', e)
# try A2A root card style
try:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "agent/getAuthenticatedExtendedCard", "params": {}}).encode()
    req = urllib.request.Request('http://127.0.0.1:61580/', data=body, headers={'Content-Type': 'application/json', 'a2a-version': '1.0'}, method='POST')
    with urllib.request.urlopen(req, timeout=10) as r:
        print('root card probe ->', r.status, r.read().decode('utf-8', 'replace')[:400])
except Exception as e:
    print('root probe ->', e)