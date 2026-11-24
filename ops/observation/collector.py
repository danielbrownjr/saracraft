"""Collect restricted saracraftctl log windows for one observed trial."""
from datetime import datetime
import json
import time


class Collector:
    def __init__(self, launch_utc, *, clock=time.monotonic, origin=None, interval=30,
                 telemetry_limit=3, schedule_slack=3):
        self.launch = datetime.fromisoformat(launch_utc)
        self.clock = clock
        self.interval = interval
        if interval <= 0 or not 0 <= schedule_slack < interval:
            raise ValueError("Invalid snapshot interval or slack")
        self.schedule_slack = schedule_slack
        self.telemetry_limit = telemetry_limit
        self.origin = clock() if origin is None else origin
        self.next_slot = interval
        self.previous = None
        self.covered_until = self.launch
        self.events = {}
        self.snapshots = []
        self.missing_slots = []
        self.collection_gaps = []
        self.finalized = False

    def ingest(self, lines, captured_utc, *, outcome=None, end_utc=None):
        if self.finalized:
            raise RuntimeError("Trial evidence is already finalized")
        elapsed = self.clock() - self.origin
        captured = datetime.fromisoformat(captured_utc)
        if end_utc is not None and outcome is None:
            raise ValueError("Trial end requires an outcome")
        end = datetime.fromisoformat(end_utc) if end_utc is not None else captured
        if not self.launch <= end <= captured:
            raise ValueError("Trial end falls outside the observed window")
        if outcome is not None:
            self.events = {line: x for line, x in self.events.items()
                           if datetime.fromisoformat(x["time"]) <= end}
        window = tuple(dict.fromkeys(lines))
        overlap = None if self.previous is None else len(set(window) & set(self.previous))
        if overlap == 0 and window != self.previous:
            front = datetime.fromisoformat(json.loads(window[0])["time"]) if window else captured
            if front > self.covered_until:
                self.collection_gaps.append((self.covered_until, front))
        self.previous = window
        self.covered_until = max(self.covered_until, captured)
        current = []
        for line in window:
            record = json.loads(line)
            ts = datetime.fromisoformat(record["time"])
            if self.launch <= ts <= end:
                self.events[line] = record
                current.append(line)
        due = []
        while elapsed >= self.next_slot:
            due.append(self.next_slot)
            self.next_slot += self.interval
        self.missing_slots.extend(due[:-1])
        slot = due[-1] if due else None
        if slot is not None and elapsed - slot > self.schedule_slack:
            self.missing_slots.append(slot)
            slot = None
        if not self.snapshots or due or outcome is not None:
            scheduled_overlap = None
            if self.snapshots:
                scheduled_overlap = len(set(window) & self._previous_snapshot)
            self.snapshots.append(dict(elapsed=elapsed, captured=captured_utc,
                                       due=slot, outcome=outcome,
                                       overlap=scheduled_overlap, lines=current))
            self._previous_snapshot = set(window)
        self.finalized = outcome is not None

    def report(self):
        samples = sorted(datetime.fromisoformat(x["time"]) for x in self.events.values()
                         if x["event"] == "telemetry_sample")
        telemetry_gaps, ambiguous_gaps = [], []
        for first, second in zip(samples, samples[1:]):
            seconds = (second-first).total_seconds()
            if seconds <= self.telemetry_limit:
                continue
            ambiguous = any(first < end and second > start for start,end in self.collection_gaps)
            (ambiguous_gaps if ambiguous else telemetry_gaps).append(seconds)
        scheduled = [snap for snap in self.snapshots if snap["due"] is not None]
        # A prelaunch baseline may have no historical records. Overlap becomes
        # mandatory from the second scheduled trial window through final capture.
        evidence_windows = [*scheduled]
        if self.finalized and self.snapshots[-1] not in evidence_windows:
            evidence_windows.append(self.snapshots[-1])
        return dict(events=len(self.events), samples=len(samples),
                    missing_slots=self.missing_slots.copy(),
                    collection_gaps=[(a.isoformat(), b.isoformat()) for a,b in self.collection_gaps],
                    telemetry_gaps=telemetry_gaps, ambiguous_telemetry_gaps=ambiguous_gaps,
                    snapshots=self.snapshots.copy(),
                    complete_overlap=self.finalized and bool(evidence_windows) and not self.missing_slots
                    and not self.collection_gaps and all(s["overlap"] for s in evidence_windows[1:]),
                    outcome=self.snapshots[-1]["outcome"] if self.finalized else None)
