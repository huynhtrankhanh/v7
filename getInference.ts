import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

type InferencePosition =
  | { type: "fixed text"; text: string }
  | { type: "syllable"; candidates: string[] };

function parseCandidatesFromStdout(stdout: string): string[][] {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    if (!line.startsWith("[")) continue;
    try {
      const parsed = JSON.parse(line);
      if (
        Array.isArray(parsed) &&
        parsed.every(
          (group) =>
            Array.isArray(group) && group.every((item) => typeof item === "string"),
        )
      ) {
        return parsed as string[][];
      }
    } catch {
      continue;
    }
  }

  throw new Error("Unable to parse inference JSON output.");
}

export function getInference(rawInput: string[]): InferencePosition[] {
  if (!Array.isArray(rawInput)) {
    throw new TypeError("rawInput must be a string array.");
  }
  if (!rawInput.every((value) => typeof value === "string")) {
    throw new TypeError("rawInput must contain only strings.");
  }
  if (rawInput.some((value) => value.includes("\u0000"))) {
    throw new TypeError("rawInput contains invalid null characters.");
  }
  if (rawInput.length === 0) {
    return [];
  }

  const binaryPath =
    process.env.INFERENCE_RS_BIN?.trim() ||
    resolve(process.cwd(), "inference-rs/target/release/inference-rs");
  if (!existsSync(binaryPath)) {
    throw new Error(
      `Inference binary not found at "${binaryPath}". Build it first with "cd inference-rs && cargo build --release".`,
    );
  }

  const stdout = execFileSync(binaryPath, [JSON.stringify(rawInput)], {
    encoding: "utf8",
  });
  const syllableCandidates = parseCandidatesFromStdout(stdout);
  const expectedSyllableCount = rawInput.reduce(
    (count, _value, index) => count + (index % 2 === 1 ? 1 : 0),
    0,
  );
  if (syllableCandidates.length !== expectedSyllableCount) {
    throw new Error(
      `Inference output mismatch: expected ${expectedSyllableCount} syllable candidate list(s) but got ${syllableCandidates.length}.`,
    );
  }

  const result: InferencePosition[] = [];
  let syllableIndex = 0;

  for (let i = 0; i < rawInput.length; i++) {
    if (i % 2 === 0) {
      result.push({ type: "fixed text", text: rawInput[i] });
    } else {
      result.push({
        type: "syllable",
        candidates: syllableCandidates[syllableIndex],
      });
      syllableIndex += 1;
    }
  }

  return result;
}
