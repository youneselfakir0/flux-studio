"""Tests Phase 5 : non-divulgation des erreurs et plafonds de concurrence.

Aucun acces GPU/ComfyUI reel : les appels reseau sont simules et le serveur
HTTP de test n'expose que des routes locales.
"""
import contextlib
import http.client
import io
import json
import os
import sys
import threading
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))
import server


def _http(port, method, path, headers=None, body=b""):
    """Requete HTTP minimale ; retourne (status, headers, body bytes)."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=8)
    try:
        conn.request(method, path, body=body, headers=headers or {})
        resp = conn.getresponse()
        data = resp.read()
        return resp.status, dict(resp.getheaders()), data
    finally:
        conn.close()


class TestErrorHardening(unittest.TestCase):
    def test_error_payload_is_stable(self):
        self.assertEqual(server.error_payload("x", "message"),
                         {"error": "message", "code": "x"})

    def test_log_redacts_known_secrets(self):
        old = server.GEMINI_API_KEY
        server.GEMINI_API_KEY = "SECRET-ABC-123"
        buf = io.StringIO()
        try:
            with contextlib.redirect_stderr(buf):
                server.log_internal("test", RuntimeError("boom SECRET-ABC-123 C:\\x"))
        finally:
            server.GEMINI_API_KEY = old
        out = buf.getvalue()
        self.assertNotIn("SECRET-ABC-123", out)
        self.assertIn("***", out)

    def test_comfy_errors_do_not_leak_internal_detail(self):
        old = server.urllib.request.urlopen

        def boom(*_a, **_k):
            raise OSError("C:\\secret\\token.txt")

        server.urllib.request.urlopen = boom
        buf = io.StringIO()
        try:
            with contextlib.redirect_stderr(buf):
                responses = [
                    server.comfy_free(),
                    server.comfy_interrupt(),
                    server.comfy_queue(),
                    server.comfy_history("prompt-x"),
                ]
        finally:
            server.urllib.request.urlopen = old
        for res in responses:
            blob = json.dumps(res)
            self.assertNotIn("secret", blob)
            self.assertNotIn("C:\\\\", blob)

    def test_no_raw_exception_interpolation_in_source(self):
        with open(server.__file__, encoding="utf-8") as f:
            src = f.read()
        self.assertNotIn("str(e)", src)
        self.assertNotIn("{e}", src)


class TestConcurrencyLimits(unittest.TestCase):
    def test_route_mapping(self):
        self.assertIs(server._slot_for_route("POST", "/api/comfyui/generate"),
                      server._sema_generate)
        self.assertIs(server._slot_for_route("POST", "/api/comfyui/validate"),
                      server._sema_generate)
        self.assertIs(server._slot_for_route("POST", "/api/comfyui/describe"),
                      server._sema_vision)
        self.assertIs(server._slot_for_route("GET", "/api/proxy"),
                      server._sema_proxy)
        self.assertIsNone(server._slot_for_route("GET", "/api/stats"))
        # Le telechargement est plafonne dans start_download (thread), pas ici.
        self.assertIsNone(server._slot_for_route("POST", "/api/comfyui/download"))

    def test_download_refuses_without_spawning_thread(self):
        old = server._sema_download
        server._sema_download = threading.BoundedSemaphore(1)
        server._sema_download.acquire()
        try:
            self.assertIsNone(server.start_download(1, 2, None))
        finally:
            server._sema_download.release()
            server._sema_download = old


class TestHTTPSaturation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = server.QuietServer(("127.0.0.1", 0), server.Handler)
        cls.port = cls.srv.server_address[1]
        cls.thread = threading.Thread(target=cls.srv.serve_forever, daemon=True)
        cls.thread.start()
        time.sleep(0.2)

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        cls.thread.join(3)

    def test_scan_saturation_returns_429_and_light_routes_survive(self):
        started = threading.Event()
        release = threading.Event()
        orig_list = server.list_model_files
        orig_sema = server._sema_scan
        server._sema_scan = threading.BoundedSemaphore(1)

        def slow_scan():
            started.set()
            release.wait(5)
            return []

        server.list_model_files = slow_scan
        result = {}

        def first_call():
            result["first"] = _http(self.port, "GET", "/api/comfyui/scan-files")

        t = threading.Thread(target=first_call)
        t.start()
        try:
            self.assertTrue(started.wait(3), "le scan n'a pas demarre")
            status, headers, body = _http(self.port, "GET", "/api/comfyui/scan-files")
            self.assertEqual(status, 429)
            self.assertEqual(json.loads(body)["code"], "overloaded")
            self.assertEqual(headers.get("Retry-After"), "1")
            # Une route legere ne doit jamais etre bloquee par un slot sature.
            status_light, _, _ = _http(self.port, "GET", "/index.html")
            self.assertEqual(status_light, 200)
        finally:
            release.set()
            t.join(5)
            server.list_model_files = orig_list
            server._sema_scan = orig_sema
        self.assertEqual(result["first"][0], 200)

    def test_connection_saturation_returns_429(self):
        sema = threading.BoundedSemaphore(1)
        sema.acquire()
        srv = server.QuietServer(("127.0.0.1", 0), server.Handler,
                                 connection_sema=sema)
        port = srv.server_address[1]
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        try:
            status, _, body = _http(port, "GET", "/index.html")
            self.assertEqual(status, 429)
            self.assertEqual(body, b"")
        finally:
            srv.shutdown()
            srv.server_close()
            t.join(3)
            sema.release()

    def test_global_post_body_limit(self):
        status, _, body = _http(
            self.port, "POST", "/api/comfyui/generate",
            headers={"Origin": "http://127.0.0.1:8080",
                     "Content-Type": "application/json",
                     "Content-Length": str(31 * 1024 * 1024)},
            body=b"")
        self.assertEqual(status, 413)
        self.assertIn("volumineuse", json.loads(body)["error"])

    def test_upload_body_limit(self):
        status, _, body = _http(
            self.port, "POST", "/api/comfyui/upload-image",
            headers={"Origin": "http://127.0.0.1:8080",
                     "Content-Type": "multipart/form-data; boundary=x",
                     "Content-Length": str(26 * 1024 * 1024)},
            body=b"")
        self.assertEqual(status, 413)
        self.assertIn("volumineux", json.loads(body)["error"])

    def test_bad_host_rejected(self):
        status, _, body = _http(self.port, "GET", "/api/stats",
                                headers={"Host": "evil.example"})
        self.assertEqual(status, 403)
        self.assertIn("host", json.loads(body)["error"])

    def test_bad_origin_rejected_on_post(self):
        status, _, body = _http(
            self.port, "POST", "/api/comfyui/interrupt",
            headers={"Origin": "http://evil.example",
                     "Content-Type": "application/json"},
            body=b"{}")
        self.assertEqual(status, 403)
        self.assertIn("origin", json.loads(body)["error"])

    def test_bad_origin_rejected_on_vram(self):
        status, _, body = _http(self.port, "GET", "/api/comfyui/vram",
                                headers={"Origin": "http://evil.example"})
        self.assertEqual(status, 403)
        self.assertIn("origin", json.loads(body)["error"])


if __name__ == "__main__":
    unittest.main()
