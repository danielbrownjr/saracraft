"""Offline tests. No sudo, systemd, credential access or Minecraft traffic."""
import importlib.machinery
import importlib.util
import io
import json
import os
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

    def test_passive_observation_diagnostics_are_bounded(self):
        base = {"time": "2026-11-23T12:00:00.000Z",
                "run": "00000000-0000-4000-8000-000000000001",
                "event": "telemetry_sample"}
        for ground in (True, False, None):
            for displacement in (None, 0, 2900, 1000000):
                safe = priv.sanitize({**base, "onGround": ground,
                                      "displacementMilliblocks": displacement})
                self.assertIsNotNone(safe)
                self.assertEqual(safe["onGround"], ground)
                self.assertEqual(safe["displacementMilliblocks"], displacement)
        for key, value in [("onGround", 1), ("onGround", "true"),
                           ("displacementMilliblocks", -1),
                           ("displacementMilliblocks", 1000001),
                           ("displacementMilliblocks", 1.5),
                           ("displacementMilliblocks", True),
                           ("displacementMilliblocks", "secret"),
                           ("position", [1, 2, 3])]:
            self.assertIsNone(priv.sanitize({**base, key: value}))
        self.assertIsNotNone(priv.sanitize(base))

    def test_command_diagnostics_only_publish_complete_boolean_groups(self):
        base = {"time": "2026-11-23T12:00:00.000Z",
                "run": "00000000-0000-4000-8000-000000000001", "event": "movement_ignored"}
        core = dict.fromkeys(priv.CHAT_CHECKS, False)
        wire = dict.fromkeys(priv.CHAT_WIRE_CHECKS, True)
        packet = dict.fromkeys(priv.CHAT_PACKET_CHECKS, True)
        for checks in (core, {**core, **wire}, {**core, **wire, **packet}):
            safe = priv.sanitize({**base, **checks})
            self.assertEqual(safe, {"time": base["time"], "event": base["event"], **checks})
        for extra in ({"signatureVerified": 1}, {"signature": "secret"},
                      {"uuid": "secret"}, {"chatSessionKnown": True}, {"packedReferences": True}):
            self.assertIsNone(priv.sanitize({**base, **core, **extra}))
        self.assertIsNone(priv.sanitize({**base, "signatureVerified": False}))

    def test_logs_drop_unsanitized_raw_lines(self):
        run = "00000000-0000-4000-8000-000000000001"
        source = "\n".join([
            json.dumps({"time": "2026-11-23T12:00:00.000Z", "run": run,
                        "event": "failed", "category": "AUTH_REQUIRED"}),
            json.dumps({"time": "2026-11-23T12:00:00.000Z", "run": run,
                        "event": "spawn", "chat": "secret"}),
            "unstructured token secret",
        ])
        with mock.patch.object(priv, "read_private_log_lines", return_value=source.splitlines()), redirect_stdout(io.StringIO()) as output:
            priv.public_logs()
        self.assertEqual(len(output.getvalue().splitlines()), 1)
        self.assertNotIn("secret", output.getvalue())
        self.assertIn("AUTH_REQUIRED", output.getvalue())


    def test_private_log_reader_checks_owner_and_mode_and_filters_content(self):
        with tempfile.TemporaryDirectory() as td:
            folder = Path(td) / "logs"
            folder.mkdir(mode=0o700)
            logfile = folder / "verification.jsonl"
            sample = {"time": "2026-11-23T12:00:00.000Z",
                      "run": "00000000-0000-4000-8000-000000000001",
                      "event": "failed", "category": "AUTH_REQUIRED"}
            logfile.write_text(json.dumps(sample) + "\n" + "secret raw text" + "\n")
            logfile.chmod(0o600)
            uid = os.getuid()
            with mock.patch.object(priv, "PRIVATE_LOG_DIR", folder), \
                 mock.patch.object(priv, "PRIVATE_LOG", logfile), \
                 mock.patch.object(priv.pwd, "getpwnam", return_value=mock.Mock(pw_uid=uid)):
                lines = priv.read_private_log_lines()
                self.assertEqual(len(lines), 2)
                with redirect_stdout(io.StringIO()) as output:
                    priv.public_logs()
                self.assertIn("AUTH_REQUIRED", output.getvalue())
                self.assertNotIn("secret raw text", output.getvalue())
                folder.chmod(0o750)
                with self.assertRaisesRegex(RuntimeError, "directory"):
                    priv.read_private_log_lines()
                folder.chmod(0o700)
                logfile.chmod(0o644)
                with self.assertRaisesRegex(RuntimeError, "file"):
                    priv.read_private_log_lines()
                logfile.chmod(0o600)
                logfile.unlink()
                logfile.symlink_to(Path(td) / "elsewhere")
                with self.assertRaises(OSError):
                    priv.read_private_log_lines()

    def test_private_log_reader_discards_partial_tail_and_limits_read(self):
        with tempfile.TemporaryDirectory() as td:
            folder = Path(td) / "logs"
            folder.mkdir(mode=0o700)
            logfile = folder / "verification.jsonl"
            sample = json.dumps({"time": "2026-11-23T12:00:00.000Z",
                                 "run": "00000000-0000-4000-8000-000000000001",
                                 "event": "disconnected"}) + "\n"
            logfile.write_bytes(b"x" * 512 + b"\n" + sample.encode())
            logfile.chmod(0o600)
            with mock.patch.object(priv, "PRIVATE_LOG_DIR", folder), \
                 mock.patch.object(priv, "PRIVATE_LOG", logfile), \
                 mock.patch.object(priv, "MAX_LOG_BYTES", len(sample) + 20), \
                 mock.patch.object(priv.pwd, "getpwnam", return_value=mock.Mock(pw_uid=os.getuid())):
                self.assertEqual(priv.read_private_log_lines(), [sample.strip()])

    def test_missing_bot_account_fails_cleanly(self):
        with mock.patch.object(priv.pwd, "getpwnam", side_effect=KeyError("saracraft-bot")):
            with self.assertRaisesRegex(RuntimeError, "Bot account missing"):
                priv.read_private_log_lines()

    def test_private_log_reader_rejects_foreign_owner(self):
        with tempfile.TemporaryDirectory() as td:
            folder = Path(td) / "logs"
            folder.mkdir(mode=0o700)
            with mock.patch.object(priv, "PRIVATE_LOG_DIR", folder), \
                 mock.patch.object(priv.pwd, "getpwnam", return_value=mock.Mock(pw_uid=os.getuid()+1000)):
                with self.assertRaisesRegex(RuntimeError, "directory"):
                    priv.read_private_log_lines()

    def test_estop_requests_stop_when_inhibit_write_fails(self):
        with mock.patch.object(priv, "validate_control_directory"), \
             mock.patch.object(priv.os, "open", side_effect=OSError("read-only")), \
             mock.patch.object(priv, "run", return_value=result()) as run, \
             redirect_stderr(io.StringIO()) as output:
            self.assertEqual(priv.emergency_stop(), 1)
        run.assert_called_once_with(["/usr/bin/systemctl", "stop", "--no-block", "saracraft-bot.service"])
        self.assertIn("PARTIAL", output.getvalue())

    def test_estop_requests_stop_despite_invalid_control_directory(self):
        with mock.patch.object(priv, "validate_control_directory", side_effect=RuntimeError("unsafe")), \
             mock.patch.object(priv, "run", return_value=result()) as run, \
             redirect_stderr(io.StringIO()) as output:
            self.assertEqual(priv.emergency_stop(), 1)
        run.assert_called_once_with(["/usr/bin/systemctl", "stop", "--no-block", "saracraft-bot.service"])
        self.assertIn("PARTIAL", output.getvalue())

    def test_estop_and_stop_do_not_obtain_operation_lock(self):
        with mock.patch.object(priv, "validate_control_directory", side_effect=RuntimeError("unsafe")), \
             mock.patch.object(priv.fcntl, "flock", side_effect=AssertionError("lock acquired")), \
             mock.patch.object(priv, "run", return_value=result()) as run, \
             redirect_stderr(io.StringIO()):
            self.assertEqual(priv.control("estop"), 1)
            self.assertEqual(priv.control("stop"), 0)
        self.assertEqual(run.call_count, 2)
        for call in run.call_args_list:
            self.assertEqual(call.args[0], ["/usr/bin/systemctl", "stop", "--no-block", "saracraft-bot.service"])

    def test_status_and_logs_skip_exclusive_lock(self):
        with mock.patch.object(priv, "validate_control_directory"), \
             mock.patch.object(priv, "unit_details", return_value={"ActiveState": "inactive", "Result": "success", "ConditionResult": "yes", "ExecMainStatus": "0"}), \
             mock.patch.object(priv, "public_logs"), \
             mock.patch.object(priv, "INHIBIT", mock.Mock(exists=lambda: False)), \
             mock.patch.object(priv.fcntl, "flock", side_effect=AssertionError("lock acquired")), \
             redirect_stdout(io.StringIO()):
            self.assertEqual(priv.control("status"), 0)
            self.assertEqual(priv.control("logs"), 0)

    def test_estop_reports_both_failed_stop_and_inhibit(self):
        with mock.patch.object(priv, "validate_control_directory", side_effect=RuntimeError("unsafe")), \
             mock.patch.object(priv, "run", return_value=result(code=1)) as run, \
             redirect_stderr(io.StringIO()) as output:
            self.assertEqual(priv.emergency_stop(), 1)
        run.assert_called_once()
        self.assertIn("PARTIAL", output.getvalue())

    def test_estop_partial_inhibit_failure_reports_future_restart_risk(self):
        with mock.patch.object(priv, "validate_control_directory"), \
             mock.patch.object(priv.os, "open", side_effect=OSError("no space")), \
             mock.patch.object(priv, "run", return_value=result()) as run, \
             redirect_stderr(io.StringIO()) as output:
            self.assertEqual(priv.emergency_stop(), 1)
        run.assert_called_once_with(["/usr/bin/systemctl", "stop", "--no-block", "saracraft-bot.service"])
        text = output.getvalue()
        self.assertIn("stop_request=ACCEPTED", text)
        self.assertIn("inhibit_file=NOT_CONFIRMED", text)
        self.assertIn("Future starts are NOT inhibited", text)
        self.assertNotIn("stop_request=FAILED", text)

    def test_estop_partial_stop_failure_reports_termination_not_confirmed(self):
        with tempfile.TemporaryDirectory() as directory:
            inhibit = Path(directory) / "inhibit"
            with mock.patch.object(priv, "INHIBIT", inhibit), \
                 mock.patch.object(priv, "validate_control_directory"), \
                 mock.patch.object(priv, "run", return_value=result(code=1)) as run, \
                 redirect_stderr(io.StringIO()) as output:
                self.assertEqual(priv.emergency_stop(), 1)
                self.assertTrue(inhibit.exists())
        run.assert_called_once_with(["/usr/bin/systemctl", "stop", "--no-block", "saracraft-bot.service"])
        text = output.getvalue()
        self.assertIn("stop_request=FAILED", text)
        self.assertIn("inhibit_file=PRESENT", text)
        self.assertIn("Verify and terminate the bot", text)
        self.assertNotIn("Future starts are NOT inhibited", text)

    def test_estop_partial_both_failures_reports_both_distinct_outcomes(self):
        with mock.patch.object(priv, "validate_control_directory", side_effect=RuntimeError("unsafe")), \
             mock.patch.object(priv, "run", side_effect=FileNotFoundError("systemctl")) as run, \
             redirect_stderr(io.StringIO()) as output:
            self.assertEqual(priv.emergency_stop(), 1)
        run.assert_called_once()
        text = output.getvalue()
        self.assertIn("stop_request=FAILED", text)
        self.assertIn("inhibit_file=NOT_CONFIRMED", text)
        self.assertIn("Future starts are NOT inhibited", text)
        self.assertIn("Verify and terminate the bot", text)

    def test_estop_complete_reports_acknowledgment_not_termination(self):
        with tempfile.TemporaryDirectory() as directory:
            inhibit = Path(directory) / "inhibit"
            with mock.patch.object(priv, "INHIBIT", inhibit), \
                 mock.patch.object(priv, "validate_control_directory"), \
                 mock.patch.object(priv, "run", return_value=result()) as run, \
                 redirect_stdout(io.StringIO()) as output:
                self.assertEqual(priv.emergency_stop(), 0)
                self.assertTrue(inhibit.exists())
        run.assert_called_once()
        self.assertIn("stop_request=ACCEPTED inhibit_file=PRESENT", output.getvalue())
        self.assertIn("termination not yet verified", output.getvalue())

    def test_deeply_nested_log_json_is_discarded_not_fatal(self):
        source = "[" * 4096 + "\n" + json.dumps({
            "time": "2026-11-23T12:00:00.000Z",
            "run": "00000000-0000-4000-8000-000000000001",
            "event": "disconnected"
        })
        with mock.patch.object(priv, "read_private_log_lines", return_value=source.splitlines()), redirect_stdout(io.StringIO()) as output:
            priv.public_logs()
        self.assertEqual(len(output.getvalue().splitlines()), 1)
        self.assertIn("disconnected", output.getvalue())

    def test_status_reports_bounded_unit_outcomes(self):
        response = result("\n".join([
            "ActiveState=failed", "Result=exit-code",
            "ConditionResult=yes", "ExecMainStatus=226",
        ]) + "\n")
        with mock.patch.object(priv, "run", return_value=response) as cmd:
            details = priv.unit_details()
        self.assertEqual(details["Result"], "exit-code")
        self.assertEqual(details["ExecMainStatus"], "226")
        cmd.assert_called_once_with([
            "/usr/bin/systemctl", "show", "saracraft-bot.service",
            "--property=ActiveState,Result,ConditionResult,ExecMainStatus",
            "--no-pager",
        ])

    def test_status_drops_unsafe_unit_metadata(self):
        values = [
            "ActiveState=active\nResult=success\nConditionResult=yes\nExecMainStatus=0\nDescription=untrusted",
            "ActiveState=active\nResult=success\nConditionResult=yes\nExecMainStatus=bad",
            "ActiveState=active\nResult=success\nConditionResult=yes",
            "ActiveState=active\nActiveState=failed\nResult=success\nConditionResult=yes\nExecMainStatus=0",
            "ActiveState=active\nResult=success\nConditionResult=yes\nExecMainStatus=0\nExecMainStatus=1",
        ]
        for value in values[1:]:
            with self.subTest(value=value), mock.patch.object(priv, "run", return_value=result(value)):
                with self.assertRaises(RuntimeError):
                    priv.unit_details()
        # Unknown fields do not leak into the returned allowlist.
        with mock.patch.object(priv, "run", return_value=result(values[0])):
            self.assertEqual(set(priv.unit_details()), set(priv.STATUS_FIELDS))

    def test_status_prints_only_allowlisted_diagnostics(self):
        details = {"ActiveState": "failed", "Result": "exit-code",
                   "ConditionResult": "yes", "ExecMainStatus": "226"}
        with mock.patch.object(priv, "validate_control_directory"), \
             mock.patch.object(priv, "unit_details", return_value=details), \
             mock.patch.object(priv, "INHIBIT", mock.Mock(exists=lambda: False)), \
             redirect_stdout(io.StringIO()) as output:
            self.assertEqual(priv.control("status"), 0)
        visible = json.loads(output.getvalue())
        self.assertEqual(visible["exec_main_status"], 226)
        self.assertEqual(visible["result"], "exit-code")
        self.assertEqual(visible["condition_result"], "yes")
        self.assertNotIn("Description", visible)

    def test_observe_launch_checks_effective_command_and_refuses_walk(self):
        node, entry = priv.OBSERVE_NODE, priv.OBSERVE_ENTRY
        observe = f"{{ path={node} ; argv[]={node} {entry} --observe ; ignore_errors=no ; }}"
        for command, allowed in [(observe, True),
                                 (observe.replace("--observe", "--walk-supervised"), False),
                                 (observe.replace("--observe", "--observe --walk-supervised"), False),
                                 (observe + " " + observe, False),
                                 ("", False)]:
            with self.subTest(command=command), tempfile.TemporaryDirectory() as directory:
                path = Path(directory)
                launch = result(stdout=command)
                with mock.patch.object(priv, "LOCK", path / "lock"), \
                     mock.patch.object(priv, "INHIBIT", path / "inhibit"), \
                     mock.patch.object(priv, "unit_state", return_value="inactive"), \
                     mock.patch.object(priv, "validate_control_directory"), \
                     mock.patch.object(priv, "run", side_effect=[launch, result()]) as run:
                    if allowed:
                        self.assertEqual(priv.control("start-observe"), 0)
                        self.assertEqual(run.call_count, 2)
                    else:
                        with self.assertRaisesRegex(RuntimeError, "fixed observation"):
                            priv.control("start-observe")
                        run.assert_called_once()

    def test_operations_single_unit_and_persistent_estop(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            with mock.patch.object(priv, "CONTROL_DIR", path), \
                 mock.patch.object(priv, "LOCK", path / "operations.lock"), \
                 mock.patch.object(priv, "INHIBIT", path / "inhibit"), \
                 mock.patch.object(priv, "unit_state", return_value="inactive"), \
                 mock.patch.object(priv, "require_observation_start"), \
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
