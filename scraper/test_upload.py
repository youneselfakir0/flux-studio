import urllib.request, io, sys

png = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082')
boundary = b'----WebKitFormBoundaryTest'
body = (b'--' + boundary + b'\r\n'
        + b'Content-Disposition: form-data; name="file"; filename="test.png"\r\n'
        + b'Content-Type: image/png\r\n\r\n' + png + b'\r\n'
        + b'--' + boundary + b'--\r\n')
req = urllib.request.Request('http://localhost:8080/api/comfyui/upload-image', data=body,
    headers={'Content-Type': 'multipart/form-data; boundary=' + boundary.decode()}, method='POST')
try:
    with urllib.request.urlopen(req, timeout=20) as r:
        sys.stdout.write(r.read().decode('utf-8', 'replace') + '\n')
except Exception as e:
    print('ERR', e)