import { installNodeGlobals } from "./runtime-globals";

installNodeGlobals();

interface ProtocolRequest {
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface ProtocolResponse {
  id: string | number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface Engine {
  handleRequest(request: ProtocolRequest): Promise<ProtocolResponse>;
}

interface NativeRuntimeBridge {
  onReady(): void;
  onResponse(requestId: number, response: string, error: string): void;
  onDiagnostic(requestId: number, phase: string, detail: string): void;
}

declare const AndroidStrippedPloverRuntime: NativeRuntimeBridge;

let requestTail: Promise<void> = Promise.resolve();
let enginePromise: Promise<Engine>;

async function loadEngine(): Promise<Engine> {
  const { StrippedPlover } = await import("@stripped-plover/engine");
  return new StrippedPlover("android-native.sqlite") as Engine;
}

function report(
  requestId: number,
  response: ProtocolResponse | null,
  error: unknown,
): void {
  const message =
    error instanceof Error ? error.message : error == null ? "" : String(error);
  AndroidStrippedPloverRuntime.onResponse(
    requestId,
    response == null ? "" : JSON.stringify(response),
    message,
  );
}

function request(requestId: number, body: string): void {
  AndroidStrippedPloverRuntime.onDiagnostic(
    requestId,
    "runtime-queued",
    `bytes=${body.length}`,
  );
  requestTail = requestTail.then(async () => {
    const startedAt = performance.now();
    try {
      const engine = await enginePromise;
      const parsed = JSON.parse(body) as ProtocolRequest;
      AndroidStrippedPloverRuntime.onDiagnostic(
        requestId,
        "runtime-start",
        `method=${parsed.method}`,
      );
      const response = await engine.handleRequest(parsed);
      AndroidStrippedPloverRuntime.onDiagnostic(
        requestId,
        "runtime-complete",
        `method=${parsed.method} elapsedMs=${Math.round(performance.now() - startedAt)}`,
      );
      report(requestId, response, null);
    } catch (error) {
      AndroidStrippedPloverRuntime.onDiagnostic(
        requestId,
        "runtime-error",
        error instanceof Error ? error.message : String(error),
      );
      report(requestId, null, error);
    }
  });
}

declare global {
  interface Window {
    StrippedPloverAndroidRuntime: {
      request(requestId: number, body: string): void;
    };
  }
}

window.StrippedPloverAndroidRuntime = { request };
enginePromise = loadEngine();
enginePromise.then(
  () => AndroidStrippedPloverRuntime.onReady(),
  (error) => report(0, null, error),
);
