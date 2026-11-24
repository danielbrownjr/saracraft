from datetime import datetime, timedelta, timezone
import json
import signal
import unittest
from unittest.mock import patch

from ops.observation.supervisor import RestrictedOperations, State, observe, evaluate_acceptance

START = datetime(2026, 1, 1, tzinfo=timezone.utc)
LAUNCH = 2.25


def timestamp(tick):
    return (START + timedelta(seconds=tick)).isoformat()


def line(tick, event, **fields):
    return json.dumps({"time": timestamp(tick), "event": event, **fields})


class SimulatedOperations:
    def __init__(self, *, finish=153, failure=None):
        self.tick = 0
        self.finish = finish
        self.failure = failure
        self.stops = 0
        self.highest_window = 0

    def clock(self):
        return self.tick + 91000

    def wall(self):
        return START + timedelta(seconds=self.tick)

    def sleep(self, seconds):
        self.tick += seconds
        if self.failure == "interrupt" and self.tick == 5 and not self.stops:
            raise KeyboardInterrupt

    def state(self):
        if self.tick < LAUNCH or self.failure == "never_started":
            return State("inactive", 0, "", 80000, "success", 0, True, 0, "")
        running = self.tick < self.finish and not self.stops
        if self.failure == "unconfirmed_stop" and self.stops:
            running = True
        started = 91000 + LAUNCH + (1 if self.failure == "restart" and self.tick >= 5 else 0)
        invocation = "original"
        restarts = 0
        if self.failure == "terminal_restart" and not running:
            started += 1
        if self.failure == "hidden_restart" and not running:
            started = 0
            invocation = ""
            restarts = 1
        if self.failure == "new_invocation" and self.tick >= 5:
            invocation = "different"
        if self.failure == "cleared_timestamp" and not running:
            started = 0
            invocation = ""
        if self.failure == "running_zero" and running and self.tick >= 5:
            started = 0
        return State("active" if running else "inactive", int(running),
                     "/simulated" if running else "", started, "success", 0,
                     bool(self.stops) and self.failure != "unconfirmed_stop", restarts, invocation)

    def logs(self):
        if self.failure == "log_error" and 5 <= self.tick and not self.stops:
            raise OSError("simulated log read error")
        records = [line(-3, "historical"), line(LAUNCH - .1, "historical")]
        if self.tick >= LAUNCH:
            records.extend([line(LAUNCH, "connecting", attempt=1),
                            line(3, "spawn"), line(3, "observation_ready")])
        if self.failure == "retry" and self.tick >= 5:
            records.append(line(5, "reconnecting"))
        for tick in range(3, min(int(self.tick), self.finish - 1) + 1):
            if self.failure == "telemetry_gap" and tick >= 5:
                continue
            distance = 251 if self.failure == "hazard" and tick >= 5 else 0
            if self.failure == "sparse" and tick % 4:
                continue
            if self.failure == "drift" and tick >= 5:
                distance = 200
            if self.failure == "null" and tick >= 5:
                distance = None
            grounded = self.failure != "never_grounded" and not (self.failure == "lost_ground" and tick >= 5)
            if self.failure == "never_grounded":
                distance = None
            verdict = "STATE_UNAVAILABLE" if self.failure == "unavailable" and tick >= 5 else "UNKNOWN_STATE"
            row = line(tick, "telemetry_sample", onGround=grounded,
                       displacementMilliblocks=distance, verdict=verdict)
            records.extend([row, row])
            if tick % 5 == 0:
                records.append(line(tick, "heartbeat"))
        if self.tick >= self.finish:
            records.append(line(self.finish, "disconnected"))
        visible = [row for row in records if json.loads(row)["time"] <= timestamp(self.tick)][-100:]
        self.highest_window = max(self.highest_window, len(visible))
        return visible

    def estop(self):
        self.stops += 1
        if self.failure == "unconfirmed_stop":
            raise OSError("simulated stop failure")

    def run(self):
        return observe(self, clock=self.clock, wall=self.wall, sleep=self.sleep, announce=lambda _: None)


