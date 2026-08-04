# Sandboxed HTTP evaluation server

This service accepts one executable, runs it against `evaluator/dataset.json`,
and returns aggregate V7 inconvenience metrics. Each submission runs in a new,
resource-limited Docker container.

## API

Send the executable as the complete request body:

```sh
curl --fail-with-body \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @./my-decoder \
  http://localhost:3002/evaluate
```

If `EVALUATION_AUTH_TOKEN` is configured, also send
`Authorization: Bearer <token>`. A successful response has this shape:

```json
{
  "status": "completed",
  "metrics": {
    "hardFailureFlag": 0,
    "failedScenarioRuns": 0,
    "illegalScenarioRuns": 0,
    "timeoutScenarioRuns": 0,
    "freeRunningFinalSyllableErrors": 272,
    "worstCorrectingPolicyPhysicalActions": 1024,
    "totalCorrectingPhysicalActions": 6144,
    "p95ErrorCascadeLength": 4,
    "totalCandidateInspectionSteps": 128,
    "p95InferenceLatencyMilliseconds": 2
  },
  "numericPolicy": "padme-rounded-up"
}
```

Every number in every HTTP JSON body is rounded upward to a Padme-permitted
integer. This applies recursively to the complete causal metric vector.
HTTP body length is **not padded**, and Padme rounding is not encryption. Exact
metrics are written only to the server's structured internal logs. Use TLS at a
reverse proxy because the service itself serves plain HTTP.

The health endpoint is `GET /healthz`.

## Executable protocol

The upload must be a Linux executable compatible with Debian 12. It is started
once and must stay alive until stdin closes. For every line read from stdin:

1. Parse the line as a JSON `string[]`. It has the evaluator's alternating
   `[fixedPrefix, compactV7Code, fixedSuffix]` request shape.
2. Write one JSON inference response followed by `\n` to stdout.
3. Do not write anything else to stdout. Diagnostic output may go to stderr.

For example, a response can be `[["trời mưa"],["trời mua"]]`. Candidate forms
and legality rules are documented in [the evaluator README](../evaluator/README.md).
Requests are strictly sequential. A statically linked executable is the most
portable choice; dynamically linked programs may use libraries present in the
minimal Debian sandbox image.

The trained language model is available read-only at `/model/lm.binary`. It is
not part of the submission and its size is not included in evaluation metrics.

## Run

With Docker Compose:

```sh
docker compose build evaluator-sandbox evaluation-server
docker compose up evaluation-server
```

Or run the server on the host:

```sh
docker build -f evaluation-server/sandbox.Dockerfile \
  -t v7-evaluator-sandbox:latest .
docker volume create v7-evaluator-model
docker run --rm --user 0:0 \
  -v "$PWD/lm.binary:/model-source/lm.binary:ro" \
  -v v7-evaluator-model:/model \
  v7-evaluator-sandbox:latest \
  /bin/sh -c 'cp /model-source/lm.binary /model/lm.binary && chmod 0444 /model/lm.binary'
npm run build:evaluation-server
EVALUATION_AUTH_TOKEN='replace-me' npm run start:evaluation-server
```

The Compose deployment mounts the Docker socket. Access to that socket is
equivalent to host-level control, so the evaluation server container must not
be exposed to untrusted administrators and should run on a dedicated worker.
Submitted code never receives the socket.

## Isolation and limits

Each submission gets uniquely named staging and execution containers plus a
uniquely named submission volume. It runs with:

- no network;
- a read-only root filesystem and a small `noexec`, `nosuid`, `nodev` `/tmp`;
- UID/GID 65534, all capabilities dropped, and `no-new-privileges`;
- CPU, memory, process, open-file, output, and per-inference time limits;
- no host bind mounts or Docker socket.

The executable is copied into the staging volume, which is mounted read-only
for execution. Both containers, the volume, and the host temporary upload are
forcibly removed after success or failure. Managed Docker resources carry the
`v7.evaluation.managed=true` label for operational auditing.

Configuration:

| Variable                          |                       Default | Meaning                                  |
| --------------------------------- | ----------------------------: | ---------------------------------------- |
| `EVALUATION_PORT`                 |                        `3002` | HTTP listen port                         |
| `EVALUATION_AUTH_TOKEN`           |                         unset | Optional bearer token                    |
| `EVALUATION_MAX_UPLOAD_BYTES`     |                    `16777216` | Maximum executable size                  |
| `EVALUATION_MAX_CONCURRENT`       |                           `2` | Concurrent submissions                   |
| `EVALUATION_SANDBOX_IMAGE`        | `v7-evaluator-sandbox:latest` | Sandbox image                            |
| `EVALUATION_MODEL_VOLUME`         |          `v7-evaluator-model` | Read-only volume containing `lm.binary`  |
| `EVALUATION_MEMORY_BYTES`         |                   `268435456` | Container memory and swap ceiling        |
| `EVALUATION_CPUS`                 |                         `0.5` | Container CPU quota                      |
| `EVALUATION_PIDS`                 |                          `64` | Container PID ceiling                    |
| `EVALUATION_OUTPUT_BYTES`         |                     `1048576` | One-response stdout and total stderr cap |
| `EVALUATION_INFERENCE_TIMEOUT_MS` |                        `2000` | Deadline for one response                |

There is intentionally no whole-corpus deadline. The
`EVALUATION_INFERENCE_TIMEOUT_MS` timer resets for each request/response pair;
a timeout kills the submission container and records a hard `TIMEOUT` in the
causal metrics.

Do not publish the service without authentication, TLS, request-rate limiting,
and restricted access to its internal logs.

## Metric privacy

The service uses the causal IME scenario evaluator and returns the first ten
fields of its lexicographic synthesis objective: failures, free-running final
errors, correcting-policy actions, cascade tail, candidate inspection, and
latency tail. The objective's final `artifactBytes` field is deliberately
omitted from both the response and exact-metric log.

For a non-negative numeric metric `L`, the response uses the Padme rounding
rule from section 4.4 of Nikitin et al., _Reducing Metadata Leakage from
Encrypted Files and Communication with PURBs_. It rounds `L` upward until the
low `E-S` bits are zero, where `E=floor(log2(L))` and
`S=floor(log2(E))+1`. Fractional values are first rounded upward to an integer.

This repository intentionally uses Padme as **numeric value rounding**, per the
evaluation API policy. It does not add bytes to the HTTP response. The server
logs the exact metrics once as an `evaluation_completed` JSON event; public
responses contain only rounded values.
