"""Offline tests. No sudo, systemd, credential access or Minecraft traffic."""
import importlib.machinery
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock
from contextlib import redirect_stdout, redirect_stderr

ROOT = Path(__file__).resolve().parents[1]

def module(name, path):
    loader = importlib.machinery.SourceFileLoader(name, str(ROOT / path))
    spec = importlib.util.spec_from_loader(name, loader)
    instance = importlib.util.module_from_spec(spec)
    loader.exec_module(instance)
    return instance

front = module("saracraftctl", "saracraftctl")
priv = module("saracraftctl_priv", "saracraftctl-priv")

def result(stdout="", code=0):
    return subprocess.CompletedProcess([], code, stdout, "")

class FrontendTests(unittest.TestCase):
    def test_allowlist_and_fixed_backend(self):
        for arguments, operation in [
            (["start", "observe"], "start-observe"), (["status"], "status"),
            (["stop"], "stop"), (["logs"], "logs"), (["estop"], "estop")
        ]:
            with self.subTest(arguments=arguments), mock.patch.object(front.subprocess, "run", return_value=result()) as run:
                self.assertEqual(front.main(arguments), 0)
                run.assert_called_once_with(
                    ["/usr/bin/sudo", "-n", "/usr/local/libexec/saracraftctl-priv", operation],
                    check=False)

    def test_rejects_extra_arguments_and_control_injection(self):
        for arguments in [[], ["start"], ["start", "walk"], ["start", "observe", "--host", "other"],
                          ["status", "other.service"], ["logs", "--all"], ["clear-inhibit"],
                          ["estop;id"], ["start", "observe\n--walk"]]:
            with self.subTest(arguments=arguments), mock.patch.object(front.subprocess, "run") as run, redirect_stderr(io.StringIO()):
                self.assertEqual(front.main(arguments), 2)
                run.assert_not_called()

class BackendTests(unittest.TestCase):
    def test_root_and_argument_gate_precedes_side_effects(self):
        for args in [[], ["start-observe", "other"], ["clear-inhibit", "x"],
                     ["restart"], ["status", "--unit=ssh"]]:
            with self.subTest(args=args), mock.patch.object(priv.os, "geteuid", return_value=0), mock.patch.object(priv, "control") as control, redirect_stderr(io.StringIO()):
                self.assertEqual(priv.main(args), 2)
                control.assert_not_called()
        with mock.patch.object(priv.os, "geteuid", return_value=1000), mock.patch.object(priv, "control") as control, redirect_stderr(io.StringIO()):
            self.assertEqual(priv.main(["start-observe"]), 1)
            control.assert_not_called()

    def test_sanitizer_rejects_identifying_and_unstructured_logs(self):
        base = {"time": "2026-11-23T12:00:00.000Z", "run": "00000000-0000-4000-8000-000000000001"}
        self.assertEqual(priv.sanitize({**base, "event": "spawn"}), {"time": base["time"], "event": "spawn"})
        for entry in [
            {**base, "event": "spawn", "username": "secret"},
            {**base, "event": "authenticating", "token": "secret"},
            {**base, "event": "failed", "category": "token=secret"},
            {**base, "event": "telemetry_sample", "creeperDistanceBlocks": "secret"},
            {**base, "event": "player_presence", "uuid": "secret"},
            {**base, "event": "arbitrary"},
        ]:
            with self.subTest(entry=entry):
                self.assertIsNone(priv.sanitize(entry))

    def test_sanitized_telemetry_fields(self):
        raw = {"time": "2026-11-23T12:00:00.000Z", "run": "00000000-0000-4000-8000-000000000001",
               "event": "telemetry_sample", "airPacketCount": 10, "airPacketAgeMs": 5000,
               "entitiesObserved": True, "creeperDistanceBlocks": 3, "verdict": "UNKNOWN_STATE"}
        safe = priv.sanitize(raw)
        self.assertEqual(safe["airPacketAgeMs"], 5000)
        self.assertEqual(safe["creeperDistanceBlocks"], 3)
        self.assertNotIn("run", safe)

    def test_logs_drop_unsanitized_raw_lines(self):
        run = "00000000-0000-4000-8000-000000000001"
        source = "\n".join([
            json.dumps({"time": "2026-11-23T12:00:00.000Z", "run": run,
                        "event": "failed", "category": "AUTH_REQUIRED"}),
            json.dumps({"time": "2026-11-23T12:00:00.000Z", "run": run,
                        "event": "spawn", "chat": "secret"}),
            "unstructured token secret",
        ])
        with mock.patch.object(priv, "run", return_value=result(source)), redirect_stdout(io.StringIO()) as output:
            priv.public_logs()
        self.assertEqual(len(output.getvalue().splitlines()), 1)
        self.assertNotIn("secret", output.getvalue())
        self.assertIn("AUTH_REQUIRED", output.getvalue())

    def test_operations_single_unit_and_persistent_estop(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            with mock.patch.object(priv, "CONTROL_DIR", path), \
                 mock.patch.object(priv, "LOCK", path / "operations.lock"), \
                 mock.patch.object(priv, "INHIBIT", path / "inhibit"), \
                 mock.patch.object(priv, "unit_state", return_value="inactive"), \
                 mock.patch.object(priv, "validate_control_directory"), \
                 mock.patch.object(priv, "run", return_value=result()) as cmd, \
                 mock.patch.object(priv.os, "geteuid", return_value=0), \
                 mock.patch.object(priv.os, "getuid", return_value=0):
                # Test uses temp directory with local permissions; no real systemd.
                path.chmod(0o700)
                self.assertEqual(priv.main(["start-observe"]), 0)
                cmd.assert_called_with(["/usr/bin/systemctl", "start", "--no-block", "saracraft-bot.service"])
                self.assertEqual(priv.main(["estop"]), 0)
                self.assertTrue((path / "inhibit").exists())
                cmd.assert_called_with(["/usr/bin/systemctl", "stop", "--no-block", "saracraft-bot.service"])
                with redirect_stderr(io.StringIO()):
                    self.assertEqual(priv.main(["start-observe"]), 1)
                # Only privileged administration can clear inhibit; frontend rejects verb.
                self.assertEqual(priv.main(["clear-inhibit"]), 0)
                self.assertFalse((path / "inhibit").exists())

if __name__ == "__main__":
    unittest.main()
