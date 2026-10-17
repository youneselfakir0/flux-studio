import urllib.request, io, sys, json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
for path in ['/', '/api', '/a2a', '/v1/a2a', '/agent-card', '/openapi.json', '/docs']:
    try:
        with urllib.request.urlopen('http://127.0.0.1:61580' + path, timeout=5) as r:
            body = r.read().decode('utf-8', 'replace')[:200]
            print(path, '->', r.status, '|', body.replace('\n',' '))
    except Exception as e:
        code = getattr(e, 'code', '')
        print(path, '->', code or e)