"""Unprivileged offline fixtures for the auth package layout preflight."""
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "auth" / "check_package_layout.py"
spec = importlib.util.spec_from_file_location("check_package_layout", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class PackageLayoutTests(unittest.TestCase):
    def fixture(self, directory):
        root = Path(directory)
        release = root / "release"
        connection = release / "controller" / "connection"
        connection.mkdir(parents=True)
        (connection / "provision-auth.js").write_text("fixture")
        (connection / "package-lock.json").write_text("{}")
        runtime = root / "runtime"
        (runtime / "bin").mkdir(parents=True)
        node = runtime / "bin" / "node"
        node.write_text("fixture")
        node.chmod(0o755)
        return release, runtime, connection, node

    def test_minimal_regular_file_layout_accepted(self):
        with tempfile.TemporaryDirectory() as td:
            release, runtime, _, _ = self.fixture(td)
            self.assertEqual(mod.check_packages(release, runtime), (4, 2))

    def test_stock_npm_and_node_symlinks_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            release, runtime, connection, node = self.fixture(td)
            links = connection / "node_modules" / ".bin"
            links.mkdir(parents=True)
            (links / "command").symlink_to("../command")
            with self.assertRaises(mod.PackageLayoutError):
                mod.check_packages(release, runtime)
            (links / "command").unlink()
            (runtime / "bin" / "npm").symlink_to(node)
            with self.assertRaises(mod.PackageLayoutError):
                mod.check_packages(release, runtime)

    def test_unsafe_permissions_hardlinks_and_special_files(self):
        with tempfile.TemporaryDirectory() as td:
            release, runtime, connection, node = self.fixture(td)
            for mode in [0o777, 0o4755, 0o2755]:
                original = stat.S_IMODE(node.stat().st_mode)
                node.chmod(mode)
                with self.assertRaises(mod.PackageLayoutError):
                    mod.check_packages(release, runtime)
                node.chmod(original)
            another = runtime / "bin" / "linked"
            os.link(node, another)
            with self.assertRaises(mod.PackageLayoutError):
                mod.check_packages(release, runtime)
            another.unlink()
            fifo = connection / "channel"
            os.mkfifo(fifo)
            with self.assertRaises(mod.PackageLayoutError):
                mod.check_packages(release, runtime)

    def test_missing_lock_or_nonexecutable_node_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            release, runtime, connection, node = self.fixture(td)
            (connection / "package-lock.json").unlink()
            with self.assertRaises(OSError):
                mod.check_packages(release, runtime)
            (connection / "package-lock.json").write_text("{}")
            node.chmod(0o644)
            with self.assertRaises(mod.PackageLayoutError):
                mod.check_packages(release, runtime)


if __name__ == "__main__":
    unittest.main()
