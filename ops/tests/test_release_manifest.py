import importlib.util
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("release_manifest", HERE / "release_manifest.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class ReleaseManifestTests(unittest.TestCase):
    def checked(self, root, manifest):
        # Simulate a trusted root-owned release *only in this isolated fixture*.
        # The public verify() CLI has no uid/gid overrides.
        original = mod.audit_tree
        def audit(path):
            return original(path, owner_uid=os.getuid(), owner_gid=os.getgid(),
                            check_ancestors=False)
        with mock.patch.object(mod, "audit_tree", side_effect=audit) as gate:
            result = mod.verify(root, manifest)
            self.assertEqual(gate.call_count, 2)
            return result

    def fixture(self, td):
        root = Path(td) / "release"
        root.mkdir()
        (root / "controller").mkdir()
        target = root / "controller" / "main.js"
        target.write_text("original")
        manifest = Path(td) / "SHA256SUMS.json"
        mod.build(root, manifest)
        return root, target, manifest

    def test_build_verify_and_tamper_detection(self):
        with tempfile.TemporaryDirectory() as td:
            root, target, manifest = self.fixture(td)
            self.assertEqual(self.checked(root, manifest), 3)  # root, dir, file
            target.write_text("modified")
            with self.assertRaisesRegex(ValueError, "differs"):
                self.checked(root, manifest)
            target.write_text("original")
            (root / "unexpected.txt").write_text("new")
            with self.assertRaisesRegex(ValueError, "differs"):
                self.checked(root, manifest)

    def test_rejects_symlink_and_nested_manifest(self):
        with tempfile.TemporaryDirectory() as td:
            root, target, manifest = self.fixture(td)
            (root / "link").symlink_to(target)
            with self.assertRaisesRegex(ValueError, "Symlinks"):
                mod.inventory(root)
            (root / "link").unlink()
            with self.assertRaisesRegex(ValueError, "outside"):
                mod.build(root, root / "manifest.json")
            alias = Path(td) / "alias"
            alias.symlink_to(root, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "outside"):
                mod.build(root, alias / "manifest.json")

    def test_rejects_untrusted_manifest_rows(self):
        with tempfile.TemporaryDirectory() as td:
            root, _, manifest = self.fixture(td)
            manifest.write_text('{"schema":"saracraft-release-tree-v1","files":[]}')
            with self.assertRaisesRegex(ValueError, "schema"):
                self.checked(root, manifest)

    def test_refuses_existing_output(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "release"
            root.mkdir()
            manifest = Path(td) / "existing.json"
            manifest.write_text("leave unchanged")
            with self.assertRaisesRegex(ValueError, "new file"):
                mod.build(root, manifest)
            self.assertEqual(manifest.read_text(), "leave unchanged")

    def test_m1_file_permissions_and_setid_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root, target, manifest = self.fixture(td)
            for mode in (0o666, 0o4755, 0o2755):
                with self.subTest(mode=oct(mode)):
                    target.chmod(mode)
                    with self.assertRaisesRegex(ValueError, "unsafe"):
                        self.checked(root, manifest)
                    target.chmod(0o644)
            self.assertEqual(self.checked(root, manifest), 3)

    def test_m1_directory_modes_and_added_empty_directory_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root, target, manifest = self.fixture(td)
            directory = target.parent
            directory.chmod(0o777)
            with self.assertRaisesRegex(ValueError, "unsafe"):
                self.checked(root, manifest)
            directory.chmod(0o755)
            (root / "empty").mkdir()
            with self.assertRaisesRegex(ValueError, "differs"):
                self.checked(root, manifest)

    def test_m1_hardlink_rejected_even_if_bytes_match(self):
        with tempfile.TemporaryDirectory() as td:
            root, target, manifest = self.fixture(td)
            outside = Path(td) / "external-hardlink"
            os.link(target, outside)
            with self.assertRaisesRegex(ValueError, "hardlink"):
                self.checked(root, manifest)

    def test_m1_owner_uid_and_gid_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root, target, manifest = self.fixture(td)
            with self.assertRaisesRegex(ValueError, "owned"):
                mod.audit_tree(root, owner_uid=os.getuid() + 1, owner_gid=os.getgid(), check_ancestors=False)
            with self.assertRaisesRegex(ValueError, "owned"):
                mod.audit_tree(root, owner_uid=os.getuid(), owner_gid=os.getgid() + 1, check_ancestors=False)

    def test_m1_ancestors_audited(self):
        with tempfile.TemporaryDirectory() as td:
            parent = Path(td) / "writable"
            parent.mkdir(mode=0o700)
            root = parent / "release"
            root.mkdir()
            mod.audit_tree(root, owner_uid=os.getuid(), owner_gid=os.getgid(), check_ancestors=False)
            parent.chmod(0o777)
            with self.assertRaisesRegex(ValueError, "unsafe"):
                mod.audit_tree(root, owner_uid=os.getuid(), owner_gid=os.getgid(), check_ancestors=True)

    def test_manifest_includes_directory_metadata(self):
        with tempfile.TemporaryDirectory() as td:
            root, target, manifest = self.fixture(td)
            document = json.loads(manifest.read_text())
            self.assertEqual(document["schema"], "saracraft-release-tree-v2")
            self.assertEqual([x["path"] for x in document["entries"]], [".", "controller", "controller/main.js"])
            self.assertEqual([x["type"] for x in document["entries"]], ["directory", "directory", "file"])
            self.assertEqual(document["entries"][-1]["nlink"], 1)
            self.assertIn("uid", document["entries"][0])
            self.assertIn("gid", document["entries"][1])
            self.assertIn("mode", document["entries"][1])

    def test_public_strict_verify_does_not_accept_developer_owned_fixture(self):
        if os.getuid() == 0:
            self.skipTest("Runner is root; ownership rejection tested explicitly with owner overrides")
        with tempfile.TemporaryDirectory() as td:
            root, target, manifest = self.fixture(td)
            with self.assertRaisesRegex(ValueError, "root-owned"):
                mod.verify(root, manifest)


if __name__ == "__main__":
    unittest.main()
