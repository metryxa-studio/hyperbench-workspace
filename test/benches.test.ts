import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod, rm, access } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { Workspace } from "../src/core/workspace.ts";
import { BENCH_TEST_COMMAND, MAX_BENCH_OUTPUT_BYTES, benchSettings, runBenchCommand } from "../src/core/benches.ts";
import type { BenchCommandResult, Project, TestBench } from "../src/types.ts";

const run = promisify(execFile);
const posix = { skip: process.platform === "win32" ? "Executable script fixtures require POSIX." : false };

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "hyperbench-benches-"));
  const data = join(root, "state");
  const workspace = new Workspace(data);
  t.after(async () => {
    workspace.close();
    await rm(root, { recursive: true, force: true });
  });
  const project = await workspace.call("projects.create", { name: "Bench project" }) as Project;
  const other = await workspace.call("projects.create", { name: "Other project" }) as Project;
  const call = <T = any>(method: string, args: object = {}) =>
    workspace.call(method, { projectId: project.id, ...args }) as Promise<T>;
  const add = (args: object = {}) => call<TestBench>("benches.add", { name: "Controller", host: "bench-alias", ...args });
  return { root, data, workspace, project, other, call, add };
}

async function fakeSsh(root: string): Promise<string> {
  const bin = join(root, "bin");
  await mkdir(bin);
  const path = join(bin, "ssh");
  await writeFile(path, `#!${process.execPath}
const args = process.argv.slice(2);
const command = args.at(-1);
if (command === 'nonzero') {
  process.stdout.write('partial result'); process.stderr.write('device failed'); process.exitCode = 7;
} else if (command === 'timeout') {
  process.on('SIGTERM', () => {}); process.stdout.write('started'); setInterval(() => {}, 100);
} else if (command === 'flood') {
  process.stdout.write(Buffer.alloc(200000, 'a')); process.stderr.write(Buffer.alloc(200000, 'b')); setInterval(() => {}, 100);
} else if (command === 'binary') {
  process.stdout.write(Buffer.alloc(100000, 255)); process.stderr.write(Buffer.alloc(100000, 255));
} else {
  process.stdout.write(JSON.stringify(args));
}
`);
  await chmod(path, 0o700);
  return path;
}

test("benches persist settings, isolate projects and cascade with project deletion", async (t) => {
  const f = await fixture(t);
  const bench = await f.add({ identityFile: "~/.ssh/id_ed25519", knownHostsFile: join(f.root, "trusted hosts"), password: "NEVER_STORE_THIS" });
  assert.equal(bench.enabled, false);
  assert.equal(bench.port, 22);
  assert.equal(bench.revision, 0);
  assert.equal(bench.description, "");
  assert.equal(bench.identityFile, join(homedir(), ".ssh/id_ed25519"));
  assert.equal("password" in bench, false);
  const connection = new Workspace(f.data);
  try {
    assert.deepEqual(await connection.call("benches.list", { projectId: f.project.id }), [bench]);
    assert.deepEqual(await connection.call("benches.list", { projectId: f.other.id }), []);
    for (const method of ["benches.test", "benches.execute", "benches.remove", "benches.update"])
      await assert.rejects(connection.call(method, { projectId: f.other.id, benchId: bench.id, expectedRevision: 0, ...benchSettings({ ...bench, name: "Hijack" }) }), /in this project/);
  } finally {
    connection.close();
  }
  await assert.rejects(f.call("benches.execute", { benchId: bench.id, command: "true" }), /disabled/);
  await f.call("projects.delete");
  const database = new DatabaseSync(join(f.data, "workspace.sqlite"));
  try {
    assert.equal(database.prepare("SELECT count(*) AS count FROM benches").get()?.count, 0);
  } finally {
    database.close();
  }
});

test("bench edits and removal require the latest revision", async (t) => {
  const f = await fixture(t);
  const bench = await f.add();
  const changes = { ...bench, benchId: bench.id, enabled: true, name: "Enabled controller" };
  await assert.rejects(f.call("benches.update", changes), /revision/);
  await assert.rejects(f.call("benches.remove", { benchId: bench.id }), /revision/);
  const updated = await f.call<TestBench>("benches.update", { ...changes, expectedRevision: 0 });
  assert.equal(updated.revision, 1);
  assert.equal(updated.enabled, true);
  assert.equal(updated.createdAt, bench.createdAt);
  await assert.rejects(f.call("benches.update", { ...changes, expectedRevision: 0 }), /Revision conflict/);
  await assert.rejects(f.call("benches.remove", { benchId: bench.id, expectedRevision: 0 }), /Revision conflict/);
  assert.deepEqual(await f.call("benches.remove", { benchId: bench.id, expectedRevision: 1 }), { ok: true });
  assert.deepEqual(await f.call("benches.list"), []);
});

test("concurrent processes cannot both update the same bench revision", async (t) => {
  const f = await fixture(t);
  const bench = await f.add();
  const moduleUrl = new URL("../src/core/workspace.ts", import.meta.url).href;
  const script = `import {Workspace} from ${JSON.stringify(moduleUrl)}; const w = new Workspace(process.argv[1]); try { const b = JSON.parse(process.argv[2]); console.log(JSON.stringify(await w.call('benches.update',{...b,benchId:b.id,name:process.argv[3],expectedRevision:0}))); } catch(e) { console.log(JSON.stringify({error:e.message})); } finally { w.close(); }`;
  const results = await Promise.all(["First", "Second"].map((name) => run(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, f.data, JSON.stringify(bench), name])));
  const values = results.map((result) => JSON.parse(result.stdout));
  assert.equal(values.filter((value) => value.revision === 1).length, 1);
  assert.equal(values.filter((value) => /Revision conflict/.test(value.error)).length, 1);
});

