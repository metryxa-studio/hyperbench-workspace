# Bug mechanisms and useful checks

Read this when reviewing whether a proposed test can distinguish the suspected defect. These public historical cases illustrate mechanisms, not claims that a current checkout is vulnerable. The linked artifacts establish upstream reports and repairs; reading them does not reproduce the bug locally. For any new investigation, record separately what was inspected, executed in simulation, or measured on a device.

## Cases that change test design

| Public case | Mechanism supported by the source | Useful investigation step |
| --- | --- | --- |
| [ArduPilot #26696](https://github.com/ArduPilot/ardupilot/pull/26696) | The IMU ring buffer recognized its filled state at the wrong insertion boundary; initialization also needed to clear that state. | Push distinct values around capacity and through multiple wraps. Check oldest/youngest contents and reinitialize a previously filled buffer. |
| [Zephyr #88835](https://github.com/zephyrproject-rtos/zephyr/pull/88835) | Counting down the final step prevented workqueue scheduling that was needed to deliver completion. | Observe the callback after a complete move, including reverse motion. Compare workqueue and counter configurations; position alone is insufficient. |
| [Zephyr #103028](https://github.com/zephyrproject-rtos/zephyr/pull/103028) | Interrupted metadata programming near the end of a flash sector left startup treating exhausted space as an error. | Interrupt at the data/metadata boundary, remount, verify committed data, then attempt another write. Test sector geometry explicitly. |
| [Zephyr #78397](https://github.com/zephyrproject-rtos/zephyr/pull/78397) | Slow processing of scan reports could occupy buffers needed by command completion/status events. The repair changed pool selection for those events. | Combine slow consumption with periodic control activity. Check ongoing delivery as well as survival, so stopping scanning cannot pass the test. |
| [Zephyr #96313](https://github.com/zephyrproject-rtos/zephyr/pull/96313) | Monochrome tile offsets and alignment assumptions were wrong; the test also had buffer-sizing defects. | Apply the same corrected test to both revisions. Check pixel content and unchanged regions across tiling/bit-order variants, with another format as a control. |
| [ArduPilot #33093](https://github.com/ArduPilot/ardupilot/pull/33093) | Entering loiter inside a large radius bypassed a controller limit that depended on tangential velocity. | Observe roll-demand changes around the transition with position/frame evidence. Compare a smaller-radius control. The reproducer came from separate [test PR #33082](https://github.com/ArduPilot/ardupilot/pull/33082). |

For these mechanisms, discovery begins at a boundary: the final operation, a full buffer, a partially committed record, competing event classes, or a mode transition. Trace the sequence that reaches it. Find a measurement that distinguishes the defect from normal rejection, recovery, or a disabled feature. Keep the source of the test separate from the source of the repair when they originate in different changes.

## Worked example: a synthetic FIFO transfer

This example is invented for instruction. It is not a reported defect in a named sensor or repository, and the arithmetic below is not an executed reproduction.

Assume a device has 24 FIFO frames, eight bytes per frame, and a two-byte command prefix included in the bus transaction length. A driver allocates space for all 194 bytes, but caps its transfer request at the 192-byte data capacity while publishing the advertised frame count.

| Test element | Concrete choice |
| --- | --- |
| Suspected trigger | FIFO count 24, no overflow, otherwise successful transfer |
| Required controls | Status-register response, returned payload bytes, requested transfer length |
| Required observation | Published sample values, especially the last frame; buffer and bus bounds |
| Valid seeds | Distinct frames at counts 1, 23, and 24, so zero-filled or repeated data cannot conceal truncation |
| Rejection cases | Short transfer, impossible count, overflow flag; use the driver's documented error behavior |
| Initial budget | One deterministic pass over those cases; expand only after the harness reaches the target |

At capacity, the expected request is `2 + 24 × 8 = 194` bytes. Model the bus faithfully: return only the bytes requested and keep untouched destination bytes distinguishable. Assert that a successful publication contains exactly the supplied complete frames. Do not force publication on an error path if the API permits dropping the batch.

Replay the identical fixture on both revisions and inspect the first mismatched byte or sample. A generic accelerometer simulator exposing only freshness and dropped-sample counts cannot answer this question: it neither controls the SPI transaction nor exposes decoded payloads. In that environment, report the source-supported hypothesis and missing capabilities. Do not count an unrelated freshness test as validation.

If execution does confirm the mismatch, retain the exact input and observation as a regression. Keep the conclusion narrow: correct transfer sizing in this modeled path does not establish interrupt timing, electrical integrity, or every device mode.
