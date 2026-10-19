# Mechanism-based triage

Read this when several causes fit the symptom, or when the controller, environment, and evaluator disagree. Use the relevant sections; an isolated register lookup does not need a full system audit.

## Find the first meaningful divergence

Construct a short event sequence around the failure: input available, decoded, interpreted, accepted, dispatched, acted upon, measured. Find the first transition whose observed result violates its contract. Later timeouts, retries, shutdowns, and missing outputs may be consequences.

Do not sort independent clocks into one apparently precise timeline. Record the time source, conversion, resolution, and uncertainty. If ordering cannot be established, mark it unresolved rather than selecting whichever event appeared first in the combined log.

An empty event list is useful only after checking when recording started, which channels were enabled, and whether buffers or output limits dropped events. A component can be active while its telemetry is absent. Conversely, a successful startup log does not establish continued operation.

## Compare both sides of the contract

For the suspect boundary, write the producer's promise beside the consumer's assumptions.

| Boundary | Details that often explain the discrepancy |
| --- | --- |
| Sensor to driver | Part revision, bus address, register width, reset state, enablement |
| Driver to message | Signedness, byte order, scale, saturation, invalid-value representation |
| Message to estimator | Sample time, freshness, sequence, coordinate frame, calibration |
| Controller to actuator | Mode, arming state, limits, acknowledgement, completed physical effect |
| Runtime to evaluator | Field path, units, schema revision, missing versus zero, failure representation |

Inspect actual values and serialized messages. Matching names do not guarantee matching meaning. If the producer writes a count in one object and the consumer expects another, a result can be rejected before its contents are evaluated. Preserve legitimate failure results while repairing that boundary.

## Time and retained state

Distinguish capture time, arrival time, processing time, and wall-clock time. A consumer using the newest pose with an older image can fail even when both streams are individually correct. Inspect which samples remain available when the consumer runs, not just the configured update frequency.

For intermittent failures, ask which ordering or delay makes the contract fail. Consider reset between read and use, reused sequence numbers, buffer wrap, late duplicates, and recovery that leaves stale state. Select a delay or event permutation that tests the specific mechanism rather than merely adding load.

Logging itself may alter timing or omit data. PX4's [logging documentation](https://github.com/PX4/PX4-user_guide/blob/main/en/dev_log/logging.md) describes configurable recording rates and dropouts. Read the matching project version before interpreting a missing sample as a missing sensor measurement.

## Geometry and sensing

Check units, axis directions, rotation order, and the point at which a measurement is defined. A camera's optical axes may differ from the body axes. ROS [REP 103](https://github.com/ros-infrastructure/rep/blob/master/rep-0103.rst) documents that distinction; [REP 105](https://github.com/ros-infrastructure/rep/blob/master/rep-0105.rst) distinguishes frame continuity and drift. Apply the target project's conventions rather than assuming it uses ROS.

For attachment or collision problems, inspect the complete geometry and its movement. A valid center position can place a rotor or tool outside a boundary. A permitted attachment tolerance can exceed collision-free approach clearance. For a rigid attachment, compare the relative transform; equal displacement along one world axis is not an invariant during rotation.

For perception, inspect the actual sensor image at the resolution delivered to the controller. Check obstruction, target size, viewing angle, and paired depth. A legal mount does not guarantee a useful field of view. A successful close-up fixture does not prove continuous acquisition through an approach.

## Challenge the test as well as the implementation

Separate unavailable capacity, startup failure, product failure, result-ingestion failure, and incomplete cleanup. They need different remedies. A stopped supervisor or returned command does not prove the physical task completed.

Ask whether the oracle checks the intended property. A contact exception for resting support should still reject body impacts. A freshness fix should still reject genuinely old samples. If broad relaxation makes both valid and invalid inputs pass, the apparent repair has removed the test's meaning.

Keep the conclusion narrow: an observed boundary mismatch, a mechanism reproduced in a replay, or a physical failure confirmed on a named device. A defect discovered nearby belongs in a separate finding until evidence connects it to the reported symptom.
