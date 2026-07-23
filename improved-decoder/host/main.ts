import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

import dataset from "../../evaluator/dataset.json";
import {
  buildEvaluationIslands,
  getPiecemealCorrectionCost,
  type EvaluationIsland,
} from "../../evaluator/evaluateInference";
import { getInference, getV7Code } from "../../evaluator/getInference";

const ROOT = resolve(__dirname, "..");
const REPOSITORY_ROOT = resolve(ROOT, "..");
const ARTIFACT_LIMIT = 50 * 1024;
const MAX_CANDIDATES = 5;
const DECODER_TIMEOUT_MS = 50;

type Split = "train" | "development" | "test";
type Scope = Split | "corpus";

interface CandidateApi {
  enumerate(v7Island: string): readonly (readonly string[])[];
  kenlmScore(sequence: readonly string[]): number;
}

interface DecoderInput {
  fixedLeftText: string;
  v7Island: string;
  maxCandidates: number;
}

type Decoder = (input: DecoderInput, api: CandidateApi) => string[];
type EvaluationFailure = "ILLEGAL" | "TIMEOUT";

class DecoderTimeoutError extends Error {}

const normalizeWord = (value: string): string =>
  value.normalize("NFC").toLocaleLowerCase("vi");

const words = (value: string): string[] =>
  value
    .normalize("NFC")
    .toLocaleLowerCase("vi")
    .match(/\p{L}+/gu) ?? [];

const splitFor = (sentence: string): Split => {
  const bucket = createHash("sha256").update(sentence).digest()[0] % 20;
  if (bucket < 14) return "train";
  if (bucket < 17) return "development";
  return "test";
};

const enumerate = (v7Island: string): string[][] =>
  getInference(["", v7Island, ""])
    .filter(
      (position): position is { type: "syllable"; candidates: string[] } =>
        position.type === "syllable",
    )
    .map((position) => [...position.candidates]);

const cartesian = (slots: readonly (readonly string[])[]): string[][] => {
  let result: string[][] = [[]];
  for (const slot of slots) {
    const next: string[][] = [];
    for (const prefix of result) {
      for (const syllable of slot) next.push([...prefix, syllable]);
    }
    result = next;
  }
  return result;
};

class KenLmQuery {
  readonly #process: ChildProcessWithoutNullStreams;
  readonly #pending: Array<{
    prefixLength: number;
    continuationLength: number;
    resolve: (score: number) => void;
    reject: (error: Error) => void;
  }> = [];
  #failure: Error | null = null;
  #buffer = "";
  #tokenScores: number[] = [];

  constructor() {
    const model = resolve(REPOSITORY_ROOT, "lm.binary");
    this.#process = spawn(
      "docker",
      [
        "run",
        "--rm",
        "-i",
        "-v",
        `${model}:/app/lm.binary:ro`,
        "--entrypoint",
        "/usr/bin/stdbuf",
        "v7-inference:latest",
        "-oL",
        "./kenlm/build/bin/query",
        "-b",
        "-v",
        "word",
        "./lm.binary",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    this.#process.stdout.setEncoding("utf8");
    this.#process.stdout.on("data", (chunk: string) =>
      this.#handleChunk(chunk),
    );
    this.#process.on("error", (error) => this.#rejectAll(error));
    this.#process.on("exit", (code) => {
      if (code !== 0 && !this.#failure) {
        this.#rejectAll(new Error(`KenLM query exited with status ${code}.`));
      }
    });
  }

  #rejectAll(error: Error): void {
    this.#failure = error;
    for (const pending of this.#pending.splice(0)) pending.reject(error);
  }

  #handleChunk(chunk: string): void {
    this.#buffer += chunk;
    let boundary = this.#buffer.indexOf("\t");
    while (boundary >= 0) {
      const field = this.#buffer.slice(0, boundary);
      this.#buffer = this.#buffer.slice(boundary + 1);
      const match = field.match(/\s(-?\d+(?:\.\d+)?)$/);
      if (!match) {
        this.#rejectAll(new Error(`Unexpected KenLM field: ${field}`));
        return;
      }
      this.#tokenScores.push(Number(match[1]));

      const pending = this.#pending[0];
      const expected =
        pending && pending.prefixLength + pending.continuationLength + 1;
      if (pending && this.#tokenScores.length === expected) {
        this.#pending.shift();
        const from = pending.prefixLength;
        const to = from + pending.continuationLength;
        pending.resolve(
          this.#tokenScores
            .slice(from, to)
            .reduce((sum, score) => sum + score, 0),
        );
        this.#tokenScores = [];
      }
      boundary = this.#buffer.indexOf("\t");
    }
  }

  score(
    prefix: readonly string[],
    continuation: readonly string[],
  ): Promise<number> {
    if (this.#failure) return Promise.reject(this.#failure);
    return new Promise((resolve, reject) => {
      this.#pending.push({
        prefixLength: prefix.length,
        continuationLength: continuation.length,
        resolve,
        reject,
      });
      this.#process.stdin.write(`${[...prefix, ...continuation].join(" ")}\n`);
    });
  }

  async close(): Promise<void> {
    this.#process.stdin.end();
    if (this.#process.exitCode !== null) return;
    await new Promise<void>((resolveExit) =>
      this.#process.once("exit", () => resolveExit()),
    );
  }
}

