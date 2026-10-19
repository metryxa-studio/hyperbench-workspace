import assert from "node:assert/strict";
import { decodeStatus } from "./decoder.mjs";

const cases = [
  ["B", 0x01, true, false],
  ["B", 0x05, true, true],
  ["B", 0x81, false, false],
  ["D", 0x10, true, false],
  ["D", 0x30, true, true],
  ["D", 0x90, false, false],
  ["D", 0x00, false, false],
  ["D", 0x01, false, false],
];
let failed = 0;
for (const [revision, value, sampleUsable, overrun] of cases) {
  try {
    const actual = decodeStatus(value, revision);
    assert.deepEqual(actual, { sampleUsable, overrun });
    console.log(`PASS revision=${revision} status=0x${value.toString(16)}`);
  } catch (error) {
    failed++;
    console.error(`FAIL revision=${revision} status=0x${value.toString(16)} ${error.message}`);
  }
}
for (const [value, revision] of [[-1, "D"], [256, "D"], [0.5, "D"], [1, "E"]]) {
  try {
    assert.throws(() => decodeStatus(value, revision));
    console.log(`PASS rejects value=${value} revision=${revision}`);
  } catch (error) {
    failed++;
    console.error(`FAIL invalid input value=${value} revision=${revision}: ${error.message}`);
  }
}
console.log(`${12 - failed}/12 checks passed. Synthetic host decoder only.`);
process.exitCode = failed ? 1 : 0;
