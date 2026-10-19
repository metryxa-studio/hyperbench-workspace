# Choosing a hardware test

Read this when the review has identified a failure mechanism and needs a target, correctness check, input model, and execution budget. Use the project's existing tooling; the examples below do not require a particular agent, model, or test framework.

## Match the harness to the observation

| Mechanism | Practical target | What to vary | What must be observed |
| --- | --- | --- | --- |
| Frame decoding or transfer sizing | Native parser/driver with a fake bus | Valid frames, truncation, count/length disagreement, endianness | Exact decoded fields, rejected input, actual transfer length |
| Ring buffers and bounded queues | Public buffer API with an independent sequence model | Empty/full boundaries, repeated wrap, reset, reinitialization | Stored values and order, capacity state, absence of stale entries |
| Driver completion and cancellation | Driver emulator or controllable scheduler | Final operation, cancel-before-complete, teardown, delayed callback | Completion delivery and state; stale callbacks must not affect a new operation |
| Persistence interruption | Flash emulator with controlled write interruption | Reset between data and metadata writes, sector boundary, retry | Earlier records survive; mount and subsequent writes follow the documented contract |
| Flight/control state transitions | Existing software-in-the-loop scenario | Entry state, coordinate frame, sensor availability, command ordering | Commanded and measured quantities separately, with units and timestamps |
| Radio/protocol starvation | Multi-node simulation or resource-pool harness | Slow consumer, control traffic, pool exhaustion, recovery | Useful work continues; required control events are delivered |

A native test cannot establish physical timing or electrical behavior. An emulator establishes behavior under its device model. A simulation can exercise the production controller without establishing a real airframe's stability. Use hardware measurements when those distinctions matter and the required operation is authorized.

## Choose a correctness check

Prefer an expected result derived independently from the implementation: a byte layout from a protocol, a simple reference queue, or a documented state transition. Check a complete discriminating result, not merely a count. Twenty-four published samples can still contain a corrupted final sample.

Round-trip checks need care. If a display driver's encoder and decoder make matching mistakes, writing and reading back through the same implementation can pass. Add an independent representation, known pattern, or direct framebuffer check when the claimed property needs it. Likewise, a successful boot does not prove interrupted writes preserved committed records.

For timing, name the relevant clock and event. Measure a completion deadline from the command that starts the operation, not from test startup. Separate desired roll from measured attitude, relative altitude from altitude above sea level, and data arrival time from the sensor's acquisition time. Use tolerances justified by the contract and simulator behavior; do not widen them merely to turn a failure green.

## Seed the boundary, then vary it

Begin with a small valid example that reaches the target. Add the cases immediately around its limit: capacity minus one, capacity, capacity plus one; zero-length payload, partial last frame, duplicate completion, and reset between phases as applicable. Keep structurally valid and deliberately malformed classes separate so early validation failures do not dominate the campaign.

For stateful inputs, record operations as well as bytes: initialize, configure, start, interrupt, cancel, restart. Check the invariant after meaningful transitions. Explore alternative event orderings with a controllable scheduler where available; arbitrary sleeps rarely establish which race occurred. Preserve the seed, generated sequence, configuration, and minimized failing artifact. A seed alone may cease to reproduce after generator changes.

## Bound the experiment

Record target command, test selector, board, toolchain, configuration, and build/test patches before execution. A small local campaign might use a two-minute wall limit, one worker, and the protocol's actual maximum payload; those are example choices, not universal defaults. State memory limits and external side effects where relevant. Cap each test case as well as the whole run so one hang does not consume the entire budget.

Read the final report and retained trace. A zero exit with all tests skipped is not a pass. Compare base and head under the same fixture, then remove the suspected trigger for a control if causality is uncertain. Confirm that a newly added assertion fails for the reported defect, not for a missing SDK, unsupported board, or stale test registration. Report a missing capability directly rather than inventing an equivalent-looking test.