const loadDecoder = async (name: "baseline" | "decoder"): Promise<Decoder> => {
  const filename = resolve(ROOT, "dist", `${name}.cjs`);
  const source = await readFile(filename, "utf8");
  if (Buffer.byteLength(source) > ARTIFACT_LIMIT) {
    throw new Error(`${name} artifact exceeds ${ARTIFACT_LIMIT} bytes.`);
  }

  const context = vm.createContext({
    module: { exports: {} },
    exports: {},
  });
  new vm.Script(source, { filename }).runInContext(context, { timeout: 100 });
  const exported = (context.module as { exports: { default?: Decoder } })
    .exports;
  const decoder = exported.default ?? (exported as unknown as Decoder);
  if (typeof decoder !== "function") {
    throw new TypeError(`${name} artifact did not export a decoder.`);
  }

  Object.assign(context, { __decoder: decoder });
  const invocation = new vm.Script("__decoder(__decoderInput, __decoderApi)", {
    filename: `${filename}:invoke`,
  });
  return (input, api) => {
    Object.assign(context, {
      __decoderInput: input,
      __decoderApi: api,
    });
    try {
      return invocation.runInContext(context, {
        timeout: DECODER_TIMEOUT_MS,
      }) as string[];
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT"
      ) {
        throw new DecoderTimeoutError(
          `${name} decoder exceeded ${DECODER_TIMEOUT_MS} ms.`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      Reflect.deleteProperty(context, "__decoderInput");
      Reflect.deleteProperty(context, "__decoderApi");
    }
  };
};

const legalCandidate = (candidate: string, v7Code: string): boolean => {
  const syllables = candidate
    .normalize("NFC")
    .trim()
    .split(/\s+/)
    .map(normalizeWord);
  const codes = syllables.map(getV7Code);
  return (
    syllables.length > 0 &&
    codes.every((code) => code !== undefined) &&
    codes.join("") === v7Code
  );
};

interface EvaluationSummary {
  decoder: string;
  scope: Scope;
  sentences: number;
  islands: number;
  representableSyllables: number;
  score: number | EvaluationFailure;
  inconveniencePerSyllable: number | EvaluationFailure;
  top1Exact: number;
  top5Recall: number;
  elapsedMs: number;
}

const scoreIsland = async (
  decoders: readonly (Decoder | null)[],
  island: EvaluationIsland,
  fixedLeftText: string,
  kenlm: KenLmQuery,
): Promise<
  Array<{
    failure: EvaluationFailure | null;
    score: number;
    top1: boolean;
    top5: boolean;
  } | null>
> => {
  const slots = enumerate(island.v7Code);
  const sequences = cartesian(slots);
  // The oracle is a 3-gram model, so two preceding words are a complete state.
  const prefix = words(fixedLeftText).slice(-2);
  const scores = await Promise.all(
    sequences.map((sequence) => kenlm.score(prefix, sequence)),
  );
  const scoreBySequence = new Map(
    sequences.map((sequence, index) => [
      sequence.join("\u0000"),
      scores[index],
    ]),
  );
  const api: CandidateApi = Object.freeze({
    enumerate: () => slots.map((slot) => [...slot]),
    kenlmScore: (sequence) =>
      scoreBySequence.get(sequence.join("\u0000")) ?? Number.NEGATIVE_INFINITY,
  });
  const input: DecoderInput = Object.freeze({
    fixedLeftText,
    v7Island: island.v7Code,
    maxCandidates: MAX_CANDIDATES,
  });

  return decoders.map((decoder) =>
    decoder ? scoreDecoder(decoder, input, api, island) : null,
  );
};

const scoreDecoder = (
  decoder: Decoder,
  input: DecoderInput,
  api: CandidateApi,
  island: EvaluationIsland,
): {
  failure: EvaluationFailure | null;
  score: number;
  top1: boolean;
  top5: boolean;
} => {
  let candidates: string[];
  try {
    candidates = decoder(input, api);
  } catch (error) {
    if (error instanceof DecoderTimeoutError) {
      return {
        failure: "TIMEOUT",
        score: 0,
        top1: false,
        top5: false,
      };
    }
    throw error;
  }
  if (
    !Array.isArray(candidates) ||
    candidates.length > MAX_CANDIDATES ||
    candidates.some(
      (candidate) =>
        typeof candidate !== "string" ||
        !legalCandidate(candidate, island.v7Code),
    )
  ) {
    return { failure: "ILLEGAL", score: 0, top1: false, top5: false };
  }

  const normalizedCandidates = candidates.map((candidate) =>
    candidate.split(/\s+/).map(normalizeWord),
  );
  const target = island.targetSyllables;
  const same = (candidate: readonly string[]): boolean =>
    candidate.length === target.length &&
    candidate.every((syllable, index) => syllable === target[index]);
  const exactIndex = normalizedCandidates.findIndex(same);
  const topPrediction = normalizedCandidates[0] ?? [];
  const correction =
    exactIndex === 0
      ? 0
      : exactIndex > 0
        ? 1
        : getPiecemealCorrectionCost(target, topPrediction);
  return {
    failure: null,
    score: 1 + correction,
    top1: exactIndex === 0,
    top5: exactIndex >= 0,
  };
};

const evaluate = async (
  scope: Scope,
  limit: number,
): Promise<EvaluationSummary[]> => {
  const decoderNames = ["baseline", "decoder"] as const;
  const decoders = await Promise.all(decoderNames.map(loadDecoder));
  const selected =
    scope === "corpus"
      ? dataset
      : dataset.filter((sentence) => splitFor(sentence) === scope);
  const sample = limit > 0 ? selected.slice(0, limit) : selected;
  const kenlm = new KenLmQuery();
  const started = performance.now();
  const totals = decoderNames.map(() => ({
    score: 0,
    islands: 0,
    syllables: 0,
    top1: 0,
    top5: 0,
    failure: null as EvaluationFailure | null,
  }));

  try {
    for (const [sentenceIndex, sentence] of sample.entries()) {
      for (const island of buildEvaluationIslands(sentence)) {
        const results = await scoreIsland(
          decoders.map((decoder, index) =>
            totals[index].failure ? null : decoder,
          ),
          island,
          sentence.slice(0, island.sourceStart),
          kenlm,
        );
        for (const [index, result] of results.entries()) {
          if (!result) continue;
          const total = totals[index];
          if (total.failure) continue;
          total.islands += 1;
          total.syllables += island.targetSyllables.length;
          if (result.failure) {
            total.failure = result.failure;
            continue;
          }
          total.score += result.score;
          if (result.top1) total.top1 += 1;
          if (result.top5) total.top5 += 1;
        }
      }
      if ((sentenceIndex + 1) % 250 === 0) {
        console.error(
          `evaluated ${sentenceIndex + 1}/${sample.length} sentences`,
        );
      }
      if (totals.every((total) => total.failure)) break;
    }
  } finally {
    await kenlm.close();
  }

  const elapsedMs = Math.round(performance.now() - started);
  return decoderNames.map((decoder, index) => {
    const total = totals[index];
    return {
      decoder,
      scope,
      sentences: sample.length,
      islands: total.islands,
      representableSyllables: total.syllables,
      score: total.failure ?? total.score,
      inconveniencePerSyllable:
        total.failure || total.syllables === 0
          ? (total.failure ?? "ILLEGAL")
          : total.score / total.syllables,
      top1Exact: total.islands === 0 ? 0 : total.top1 / total.islands,
      top5Recall: total.islands === 0 ? 0 : total.top5 / total.islands,
      elapsedMs,
    };
  });
};

const train = async (): Promise<void> => {
  const recordLimit = Number.parseInt(option("records", "1200"), 10);
  const contextRecordLimit = Number.parseInt(
    option("context-records", "665"),
    10,
  );
  const phrasesPerCode = Number.parseInt(option("phrases-per-code", "3"), 10);
  const counts = new Map<string, Map<string, number>>();
  const contextCounts = new Map<string, Map<string, number>>();
  for (const sentence of dataset) {
    for (const island of buildEvaluationIslands(sentence)) {
      const phrase = island.targetSyllables.join(" ");
      const phrases = counts.get(island.v7Code) ?? new Map<string, number>();
      phrases.set(phrase, (phrases.get(phrase) ?? 0) + 1);
      counts.set(island.v7Code, phrases);

      const leftWord = words(sentence.slice(0, island.sourceStart)).at(-1);
      if (leftWord) {
        const contextKey = `${leftWord}\t${island.v7Code}`;
        const contextualPhrases =
          contextCounts.get(contextKey) ?? new Map<string, number>();
        contextualPhrases.set(phrase, (contextualPhrases.get(phrase) ?? 0) + 1);
        contextCounts.set(contextKey, contextualPhrases);
      }
    }
  }

  const records: Array<{
    code: string;
    phrase: string;
    count: number;
    bonus: number;
  }> = [];
  for (const [code, phrases] of counts) {
    for (const [phrase, count] of [...phrases]
      .sort((a, b) => b[1] - a[1])
      .slice(0, phrasesPerCode)) {
      records.push({
        code,
        phrase,
        count,
        bonus: Math.min(24, Math.max(1, Math.round(4 * Math.log2(count + 1)))),
      });
    }
  }
  records.sort((a, b) => b.count - a.count);

  const baseRows = records
    .slice(0, recordLimit)
    .map(({ code, phrase, bonus }) => `${code}\t${phrase}\t${bonus}`)
    .join("\n");
  const contextRows = [...contextCounts]
    .map(([key, phrases]) => {
      const ranked = [...phrases].sort((a, b) => b[1] - a[1]);
      const [phrase, count] = ranked[0];
      const runnerUp = ranked[1]?.[1] ?? 0;
      const [, code] = key.split("\t");
      const globalPhrase = [...(counts.get(code) ?? [])].sort(
        (a, b) => b[1] - a[1],
      )[0]?.[0];
      return {
        key,
        phrase,
        count,
        advantage: count - runnerUp,
        differsFromGlobal: phrase !== globalPhrase,
      };
    })
    .filter((record) => record.differsFromGlobal)
    .sort(
      (a, b) =>
        b.advantage - a.advantage ||
        b.count - a.count ||
        a.key.localeCompare(b.key),
    )
    .slice(0, contextRecordLimit)
    .map(({ key, phrase }) => `${key}\t${phrase}`)
    .join("\n");
  await mkdir(resolve(ROOT, "generated"), { recursive: true });
  await writeFile(
    resolve(ROOT, "generated", "model.js"),
    "// Generated from the complete public corpus by `npm run train`.\n" +
      `export default ${JSON.stringify([baseRows, contextRows])};\n`,
    "utf8",
  );
  console.log(
    `Generated ${Math.min(records.length, recordLimit)}/${records.length} ` +
      `base records and ${Math.min(contextCounts.size, contextRecordLimit)} ` +
      `context records across ${counts.size} codes.`,
  );
};

const option = (name: string, fallback: string): string => {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((argument) => argument.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  );
};

const main = async (): Promise<void> => {
  const command = process.argv[2] ?? "evaluate";
  if (command === "train") {
    await train();
    return;
  }
  if (command !== "evaluate") throw new Error(`Unknown command: ${command}`);

  const scope = option("scope", option("split", "corpus")) as Scope;
  if (!["corpus", "train", "development", "test"].includes(scope)) {
    throw new Error(`Unknown scope: ${scope}`);
  }
  const limit = Number.parseInt(option("limit", "100"), 10);
  for (const result of await evaluate(scope, limit)) {
    console.log(JSON.stringify(result, null, 2));
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
