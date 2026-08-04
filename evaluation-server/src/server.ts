import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createWriteStream, readFileSync } from "node:fs";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import defaultCorpus from "../../evaluator/dataset.json";
import {
  DockerSandboxSession,
  SandboxError,
  verifySandboxAssets,
  type SandboxLimits,
} from "./dockerSandbox";
import { evaluateCorpus } from "./evaluationService";
import { obfuscateNumbers } from "./padme";

const parsePositiveInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer.`);
  return value;
};

const port = parsePositiveInt("EVALUATION_PORT", 3002);
const maxUploadBytes = parsePositiveInt(
  "EVALUATION_MAX_UPLOAD_BYTES",
  16 * 1024 * 1024,
);
const maxConcurrent = parsePositiveInt("EVALUATION_MAX_CONCURRENT", 2);
const authToken = process.env.EVALUATION_AUTH_TOKEN;
const corpus = (() => {
  const path = process.env.EVALUATION_CORPUS_PATH;
  const value: unknown = path
    ? JSON.parse(readFileSync(path, "utf8"))
    : defaultCorpus;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((text) => typeof text !== "string" || text.length === 0)
  ) {
    throw new Error("Evaluation corpus must be a non-empty JSON string array.");
  }
  return value as string[];
})();
const limits: SandboxLimits = {
  image: process.env.EVALUATION_SANDBOX_IMAGE ?? "v7-evaluator-sandbox:latest",
  modelHostPath: process.env.EVALUATION_MODEL_HOST_PATH ?? resolve("lm.binary"),
  memoryBytes: parsePositiveInt(
    "EVALUATION_MEMORY_BYTES",
    2 * 1024 * 1024 * 1024,
  ),
  cpus: Number(process.env.EVALUATION_CPUS ?? "0.5"),
  pids: parsePositiveInt("EVALUATION_PIDS", 64),
  outputBytes: parsePositiveInt("EVALUATION_OUTPUT_BYTES", 1024 * 1024),
  inferenceTimeoutMs: parsePositiveInt(
    "EVALUATION_INFERENCE_TIMEOUT_MS",
    2_000,
  ),
};
if (!Number.isFinite(limits.cpus) || limits.cpus <= 0)
  throw new Error("EVALUATION_CPUS must be positive.");

let active = 0;

function sendJson(
  response: ServerResponse,
  status: number,
  body: object,
): void {
  const encoded = JSON.stringify(obfuscateNumbers(body));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(encoded),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(encoded);
}

async function receiveExecutable(
  request: IncomingMessage,
): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "v7-evaluation-"));
  const path = join(directory, "program");
  const output = createWriteStream(path, { flags: "wx", mode: 0o500 });
  let received = 0;

  try {
    for await (const chunk of request) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += data.length;
      if (received > maxUploadBytes) throw new Error("UPLOAD_TOO_LARGE");
      if (!output.write(data))
        await new Promise<void>((resolve) => output.once("drain", resolve));
    }
    await new Promise<void>((resolve, reject) =>
      output.end((error?: Error | null) => (error ? reject(error) : resolve())),
    );
    if (received === 0) throw new Error("EMPTY_UPLOAD");
    await chmod(path, 0o555);
    return { directory, path };
  } catch (error) {
    output.destroy();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

const server = createServer(async (request, response) => {
  const requestId = randomUUID();
  if (request.method === "GET" && request.url === "/healthz") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (request.method !== "POST" || request.url !== "/evaluate") {
    sendJson(response, 404, { error: "NOT_FOUND" });
    return;
  }
  if (authToken && request.headers.authorization !== `Bearer ${authToken}`) {
    request.resume();
    sendJson(response, 401, { error: "UNAUTHORIZED" });
    return;
  }
  if (
    request.headers["content-type"]?.split(";", 1)[0] !==
    "application/octet-stream"
  ) {
    request.resume();
    sendJson(response, 415, { error: "EXECUTABLE_REQUIRED" });
    return;
  }
  if (active >= maxConcurrent) {
    request.resume();
    sendJson(response, 503, { error: "SERVER_BUSY" });
    return;
  }

  active += 1;
  let directory: string | undefined;
  let session: DockerSandboxSession | undefined;
  try {
    const upload = await receiveExecutable(request);
    directory = upload.directory;
    session = await DockerSandboxSession.start(upload.path, limits);
    const exactMetrics = await evaluateCorpus(corpus, session);
    // Exact metrics are intentionally emitted only to internal structured logs.
    console.info(
      JSON.stringify({
        event: "evaluation_completed",
        requestId,
        metrics: exactMetrics,
      }),
    );
    sendJson(response, 200, {
      status: "completed",
      metrics: exactMetrics,
      numericPolicy: "padme-rounded-up",
    });
  } catch (error) {
    const code =
      error instanceof SandboxError
        ? error.code
        : error instanceof Error
          ? error.message
          : "INTERNAL_ERROR";
    console.error(
      JSON.stringify({ event: "evaluation_failed", requestId, error: code }),
    );
    const status =
      code === "UPLOAD_TOO_LARGE" ? 413 : code === "EMPTY_UPLOAD" ? 400 : 422;
    sendJson(response, status, { status: "failed", error: code });
  } finally {
    await session?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
    active -= 1;
  }
});

// Corpus evaluation has no wall-clock deadline. The sandbox enforces a fresh
// deadline for each inference request instead.
server.requestTimeout = 0;
server.headersTimeout = 10_000;
void verifySandboxAssets(limits)
  .then(() => {
    server.listen(port, "0.0.0.0", () => {
      console.info(
        JSON.stringify({ event: "evaluation_server_started", port }),
      );
    });
  })
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "evaluation_server_start_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  });
