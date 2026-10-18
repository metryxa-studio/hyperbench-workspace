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
test("MCP can propose drafts but exposes no save, accept, delete or shell tool", async () => {
  const x = await connected("a");
  try {
    const tools = await x.client.listTools();
    assert.equal(
      tools.tools.filter((t) => t.annotations?.readOnlyHint === false).length,
      1,
    );
    assert.equal(
      tools.tools.some((t) => /save|accept|delete|shell|execute/.test(t.name)),
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
