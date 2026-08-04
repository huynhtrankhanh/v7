/**
 * Round a non-negative integer up to a Padme-permitted value.
 *
 * Padme limits a value's mantissa to no more bits than its exponent. Values
 * below eight are already permitted. See Nikitin et al., "Reducing Metadata
 * Leakage from Encrypted Files and Communication with PURBs", section 4.4.
 */
export function padmeRound(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Padme can only round finite, non-negative numbers.");
  }

  const integer = Math.ceil(value);
  if (integer < 2) return integer;

  const exponent = Math.floor(Math.log2(integer));
  const exponentBits = Math.floor(Math.log2(exponent)) + 1;
  const zeroBits = exponent - exponentBits;
  if (zeroBits <= 0) return integer;

  const quantum = 2 ** zeroBits;
  return Math.ceil(integer / quantum) * quantum;
}

/** Recursively Padme-round every number in an HTTP response object. */
export function obfuscateNumbers<T>(value: T): T {
  if (typeof value === "number") return padmeRound(value) as T;
  if (Array.isArray(value)) return value.map(obfuscateNumbers) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        obfuscateNumbers(child),
      ]),
    ) as T;
  }
  return value;
}
