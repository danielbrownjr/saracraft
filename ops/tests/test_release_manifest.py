import importlib.util
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("release_manifest", HERE / "release_manifest.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class ReleaseManifestTests(unittest.TestCase):
    def test_build_verify_and_tamper_detection(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "release"
            root.mkdir()
            (root / "controller").mkdir()
            file = root / "controller" / "main.js"
            file.write_text("original")
            manifest = Path(td) / "SHA256SUMS.json"
            self.assertEqual(mod.build(root, manifest), 1)
            self.assertEqual(mod.verify(root, manifest), 1)
            file.write_text("modified")
            with self.assertRaisesRegex(ValueError, "differs"):
                mod.verify(root, manifest)
            file.write_text("original")
            (root / "unexpected.txt").write_text("new")
            with self.assertRaisesRegex(ValueError, "differs"):
                mod.verify(root, manifest)

    def test_rejects_symlink_and_nested_manifest(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "release"
            root.mkdir()
            (root / "file").write_text("data")
            (root / "link").symlink_to(root / "file")
            with self.assertRaisesRegex(ValueError, "Symlinks"):
                mod.inventory(root)
            (root / "link").unlink()
            with self.assertRaisesRegex(ValueError, "outside"):
                mod.build(root, root / "manifest.json")

    def test_rejects_untrusted_manifest_rows(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "release"
            root.mkdir()
            (root / "file").write_text("data")
            manifest = Path(td) / "SHA256SUMS.json"
            manifest.write_text('{"schema":"saracraft-release-tree-v1","files":[{"path":"../escape","sha256":"x","size":1}]}')
            with self.assertRaisesRegex(ValueError, "differs"):
                mod.verify(root, manifest)

    def test_refuses_existing_output(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "release"
            root.mkdir()
            manifest = Path(td) / "existing.json"
            manifest.write_text("leave unchanged")
            with self.assertRaisesRegex(ValueError, "new file"):
                mod.build(root, manifest)
            self.assertEqual(manifest.read_text(), "leave unchanged")

if __name__ == "__main__":
    unittest.main()
