from datetime import datetime, timedelta, timezone
import json
import unittest
from ops.observation.collector import Collector

START = datetime(2026, 11, 24, tzinfo=timezone.utc)
def stamp(second):
    return (START + timedelta(seconds=second)).isoformat()
def line(second, event="telemetry_sample"):
    return json.dumps(dict(time=stamp(second), event=event))

class Fixture:
    elapsed = 0
    def __init__(self):
        self.c = Collector(stamp(0), clock=lambda: 18000 + self.elapsed)
    def feed(self, second, records, outcome=None):
        self.elapsed = second
        self.c.ingest(records[-100:], stamp(second), outcome=outcome)

class Tests(unittest.TestCase):
    def test_full_trial_and_rollover(self):
        f = Fixture()
        records = [line(-1)]
        f.feed(0, records)
        for i in range(151):
            records.extend([line(i), line(i, "heartbeat"), line(i, "heartbeat")])
            f.feed(i, records, "normal" if i==150 else None)
        data = f.c.report()
        self.assertEqual([s["due"] for s in data["snapshots"]], [None,30,60,90,120,150])
        self.assertTrue(data["complete_overlap"])
        self.assertTrue(all(s["overlap"] for s in data["snapshots"][2:]))
        self.assertEqual(data["samples"],151)
        self.assertEqual(data["events"],302)
        self.assertEqual(data["outcome"],"normal")
        self.assertNotIn(line(-1),f.c.events)

    def test_missing_schedule_with_stream_continuity(self):
        f = Fixture()
        for i in (0,10,20,29,62,66):
            f.feed(i,[line(t) for t in range(i+1)],"premature" if i==66 else None)
        data=f.c.report()
        self.assertEqual(data["missing_slots"],[30])
        self.assertFalse(data["complete_overlap"])
        self.assertFalse(data["collection_gaps"])
        self.assertFalse(data["telemetry_gaps"])
        self.assertEqual(data["outcome"],"premature")

    def test_genuine_gap_with_overlap(self):
        f=Fixture()
        f.feed(0,[line(0)])
        f.feed(6,[line(0),line(6)],"premature")
        data=f.c.report()
        self.assertEqual(data["telemetry_gaps"],[6])
        self.assertFalse(data["collection_gaps"])

    def test_rollover_without_overlap_makes_gap_ambiguous(self):
        f=Fixture()
        f.feed(0,[line(0)])
        f.feed(60,[line(t,"heartbeat") for t in range(10,60)]*3+[line(60)],"premature")
        data=f.c.report()
        self.assertTrue(data["collection_gaps"])
        self.assertEqual(data["ambiguous_telemetry_gaps"],[60])
        self.assertFalse(data["telemetry_gaps"])

    def test_scheduled_windows_can_lose_overlap_without_losing_poll_events(self):
        f=Fixture()
        records=[line(-1)]
        f.feed(0,records)
        for second in range(1,61):
            records.append(line(second))
            for seq in range(4):
                records.append(json.dumps(dict(time=stamp(second),event="heartbeat",seq=seq)))
            f.feed(second,records,"normal" if second==60 else None)
        data=f.c.report()
        self.assertEqual(data["samples"],60)
        self.assertFalse(data["collection_gaps"])
        self.assertFalse(data["complete_overlap"])
        self.assertEqual(data["snapshots"][-1]["overlap"],0)

    def test_does_not_credit_late_snapshot_or_events_after_inactive(self):
        f=Fixture()
        f.feed(0,[line(0)])
        f.feed(35,[line(0),line(35)])
        f.elapsed=38
        f.c.ingest([line(0),line(35),line(38)],stamp(38),outcome="premature",end_utc=stamp(36))
        data=f.c.report()
        self.assertEqual(data["missing_slots"],[30])
        self.assertFalse(data["complete_overlap"])
        self.assertEqual(data["samples"],2)
        self.assertNotIn(line(38),f.c.events)

    def test_exit_between_snapshots_uses_final_capture(self):
        f=Fixture()
        f.feed(0,[line(-1)])
        f.feed(30,[line(t) for t in range(-1,31)])
        f.feed(35,[line(t) for t in range(-1,36)],"premature")
        data=f.c.report()
        self.assertEqual(data["snapshots"][-1]["elapsed"],35)
        self.assertIsNone(data["snapshots"][-1]["due"])
        self.assertTrue(data["complete_overlap"])
        with self.assertRaises(RuntimeError):
            f.feed(36,[line(36)])

if __name__ == "__main__":
    unittest.main()
