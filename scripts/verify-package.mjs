import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const fromRegistry = process.argv[2] === "--registry";
const packageSpec = fromRegistry
  ? process.argv[3] || "hyperbench-workspace"
  : path.resolve(process.argv[2] || "hyperbench-workspace-0.1.1.tgz");
const root = await mkdtemp(path.join(tmpdir(), "hyperbench package check "));
const cli = path.join(
  root,
  "node_modules/hyperbench-workspace/bin/hyperbench.mjs",
);
const state = path.join(root, "local state");
let server, client, transport;
try {
  execFileSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    [
      "install",
      "--prefix",
      root,
      packageSpec,
      "--registry=https://registry.npmjs.org",
      "--prefer-online",
    ],
    { stdio: "pipe", shell: process.platform === "win32" },
  );
  const doctor = JSON.parse(
    execFileSync(process.execPath, [cli, "doctor", "--data-dir", state], {
      encoding: "utf8",
    }),
  );
  assert.equal(doctor.ok, true);
  assert.equal(doctor.codeIndexer, false);
  const destination = path.join(root, "agent skills");
  execFileSync(process.execPath, [cli, "skills", "--destination", destination]);
  assert.throws(() =>
    execFileSync(
      process.execPath,
      [cli, "skills", "--destination", destination],
      { stdio: "pipe" },
    ),
  );
  const config = JSON.parse(
    execFileSync(
      process.execPath,
      [cli, "connect", "generic", "--data-dir", state],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ),
  );
  server = spawn(
    process.execPath,
    [cli, "start", "--no-open", "--data-dir", state],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error("Packaged browser server did not start")),
      10000,
    );
    server.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited: ${code}`));
    });
    server.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#[^\s]+/);
      if (match) {
        clearTimeout(timeout);
        resolve(new URL(match[0]));
      }
    });
  });
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${new URLSearchParams(url.hash.slice(1)).get("token")}`,
    origin: url.origin,
  };
  const call = async (method, args = {}) => {
    const response = await fetch(`${url.origin}/api/call`, {
      method: "POST",
      headers,
      body: JSON.stringify({ method, args }),
    });
    const body = await response.json();
    assert.equal(response.ok, true, JSON.stringify(body));
    return body.result;
  };
  assert.equal((await fetch(url.origin)).status, 200);
  const project = await call("projects.create", { name: "Package check" });
  const repoPath = path.join(root, "firmware");
  await mkdir(repoPath);
  await writeFile(path.join(repoPath, "sensor.c"), "int temperature = 42;\n");
  const repo = await call("repositories.add", {
    projectId: project.id,
    path: repoPath,
  });
  const doc = await call("documents.upload", {
    projectId: project.id,
    name: "pins.txt",
    base64: Buffer.from("Pin 3 carries temperature data.").toString("base64"),
  });
  const settings = config.mcpServers.hyperbench;
  transport = new StdioClientTransport({
    command: settings.command,
    args: [...settings.args, "--project", project.id],
    stderr: "pipe",
  });
  client = new Client({ name: "package-check", version: "1.0.0" });
  await client.connect(transport);
  const tool = async (name, args) => {
    const response = await client.callTool({ name, arguments: args });
    assert.notEqual(response.isError, true, JSON.stringify(response));
    return JSON.parse(response.content[0].text);
  };
  assert.equal(
    (
      await tool("source_read", {
        projectId: project.id,
        repositoryId: repo.id,
        path: "sensor.c",
      })
    ).text,
    "int temperature = 42;",
  );
  assert.match(
    (await tool("document_read", { projectId: project.id, documentId: doc.id }))
      .pages[0].text,
    /Pin 3/,
  );
  const system = await tool("system_get", { projectId: project.id });
  system.layout = "truck";
  system.components = [
    {
      id: "sensor",
      label: "Sensor",
      kind: "hardware",
      description: "",
      x: 0,
      y: 0,
      ports: [],
      evidence: [{ type: "document", documentId: doc.id, page: 1 }],
    },
  ];
  const draft = await tool("propose_system", {
    projectId: project.id,
    baseRevision: 0,
    summary: "Add sensor",
    system,
  });
  assert.equal(
    (await call("system.get", { projectId: project.id })).components.length,
    0,
  );
  await call("drafts.accept", {
    projectId: project.id,
    draftId: draft.id,
    expectedRevision: 0,
  });
  assert.equal(
    (await tool("system_get", { projectId: project.id })).components[0].label,
    "Sensor",
  );
  assert.equal(
    (await tool("system_get", { projectId: project.id })).layout,
    "truck",
  );
  console.log(
    JSON.stringify({
      ok: true,
      node: process.version,
      freshInstall: true,
      pathsWithSpaces: true,
      browserApi: true,
      mcp: true,
      skillInstall: true,
      explicitDraftAcceptance: true,
    }),
  );
} finally {
  await client?.close();
  await transport?.close();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      server.once("exit", resolve);
      setTimeout(() => {
        server.kill("SIGKILL");
        resolve();
      }, 2000).unref();
    });
  }
  await rm(root, { recursive: true, force: true });
}
