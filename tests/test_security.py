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


class TestSafeDownloadFilename(unittest.TestCase):
    def test_normal_name_kept(self):
        self.assertEqual(server.safe_download_filename("coolModel.safetensors", 1),
                         "coolModel.safetensors")

    def test_traversal_stripped(self):
        self.assertEqual(server.safe_download_filename("..\\..\\evil.safetensors", 7),
                         "evil.safetensors")

    def test_absolute_path_stripped(self):
        self.assertEqual(server.safe_download_filename("/etc/passwd", 7), "passwd")

    def test_empty_falls_back(self):
        self.assertEqual(server.safe_download_filename("", 5), "model_5.safetensors")
        self.assertEqual(server.safe_download_filename("..", 5), "model_5.safetensors")

    def test_result_has_no_separator(self):
        for raw in ["a/b/c.safetensors", "a\\b\\c.safetensors", "/x/y",
                    "..\\..\\..\\z.ckpt", "weird|name?.safetensors"]:
            out = server.safe_download_filename(raw, 3)
            self.assertNotIn("/", out)
            self.assertNotIn("\\", out)


class TestPickInstalledModel(unittest.TestCase):
    def setUp(self):
        self._old = server.MODELS_DIR
        self.root = tempfile.mkdtemp()
        dm = os.path.join(self.root, "diffusion_models")
        os.makedirs(dm)
        for name in ["flux-2-klein-4b.safetensors",
                     "flux-2-klein-4b-Q4_1.gguf",
                     "klein-preview.jpeg",
                     "readme.txt"]:
            open(os.path.join(dm, name), "w").close()
        server.MODELS_DIR = self.root

    def tearDown(self):
        server.MODELS_DIR = self._old

    def test_prefers_safetensors_and_ignores_non_models(self):
        picked = server._pick_installed_model(["diffusion_models"], ["klein"])
        self.assertEqual(picked, "flux-2-klein-4b.safetensors")

    def test_missing_folder_returns_none(self):
        self.assertIsNone(server._pick_installed_model(["nope"], ["x"]))


class TestGenerateWorkflow(unittest.TestCase):
    """Verifie l'assemblage des graphes du mode App (BUG-01/BUG-02)."""

    def setUp(self):
        self._old = server.MODELS_DIR
        server.MODELS_DIR = tempfile.mkdtemp()  # vide -> noms de repli

    def tearDown(self):
        server.MODELS_DIR = self._old

    def _wf(self, model):
        return server.build_generate_workflow(
            model, "a cat", 512, 512, 4, 1.0, "euler", "simple", 42, "auto", "auto")

    def _classes(self, wf):
        return {n["class_type"] for n in wf.values()}

    def test_all_nodes_referenced_ids_exist(self):
        for model in ["Flux.2 Klein 4B", "Flux.1 D", "SDXL", "Unknown"]:
            wf = self._wf(model)
            for nid, node in wf.items():
                for value in node["inputs"].values():
                    if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str):
                        self.assertIn(value[0], wf, f"{model}: noeud {value[0]} manquant")

    def test_klein_uses_documented_pipeline(self):
        classes = self._classes(self._wf("Flux.2 Klein 4B"))
        for required in ["UNETLoader", "CLIPLoader", "Flux2Scheduler",
                         "CFGGuider", "SamplerCustomAdvanced", "VAELoader"]:
            self.assertIn(required, classes)

    def test_flux1_uses_unet_and_dual_clip(self):
        wf = self._wf("Flux.1 D")
        classes = self._classes(wf)
        self.assertIn("UNETLoader", classes)
        self.assertIn("DualCLIPLoader", classes)
        self.assertNotIn("CheckpointLoaderSimple", classes)
        clip = next(n for n in wf.values() if n["class_type"] == "DualCLIPLoader")
        self.assertEqual(clip["inputs"]["type"], "flux")

    def test_sdxl_uses_checkpoint(self):
        classes = self._classes(self._wf("SDXL"))
        self.assertIn("CheckpointLoaderSimple", classes)
        self.assertIn("EmptyLatentImage", classes)

    def test_names_have_no_path_separator(self):
        for model in ["Flux.2 Klein 4B", "Flux.1 D", "SDXL"]:
            wf = self._wf(model)
            for node in wf.values():
                for value in node["inputs"].values():
                    if isinstance(value, str) and value.lower().endswith((".safetensors", ".gguf", ".ckpt", ".pt")):
                        self.assertNotIn("/", value)
                        self.assertNotIn("\\", value)


if __name__ == "__main__":
    unittest.main()