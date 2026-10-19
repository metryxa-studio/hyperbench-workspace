# Experiments and a worked example

Read this when choosing a reproduction or deciding whether a proposed repair has enough evidence. The example is synthetic: its paths, numbers, and outcomes illustrate reasoning, not an executed test or a claim about a real repository.

## Design a check that can change the conclusion

Write the predicted observation before running the test. Name the input, relevant initial state, permitted intervention, measured output, and stop condition. If every possible outcome would support the same explanation, choose a more discriminating check.

Prefer the smallest environment that preserves the suspected mechanism. A parser error may need one byte sequence; a freshness race needs delayed processing and retained state; electrical noise needs appropriate physical measurements. Moving a failure into a simpler environment helps only if the important cause survives that move.

Pair the failure with controls. A positive control establishes that the observation path can detect success. A negative control establishes that an invalid case remains invalid. Change one causal factor where practical. When several factors must change together, record the confounding changes and avoid attributing the result to just one.

## Synthetic case: a docking clamp never closes

Suppose a mobile cart reaches a marked station but reports a docking timeout. The user suspects a broken clamp. The controller requires a decoded marker, a recent image, and a pose close to the image's capture time before sending a clamp request.

First inspect the request path and its recording coverage. A complete dispatch record contains no clamp requests. This narrows the observed failure to a precondition or dispatch path; it does not prove that the clamp would work. A separate bench canary is supporting evidence only if its wiring, state, and execution scope match.

Inspect one failing input and the code that consumes it. The synthetic fixture provides:

| Item | Value |
| --- | --- |
| Image capture | 1,000 ms on the controller clock |
| Image processed | 1,080 ms on the same clock |
| Maximum permitted image age | 100 ms |
| Maximum pose-to-image time difference | 15 ms |
| Pose retained by the broker | Only the latest sample, at 1,080 ms |
| Decoded marker | Correct station identifier |

The image is 80 ms old and within its age limit. The sole pose is 80 ms away from capture, exceeding the pairing limit. These facts predict a rejected precondition, but the observed fixture and consumer path still need replaying.

## Test competing explanations

| Explanation | Discriminating check | Interpretation |
| --- | --- | --- |
| Marker cannot be decoded | Run the same decoder on the recorded image and a known readable control | Successful decoding weakens this explanation for that image only |
| Retained state loses the matching pose | Replay identical input with the capture-time pose also retained | A changed pairing result supports the retention mechanism |
| Clamp rejects a dispatched request | Inspect the verified dispatch record | No request means this failure has not exercised that behavior |

Do not enlarge the freshness limit just to make the fixture pass. That would admit the wrong pose and could move the docking target. Instead, test the existing contract with the required historical sample available.

The replay's expected acceptance result is a valid marker paired with the 1,000 ms pose. It may then reach a fake actuator used only to record requests. That establishes a software transition, not actual clamp motion.

## Keep the rejecting cases

Add a frame captured at 800 ms but processed at 1,080 ms: it must remain stale even if its pose is retained. An unknown station must not dispatch. A missing pose must remain unresolved. Replaying the same accepted observation must follow the project's documented duplicate-command policy, rather than accidentally producing another physical action.

If the before/after replay matches these predictions, a bounded history change has a credible causal explanation. Choose its retention bound from documented timing requirements and measured delays; do not turn the example's numbers into general defaults. Test reset behavior and the affected consumer as needed.

## Report the actual verification scope

The report should distinguish the original symptom, the reproduced software failure, and remaining hardware uncertainty. Record the exact fixture and command used, version, observations, controls, and changes. If no replay was run, the result remains a proposed explanation and test plan.

For a real bench follow-up, use existing authorization and a known stop procedure. A command acknowledgement may mean only queued work. Verify the resulting physical state independently. After an SSH timeout or lost receipt, determine whether the remote action is still running before any retry; loss of the local connection is not a cancellation guarantee.
