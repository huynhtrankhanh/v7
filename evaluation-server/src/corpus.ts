import { readFileSync } from "node:fs";
import { globSync } from "glob";

/** Load one corpus item per non-empty line from every matching text file. */
export function loadCorpus(specification: string): string[] {
  const paths = globSync(specification, { absolute: true, nodir: true }).sort();
  if (paths.length === 0) {
    throw new Error(
      `Evaluation corpus specification matched no files: ${specification}`,
    );
  }

  const corpus = paths.flatMap((path) =>
    readFileSync(path, "utf8")
      .split(/\r?\n/u)
      .map((text) => text.trim())
      .filter((text) => text.length > 0),
  );
  if (corpus.length === 0) {
    throw new Error("Evaluation corpus text files contain no non-empty lines.");
  }
  return corpus;
}
