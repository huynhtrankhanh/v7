import { ploverProtocolErrorMessage } from "../src/ploverProtocol";

describe("ploverProtocolErrorMessage", () => {
  it("decodes a structured protocol error without stringifying its object", () => {
    const message = ploverProtocolErrorMessage({
      code: -32000,
      message: "Entry not found: DOES-NOT-EXIST",
    });

    expect(message).toBe("Entry not found: DOES-NOT-EXIST");
    expect(message).not.toContain("[object Object]");
  });

  it("preserves string errors and safely handles unknown values", () => {
    expect(ploverProtocolErrorMessage("runtime stopped")).toBe(
      "runtime stopped",
    );
    expect(ploverProtocolErrorMessage({ code: -32000 })).toBe(
      "Stripped Plover request failed.",
    );
  });
});
