import urllib.request, io, sys, json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
for port in (9900, 61580):
    print('=== port', port, '===')
    for path in ['/.well-known/agent-card.json', '/health', '/.well-known/agent.json']:
        try:
            with urllib.request.urlopen('http://127.0.0.1:%d%s' % (port, path), timeout=5) as r:
                body = r.read().decode('utf-8', 'replace')[:400]
                print(path, '->', r.status, body.replace('\n',' '))
        except Exception as e:
            print(path, '->', getattr(e, 'code', e))
# also try a2a JSON RPC
for port in (9900, 61580):
    try:
        body = json.dumps({"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"role":"user","parts":[{"text":"ping","mediaType":"text/plain"}],"messageId":"abc"}}}).encode()
        req = urllib.request.Request('http://127.0.0.1:%d/' % port, data=body, headers={'Content-Type':'application/json','A2A-Version':'1.0'}, method='POST')
        with urllib.request.urlopen(req, timeout=8) as r:
            print('rpc post port', port, '->', r.status, r.read().decode('utf-8','replace')[:200])
    except Exception as e:
        print('rpc post port', port, '->', getattr(e,'code',e))