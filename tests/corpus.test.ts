import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCorpus } from "../evaluation-server/src/corpus";

describe("loadCorpus", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("loads non-empty lines from matching text files in path order", () => {
    const directory = mkdtempSync(join(tmpdir(), "v7-corpus-"));
    directories.push(directory);
    writeFileSync(join(directory, "b.txt"), " dòng ba \r\n\r\n");
    writeFileSync(join(directory, "a.txt"), "dòng một\ndòng hai\n");
    writeFileSync(join(directory, "ignored.md"), "không đọc");

    expect(loadCorpus(join(directory, "*.txt"))).toEqual([
      "dòng một",
      "dòng hai",
      "dòng ba",
    ]);
  });

  test("rejects specifications that match no files", () => {
    const directory = mkdtempSync(join(tmpdir(), "v7-corpus-"));
    directories.push(directory);

    expect(() => loadCorpus(join(directory, "*.txt"))).toThrow(
      "matched no files",
    );
  });

  test("rejects files without corpus entries", () => {
    const directory = mkdtempSync(join(tmpdir(), "v7-corpus-"));
    directories.push(directory);
    writeFileSync(join(directory, "empty.txt"), " \n\r\n");

    expect(() => loadCorpus(join(directory, "*.txt"))).toThrow(
      "contain no non-empty lines",
    );
  });
});
