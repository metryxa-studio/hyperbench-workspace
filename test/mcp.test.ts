import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp.js";
import type { Args } from "../src/types.js";
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
