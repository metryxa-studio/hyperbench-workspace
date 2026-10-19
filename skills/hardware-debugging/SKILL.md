---
name: hardware-debugging
description: Diagnose firmware and hardware-interface failures using local code, logs, specifications, and Hyperbench context. Use for incorrect readings, missing messages, timing faults, initialization failures, and regressions.
---

# Hardware debugging

Find the earliest broken contract that explains the reported behavior. Investigate the device, firmware, configuration, and test environment together. Diagnose within the user's scope; make an authorized fix only when evidence supports it.

Use Hyperbench's available context tools or the agent's existing local tools. This skill supplies a method, not a simulator, execution harness, or hardware connection.

Read supporting material only when it helps the current investigation:

| Situation | Reference |
| --- | --- |
| Several explanations fit; timing, geometry, or an evaluator may be involved | [Mechanism-based triage](references/mechanism-triage.md) |
| Choosing a reproduction, controls, or evidence sufficient to justify a fix | [Experiments and a worked example](references/experiments.md) |

## Establish what failed

Record expected versus actual behavior and its trigger. Identify relevant board/part revisions, firmware commit and working-tree changes, active configuration, and input or recording. Cite document revision and page for hardware requirements. Request missing information when it changes the next useful check.

For regressions, establish the actual known-good and failing versions and compare their settings, inputs, and hardware. A recent change is a suspect, not automatically the cause.

Keep claims at their demonstrated level:

| Status | Meaning |
| --- | --- |
| Reported | A user, log, or saved report describes the failure; its mechanism is not yet verified. |
| Observed | Inspectable evidence establishes a specific event or value, subject to its capture limits. |
| Reproduced | A recorded test recreates the failure in a named environment. |
| Uncertain | Evidence is missing, contradictory, or consistent with several explanations. |

A reproduced symptom is not automatically a reproduced cause. Call a mechanism confirmed only when the relevant path and a discriminating check support it. Keep unrelated defects separate.

## Trace the failing boundary

Follow the affected signal through its producer, transport, interpretation, decision, and consumer. For physical actions, distinguish requested, accepted, started, and completed. No actuator request directs attention upstream only if the relevant request logging is complete; it does not prove the actuator works.

Use exact identifiers to retrieve the driver, enabling configuration, caller, consumer, and applicable specification. Check search scope and truncation before treating a missing match as absent implementation. Read original diagram pages when wire connectivity or pin identity matters.

Maintain a small hypothesis table rather than a growing list of guesses:

| Candidate mechanism | Predicted observation | Next discriminating check |
| --- | --- | --- |
| Stale measurement rejected | Capture time is valid, but retained state cannot match it | Replay the same input with capture-time state retained |
| Wrong units or coordinate frame | Error changes predictably with scale or orientation | Compare raw and converted values using known inputs |
| Producer/consumer contract mismatch | Producer emits valid data the consumer reads differently | Pass the actual serialized output through the consumer |
| Physical command never reached device | Upstream precondition fails before dispatch | Inspect each transition and its coverage |

Note supporting and contradicting evidence. Choose the cheapest check that separates plausible explanations.

## Reproduce before broadening

Start with a saved input, local test, or bounded replay that preserves the suspected mechanism. Record input, revision, configuration, command, result, and expected invariant. Use a working positive control and a negative control that should be rejected. Accepting the negative control indicates a faulty oracle.

Preserve timing, ordering, and state needed by the failure. A stationary fixture does not validate motion; a simulator does not establish electrical behavior. Label substitutions, sampled logs, missing channels, and untested operating ranges. If a test fails before reaching the target code, resolve or report that blocker instead of counting it as a reproduced product defect.

## Execute within the available scope

Local analysis does not authorize flashing, actuator motion, remote mutations, or extended bench runs. Reuse authorization already given for the specific task. Before physical execution, establish the target, bounds, stop method, and observable completion state.

When Hyperbench bench tools are available, inspect the registered bench and its permissions. A `bench_execute` timeout stops the local SSH client; remote work may continue. After timeout or an uncertain receipt, inspect remote state through an authorized read or stop path. Do not automatically retry a hardware action. Exit status, truncation, and missing telemetry limit what can be claimed.

## Fix and report

Preserve the failing input. For an authorized change, verify failure before and success afterward, retaining rejecting controls and checking the affected consumer. Do not silence the error, weaken the requirement, or extend a timeout without evidence that this repairs the mechanism. Stop broadening once the requested outcome has sufficient proof.

Report the symptom, evidence status, supported cause or remaining hypotheses, change if any, and exact checks with results. Separate local, simulated, and physical verification. State what remains untested and the single most useful next check; never replace missing execution with a success claim.
