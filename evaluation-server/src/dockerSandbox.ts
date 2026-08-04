import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SandboxLimits {
  image: string;
  modelHostPath: string;
  memoryBytes: number;
  cpus: number;
  pids: number;
  outputBytes: number;
  inferenceTimeoutMs: number;
}

export interface InferenceSession {
  infer(request: string[]): Promise<unknown>;
  close(): Promise<void>;
}

export class SandboxError extends Error {
  constructor(
    readonly code:
      | "SANDBOX_UNAVAILABLE"
      | "START_FAILED"
      | "TIME_LIMIT"
      | "OUTPUT_LIMIT"
      | "PROTOCOL_ERROR"
      | "EXECUTABLE_FAILED",
    message: string,
  ) {
    super(message);
  }
}

/** Fail startup before accepting submissions if the image or shared model is absent. */
export async function verifySandboxAssets(
  limits: SandboxLimits,
): Promise<void> {
  try {
    await execFileAsync("docker", [
      "run",
      "--rm",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges:true",
      `--mount=type=bind,source=${limits.modelHostPath},target=/model/lm.binary,readonly`,
      "--user=65534:65534",
      limits.image,
      "/usr/bin/test",
      "-r",
      "/model/lm.binary",
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SandboxError(
      "SANDBOX_UNAVAILABLE",
      `Sandbox image/model preflight failed: ${detail}`,
    );
  }
}

export class DockerSandboxSession implements InferenceSession {
  private child: ChildProcessWithoutNullStreams | undefined;
  private stdout = "";
  private stderr = "";
  private stderrBytes = 0;
  private pending:
    | { resolve: (value: unknown) => void; reject: (reason: Error) => void }
    | undefined;
  private terminalError: SandboxError | undefined;
  private closed = false;

  private constructor(
    private readonly containerName: string,
    private readonly loaderName: string,
    private readonly volumeName: string,
    private readonly limits: SandboxLimits,
  ) {}

  static async start(
    executablePath: string,
    limits: SandboxLimits,
  ): Promise<DockerSandboxSession> {
    const name = `v7-eval-${randomUUID()}`;
    const loaderName = `${name}-loader`;
    const volumeName = `${name}-submission`;
    const session = new DockerSandboxSession(
      name,
      loaderName,
      volumeName,
      limits,
    );
    try {
      await execFileAsync("docker", [
        "volume",
        "create",
        "--label",
        "v7.evaluation.managed=true",
        volumeName,
      ]);
      await execFileAsync("docker", [
        "create",
        "--name",
        loaderName,
        "--label",
        "v7.evaluation.managed=true",
        "--network=none",
        `--mount=type=volume,source=${volumeName},target=/submission`,
        limits.image,
        "/bin/true",
      ]);
      await execFileAsync("docker", [
        "cp",
        executablePath,
        `${loaderName}:/submission/program`,
      ]);
      await execFileAsync("docker", ["rm", "--force", loaderName]);
      await execFileAsync("docker", [
        "create",
        "--name",
        name,
        "--interactive",
        "--label",
        "v7.evaluation.managed=true",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges:true",
        `--memory=${limits.memoryBytes}`,
        `--memory-swap=${limits.memoryBytes}`,
        `--cpus=${limits.cpus}`,
        `--pids-limit=${limits.pids}`,
        "--ulimit=nofile=64:64",
        "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16777216",
        `--mount=type=volume,source=${volumeName},target=/submission,readonly`,
        `--mount=type=bind,source=${limits.modelHostPath},target=/model/lm.binary,readonly`,
        "--user=65534:65534",
        "--workdir=/tmp",
        "--env=V7_EVALUATION_PROTOCOL=ndjson-v1",
        "--env=V7_MODEL_PATH=/model/lm.binary",
        limits.image,
        "/submission/program",
      ]);
      await unlink(executablePath).catch(() => undefined);
      session.attach();
      return session;
    } catch (error) {
      await session.close();
      const detail = error instanceof Error ? error.message : String(error);
      throw new SandboxError(
        detail.includes("ENOENT") ? "SANDBOX_UNAVAILABLE" : "START_FAILED",
        detail,
      );
    }
  }

  private attach(): void {
    const child = spawn(
      "docker",
      ["start", "--attach", "--interactive", this.containerName],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child = child;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    child.stderr.on("data", (chunk: string) => {
      this.stderrBytes += Buffer.byteLength(chunk);
      this.stderr = (this.stderr + chunk).slice(-this.limits.outputBytes);
      if (this.stderrBytes > this.limits.outputBytes) {
        this.fail(
          new SandboxError(
            "OUTPUT_LIMIT",
            "Executable diagnostic output limit exceeded.",
          ),
        );
      }
    });
    child.on("error", (error) =>
      this.fail(new SandboxError("SANDBOX_UNAVAILABLE", error.message)),
    );
    child.on("exit", (code, signal) => {
      if (!this.closed && !this.terminalError) {
        this.fail(
          new SandboxError(
            "EXECUTABLE_FAILED",
            `Executable exited with code ${code ?? "none"}, signal ${signal ?? "none"}: ${this.stderr}`,
          ),
        );
      }
    });
  }

  private onStdout(chunk: string): void {
    this.stdout += chunk;
    if (Buffer.byteLength(this.stdout) > this.limits.outputBytes) {
      this.fail(
        new SandboxError("OUTPUT_LIMIT", "Executable output limit exceeded."),
      );
      return;
    }
    const newline = this.stdout.indexOf("\n");
    if (newline < 0 || !this.pending) return;

    const line = this.stdout.slice(0, newline);
    this.stdout = this.stdout.slice(newline + 1);
    const pending = this.pending;
    this.pending = undefined;
    try {
      pending.resolve(JSON.parse(line));
    } catch {
      pending.reject(
        new SandboxError("PROTOCOL_ERROR", "Executable returned invalid JSON."),
      );
    }
  }

  private fail(error: SandboxError): void {
    if (this.terminalError) return;
    this.terminalError = error;
    this.pending?.reject(error);
    this.pending = undefined;
    void this.close();
  }

  async infer(request: string[]): Promise<unknown> {
    if (this.terminalError) throw this.terminalError;
    if (!this.child || this.closed) {
      throw new SandboxError("EXECUTABLE_FAILED", "Executable is not running.");
    }
    if (this.pending) {
      throw new SandboxError(
        "PROTOCOL_ERROR",
        "Concurrent inference is unsupported.",
      );
    }
    if (this.stdout.includes("\n")) {
      throw new SandboxError(
        "PROTOCOL_ERROR",
        "Executable emitted an unsolicited response.",
      );
    }

    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new SandboxError(
          "TIME_LIMIT",
          "Inference time limit exceeded.",
        );
        this.fail(error);
        reject(error);
      }, this.limits.inferenceTimeoutMs);
      timer.unref();
      this.pending = {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.child!.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (error)
          this.fail(new SandboxError("EXECUTABLE_FAILED", error.message));
      });
      this.onStdout("");
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.child?.stdin.destroy();
    this.child?.kill("SIGKILL");
    await execFileAsync("docker", ["rm", "--force", this.containerName]).catch(
      () => undefined,
    );
    await execFileAsync("docker", ["rm", "--force", this.loaderName]).catch(
      () => undefined,
    );
    await execFileAsync("docker", [
      "volume",
      "rm",
      "--force",
      this.volumeName,
    ]).catch(() => undefined);
  }
}
