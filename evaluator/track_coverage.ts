/**
 * track_coverage.ts
 *
 * Reads dataset.jsonl and reports detailed coverage metrics:
 *  - How many unique v7 codes (consonant+vowel+tone triples) appear
 *  - How many unique Vietnamese syllables appear
 *  - Which v7 codes are NOT yet covered
 *
 * Usage:
 *   npx ts-node -P tsconfig.scripts.json evaluator/track_coverage.ts [evaluator/dataset.jsonl]
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Re-build the set of ALL possible v7 codes from scratch
// (mirrors getInference.ts logic without needing the full tokenizer)
// ---------------------------------------------------------------------------

const ALL_CONSONANTS = [
  "0",
  "b",
  "ch",
  "d",
  "g",
  "h",
  "k",
  "kh",
  "l",
  "m",
  "n",
  "ng",
  "nh",
  "p",
  "ph",
  "r",
  "s",
  "t",
  "th",
  "tr",
  "v",
  "w",
  "x",
  "z",
  "đ",
  "dd",
];
const ALL_VOWELS = ["a", "e", "i", "o", "u"];
const ALL_TONES = [0, 1, 2, 3, 4, 5, 6, 7];

/** Build the complete set of theoretically possible v7 syllable codes. */
function buildAllPossibleV7Codes(): Set<string> {
  const codes = new Set<string>();
  for (const c of ALL_CONSONANTS) {
    for (const v of ALL_VOWELS) {
      if (c === "w" && v === "u") continue; // invalid combination
      for (const t of ALL_TONES) {
        codes.add(`${c}${v}${t}`);
      }
    }
  }
  return codes;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface OpenAIMessage {
  role: string;
  content: string;
}

interface OpenAILine {
  messages: OpenAIMessage[];
}

function parseDataset(filePath: string): OpenAILine[] {
  const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
  const parsed: OpenAILine[] = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line) as OpenAILine);
    } catch {
      // skip malformed lines
    }
  }
  return parsed;
}

/**
 * Extract per-syllable v7 codes from a v7 island string.
 * A v7 island is a sequence of (consonant)(vowel)(tone) triples.
 * We use a greedy left-to-right parse matching known consonant prefixes.
 */
const CONSONANT_PREFIXES_SORTED = [...ALL_CONSONANTS].sort(
  (a, b) => b.length - a.length,
);

function extractV7CodesFromIsland(island: string): string[] {
  const codes: string[] = [];
  let s = island;
  while (s.length > 0) {
    let matched = false;
    for (const c of CONSONANT_PREFIXES_SORTED) {
      if (s.startsWith(c)) {
        const rest = s.slice(c.length);
        if (rest.length >= 2) {
          const vowel = rest[0];
          const toneChar = rest[1];
          if (ALL_VOWELS.includes(vowel) && /^[0-7]$/.test(toneChar)) {
            codes.push(`${c}${vowel}${toneChar}`);
            s = rest.slice(2);
            matched = true;
            break;
          }
        }
        break; // consonant matched but no valid vowel+tone → stop
      }
    }
    if (!matched) break;
  }
  return codes;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const datasetPath = process.argv[2] ?? path.join(__dirname, "dataset.jsonl");

  if (!fs.existsSync(datasetPath)) {
    console.error(`Dataset file not found: ${datasetPath}`);
    process.exit(1);
  }

  console.log(`Reading: ${datasetPath}`);
  const records = parseDataset(datasetPath);
  console.log(`Total records: ${records.length}`);

  const allPossibleCodes = buildAllPossibleV7Codes();
  const coveredCodes = new Set<string>();
  const coveredSyllables = new Set<string>();
  let totalV7Islands = 0;

  for (const record of records) {
    const userMsg = record.messages.find((m) => m.role === "user");
    const assistantMsg = record.messages.find((m) => m.role === "assistant");
    if (!userMsg || !assistantMsg) continue;

    // User content: "Perform the following v7 inference request: [...]"
    const prefix = "Perform the following v7 inference request: ";
    if (!userMsg.content.startsWith(prefix)) continue;
    let inputArr: string[];
    try {
      inputArr = JSON.parse(userMsg.content.slice(prefix.length)) as string[];
    } catch {
      continue;
    }

    // Extract v7 islands (odd indices)
    for (let i = 1; i < inputArr.length; i += 2) {
      const island = inputArr[i];
      totalV7Islands++;
      const codes = extractV7CodesFromIsland(island);
      for (const code of codes) {
        coveredCodes.add(code);
      }
    }

    // Extract resolved syllables from assistant response
    let resolvedArr: string[];
    try {
      resolvedArr = JSON.parse(assistantMsg.content) as string[];
    } catch {
      continue;
    }
    for (let i = 1; i < resolvedArr.length; i += 2) {
      const resolved = resolvedArr[i];
      if (resolved) {
        for (const syl of resolved.split(/\s+/)) {
          if (syl) coveredSyllables.add(syl.toLowerCase());
        }
      }
    }
  }

  const uncoveredCodes = [...allPossibleCodes].filter(
    (c) => !coveredCodes.has(c),
  );

  console.log("\n=== V7 Code Coverage ===");
  console.log(`Total possible v7 codes: ${allPossibleCodes.size}`);
  console.log(
    `Covered v7 codes:        ${coveredCodes.size} (${((coveredCodes.size / allPossibleCodes.size) * 100).toFixed(1)}%)`,
  );
  console.log(`Uncovered v7 codes:      ${uncoveredCodes.length}`);

  console.log("\n=== Syllable Coverage ===");
  console.log(`Unique Vietnamese syllables covered: ${coveredSyllables.size}`);
  console.log(`Total v7 islands processed: ${totalV7Islands}`);

  if (uncoveredCodes.length > 0 && uncoveredCodes.length <= 100) {
    console.log("\nUncovered v7 codes:");
    console.log(uncoveredCodes.join(", "));
  } else if (uncoveredCodes.length > 100) {
    console.log(`\nFirst 100 uncovered v7 codes:`);
    console.log(uncoveredCodes.slice(0, 100).join(", "));
  }

  // Write detailed coverage report
  const reportPath = path.join(
    path.dirname(datasetPath),
    "dataset_coverage.json",
  );
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        totalRecords: records.length,
        totalV7Islands,
        possibleV7Codes: allPossibleCodes.size,
        coveredV7Codes: coveredCodes.size,
        coveragePercent: parseFloat(
          ((coveredCodes.size / allPossibleCodes.size) * 100).toFixed(2),
        ),
        uncoveredV7Codes: uncoveredCodes,
        coveredVietnameseSyllables: coveredSyllables.size,
        sampleCoveredSyllables: [...coveredSyllables].sort().slice(0, 200),
      },
      null,
      2,
    ),
  );
  console.log(`\nDetailed report written to ${reportPath}`);
}

main();