test("SSH settings reject malformed types, option injection and SSH path expansion", async (t) => {
  const f = await fixture(t);
  const invalid = [
    { host: "-oProxyCommand=touch x" }, { host: "a;touch x" }, { host: "user@host" },
    { host: "example.test:2222" }, { host: "a\nHost *" }, { host: ["localhost"] },
    { username: "-o" }, { username: "a;true" }, { username: ["root"] },
    { port: "22" }, { port: 0 }, { port: 65536 }, { port: 1.5 }, { port: null },
    { enabled: "false" }, { enabled: 1 }, { enabled: null },
    { identityFile: "relative/key" }, { identityFile: "/key%h" }, { identityFile: "/${HOME}/key" },
    { identityFile: "/key\nfile" }, { knownHostsFile: [] }, { knownHostsFile: "hosts" },
    { description: null }, { name: ["Controller"] },
  ];
  for (const settings of invalid) await assert.rejects(f.add(settings), JSON.stringify(settings));
  for (const host of ["127.0.0.1", "::1", "fe80::1234", "bench_alias", "bench.example.test"])
    assert.equal((await f.add({ host })).host, host);
  assert.equal((await f.add({ username: "", identityFile: "", knownHostsFile: "" })).username, undefined);
});

test("SSH passes commands as one literal argument with noninteractive safe overrides", posix, async (t) => {
  const f = await fixture(t);
  const executable = await fakeSsh(f.root);
  const marker = join(f.root, "must-not-exist");
  const bench = await f.add({ enabled: true, port: 2222, username: "test-user", identityFile: "/keys/test key", knownHostsFile: "/keys/trusted hosts" });
  const command = `printf test; touch '${marker}'; $(echo injected)`;
  const result = await runBenchCommand(bench, command, 5, executable);
  const args = JSON.parse(result.stdout) as string[];
  assert.deepEqual(args.slice(-3), ["--", "bench-alias", command]);
  for (const option of ["BatchMode=yes", "StrictHostKeyChecking=yes", "UpdateHostKeys=no", "PasswordAuthentication=no", "KbdInteractiveAuthentication=no", "ForwardAgent=no", "ForwardX11=no", "ClearAllForwardings=yes", "PermitLocalCommand=no", "LocalCommand=none", "RemoteCommand=none", "ControlMaster=no", "ControlPath=none", "ControlPersist=no", "RequestTTY=no", 'UserKnownHostsFile="/keys/trusted hosts"'])
    assert.ok(args.includes(option), option);
  assert.equal(args[args.indexOf("-p") + 1], "2222");
  assert.equal(args[args.indexOf("-l") + 1], "test-user");
  assert.equal(args[args.indexOf("-i") + 1], "/keys/test key");
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.truncated, false);
  await assert.rejects(access(marker));
});

test("probe works while disabled and execution uses the stored bench", posix, async (t) => {
  const f = await fixture(t);
  const executable = await fakeSsh(f.root);
  const oldPath = process.env.PATH;
  process.env.PATH = `${join(f.root, "bin")}:${oldPath ?? ""}`;
  try {
    const bench = await f.add();
    const tested = await f.call<BenchCommandResult>("benches.test", { benchId: bench.id, command: "ignored" });
    assert.equal(tested.command, BENCH_TEST_COMMAND);
    assert.equal(JSON.parse(tested.stdout).at(-1), BENCH_TEST_COMMAND);
    await f.call("benches.update", { ...bench, benchId: bench.id, enabled: true, expectedRevision: 0 });
    const executed = await f.call<BenchCommandResult>("benches.execute", { benchId: bench.id, command: "nonzero", host: "untrusted-override" });
    assert.equal(executed.exitCode, 7);
    assert.equal(executed.stdout, "partial result");
    assert.equal(executed.stderr, "device failed");
    assert.equal(executed.benchId, bench.id);
    for (const timeoutSeconds of [0, 301, "30", null, 0.5])
      await assert.rejects(f.call("benches.execute", { benchId: bench.id, command: "true", timeoutSeconds }), /timeout/);
    for (const command of ["", "\0", ["true"], "a".repeat(32_769)])
      await assert.rejects(runBenchCommand(bench, command, 1, executable), /command/);
  } finally {
    process.env.PATH = oldPath;
  }
});

test("SSH preserves nonzero results, bounds combined output and terminates overdue processes", posix, async (t) => {
  const f = await fixture(t);
  const executable = await fakeSsh(f.root);
  const bench = await f.add();
  const nonzero = await runBenchCommand(bench, "nonzero", 5, executable);
  assert.equal(nonzero.exitCode, 7);
  assert.equal(nonzero.stderr, "device failed");
  const flood = await runBenchCommand(bench, "flood", 5, executable);
  assert.equal(flood.truncated, true);
  assert.ok(Buffer.byteLength(flood.stdout) + Buffer.byteLength(flood.stderr) <= MAX_BENCH_OUTPUT_BYTES);
  assert.equal(flood.timedOut, false);
  const binary = await runBenchCommand(bench, "binary", 5, executable);
  assert.equal(binary.truncated, true);
  assert.ok(Buffer.byteLength(binary.stdout) + Buffer.byteLength(binary.stderr) <= MAX_BENCH_OUTPUT_BYTES);
  const timeout = await runBenchCommand(bench, "timeout", 1, executable);
  assert.equal(timeout.timedOut, true);
  assert.equal(timeout.stdout, "started");
  assert.ok(timeout.durationMs >= 1000 && timeout.durationMs < 4000);
  await assert.rejects(runBenchCommand(bench, "true", 1, join(f.root, "missing-ssh")), /OpenSSH could not start/);
});
