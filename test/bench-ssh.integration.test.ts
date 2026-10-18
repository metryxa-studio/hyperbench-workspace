import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Workspace } from "../src/core/workspace.ts";
import type { BenchCommandResult, Project, TestBench } from "../src/types.ts";
const configPath = process.env.HYPERBENCH_SSH_TEST_CONFIG;
test("real SSH bench works through workspace and stdio MCP", {
  skip: !configPath,
  timeout: 40_000,
}, async () => {
  const settings = JSON.parse(await readFile(configPath!, "utf8"));
  const directory = await mkdtemp(path.join(tmpdir(), "hb-real-ssh-"));
  const workspace = new Workspace(directory);
  const client = new Client({ name: "ssh-integration", version: "1.0.0" });
  let transport: StdioClientTransport | undefined;
  try {
    const project = await workspace.call("projects.create", { name: "SSH test" }) as Project;
    const bench = await workspace.call("benches.add", {
      ...settings, projectId: project.id, name: "Disposable SSH bench", enabled: false,
    }) as TestBench;
    const args = { projectId: project.id, benchId: bench.id };
    const probe = await workspace.call("benches.test", args) as BenchCommandResult;
    assert.equal(probe.exitCode, 0, probe.stderr);
    assert.ok(probe.stdout.trim());
    await assert.rejects(workspace.call("benches.execute", { ...args, command: "printf unsafe" }), /enabled|disabled/i);
    await workspace.call("benches.update", {
      ...bench, ...args, expectedRevision: bench.revision, enabled: true,
    });

    transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", path.resolve("src/cli.ts"), "mcp", "--data-dir", directory, "--project", project.id],
      stderr: "pipe",
    });
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    assert.ok(tools.some(tool => tool.name === "bench_execute"));
    const listed = await client.callTool({ name: "list_benches", arguments: { projectId: project.id } });
    assert.equal(JSON.parse((listed.content as { text: string }[])[0].text)[0].id, bench.id);
    const output = await client.callTool({ name: "bench_execute", arguments: {
      ...args, command: "printf 'ssh-stdout\\n'; printf 'ssh-stderr\\n' >&2; exit 7",
    } });
    const result = JSON.parse((output.content as { text: string }[])[0].text) as BenchCommandResult;
    assert.equal(result.stdout, "ssh-stdout\n");
    assert.equal(result.stderr, "ssh-stderr\n");
    assert.equal(result.exitCode, 7);
    assert.equal(result.timedOut, false);

    const deadline = await workspace.call("benches.execute", {
      ...args, command: "sleep 3", timeoutSeconds: 1,
    }) as BenchCommandResult;
    assert.equal(deadline.timedOut, true);
    assert.ok(deadline.durationMs < 5000);
    const large = await workspace.call("benches.execute", {
      ...args, command: "yes hyperbench-output", timeoutSeconds: 5,
    }) as BenchCommandResult;
    assert.equal(large.truncated, true);
    assert.ok(Buffer.byteLength(large.stdout + large.stderr) <= 256 * 1024);

    const unknownHosts = path.join(directory, "empty-known-hosts");
    await writeFile(unknownHosts, "", { mode: 0o600 });
    const untrusted = await workspace.call("benches.add", {
      ...settings, projectId: project.id, name: "Untrusted host", knownHostsFile: unknownHosts,
    }) as TestBench;
    const refused = await workspace.call("benches.test", {
      projectId: project.id, benchId: untrusted.id,
    }) as BenchCommandResult;
    assert.notEqual(refused.exitCode, 0);
    assert.match(refused.stderr, /host key verification|strict checking/i);
  } finally {
    await client.close();
    await transport?.close();
    workspace.close();
    await rm(directory, { recursive: true, force: true });
  }
});
