"""Offline tests for candidate auth launcher. No sudo, systemd or host I/O."""
import importlib.machinery
import importlib.util
import io
import os
from pathlib import Path
import stat
import subprocess
import unittest
from unittest import mock
from contextlib import redirect_stderr

SCRIPT = Path(__file__).resolve().parents[1] / "auth" / "saracraft-auth-launch"
loader = importlib.machinery.SourceFileLoader("saracraft_auth_launch", str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
mod = importlib.util.module_from_spec(spec)
loader.exec_module(mod)


class FakeStat:
    def __init__(self, mode, uid=0, gid=0):
        self.st_mode = mode
        self.st_uid = uid
        self.st_gid = gid


class LauncherTests(unittest.TestCase):
    def test_fixed_invocation_has_clean_environment_and_no_gameplay(self):
        entry = Path("/opt/saracraft/releases/" + "a" * 40 + "/controller/connection/provision-auth.js")
        cmd = mod.command(entry)
        self.assertEqual(cmd[0], "/usr/bin/systemd-run")
        self.assertEqual(cmd[-2:], [str(mod.NODE), str(entry)])
        self.assertIn("--pty", cmd)
        self.assertIn("--wait", cmd)
        self.assertIn("--collect", cmd)
        self.assertIn("--property=User=saracraft-bot", cmd)
        self.assertIn("--property=BindPaths=/var/lib/saracraft-bot/auth:/auth", cmd)
        self.assertIn("--property=RuntimeMaxSec=540", cmd)
        self.assertEqual(cmd[cmd.index("--") + 1:cmd.index("--") + 4],
                         ["/usr/bin/env", "-i", "PATH=/usr/bin:/bin"])
        self.assertNotIn("main.js", " ".join(cmd))
        self.assertNotIn("--observe", cmd)
        self.assertNotIn("clear-inhibit", " ".join(cmd))
        self.assertNotIn("npm", " ".join(cmd))

    def test_zero_arguments_only(self):
        with mock.patch.object(mod, "preflight") as preflight, redirect_stderr(io.StringIO()):
            self.assertEqual(mod.main(["--debug"]), 2)
            preflight.assert_not_called()

    def test_unit_status_rejects_malformed_and_duplicates(self):
        cases = ["", "ActiveState=active\n", "MainPID=x\nActiveState=inactive\nLoadState=loaded\n",
                 "ActiveState=inactive\nActiveState=inactive\nMainPID=0\nLoadState=loaded\n"]
        for output in cases:
            with self.subTest(output=output), mock.patch.object(mod.subprocess, "run",
                return_value=subprocess.CompletedProcess([], 0, output, "")):
                with self.assertRaises(RuntimeError):
                    mod.unit_status("saracraft-bot.service")

    def test_unit_status_uses_fixed_systemctl(self):
        data = "LoadState=not-found\nActiveState=inactive\nMainPID=0\n"
        with mock.patch.object(mod.subprocess, "run",
                               return_value=subprocess.CompletedProcess([], 0, data, "")) as run:
            self.assertEqual(mod.unit_status(mod.AUTH_UNIT)["MainPID"], "0")
            self.assertEqual(run.call_args.args[0][:3],
                             ["/usr/bin/systemctl", "show", mod.AUTH_UNIT])

    def test_private_directory_mode_and_owner_rejected(self):
        with mock.patch.object(Path, "lstat", return_value=FakeStat(stat.S_IFDIR | 0o700, uid=1234)):
            mod.check_private_dir(Path("/auth"), 1234)
            with self.assertRaises(RuntimeError):
                mod.check_private_dir(Path("/auth"), 4321)
        for mode in [stat.S_IFLNK | 0o777, stat.S_IFDIR | 0o750,
                     stat.S_IFDIR | 0o4700, stat.S_IFREG | 0o600]:
            with self.subTest(mode=oct(mode)), mock.patch.object(Path, "lstat",
                return_value=FakeStat(mode, uid=1234)):
                with self.assertRaises(RuntimeError):
                    mod.check_private_dir(Path("/auth"), 1234)

    def test_inhibit_must_be_root_owned_0600_regular_file(self):
        for mode, uid in [(stat.S_IFREG | 0o644, 0), (stat.S_IFREG | 0o600, 1000),
                          (stat.S_IFLNK | 0o777, 0)]:
            with self.subTest(mode=oct(mode), uid=uid), mock.patch.object(Path, "lstat",
                return_value=FakeStat(mode, uid=uid)):
                with self.assertRaises(RuntimeError):
                    mod.check_root_path(mod.CONTROL_INHIBIT, kind="file", exact_mode=0o600)

    def test_preflight_refuses_unattended_and_missing_inhibit(self):
        with mock.patch.object(mod.os, "geteuid", return_value=1000):
            with self.assertRaises(RuntimeError):
                mod.preflight()
        with mock.patch.object(mod.os, "geteuid", return_value=0), \
             mock.patch.dict(mod.os.environ, {"SUDO_USER": "daniel"}), \
             mock.patch.object(mod.os, "isatty", return_value=True), \
             mock.patch("builtins.open", mock.mock_open()) as tty, \
             mock.patch.object(mod, "check_root_path", side_effect=RuntimeError("no inhibit")) as check:
            tty.return_value.__enter__.return_value.fileno.return_value = 4
            with self.assertRaisesRegex(RuntimeError, "no inhibit"):
                mod.preflight()
            check.assert_called_once_with(mod.CONTROL_INHIBIT, kind="file", exact_mode=0o600)

    def test_main_dispatches_only_fixed_command_and_generic_failure(self):
        entry = Path("/opt/saracraft/releases/" + "a" * 40 + "/controller/connection/provision-auth.js")
        with mock.patch.object(mod, "preflight", return_value=entry), \
             mock.patch.object(mod.subprocess, "run",
                return_value=subprocess.CompletedProcess([], 0, "", "")) as run:
            self.assertEqual(mod.main([]), 0)
            self.assertEqual(run.call_args.args[0], mod.command(entry))
            self.assertEqual(run.call_args.kwargs["env"],
                             {"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
        with mock.patch.object(mod, "preflight", return_value=entry), \
             mock.patch.object(mod.subprocess, "run",
                side_effect=RuntimeError("SYNTHETIC-SECRET")), \
             redirect_stderr(io.StringIO()) as stderr:
            self.assertEqual(mod.main([]), 1)
            self.assertNotIn("SYNTHETIC-SECRET", stderr.getvalue())
            self.assertIn("keep inhibit active", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
