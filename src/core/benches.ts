import { spawn } from "node:child_process";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Args, BenchCommandResult, TestBench } from "../types.ts";

export const MAX_BENCH_OUTPUT_BYTES = 256 * 1024;
export const BENCH_TEST_COMMAND =
  "printf 'Hyperbench SSH connection OK\\n'; uname -s; hostname; pwd";
type BenchSettings = Pick<
  TestBench,
  | "name"
  | "description"
  | "host"
  | "port"
  | "username"
  | "identityFile"
  | "knownHostsFile"
  | "enabled"
>;

function text(
  value: unknown,
  label: string,
  maximum: number,
  empty = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (!empty && !value.trim()) ||
    value.includes("\0")
  )
    throw new Error(
      `${label} must be ${empty ? "text" : "nonempty text"} of at most ${maximum} characters.`,
    );
  return value;
}

function integer(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  return value;
}

function localFile(value: unknown, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  let path = text(value, label, 4096);
  if (/[\x00-\x1f\x7f%]/u.test(path) || path.includes("${"))
    throw new Error(
      `${label} must not contain control characters or SSH expansion tokens.`,
    );
  if (path.startsWith("~/")) path = join(homedir(), path.slice(2));
  if (!isAbsolute(path))
    throw new Error(
      `${label} must be an absolute local path or start with ~/.`,
    );
  return normalize(path);
}

export function benchSettings(args: Args): BenchSettings {
  const host = text(args.host, "SSH host", 253).trim();
  if (!isIP(host) && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u.test(host))
    throw new Error(
      "SSH host must be a hostname, IP address, or SSH-config alias, without a username, port, or shell characters.",
    );
  let username: string | undefined;
  if (args.username !== undefined && args.username !== "") {
    username = text(args.username, "SSH username", 64);
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/u.test(username))
      throw new Error("SSH username contains unsupported characters.");
  }
  if (args.enabled !== undefined && typeof args.enabled !== "boolean")
    throw new Error("Bench enabled must be a boolean.");
  return {
    name: text(args.name, "Bench name", 200).trim(),
    description:
      args.description === undefined
        ? ""
        : text(args.description, "Bench description", 20_000, true),
    host,
    port:
      args.port === undefined ? 22 : integer(args.port, "SSH port", 1, 65535),
    username,
    identityFile: localFile(args.identityFile, "SSH identity file"),
    knownHostsFile: localFile(args.knownHostsFile, "SSH known-hosts file"),
    enabled: args.enabled ?? false,
  };
}

export function benchRevision(value: unknown): number {
  return integer(
    value,
    "Expected bench revision",
    0,
    Number.MAX_SAFE_INTEGER - 1,
  );
}

function sshArguments(bench: TestBench, command: string): string[] {
  const options = [
    "BatchMode=yes",
    "StrictHostKeyChecking=yes",
    "UpdateHostKeys=no",
    "PasswordAuthentication=no",
    "KbdInteractiveAuthentication=no",
    "PreferredAuthentications=publickey",
    "NumberOfPasswordPrompts=0",
    "ForwardAgent=no",
    "ForwardX11=no",
    "ForwardX11Trusted=no",
    "ClearAllForwardings=yes",
    "Tunnel=no",
    "PermitLocalCommand=no",
    "LocalCommand=none",
    "RemoteCommand=none",
    "RequestTTY=no",
    "SessionType=default",
    "ControlMaster=no",
    "ControlPath=none",
    "ControlPersist=no",
    "ForkAfterAuthentication=no",
    "EscapeChar=none",
    "ConnectTimeout=10",
    "ConnectionAttempts=1",
    "ServerAliveInterval=5",
    "ServerAliveCountMax=1",
    "LogLevel=ERROR",
  ];
  if (bench.knownHostsFile) {
    const path = bench.knownHostsFile
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"');
    options.push(`UserKnownHostsFile="${path}"`);
  }
  const args = [
    "-T",
    "-n",
    ...options.flatMap((option) => ["-o", option]),
    "-p",
    String(bench.port),
  ];
  if (bench.username) args.push("-l", bench.username);
  if (bench.identityFile) args.push("-i", bench.identityFile);
  args.push("--", bench.host, command);
  return args;
}

function boundedText(text: string, maximum: number): string {
  const encoded = Buffer.from(text, "utf8");
  return new StringDecoder("utf8").write(encoded.subarray(0, maximum));
}
export async function runBenchCommand(
  bench: TestBench,
  value: unknown,
  timeoutValue: unknown = 30,
  executable = "ssh",
): Promise<BenchCommandResult> {
  const command = text(value, "Bench command", 32_768);
  const timeoutSeconds = integer(timeoutValue, "Bench timeout", 1, 300);
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, sshArguments(bench, command), {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    let bytes = 0,
      timedOut = false,
      truncated = false,
      stopping = false,
      settled = false;
    let exitCode: number | null = null,
      signal: string | null = null;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutSeconds * 1000);

    function kill(kind: NodeJS.Signals): void {
      if (!child.pid) return;
      try {
        if (process.platform !== "win32") process.kill(-child.pid, kind);
        else child.kill(kind);
      } catch {}
    }
    function finish(): void {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (forceTimer) clearTimeout(forceTimer);
      const decodedOut = Buffer.concat(stdout).toString("utf8");
      const decodedErr = Buffer.concat(stderr).toString("utf8");
      if (
        Buffer.byteLength(decodedOut) + Buffer.byteLength(decodedErr) >
        MAX_BENCH_OUTPUT_BYTES
      )
        truncated = true;
      const out = boundedText(decodedOut, MAX_BENCH_OUTPUT_BYTES);
      const err = boundedText(
        decodedErr,
        MAX_BENCH_OUTPUT_BYTES - Buffer.byteLength(out),
      );
      resolve({
        benchId: bench.id,
        command,
        stdout: out,
        stderr: err,
        exitCode,
        signal,
        timedOut,
        truncated,
        durationMs: Math.round(performance.now() - started),
      });
    }
    function stop(): void {
      if (stopping || settled) return;
      stopping = true;
      kill("SIGTERM");
      forceTimer = setTimeout(() => {
        kill("SIGKILL");
        child.stdout.destroy();
        child.stderr.destroy();
        exitCode = child.exitCode;
        signal = child.signalCode;
        finish();
      }, 500);
    }
    function receive(chunk: Buffer, output: Buffer[]): void {
      if (settled) return;
      const remaining = MAX_BENCH_OUTPUT_BYTES - bytes;
      const kept = chunk.subarray(0, remaining);
      if (kept.length) output.push(kept);
      bytes += kept.length;
      if (chunk.length > remaining) {
        truncated = true;
        stop();
      }
    }
    child.stdout.on("data", (chunk: Buffer) => receive(chunk, stdout));
    child.stderr.on("data", (chunk: Buffer) => receive(chunk, stderr));
    child.once("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (forceTimer) clearTimeout(forceTimer);
      reject(
        new Error(
          "OpenSSH could not start. Install the ssh command and ensure it is available on PATH.",
        ),
      );
    });
    child.once("close", (code, closedSignal) => {
      exitCode = code;
      signal = closedSignal;
      if (!stopping) finish();
    });
  });
}
