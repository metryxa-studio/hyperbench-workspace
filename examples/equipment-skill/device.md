# Harbor H2 status interface

This is a fictional device specification written for this example. It does not describe a physical product.

## Revision selection

Board revisions B and D use different status assignments. Select the revision printed on the assembly record; the shared product name does not identify it. The provided task uses revision D. Existing revision B installations must continue to work.

## Status register

The input is one unsigned byte. Only the bits listed here have defined meaning; reserved bits must not be treated as readiness or failure indicators.

| Flag | Revision B mask | Revision D mask | Meaning |
| --- | --- | --- | --- |
| Ready | `0x01` | `0x10` | A complete sample is available. |
| Overrun | `0x04` | `0x20` | An earlier sample was lost; the current complete sample remains usable. |
| Fault | `0x80` | `0x80` | The sample cannot be used even if Ready is set. |

A sample is usable exactly when Ready is set and Fault is clear. Overrun must be reported separately; it does not suppress an otherwise usable sample. Unsupported board revisions and inputs outside a byte are errors.

## Evidence limits

The host example supplies synthetic bytes directly to the decoder. It contains no register-read transport, electrical model, timing model, or measurements. A decoder check cannot verify the board revision, bus configuration, or physical sensor. No reset, flashing, or power-control procedure is specified here.
