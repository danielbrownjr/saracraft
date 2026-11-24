# Attended passive observation supervisor

The supervisor watches one operator-started `saracraft-bot.service` observation and collects only the restricted `saracraftctl logs` output. It uses systemd's read-only process state to identify the launch and verify termination. It requests the existing `saracraftctl estop` on exit from supervision, including after normal completion. It has no start, inhibit-clearance, network, authentication, or movement interface.

## Offline rehearsal

From the repository root, use the same standard-library test discovery as CI.

```sh
python3 -B -m unittest discover -s ops/tests -p 'test_observation_*.py' -v
```

The tests inject a clock and simulated service operations. They exercise an operator-started 150-second window, a rolling 100-record output buffer, deadline and overlap checks, failures and cleanup. They make no service or network calls.

## Attended use after separate authorization

1. Follow the existing host and trial preflight. Verify the exact approved release and helper, the authorized operator and lease, both bot-related units inactive, inhibit active, singleton and server roster checks, a healthy server, and a dry enclosed hazard-free spawn. Record host time synchronization (for example, `timedatectl show -p NTPSynchronized`) and confirm stable UTC attribution. Ensure an independent emergency-stop path is available. Keep the privileged clearance procedure in the operator's own terminal.
2. From a trusted checkout, arm the supervisor as the operator already authorized to use the restricted controls. Provide a new private output file outside the checkout.

   ```sh
   python3 -B -m ops.observation.supervisor --attended --output /path/to/private-evidence.json
   ```

3. After the armed message and only with separate live-trial authorization, perform the established manual inhibit clearance and single `saracraftctl start observe` in the operator terminal. The supervisor times out if no new systemd execution is visible within 30 seconds. No retry is permitted. Maintain visual oversight and use the independent `saracraftctl estop` immediately for unexpected motion, damage, death, hostile mobs, lost oversight or any hazard. Ctrl-C also asks the supervisor to stop through the restricted interface.
4. Review verified termination, inhibit state, server health and roster, sanitized records and operator observations before reporting acceptance. If the supervisor cannot confirm termination or inhibit, use the independent emergency-stop path and escalate. Complete acceptance still requires the reviewed grounding, displacement, sample and operator criteria. Exit 0 means the automated criteria passed, not full live acceptance. The JSON records `outcome` (execution), `acceptance.automated_acceptance` (pass/fail), individual criteria and `acceptance.operator_acceptance` (pending). Confirm the human-observed criteria and post-trial host/server checks separately; neither exit 0 nor a normal process exit implies movement readiness.

The collector schedules from systemd's boot-relative start timestamp and associates records with the corresponding UTC trial window. It records prelaunch, approximately 30-second, and final windows, and keeps distinct trial events from intermediate polls. Missed snapshot slots, absent overlap, and collection gaps remain evidence deficiencies. UTC attribution assumes the host wall clock stays stable. Avoid concurrent attempts and do not claim complete attribution if the clock or singleton assumption fails. The helper must be able to read its existing sanitized evidence at arming. A missing or unreadable log prevents arming.

The supervisor reports an early disconnect, restart, retry, runtime failure, prolonged telemetry silence, hazard, or application deadline violation as premature. It treats stop-request acceptance and verified process termination as separate outcomes. After the first interrupt, repeated SIGINT/SIGTERM/SIGHUP are ignored during bounded cleanup; child processes use separate sessions. Stop requests have a dedicated 15-second timeout; read operations retain their 2-second timeout. The supervisor stops on post-baseline null displacement, loss of grounding or unavailable verdict. Worst-case polling latency is approximately 6.5 seconds before cleanup (three 2-second reads plus the 0.5-second sleep); this is a secondary monitor, not a real-time safety guarantee. A supervisor crash or forced kill may prevent the final stop request, so continuous attendance and independent emergency stop remain required.
