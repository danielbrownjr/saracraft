"""Monitor one operator-started observation and restore the inhibit on exit."""
import argparse
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import os
import signal
import subprocess
import time

from ops.observation.collector import Collector


UNIT = "saracraft-bot.service"
CONTROL = "/usr/local/bin/saracraftctl"
SYSTEMCTL = "/usr/bin/systemctl"
TERMINAL = {"inactive", "failed"}


@dataclass(frozen=True)
class State:
    active: str
    pid: int
    group: str
    started: float
    result: str
    exit_status: int
    inhibited: bool

    @property
    def stopped(self):
        return self.active in TERMINAL and self.pid == 0 and not self.group


class RestrictedOperations:
    @staticmethod
    def _read(*command):
        return subprocess.check_output(command, text=True, timeout=2,
                                       stderr=subprocess.DEVNULL,
                                       env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"})

    def state(self):
        props = dict(line.split("=", 1) for line in self._read(
            SYSTEMCTL, "show", UNIT, "-p", "ActiveState,MainPID,ControlGroup,"
            "ExecMainStartTimestampMonotonic,Result,ExecMainStatus"
        ).splitlines())
        status = json.loads(self._read(CONTROL, "status"))
        if type(status.get("emergency_inhibit")) is not bool:
            raise ValueError("Invalid inhibit status")
        return State(props["ActiveState"], int(props["MainPID"]), props["ControlGroup"],
                     int(props["ExecMainStartTimestampMonotonic"]) / 1_000_000,
                     props["Result"], int(props["ExecMainStatus"]),
                     status["emergency_inhibit"])

    def logs(self):
        return self._read(CONTROL, "logs").splitlines()

    def estop(self):
        self._read(CONTROL, "estop")


class TrialStop(RuntimeError):
    pass


def utc_now():
    return datetime.now(timezone.utc)


def require_safe_stream(events, now, elapsed):
    if any(row["event"] in {"failed", "reconnecting"} for row in events):
        raise TrialStop("runtime_failure_or_retry")
    attempts = [row for row in events if row["event"] == "connecting"]
    if len(attempts) > 1 or any(row.get("attempt") != 1 for row in attempts):
        raise TrialStop("multiple_or_invalid_attempts")
    spawn = next((row for row in events if row["event"] == "spawn"), None)
    ready = next((row for row in events if row["event"] == "observation_ready"), None)
    samples = [row for row in events if row["event"] == "telemetry_sample"]
    if any((row.get("displacementMilliblocks") or 0) > 250
           or row.get("blockVolumeInWater") is True
           or (row.get("creeperDistanceBlocks") is not None
               and row["creeperDistanceBlocks"] <= 16) for row in samples):
        raise TrialStop("displacement_or_hazard")
    last = samples[-1] if samples else spawn
    if last and (now - datetime.fromisoformat(last["time"])).total_seconds() > 5:
        raise TrialStop("telemetry_gap")
    for row in events:
        if row["event"] == "disconnected" and (not ready or (
            datetime.fromisoformat(row["time"]) - datetime.fromisoformat(ready["time"])
        ).total_seconds() < 150):
            raise TrialStop("premature_disconnect")
    if not ready and elapsed > 25:
        raise TrialStop("readiness_timeout")
    if elapsed > 175:
        raise TrialStop("application_deadline")


def normal_exit(events, state):
    ready = [row for row in events if row["event"] == "observation_ready"]
    end = [row for row in events if row["event"] == "disconnected"]
    attempts = [row for row in events if row["event"] == "connecting"]
    return (state.result == "success" and state.exit_status == 0
            and len(ready) == len(end) == len(attempts) == 1
            and not any(row["event"] in {"failed", "reconnecting"} for row in events)
            and (datetime.fromisoformat(end[0]["time"]) -
                 datetime.fromisoformat(ready[0]["time"])).total_seconds() >= 150)


def observe(ops, *, clock=time.monotonic, wall=utc_now, sleep=time.sleep, announce=print):
    initial = ops.state()
    if initial.active != "inactive" or not initial.stopped or not initial.inhibited:
        raise ValueError("Supervisor requires an inactive, inhibited service")
    before = ops.logs()
    armed_at = clock()
    result = {"outcome": "premature", "reason": "supervision_interrupted"}
    collector = None
    ended = None

    try:
        announce("Armed. Follow the separately authorized operator launch procedure.")
        while True:
            state = ops.state()
            current = clock()
            observed = wall()
            if collector is None and state.started != initial.started:
                if not armed_at <= state.started <= current:
                    raise TrialStop("unattributable_service_start")
                launch = observed - timedelta(seconds=current - state.started)
                collector = Collector(launch.isoformat(), clock=clock, origin=state.started)
                collector.ingest(before, launch.isoformat())
                result["launch_utc"] = launch.isoformat()
                started = state.started
            if collector is None:
                if current - armed_at >= 30:
                    raise TrialStop("operator_launch_timeout")
            else:
                if state.started != started:
                    raise TrialStop("service_restarted")
                collector.ingest(ops.logs(), observed.isoformat())
                events = sorted(collector.events.values(), key=lambda row: row["time"])
                if state.stopped:
                    ended = observed
                require_safe_stream(events, observed, current - started)
                if state.stopped:
                    if normal_exit(events, state):
                        result.update(outcome="normal", reason="service_exited")
                    else:
                        result["reason"] = "premature_service_exit"
                    break
            sleep(0.5)
    except TrialStop as error:
        result["reason"] = str(error)
    except KeyboardInterrupt:
        result["reason"] = "operator_interrupt"
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        result["reason"] = "supervisor_input_failure"
    finally:
        # Stop through the existing restricted interface even if monitoring fails.
        try:
            ops.estop()
        except (OSError, subprocess.SubprocessError):
            result["estop_request_failed"] = True
        try:
            for _ in range(8):
                state = ops.state()
                if state.stopped and state.inhibited:
                    result["termination_verified"] = True
                    ended = ended or wall()
                    break
                sleep(0.5)
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
            pass
        result.setdefault("termination_verified", False)
        if collector is not None:
            try:
                captured = wall()
                collector.ingest(ops.logs(), captured.isoformat(), outcome=result["outcome"],
                                 end_utc=(ended or captured).isoformat())
            except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
                result["final_capture_failed"] = True
            result["evidence"] = collector.report()
            result["evidence"]["events_retained"] = sorted(
                collector.events.values(), key=lambda row: row["time"])
        if ended is not None:
            result["inactive_utc"] = ended.isoformat()
    return result


def interrupted(_number, _frame):
    raise KeyboardInterrupt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--attended", action="store_true",
                        help="confirm separate authorization and continuous operator oversight")
    parser.add_argument("--output", required=True, help="new private JSON evidence file")
    args = parser.parse_args()
    if not args.attended:
        parser.error("--attended is required")
    for sig in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, interrupted)
    with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
        try:
            result = observe(RestrictedOperations(), announce=lambda message: print(message, flush=True))
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
            result = {"outcome": "not_armed", "reason": "preflight_failed"}
        json.dump(result, stream, indent=2)
        stream.write("\n")
    return 0 if (result.get("outcome") == "normal" and result.get("termination_verified")
                 and not result.get("estop_request_failed") and not result.get("final_capture_failed")
                 and result.get("evidence", {}).get("complete_overlap")) else 1


if __name__ == "__main__":
    raise SystemExit(main())
