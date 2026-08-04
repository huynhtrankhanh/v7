import { obfuscateNumbers, padmeRound } from "../evaluation-server/src/padme";

describe("Padme metric obfuscation", () => {
  test.each([
    [0, 0],
    [1, 1],
    [8, 8],
    [9, 10],
    [10, 10],
    [11, 12],
    [15, 16],
    [16, 16],
    [17, 18],
    [255, 256],
    [257, 272],
  ])("rounds %d up to %d", (input, expected) => {
    expect(padmeRound(input)).toBe(expected);
  });

  test("rounds fractional and nested response metrics without changing text", () => {
    expect(
      obfuscateNumbers({
        score: 257,
        nested: [8.1, { count: 11 }],
        status: "ok",
      }),
    ).toEqual({
      score: 272,
      nested: [10, { count: 12 }],
      status: "ok",
    });
  });

  test("rejects values outside the metric domain", () => {
    expect(() => padmeRound(-1)).toThrow(RangeError);
    expect(() => padmeRound(Number.NaN)).toThrow(RangeError);
  });
});
