import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, type WorkspaceTools } from "../src/mcp.js";
import { startBrowserServer } from "../src/server.js";

async function withClient(
  workspace: WorkspaceTools,
  run: (client: Client) => Promise<void>,
) {
  const server = createMcpServer(workspace);
  const client = new Client({ name: "protocol-regression", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

test("MCP project inventories enforce the same response limit as retrieval tools", async () => {
  const projects = Array.from({ length: 10_000 }, (_, index) => ({
    id: String(index),
    name: "x".repeat(200),
  }));
  await withClient(
    {
      async call(method) {
        return method === "projects.list" || method === "documents.list"
          ? projects
          : [];
      },
    },
    async (client) => {
      for (const name of ["list_projects", "project_context"]) {
        const result = await client.callTool({
          name,
          arguments: name === "list_projects" ? {} : { projectId: "project" },
        });
        assert.equal(result.isError, true, name);
        assert.match(
          (result.content as { text: string }[])[0].text,
          /response limit/,
        );
        assert.ok(JSON.stringify(result).length < 1000);
      }
    },
  );
});

test("MCP response limit counts UTF-8 bytes rather than UTF-16 characters", async () => {
  await withClient(
    {
      async call() {
        return { text: "界".repeat(750_000) };
      },
    },
    async (client) => {
      const result = await client.callTool({
        name: "document_read",
        arguments: { projectId: "project", documentId: "document" },
      });
      assert.equal(result.isError, true);
      assert.match(
        (result.content as { text: string }[])[0].text,
        /response limit/,
      );
    },
  );
});

test("MCP file and search tools retain repository-relative directory scopes", async () => {
  const calls: { method: string; directory: unknown }[] = [];
  await withClient(
    {
      async call(method, args) {
        calls.push({ method, directory: args.directory });
        return {};
      },
    },
    async (client) => {
      await client.callTool({
        name: "repository_files",
        arguments: {
          projectId: "project",
          repositoryId: "repository",
          directory: "src/drivers",
        },
      });
      await client.callTool({
        name: "source_search",
        arguments: {
          projectId: "project",
          repositoryId: "repository",
          query: "sensor",
          directory: "src/drivers",
        },
      });
    },
  );
  assert.deepEqual(calls, [
    { method: "repositories.files", directory: "src/drivers" },
    { method: "repositories.search", directory: "src/drivers" },
  ]);
});

test("browser shutdown releases unfinished uploads and can be called twice", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "hb-shutdown-"));
  await writeFile(path.join(directory, "index.html"), "<h1>Workspace</h1>");
  let calls = 0;
  const local = await startBrowserServer(
    {
      async call() {
        calls++;
        return {};
      },
      async documentFile() {
        throw new Error("Not used");
      },
    },
    {
      dataDir: directory,
      uiDir: directory,
      cliPath: "/cli.js",
      nodePath: process.execPath,
    },
  );
  const address = new URL(local.origin);
  const socket = net.connect(Number(address.port), address.hostname);
  socket.on("error", () => {});
  try {
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    const received = new Promise<void>((resolve) =>
      local.server.once("request", () => resolve()),
    );
    socket.write(
      `POST /api/call HTTP/1.1\r\nHost: ${address.host}\r\nAuthorization: Bearer ${local.token}\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{`,
    );
    await received;
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.all([local.close(), local.close()]),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Shutdown did not finish")),
            2500,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    assert.equal(calls, 0);
  } finally {
    socket.destroy();
    await local.close();
    await rm(directory, { recursive: true, force: true });
  }
});
