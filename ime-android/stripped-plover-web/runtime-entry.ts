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
  onEvent(event: string): void;
}

declare const AndroidStrippedPloverRuntime: NativeRuntimeBridge;

const PYTHON_SERVICE_WORKER_URL =
  "/assets/stripped-plover-python-service-worker.js";
const PYTHON_SERVICE_WORKER_SCOPE = "/assets/";
const SERVICE_WORKER_STARTUP_TIMEOUT_MS = 15_000;

let requestTail: Promise<void> = Promise.resolve();
let enginePromise: Promise<Engine>;

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
  if (crossOriginIsolated) {
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
      await registration.unregister();
    }
  }
  const registration = await withTimeout(
    navigator.serviceWorker.register(PYTHON_SERVICE_WORKER_URL, {
      scope: PYTHON_SERVICE_WORKER_SCOPE,
    }),
    SERVICE_WORKER_STARTUP_TIMEOUT_MS,
    "Python service worker registration timed out",
  );
  await withTimeout(
    waitForServiceWorkerActivation(registration),
    SERVICE_WORKER_STARTUP_TIMEOUT_MS,
    "Python service worker activation timed out",
  );
  await withTimeout(
    waitForServiceWorkerControl(),
    SERVICE_WORKER_STARTUP_TIMEOUT_MS,
    "Python service worker did not take control of the runtime",
  );
}

async function loadEngine(): Promise<Engine> {
  await preparePythonRuntime();
  const { StrippedPlover } = await import("@stripped-plover/engine");
  const engine = new StrippedPlover(
    "android-native.sqlite",
  ) as unknown as Engine & {
    eventSink: (event: Record<string, unknown>) => void;
  };
  // The upstream CLI writes asynchronous host-command events to STDOUT. The
  // Android bundle has no STDOUT protocol transport, so replace that sink
  // with the deliberately narrow native event bridge.
  engine.eventSink = (event) => {
    AndroidStrippedPloverRuntime.onEvent(JSON.stringify(event));
  };
  return engine;
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

function expandDictionaryImport(request: ProtocolRequest): ProtocolRequest {
  if (request.method !== "import_dictionary_source") return request;
  const params = request.params ?? {};
  const name = params.name;
  const type = params.type;
  const source = params.source;
  const merge = params.merge;
  if (typeof name !== "string" || !name) {
    throw new Error("Dictionary name is required");
  }
  if (type !== "json" && type !== "python") {
    throw new Error('Dictionary type must be "json" or "python"');
  }
  if (typeof source !== "string" || !source) {
    throw new Error("Dictionary source is empty");
  }
  return {
    ...request,
    method: "import_dictionary",
    params:
      type === "json"
        ? { name, type, merge: !!merge, data: JSON.parse(source) }
        : { name, type, merge: false, pythonCode: source },
  };
}

function request(requestId: number, body: string): void {
  requestTail = requestTail.then(async () => {
    try {
      const engine = await enginePromise;
      const parsed = expandDictionaryImport(
        JSON.parse(body) as ProtocolRequest,
      );
      const response = await engine.handleRequest(parsed);
      report(requestId, response, null);
    } catch (error) {
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
