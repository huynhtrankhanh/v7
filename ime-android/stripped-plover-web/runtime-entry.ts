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

const PYTHON_SERVICE_WORKER_URL =
  "/assets/stripped-plover-python-service-worker.js";
const PYTHON_SERVICE_WORKER_SCOPE = "/assets/";
const PENDING_DIAGNOSTIC_INTERVAL_MS = 5_000;
const SERVICE_WORKER_STARTUP_TIMEOUT_MS = 15_000;

let requestTail: Promise<void> = Promise.resolve();
let enginePromise: Promise<Engine>;

function diagnostic(requestId: number, phase: string, detail = ""): void {
  AndroidStrippedPloverRuntime.onDiagnostic(requestId, phase, detail);
}

function waitForServiceWorkerActivation(
  registration: ServiceWorkerRegistration,
): Promise<void> {
  const worker =
    registration.installing ?? registration.waiting ?? registration.active;
  if (!worker) {
    return Promise.reject(
      new Error("Python service worker registration has no worker"),
    );
  }
  if (worker.state === "activated") {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const stateChanged = () => {
      if (worker.state === "activated") {
        worker.removeEventListener("statechange", stateChanged);
        resolve();
      } else if (worker.state === "redundant") {
        worker.removeEventListener("statechange", stateChanged);
        reject(new Error("Python service worker became redundant"));
      }
    };
    worker.addEventListener("statechange", stateChanged);
  });
}

function waitForServiceWorkerControl(): Promise<void> {
  const expectedScriptUrl = new URL(PYTHON_SERVICE_WORKER_URL, location.href)
    .href;
  if (navigator.serviceWorker.controller?.scriptURL === expectedScriptUrl) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const controllerChanged = () => {
      if (navigator.serviceWorker.controller?.scriptURL === expectedScriptUrl) {
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          controllerChanged,
        );
        resolve();
      }
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      controllerChanged,
    );
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error(message)),
      timeoutMs,
    );
    promise.then(
      (result) => {
        window.clearTimeout(timeout);
        resolve(result);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function preparePythonRuntime(): Promise<void> {
  diagnostic(
    0,
    "runtime-environment",
    [
      `crossOriginIsolated=${crossOriginIsolated}`,
      `sharedArrayBuffer=${typeof SharedArrayBuffer !== "undefined"}`,
      `serviceWorker=${"serviceWorker" in navigator}`,
      `controller=${navigator.serviceWorker?.controller?.scriptURL ?? "none"}`,
    ].join(" "),
  );
  if (crossOriginIsolated) {
    diagnostic(0, "runtime-io-ready", "mode=atomics");
    return;
  }
  if (!("serviceWorker" in navigator)) {
    throw new Error(
      "Python requires either cross-origin isolation or service-worker support",
    );
  }
  const registrations = await withTimeout(
    navigator.serviceWorker.getRegistrations(),
    SERVICE_WORKER_STARTUP_TIMEOUT_MS,
    "Reading Python service worker registrations timed out",
  );
  for (const registration of registrations) {
    if (
      new URL(registration.scope).pathname === "/assets/worker/" ||
      registration.active?.scriptURL.endsWith(
        "/assets/worker/service-worker.js",
      )
    ) {
      const removed = await registration.unregister();
      diagnostic(
        0,
        "runtime-service-worker-legacy-removed",
        `scope=${registration.scope} removed=${removed}`,
      );
    }
  }
  diagnostic(
    0,
    "runtime-service-worker-register-start",
    `url=${PYTHON_SERVICE_WORKER_URL} scope=${PYTHON_SERVICE_WORKER_SCOPE}`,
  );
  const registration = await withTimeout(
    navigator.serviceWorker.register(PYTHON_SERVICE_WORKER_URL, {
      scope: PYTHON_SERVICE_WORKER_SCOPE,
    }),
    SERVICE_WORKER_STARTUP_TIMEOUT_MS,
    "Python service worker registration timed out",
  );
  diagnostic(
    0,
    "runtime-service-worker-registered",
    `active=${registration.active?.state ?? "none"} installing=${registration.installing?.state ?? "none"} waiting=${registration.waiting?.state ?? "none"}`,
  );
  await withTimeout(
    waitForServiceWorkerActivation(registration),
    SERVICE_WORKER_STARTUP_TIMEOUT_MS,
    "Python service worker activation timed out",
  );
  diagnostic(0, "runtime-service-worker-activated");
  await withTimeout(
    waitForServiceWorkerControl(),
    SERVICE_WORKER_STARTUP_TIMEOUT_MS,
    "Python service worker did not take control of the runtime",
  );
  diagnostic(
    0,
    "runtime-io-ready",
    `mode=service-worker controller=${navigator.serviceWorker.controller?.scriptURL ?? "none"}`,
  );
}

async function loadEngine(): Promise<Engine> {
  await preparePythonRuntime();
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
    let activePhase = "runtime-start";
    const previousDiagnostic = globalThis.__v7PloverDiagnostic;
    const pendingDiagnostic = window.setInterval(() => {
      diagnostic(
        requestId,
        "runtime-pending",
        `elapsedMs=${Math.round(performance.now() - startedAt)} activePhase=${activePhase}`,
      );
    }, PENDING_DIAGNOSTIC_INTERVAL_MS);
    try {
      const engine = await enginePromise;
      const parsed = JSON.parse(body) as ProtocolRequest;
      diagnostic(requestId, "runtime-start", `method=${parsed.method}`);
      globalThis.__v7PloverDiagnostic = (phase, detail = "") => {
        activePhase = phase;
        diagnostic(requestId, phase, detail);
      };
      const response = await engine.handleRequest(parsed);
      diagnostic(
        requestId,
        "runtime-complete",
        `method=${parsed.method} elapsedMs=${Math.round(performance.now() - startedAt)}`,
      );
      report(requestId, response, null);
    } catch (error) {
      diagnostic(
        requestId,
        "runtime-error",
        error instanceof Error ? error.message : String(error),
      );
      report(requestId, null, error);
    } finally {
      window.clearInterval(pendingDiagnostic);
      globalThis.__v7PloverDiagnostic = previousDiagnostic;
    }
  });
}

declare global {
  var __v7PloverDiagnostic:
    ((phase: string, detail?: string) => void) | undefined;

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