class SupervisorTests(unittest.TestCase):
    def test_normal_attended_run_schedules_from_observed_launch_and_restores_inhibit(self):
        ops = SimulatedOperations()
        result = ops.run()
        self.assertEqual(result["outcome"], "normal")
        self.assertEqual(result["acceptance"]["automated_acceptance"], "pass")
        self.assertEqual(result["acceptance"]["operator_acceptance"], "pending")
        self.assertTrue(result["termination_verified"])
        self.assertEqual(ops.stops, 1)
        self.assertEqual(ops.highest_window, 100)
        self.assertEqual(result["launch_utc"], timestamp(LAUNCH))
        self.assertEqual(result["inactive_utc"], timestamp(153))
        evidence = result["evidence"]
        self.assertTrue(evidence["complete_overlap"])
        self.assertEqual([s["due"] for s in evidence["snapshots"]], [None,30,60,90,120,150,None])
        self.assertEqual(evidence["samples"], 150)
        self.assertEqual(evidence["events"], 184)
        self.assertEqual(len(evidence["events_retained"]), 184)
        self.assertEqual(evidence["snapshots"][-1]["outcome"], "normal")
        self.assertTrue(all("historical" not in row for s in evidence["snapshots"] for row in s["lines"]))

    def test_premature_exit(self):
        ops = SimulatedOperations(finish=10)
        result = ops.run()
        self.assertEqual(result["outcome"], "premature")
        self.assertEqual(result["reason"], "premature_disconnect")
        self.assertEqual(result["evidence"]["outcome"], "premature")
        self.assertTrue(result["termination_verified"])
        self.assertEqual(ops.stops, 1)

    def test_faults_all_restore_inhibit_and_preserve_premature_outcome(self):
        for failure, reason in (("hazard", "displacement_or_hazard"), ("retry", "runtime_failure_or_retry"),
                                ("restart", "service_restarted"), ("telemetry_gap", "telemetry_gap"),
                                ("interrupt", "operator_interrupt"), ("log_error", "supervisor_input_failure"),
                                ("never_started", "operator_launch_timeout")):
            with self.subTest(failure=failure):
                ops = SimulatedOperations(failure=failure)
                result = ops.run()
                self.assertEqual(result["reason"], reason)
                self.assertEqual(result["outcome"], "premature")
                self.assertTrue(result["termination_verified"])
                self.assertEqual(ops.stops, 1)

    def test_stop_request_is_not_termination_confirmation(self):
        ops = SimulatedOperations(failure="unconfirmed_stop")
        result = ops.run()
        self.assertTrue(result["estop_request_failed"])
        self.assertFalse(result["termination_verified"])

    def test_rejects_uninhibited_initial_state_without_taking_control(self):
        ops = SimulatedOperations()
        ops.state = lambda: State("inactive", 0, "", 0, "success", 0, False, 0, "")
        with self.assertRaises(ValueError):
            ops.run()
        self.assertEqual(ops.stops, 0)

    def test_adapter_only_reads_state_logs_and_requests_existing_emergency_stop(self):
        with patch("subprocess.check_output", side_effect=[
            "ActiveState=inactive\nMainPID=0\nControlGroup=\n"
            "ExecMainStartTimestampMonotonic=0\nResult=success\nExecMainStatus=0\nNRestarts=0\nInvocationID=\n",
            '{"emergency_inhibit":true}', "", "",
        ]) as execute:
            ops = RestrictedOperations()
            self.assertTrue(ops.state().stopped)
            self.assertEqual(ops.logs(), [])
            ops.estop()
        self.assertEqual([args[0][:2] for args, _ in execute.call_args_list], [
            ("/usr/bin/systemctl", "show"),
            ("/usr/local/bin/saracraftctl", "status"),
            ("/usr/local/bin/saracraftctl", "logs"),
            ("/usr/local/bin/saracraftctl", "estop"),
        ])

    def test_failed_acceptance_cannot_pass_despite_normal_execution(self):
        for failure, criterion in (("sparse", "minimum_samples"),
                                   ("drift", "post_baseline_state"),
                                   ("never_grounded", "grounding_within_3s")):
            with self.subTest(failure=failure):
                result = SimulatedOperations(failure=failure).run()
                self.assertEqual(result["acceptance"]["automated_acceptance"], "fail")
                self.assertFalse(result["acceptance"]["criteria"][criterion])

    def test_post_baseline_invalid_state_stops(self):
        for failure in ("null", "lost_ground", "unavailable"):
            with self.subTest(failure=failure):
                ops = SimulatedOperations(failure=failure)
                result = ops.run()
                self.assertEqual(result["reason"], "post_baseline_state_unavailable")
                self.assertEqual(result["acceptance"]["automated_acceptance"], "fail")
                self.assertTrue(result["termination_verified"])

    def test_repeated_interrupt_during_stop_preserves_evidence(self):
        ops = SimulatedOperations(failure="interrupt")
        original = ops.estop
        def stop():
            self.assertEqual(signal.getsignal(signal.SIGINT), signal.SIG_IGN)
            self.assertEqual(signal.getsignal(signal.SIGTERM), signal.SIG_IGN)
            signal.raise_signal(signal.SIGINT)
            signal.raise_signal(signal.SIGTERM)
            original()
            raise KeyboardInterrupt
        ops.estop = stop
        previous = signal.getsignal(signal.SIGINT)
        result = ops.run()
        self.assertEqual(signal.getsignal(signal.SIGINT), previous)
        self.assertTrue(result["estop_request_failed"])
        self.assertTrue(result["termination_verified"])
        self.assertIn("events_retained", result["evidence"])
        self.assertEqual(result["acceptance"]["automated_acceptance"], "fail")

    def test_adapter_uses_separate_stop_timeout_and_sessions(self):
        with patch("subprocess.check_output", return_value="") as execute:
            ops = RestrictedOperations()
            ops.logs()
            ops.estop()
        self.assertEqual([call.kwargs["timeout"] for call in execute.call_args_list], [2, 15])
        self.assertTrue(all(call.kwargs["start_new_session"] for call in execute.call_args_list))

    def test_normal_shutdown_with_cleared_timestamp(self):
        result = SimulatedOperations(failure="cleared_timestamp").run()
        self.assertEqual(result["outcome"], "normal")
        self.assertEqual(result["acceptance"]["automated_acceptance"], "pass")
        self.assertTrue(result["evidence"]["complete_overlap"])

    def test_premature_shutdown_with_cleared_timestamp(self):
        result = SimulatedOperations(finish=10, failure="cleared_timestamp").run()
        self.assertEqual(result["reason"], "premature_disconnect")
        self.assertEqual(result["acceptance"]["automated_acceptance"], "fail")

    def test_restart_cannot_be_misclassified_as_terminal_reset(self):
        for failure in ("restart", "terminal_restart", "hidden_restart",
                        "new_invocation", "running_zero"):
            with self.subTest(failure=failure):
                result = SimulatedOperations(failure=failure).run()
                self.assertEqual(result["reason"], "service_restarted")
                self.assertEqual(result["acceptance"]["automated_acceptance"], "fail")
                self.assertTrue(result["termination_verified"])
