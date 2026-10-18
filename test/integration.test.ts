import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Workspace } from "../src/core/workspace.ts";

test("real stdio client retrieves local code/documents and proposes a draft visible to another process", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "hb-stdio-"));
  const workspace = new Workspace(path.join(temp, "state"));
  const client = new Client({
    name: "independent-test-client",
    version: "1.0.0",
  });
  let transport: StdioClientTransport | undefined;
  try {
    const project: any = await workspace.call("projects.create", {
      name: "Controller",
    });
    const other: any = await workspace.call("projects.create", {
      name: "Private other project",
    });
    const root = path.join(temp, "repository");
    await mkdir(root);
    await writeFile(
      path.join(root, "sensor.c"),
      "// sensor driver\nint temperature = 42;\n",
    );
    await writeFile(path.join(root, ".env"), "DO_NOT_RETURN=private_fixture\n");
    const repo: any = await workspace.call("repositories.add", {
      projectId: project.id,
      path: root,
    });
    const doc: any = await workspace.call("documents.upload", {
      projectId: project.id,
      name: "board.txt",
      base64: Buffer.from("Pin 3 carries temperature data.").toString("base64"),
    });
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        "--import",
        "tsx",
        path.resolve("src/cli.ts"),
        "mcp",
        "--data-dir",
        path.join(temp, "state"),
        "--project",
        project.id,
      ],
      stderr: "pipe",
    });
    await client.connect(transport);
    const projects = await client.callTool({
      name: "list_projects",
      arguments: {},
    });
    const items = JSON.parse((projects.content as any)[0].text);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, project.id);
    const context = await client.callTool({
      name: "project_context",
      arguments: { projectId: project.id },
    });
    const parsed = JSON.parse((context.content as any)[0].text);
    assert.equal(parsed.repositories[0].id, repo.id);
    assert.equal(parsed.documents[0].id, doc.id);
    const read = await client.callTool({
      name: "source_read",
      arguments: {
        projectId: project.id,
        repositoryId: repo.id,
        path: "sensor.c",
        startLine: 2,
        endLine: 2,
      },
    });
    assert.equal(
      JSON.parse((read.content as any)[0].text).text,
      "int temperature = 42;",
    );
    const secret = await client.callTool({
      name: "source_read",
      arguments: { projectId: project.id, repositoryId: repo.id, path: ".env" },
    });
    assert.equal(secret.isError, true);
    assert.equal(JSON.stringify(secret).includes("private_fixture"), false);
    const scope = await client.callTool({
      name: "system_get",
      arguments: { projectId: other.id },
    });
    assert.equal(scope.isError, true);
    const evidence = { type: "document", documentId: doc.id, page: 1 };
    const model = {
      ...parsed.system,
      components: [
        {
          id: "sensor",
          label: "Temperature sensor",
          kind: "hardware",
          description: "From board note",
          x: 20,
          y: 30,
          ports: ["3"],
          evidence: [evidence],
        },
      ],
    };
    const proposed = await client.callTool({
      name: "propose_system",
      arguments: {
        projectId: project.id,
        baseRevision: 0,
        summary: "Add documented temperature sensor",
        system: model,
      },
    });
    assert.notEqual(proposed.isError, true);
    const drafts: any = await workspace.call("drafts.list", {
      projectId: project.id,
    });
    assert.equal(drafts.length, 1);
    assert.equal(
      ((await workspace.call("system.get", { projectId: project.id })) as any)
        .components.length,
      0,
    );
    const accepted: any = await workspace.call("drafts.accept", {
      projectId: project.id,
      draftId: drafts[0].id,
      expectedRevision: 0,
    });
    assert.equal(accepted.components[0].label, "Temperature sensor");
    const after = await client.callTool({
      name: "system_get",
      arguments: { projectId: project.id },
    });
    assert.equal(JSON.parse((after.content as any)[0].text).revision, 1);
  } finally {
    await client.close();
    await transport?.close();
    workspace.close();
    await rm(temp, { recursive: true, force: true });
  }
});
