import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp.js";
import { Workspace } from "../src/core/workspace.ts";
import {
  SYSTEM_LAYOUTS,
  type Args,
  type Project,
  type SystemDraft,
  type SystemModel,
  type TestBench,
} from "../src/types.js";
async function connected(scope?: string) {
  const calls: { method: string; args: Args }[] = [];
  const server = createMcpServer(
    {
      async call(method, args) {
        calls.push({ method, args });
        if (method === "projects.list")
          return [
            { id: "a", name: "A" },
            { id: "b", name: "B" },
          ];
        if (method === "documents.page")
          return {
            data: "iVBORw0KGgo=",
            mimeType: "image/png",
            page: 1,
            width: 10,
            height: 10,
          };
        if (method === "drafts.propose")
          return { id: "draft", baseRevision: 3 };
        return { ok: true };
      },
    },
    scope,
  );
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    calls,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
test("MCP exposes scoped projects and rejects another project before any read", async () => {
  const x = await connected("a");
  try {
    const listed = await x.client.callTool({
      name: "list_projects",
      arguments: {},
    });
    assert.deepEqual(JSON.parse((listed.content as any)[0].text), [
      { id: "a", name: "A" },
    ]);
    const result = await x.client.callTool({
      name: "source_read",
      arguments: { projectId: "b", repositoryId: "r", path: "README.md" },
    });
    assert.equal(result.isError, true);
    assert.equal(x.calls.length, 1);
  } finally {
    await x.close();
  }
});
test("MCP forwards exact line range to the scoped workspace", async () => {
  const x = await connected("a");
  try {
    await x.client.callTool({
      name: "source_read",
      arguments: {
        projectId: "a",
        repositoryId: "r",
        path: "driver.c",
        startLine: 20,
        endLine: 30,
      },
    });
    assert.deepEqual(x.calls, [
      {
        method: "repositories.read",
        args: {
          projectId: "a",
          repositoryId: "r",
          path: "driver.c",
          startLine: 20,
          endLine: 30,
        },
      },
    ]);
  } finally {
    await x.close();
  }
});
test("MCP exposes draft proposals and bench execution without saved-state management tools", async () => {
  const x = await connected("a");
  try {
    const tools = await x.client.listTools();
    assert.equal(
      tools.tools.filter((t) => t.annotations?.readOnlyHint === false).length,
      2,
    );
    assert.equal(
      tools.tools.some((t) =>
        /save|accept|delete|shell|bench_add|bench_update|bench_remove/.test(t.name),
      ),
      false,
    );
    await x.client.callTool({
      name: "propose_system",
      arguments: {
        projectId: "a",
        baseRevision: 3,
        summary: "Sensor link",
        system: { revision: 3 },
      },
    });
    assert.equal(x.calls[0].method, "drafts.propose");
  } finally {
    await x.close();
  }
});
test("MCP bench execution advertises remote side effects and fixed probes advertise remote access", async () => {
  const x = await connected("a");
  try {
    const tools = (await x.client.listTools()).tools;
    assert.deepEqual(
      tools
        .filter((tool) => tool.name.includes("bench"))
        .map((tool) => tool.name)
        .sort(),
      ["bench_execute", "bench_test", "list_benches"],
    );
    assert.deepEqual(
      tools.find((tool) => tool.name === "bench_execute")?.annotations,
      {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    );
    assert.deepEqual(
      tools.find((tool) => tool.name === "bench_test")?.annotations,
      {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    );
    assert.equal(
      tools.find((tool) => tool.name === "list_benches")?.annotations?.openWorldHint,
      false,
    );
  } finally {
    await x.close();
  }
});
test("MCP project context includes benches and remote tools reject another project before dispatch", async () => {
  const x = await connected("a");
  try {
    const result = await x.client.callTool({
      name: "project_context",
      arguments: { projectId: "a" },
    });
    assert.deepEqual(
      JSON.parse((result.content as { text: string }[])[0]!.text).benches,
      { ok: true },
    );
    assert.ok(x.calls.some((call) => call.method === "benches.list"));
    const count = x.calls.length;
    for (const name of ["list_benches", "bench_test", "bench_execute"]) {
      const rejected = await x.client.callTool({
        name,
        arguments: { projectId: "b", benchId: "bench", command: "printf safe" },
      });
      assert.equal(rejected.isError, true);
      assert.match(
        (rejected.content as { text: string }[])[0]!.text,
        /restricted/u,
      );
    }
    assert.equal(x.calls.length, count);
    const args = {
      projectId: "a",
      benchId: "bench",
      command: "printf safe",
      timeoutSeconds: 12,
    };
    await x.client.callTool({ name: "bench_execute", arguments: args });
    assert.deepEqual(x.calls.at(-1), {
      method: "benches.execute",
      args,
    });
  } finally {
    await x.close();
  }
});
test("MCP rejects invalid bench commands and timeout bounds before dispatch", async () => {
  const x = await connected("a");
  try {
    for (const args of [
      { command: "" },
      { command: "x".repeat(32_769) },
      { command: "true", timeoutSeconds: 0 },
      { command: "true", timeoutSeconds: 301 },
      { command: "true", timeoutSeconds: 1.5 },
    ]) {
      const result = await x.client.callTool({
        name: "bench_execute",
        arguments: { projectId: "a", benchId: "bench", ...args },
      });
      assert.equal(result.isError, true);
    }
    assert.equal(x.calls.length, 0);
  } finally {
    await x.close();
  }
});
test("MCP enforces disabled benches and bench ownership through the real workspace", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "hyperbench-mcp-benches-"));
  const workspace = new Workspace(directory);
  const project = (await workspace.call("projects.create", {
    name: "Test bench project",
  })) as Project;
  const other = (await workspace.call("projects.create", {
    name: "Other project",
  })) as Project;
  const bench = (await workspace.call("benches.add", {
    projectId: project.id,
    name: "Disabled bench",
    host: "127.0.0.1",
  })) as TestBench;
  const server = createMcpServer(workspace);
  const client = new Client({ name: "bench-test-agent", version: "1.0.0" });
  t.after(async () => {
    await client.close();
    await server.close();
    workspace.close();
    await rm(directory, { recursive: true, force: true });
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const listed = await client.callTool({
    name: "list_benches",
    arguments: { projectId: project.id },
  });
  assert.deepEqual(
    JSON.parse((listed.content as { text: string }[])[0]!.text),
    JSON.parse(JSON.stringify([bench])),
  );
  const isolated = await client.callTool({
    name: "list_benches",
    arguments: { projectId: other.id },
  });
  assert.deepEqual(
    JSON.parse((isolated.content as { text: string }[])[0]!.text),
    [],
  );
  const disabled = await client.callTool({
    name: "bench_execute",
    arguments: { projectId: project.id, benchId: bench.id, command: "printf safe" },
  });
  assert.equal(disabled.isError, true);
  assert.match(
    (disabled.content as { text: string }[])[0]!.text,
    /disabled|enable/iu,
  );
  for (const name of ["bench_test", "bench_execute"]) {
    const foreign = await client.callTool({
      name,
      arguments: { projectId: other.id, benchId: bench.id, command: "printf safe" },
    });
    assert.equal(foreign.isError, true);
    assert.match(
      (foreign.content as { text: string }[])[0]!.text,
      /not found|project|belong/iu,
    );
  }
});
test("MCP page returns image content and useful page metadata", async () => {
  const x = await connected("a");
  try {
    const result = await x.client.callTool({
      name: "document_page",
      arguments: {
        projectId: "a",
        documentId: "d",
        page: 1,
        crop: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      },
    });
    const content = result.content as any[];
    assert.equal(content[1].type, "image");
    assert.equal(content[1].mimeType, "image/png");
    assert.equal(JSON.parse(content[0].text).page, 1);
  } finally {
    await x.close();
  }
});
test("MCP outline proposals validate against saved state and remain drafts until accepted", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "hyperbench-mcp-layouts-"));
  const workspace = new Workspace(directory);
  const project = (await workspace.call("projects.create", {
    name: "Device outlines",
  })) as Project;
  const server = createMcpServer(workspace, project.id);
  const client = new Client({ name: "outline-test-agent", version: "1.0.0" });
  t.after(async () => {
    await client.close();
    await server.close();
    workspace.close();
    await rm(directory, { recursive: true, force: true });
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const initial = (await workspace.call("system.get", {
    projectId: project.id,
  })) as SystemModel;
  const advertised = (await client.listTools()).tools.find(
    (tool) => tool.name === "propose_system",
  )!;
  for (const layout of SYSTEM_LAYOUTS)
    assert.ok(advertised.description?.includes(layout));
  let latest: SystemDraft | undefined;
  for (const layout of SYSTEM_LAYOUTS) {
    const result = await client.callTool({
      name: "propose_system",
      arguments: {
        projectId: project.id,
        baseRevision: initial.revision,
        summary: `Use the ${layout} outline`,
        system: { ...initial, layout },
      },
    });
    assert.notEqual(result.isError, true);
    latest = JSON.parse(
      (result.content as { text: string }[])[0]!.text,
    ) as SystemDraft;
    assert.deepEqual(latest.system, { ...initial, layout });
    assert.deepEqual(
      await workspace.call("system.get", { projectId: project.id }),
      initial,
    );
  }
  const draftCount = (
    (await workspace.call("drafts.list", {
      projectId: project.id,
    })) as SystemDraft[]
  ).length;
  for (const layout of ["unsupported-outline", null, ["robot-arm"]]) {
    const result = await client.callTool({
      name: "propose_system",
      arguments: {
        projectId: project.id,
        baseRevision: initial.revision,
        summary: "Invalid outline",
        system: { ...initial, layout },
      },
    });
    assert.equal(result.isError, true);
    assert.match(
      (result.content as { text: string }[])[0]!.text,
      /System layout/u,
    );
  }
  assert.equal(
    (
      (await workspace.call("drafts.list", {
        projectId: project.id,
      })) as SystemDraft[]
    ).length,
    draftCount,
  );
  const accepted = (await workspace.call("drafts.accept", {
    projectId: project.id,
    draftId: latest!.id,
    expectedRevision: initial.revision,
  })) as SystemModel;
  assert.equal(accepted.layout, latest!.system.layout);
  assert.equal(accepted.revision, initial.revision + 1);
  const stale = await client.callTool({
    name: "propose_system",
    arguments: {
      projectId: project.id,
      baseRevision: initial.revision,
      summary: "Outdated outline",
      system: { ...initial, layout: "robot-arm" },
    },
  });
  assert.equal(stale.isError, true);
  assert.match(
    (stale.content as { text: string }[])[0]!.text,
    /Revision conflict/u,
  );
  const current = await client.callTool({
    name: "system_get",
    arguments: { projectId: project.id },
  });
  assert.deepEqual(
    JSON.parse((current.content as { text: string }[])[0]!.text),
    accepted,
  );
});
test("MCP validates limits and page numbers before workspace calls", async () => {
  const x = await connected("a");
  try {
    const result = await x.client.callTool({
      name: "document_page",
      arguments: { projectId: "a", documentId: "d", page: 0 },
    });
    assert.equal(result.isError, true);
    assert.equal(x.calls.length, 0);
  } finally {
    await x.close();
  }
});
test("MCP prompt respects project boundary", async () => {
  const x = await connected("a");
  try {
    await assert.rejects(
      () =>
        x.client.getPrompt({
          name: "hardware_trace",
          arguments: { projectId: "b", question: "trace sensor" },
        }),
      /restricted/,
    );
    const prompt = await x.client.getPrompt({
      name: "hardware_trace",
      arguments: { projectId: "a", question: "trace sensor" },
    });
    assert.equal(prompt.messages.length, 1);
  } finally {
    await x.close();
  }
});
