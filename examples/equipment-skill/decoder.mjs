export function decodeStatus(value, revision) {
  if (!Number.isInteger(value) || value < 0 || value > 255)
    throw new Error("Expected an unsigned status byte.");
  if (revision !== "B" && revision !== "D")
    throw new Error("Unsupported board revision.");
  const readyMask = 0x01;
  const overrunMask = revision === "B" ? 0x04 : 0x20;
  return {
    sampleUsable: (value & readyMask) !== 0 && (value & 0x80) === 0,
    overrun: (value & overrunMask) !== 0,
  };
}
