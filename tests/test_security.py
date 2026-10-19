import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))
import server


class TestIsWithin(unittest.TestCase):
    def test_inside(self):
        root = tempfile.mkdtemp()
        child = os.path.join(root, "sub", "file.txt")
        os.makedirs(os.path.dirname(child), exist_ok=True)
        open(child, "w").close()
        self.assertTrue(server.is_within(child, root))

    def test_outside(self):
        root = tempfile.mkdtemp()
        other = tempfile.mkdtemp()
        f = os.path.join(other, "x.txt")
        open(f, "w").close()
        self.assertFalse(server.is_within(f, root))

    def test_traversal(self):
        root = tempfile.mkdtemp()
        traversal = os.path.join(root, "..", "etc", "passwd")
        self.assertFalse(server.is_within(traversal, root))


class TestDBInit(unittest.TestCase):
    def test_init_db_creates_tables(self):
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        os.remove(path)
        old = server.DB_PATH
        server.DB_PATH = path
        try:
            server.init_db()
            conn = __import__("sqlite3").connect(path)
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = {r[0] for r in cur.fetchall()}
            conn.close()
            self.assertIn("models", tables)
            self.assertIn("images", tables)
            self.assertIn("model_versions", tables)
        finally:
            server.DB_PATH = old
            try:
                os.remove(path)
            except OSError:
                pass


class TestSafetensorsHeader(unittest.TestCase):
    def test_missing_file(self):
        res = server.read_safetensors_header("/no/such/file.safetensors")
        self.assertIn("error", res)

    def test_valid_header(self):
        import struct, json
        header = {"__metadata__": {"format": "pt"}, "weight": [1, 2, 3, 0, "F32"]}
        hb = json.dumps(header).encode()
        fd, path = tempfile.mkstemp(suffix=".safetensors")
        with os.fdopen(fd, "wb") as f:
            f.write(struct.pack("<Q", len(hb)))
            f.write(hb)
            f.write(b"\x00" * 4)
        try:
            res = server.read_safetensors_header(path)
            self.assertNotIn("error", res)
            self.assertEqual(res["tensor_count"], 1)
        finally:
            os.remove(path)


if __name__ == "__main__":
    unittest.main()