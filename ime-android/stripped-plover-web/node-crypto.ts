export function randomBytes(size: number): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new RangeError("randomBytes size must be a non-negative integer");
  }
  const result = new Uint8Array(size);
  const maximumChunk = 65_536;
  for (let offset = 0; offset < result.length; offset += maximumChunk) {
    crypto.getRandomValues(
      result.subarray(offset, Math.min(result.length, offset + maximumChunk)),
    );
  }
  return result;
}
