import urllib.request, json, time

urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8188/interrupt', data=b'{}',
    headers={'Content-Type': 'application/json'}, method='POST'), timeout=5).read()
urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8188/queue', data=b'{"clear":true}',
    headers={'Content-Type': 'application/json'}, method='POST'), timeout=5).read()
time.sleep(2)
print(urllib.request.urlopen('http://127.0.0.1:8188/queue', timeout=5).read().decode())