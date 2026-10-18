---
name: hardware-pr-review
description: Review a hardware or firmware PR using its local diff and source/document contracts; run focused regression, property, or fuzz tests when appropriate. Use when asked to assess a PR, patch, or changed interface.
---

# Hardware PR review

Identify the requested base and head, record their commits, and inspect the working tree. Use the PR's actual comparison; do not guess a branch or replace local changes. Trace changed code into affected callers, consumers, configurations, and hardware specifications.

Pick tests that can expose a concrete failure at the changed boundary.

| Change | Candidate checks |
| --- | --- |
| Packet/parser | Empty, truncated, oversized, corrupt frames; length and checksum disagreement |
| Numeric conversion | Range limits, overflow, signedness, units; non-finite values where accepted |
| State/retry logic | Reordering, duplicates, timeouts, resets, recovery after failure |
| Driver/configuration | Invalid combinations, missing resources, interface/board compatibility |

Use existing tests and fuzz targets first. Fuzz host-side functions or simulations; keep hardware I/O behind the repository's test substitutes. Give the run a finite time/input-size budget. Preserve useful valid seeds so random inputs reach deeper behavior.

Assert a contract: accepted outputs satisfy bounds, malformed inputs fail predictably, state remains recoverable, or equivalent encodings agree. “Did not crash” is useful evidence, not proof of correctness. For native code, use available sanitizers when compatible with the target.

Save and minimize failures. Record the commit, command, seed/corpus, environment, and expected/observed result. Replay on base and head before calling it a new regression. When test edits are in scope, preserve confirmed failures as regression tests. Keep code fixes within the requested scope.

Report actionable findings with file/line evidence and reproduction steps. State tests run, duration, and coverage limits; a clean bounded run does not establish absence of bugs. Missing tools or unavailable execution must remain explicit. Do not flash hardware or send actuator commands without authorization.
