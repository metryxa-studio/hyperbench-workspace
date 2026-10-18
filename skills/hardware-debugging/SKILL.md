---
name: hardware-debugging
description: Diagnose firmware and hardware-interface failures using local code, logs, specifications, and Hyperbench context. Use for incorrect readings, missing messages, timing faults, initialization failures, and regressions.
---

# Hardware debugging

Establish the symptom, expected behavior, affected board/firmware revisions, and a reproducible input or log. Retrieve the relevant driver, configuration, interface contract, and document pages through Hyperbench or the host's local tools.

Choose the next check by which competing explanation it can rule out.

| Symptom | Useful boundaries to inspect |
| --- | --- |
| Missing data | Enablement, pin/bus mapping, initialization, message routing |
| Wrong values | Units, scaling, signedness, byte order, calibration |
| Intermittent behavior | Timeouts, ordering, stale state, retries, concurrency |
| Failure after a change | Actual base/head diff, changed assumptions, configuration |

Separate observed facts from hypotheses. Use a minimal replay, test, or simulation to check the strongest hypothesis before changing code. Record the input and the failure; do not equate a plausible explanation with a reproduced cause.

For an authorized fix, add a regression that fails before the change and passes afterward. Check the affected caller/consumer boundary. Keep the user's unrelated edits intact.

Report the cause, evidence, change, commands/results, and remaining uncertainty. If execution is unavailable, give the exact next check instead of claiming success. Bench activity, flashing, and actuator commands require the user's authorization; a local debugging request alone does not authorize them.
