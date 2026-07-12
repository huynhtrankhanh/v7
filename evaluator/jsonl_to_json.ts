/**
 * jsonl_to_json.ts
 *
 * Converts evaluator/dataset.jsonl into evaluator/dataset.json.
 * For each JSONL record:
 * - parse the inference request array from the user message
 * - parse assistant inference results
 * - rebuild the full resolved sentence by replacing each v7 island
 * - deduplicate sentences
 *
 * Usage:
 *   npx ts-node -P tsconfig.scripts.json evaluator/jsonl_to_json.ts [input.jsonl] [output.json]
 */

import * as fs from "fs";
import * as path from "path";

interface OpenAIMessage {
  role: string;
  content: string;
}

interface OpenAILine {
  messages: OpenAIMessage[];
}

const USER_PREFIX = "Perform the following v7 inference request: ";

function normalizeSentence(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function rebuildSentence(
  templateParts: string[],
  resolvedParts: string[],
): string {
  let sentence = "";
  let resolvedIndex = 0;

  for (let i = 0; i < templateParts.length; i++) {
    if (i % 2 === 0) {
      sentence += templateParts[i];
    } else {
      sentence += resolvedParts[resolvedIndex] ?? "";
      resolvedIndex++;
    }
  }

  return normalizeSentence(sentence);
}

function main() {
  const inputPath = process.argv[2] ?? path.join(__dirname, "dataset.jsonl");
  const outputPath = process.argv[3] ?? path.join(__dirname, "dataset.json");

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const lines = fs
    .readFileSync(inputPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const uniqueSentences = new Set<string>();

  for (const line of lines) {
    let record: OpenAILine;
    try {
      record = JSON.parse(line) as OpenAILine;
    } catch {
      continue;
    }

    const userMessage = record.messages.find((m) => m.role === "user");
    const assistantMessage = record.messages.find(
      (m) => m.role === "assistant",
    );
    if (!userMessage || !assistantMessage) continue;
    if (!userMessage.content.startsWith(USER_PREFIX)) continue;

    let templateParts: string[];
    let resolvedParts: string[];
    try {
      templateParts = JSON.parse(
        userMessage.content.slice(USER_PREFIX.length),
      ) as string[];
      resolvedParts = JSON.parse(assistantMessage.content) as string[];
    } catch {
      continue;
    }

    if (!Array.isArray(templateParts) || !Array.isArray(resolvedParts))
      continue;

    const sentence = rebuildSentence(templateParts, resolvedParts);
    if (sentence) uniqueSentences.add(sentence);
  }

  fs.writeFileSync(
    outputPath,
    JSON.stringify([...uniqueSentences], null, 2) + "\n",
    "utf8",
  );
  console.log(
    `Converted ${lines.length} records into ${uniqueSentences.size} unique sentences at ${outputPath}`,
  );
}

main();
