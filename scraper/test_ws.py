import asyncio, websockets, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

async def main():
    uri = 'ws://127.0.0.1:8188/ws?client_id=test123'
    try:
        async with websockets.connect(uri) as ws:
            print('CONNECTED OK')
            msg = await asyncio.wait_for(ws.recv(), timeout=3)
            print('got:', msg[:200])
    except Exception as e:
        print('ERR:', repr(e))

asyncio.run(main())

