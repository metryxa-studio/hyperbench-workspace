import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  rename,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { Workspace } from "../src/core/workspace.ts";
import { SYSTEM_LAYOUTS } from "../src/types.ts";
import type {
  DocumentSummary,
  Project,
  Repository,
  SourceRead,
  SystemDraft,
  SystemModel,
} from "../src/types.ts";

const run = promisify(execFile);
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "hyperbench-core-"));
  const source = join(root, "source");
  await mkdir(source);
  const data = join(root, "state");
  const workspace = new Workspace(data);
  const connections = [workspace];
  const connect = () => {
    const connection = new Workspace(data);
    connections.push(connection);
    return connection;
  };
  t.after(async () => {
    for (const connection of connections) connection.close();
    await rm(root, { recursive: true, force: true });
  });
  const project = (await workspace.call("projects.create", {
    name: "Flight controller",
  })) as Project;
  const project2 = (await workspace.call("projects.create", {
    name: "Independent project",
  })) as Project;
  const repository = (await workspace.call("repositories.add", {
    projectId: project.id,
    path: source,
  })) as Repository;
  const call = <T = any>(method: string, args: object = {}) =>
    workspace.call(method, { projectId: project.id, ...args }) as Promise<T>;
  return {
    root,
    source,
    data,
    workspace,
    project,
    project2,
    repository,
    call,
    connect,
  };
}
function model(title = "Flight system"): SystemModel {
  return {
    revision: 0,
    title,
    layout: "quadrotor",
    components: [
      {
        id: "fc",
        label: "Flight controller",
        kind: "hardware",
        description: "Control board",
        x: 50,
        y: 100,
        ports: ["motor"],
        evidence: [],
      },
      {
        id: "motor",
        label: "Motor",
        kind: "hardware",
        description: "",
        x: 300,
        y: 100,
        ports: ["pwm"],
        evidence: [],
      },
    ],
    connections: [
      {
        id: "pwm",
        from: "fc",
        to: "motor",
        fromPort: "motor",
        toPort: "pwm",
        label: "PWM",
        evidence: [],
      },
    ],
    links: [],
  };
}

test("projects and links persist; project deletion never deletes source directories", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.source, "main.cpp"), "int flight_controller;\n");
  const duplicate = await f.call<Repository>("repositories.add", {
    path: f.source,
  });
  assert.equal(duplicate.id, f.repository.id);
  await f.call("projects.rename", { name: "Autopilot" });
  const second = f.connect();
  assert.equal(
    ((await second.call("projects.list")) as Project[]).find(
      (project) => project.id === f.project.id,
    )?.name,
    "Autopilot",
  );
  await f.call("projects.delete");
  assert.equal(
    await readFile(join(f.source, "main.cpp"), "utf8"),
    "int flight_controller;\n",
  );
  await assert.rejects(f.call("repositories.list"), /Project does not exist/u);
  await assert.rejects(
    second.call("system.get", { projectId: f.project.id }),
    /Project does not exist/u,
  );
});

test("repository reads reject traversal, symlinks, binary files, out of bounds and cross-project IDs", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.source, "flight.c"), "one\ntwo\nthree\n");
  await writeFile(join(f.root, "outside.txt"), "private");
  await symlink(join(f.root, "outside.txt"), join(f.source, "link.txt"));
  await symlink(f.root, join(f.source, "outside"));
  await writeFile(join(f.source, "binary.bin"), Buffer.from([0, 1, 2]));
  const read = (path: string, args: object = {}) =>
    f.call<SourceRead>("repositories.read", {
      repositoryId: f.repository.id,
      path,
      ...args,
    });
  const selected = await read("flight.c", { startLine: 2, endLine: 2 });
  assert.deepEqual(
    {
      text: selected.text,
      total: selected.totalLines,
      truncated: selected.truncated,
    },
    { text: "two", total: 3, truncated: true },
  );
  for (const path of [
    "../outside.txt",
    "/etc/passwd",
    "outside/outside.txt",
    "link.txt",
    "binary.bin",
    "a/../flight.c",
    ".git/../flight.c",
    "C:\\windows",
    "flight.c\0",
  ])
    await assert.rejects(read(path));
  await assert.rejects(read("flight.c", { startLine: 0 }), /Start line/u);
  await assert.rejects(read("flight.c", { startLine: 9 }), /exceeds/u);
  await assert.rejects(
    read("flight.c", { startLine: 2, endLine: 1 }),
    /End line/u,
  );
  await assert.rejects(
    read("flight.c", { startLine: 1, endLine: 2001 }),
    /End line/u,
  );
  await assert.rejects(
    f.workspace.call("repositories.read", {
      projectId: f.project2.id,
      repositoryId: f.repository.id,
      path: "flight.c",
    }),
    /in this project/u,
  );
  await assert.rejects(
    f.call("repositories.files", {
      repositoryId: f.repository.id,
      limit: 2001,
    }),
    /File limit/u,
  );
  await assert.rejects(
    f.call("repositories.search", { repositoryId: f.repository.id, query: "" }),
    /Search query/u,
  );
});

test("bounded literal search and file listing reflect current source without an index", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.source, ".git"));
  await mkdir(join(f.source, "node_modules"));
  await writeFile(join(f.source, ".git", "config"), "literal .* secret");
  await writeFile(
    join(f.source, "node_modules", "ignored.js"),
    "literal .* dependency",
  );
  await writeFile(
    join(f.source, "a.txt"),
    "literal .* alpha\nliteral .* beta\n",
  );
  await writeFile(join(f.source, "b.txt"), "literal zz gamma\n");
  await writeFile(join(f.source, "c.bin"), Buffer.from("literal .*\0binary"));
  const files = await f.call("repositories.files", {
    repositoryId: f.repository.id,
    limit: 2,
  });
  assert.deepEqual(files, { paths: ["a.txt", "b.txt"], truncated: true });
  assert.deepEqual(
    await f.call("repositories.files", {
      repositoryId: f.repository.id,
      query: "B.TXT",
    }),
    { paths: ["b.txt"], truncated: false },
  );
  const search = await f.call("repositories.search", {
    repositoryId: f.repository.id,
    query: ".*",
    limit: 1,
  });
  assert.equal(search.hits.length, 1);
  assert.equal(search.hits[0].line, 1);
  assert.equal(search.truncated, true);
  const all = await f.call("repositories.search", {
    repositoryId: f.repository.id,
    query: ".*",
    limit: 10,
  });
  assert.equal(all.hits.length, 2);
  assert.equal(all.truncated, false);
  await writeFile(join(f.source, "b.txt"), "new source change\n");
  assert.equal(
    (
      await f.call("repositories.search", {
        repositoryId: f.repository.id,
        query: "new source change",
      })
    ).hits[0].path,
    "b.txt",
  );
  await f.call("repositories.remove", { repositoryId: f.repository.id });
  assert.equal(
    await readFile(join(f.source, "a.txt"), "utf8"),
    "literal .* alpha\nliteral .* beta\n",
  );
});

test("replacing linked root with a symlink cannot expose another directory", async (t) => {
  const f = await fixture(t);
  await rename(f.source, `${f.source}-original`);
  await symlink(f.root, f.source);
  await assert.rejects(
    f.call("repositories.files", { repositoryId: f.repository.id }),
    /changed/u,
  );
  await assert.rejects(
    f.call("repositories.read", {
      repositoryId: f.repository.id,
      path: "outside.txt",
    }),
    /changed/u,
  );
});

test("source file size and response lengths are bounded", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.source, "large.txt"),
    Buffer.alloc(2 * 1024 * 1024 + 1, "x"),
  );
  await assert.rejects(
    f.call("repositories.read", {
      repositoryId: f.repository.id,
      path: "large.txt",
    }),
    /2 MiB/u,
  );
  await writeFile(join(f.source, "long.txt"), "x".repeat(150_000));
  const result = await f.call<SourceRead>("repositories.read", {
    repositoryId: f.repository.id,
    path: "long.txt",
  });
  assert.equal(result.text.length, 128_000);
  assert.equal(result.truncated, true);
  const search = await f.call("repositories.search", {
    repositoryId: f.repository.id,
    query: "xxx",
  });
  assert.equal(search.hits.length, 1);
  assert.ok(search.hits[0].text.length <= 2001);
});

test("system compare-and-swap survives two connections; drafts do not alter saved model", async (t) => {
  const f = await fixture(t);
  const second = f.connect();
  const initial = await f.call<SystemModel>("system.get");
  assert.equal(initial.revision, 0);
  const draft = await f.call<SystemDraft>("drafts.propose", {
    system: model("Draft"),
    baseRevision: 0,
    summary: "Flight wiring",
  });
  assert.equal((await f.call<SystemModel>("system.get")).title, "System");
  assert.equal(
    (
      (await second.call("drafts.list", {
        projectId: f.project.id,
      })) as SystemDraft[]
    )[0]?.id,
    draft.id,
  );
  const outcomes = await Promise.allSettled([
    f.call("system.save", { system: model("Writer one"), expectedRevision: 0 }),
    second.call("system.save", {
      projectId: f.project.id,
      system: model("Writer two"),
      expectedRevision: 0,
    }),
  ]);
  assert.equal(
    outcomes.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    outcomes.filter((result) => result.status === "rejected").length,
    1,
  );
  assert.match(
    String(
      (
        outcomes.find(
          (result) => result.status === "rejected",
        ) as PromiseRejectedResult
      ).reason,
    ),
    /Revision conflict/u,
  );
  await assert.rejects(
    f.call("drafts.accept", { draftId: draft.id, expectedRevision: 1 }),
    /stale/u,
  );
  await assert.rejects(
    f.call("drafts.propose", {
      system: model(),
      baseRevision: 0,
      summary: "Stale",
    }),
    /Revision conflict/u,
  );
  await f.call("drafts.delete", { draftId: draft.id });
  const current = await f.call<SystemModel>("system.get");
  const fresh = await f.call<SystemDraft>("drafts.propose", {
    system: { ...current, title: "Accepted draft" },
    baseRevision: 1,
    summary: "Updated flight wiring",
  });
  await assert.rejects(
    f.call("drafts.accept", { draftId: fresh.id, expectedRevision: 0 }),
    /Revision conflict/u,
  );
  assert.equal(
    (
      await f.call<SystemModel>("drafts.accept", {
        draftId: fresh.id,
        expectedRevision: 1,
      })
    ).revision,
    2,
  );
  assert.deepEqual(await f.call("drafts.list"), []);
  assert.equal(
    (
      (await second.call("system.get", {
        projectId: f.project.id,
      })) as SystemModel
    ).title,
    "Accepted draft",
  );
  await assert.rejects(
    f.call("system.save", { system: model() }),
    /Expected revision/u,
  );
});

test("all device outlines persist without changing graph, evidence, or revision protection", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.source, "flight.c"), "controller\n");
  const document = await f.call<DocumentSummary>("documents.upload", {
    name: "manual.txt",
    base64: Buffer.from("Pin mapping").toString("base64"),
  });
  const graph = model();
  graph.components[0]!.evidence.push({
    type: "source",
    repositoryId: f.repository.id,
    path: "flight.c",
    line: 1,
  });
  graph.connections[0]!.evidence.push({
    type: "document",
    documentId: document.id,
    page: 1,
  });
  graph.links.push({
    id: "manual",
    documentId: document.id,
    page: 1,
    componentId: "fc",
    note: "Pin mapping",
  });
  let revision = 0;
  for (const layout of SYSTEM_LAYOUTS) {
    const saved = await f.call<SystemModel>("system.save", {
      system: { ...graph, layout },
      expectedRevision: revision,
    });
    assert.deepEqual(saved, { ...graph, layout, revision: ++revision });
    const reopened = f.connect();
    try {
      assert.deepEqual(
        await reopened.call("system.get", { projectId: f.project.id }),
        saved,
      );
      await assert.rejects(
        reopened.call("system.save", {
          projectId: f.project.id,
          system: { ...graph, layout: "blank" },
          expectedRevision: revision - 1,
        }),
        /Revision conflict/u,
      );
    } finally {
      reopened.close();
    }
  }
  const before = await f.call<SystemModel>("system.get");
  for (const layout of ["unknown-device", "drone", null, ["truck"]]) {
    await assert.rejects(
      f.call("system.save", {
        system: { ...before, layout },
        expectedRevision: before.revision,
      }),
      /System layout/u,
    );
  }
  assert.deepEqual(await f.call("system.get"), before);
});

test("graph validation rejects dangling, duplicate, cross-project and malformed references", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.source, "flight.c"), "controller\n");
  const doc = await f.call<DocumentSummary>("documents.upload", {
    name: "manual.txt",
    base64: Buffer.from("manual").toString("base64"),
  });
  const invalid: SystemModel[] = [];
  let candidate = model();
  candidate.connections[0]!.to = "absent";
  invalid.push(candidate);
  candidate = model();
  candidate.connections[0]!.fromPort = "absent";
  invalid.push(candidate);
  candidate = model();
  candidate.components.push(candidate.components[0]!);
  invalid.push(candidate);
  candidate = model();
  candidate.components[0]!.x = Infinity;
  invalid.push(candidate);
  candidate = model();
  candidate.components[0]!.evidence.push({
    type: "source",
    repositoryId: "absent",
    path: "flight.c",
  });
  invalid.push(candidate);
  candidate = model();
  candidate.components[0]!.evidence.push({
    type: "source",
    repositoryId: f.repository.id,
    path: "../outside",
  });
  invalid.push(candidate);
  candidate = model();
  candidate.components[0]!.evidence.push({
    type: "document",
    documentId: doc.id,
    page: 2,
  });
  invalid.push(candidate);
  candidate = model();
  candidate.links.push({
    id: "link",
    documentId: doc.id,
    componentId: "absent",
    note: "",
  });
  invalid.push(candidate);
  candidate = model();
  candidate.links.push({
    id: "link",
    documentId: doc.id,
    path: "flight.c",
    note: "",
  });
  invalid.push(candidate);
  for (const system of invalid)
    await assert.rejects(
      f.call("system.save", { system, expectedRevision: 0 }),
    );
  const good = model();
  good.components[0]!.evidence.push({
    type: "source",
    repositoryId: f.repository.id,
    path: "flight.c",
    line: 1,
  });
  good.components[1]!.evidence.push({
    type: "document",
    documentId: doc.id,
    page: 1,
  });
  good.links.push({
    id: "manual",
    documentId: doc.id,
    componentId: "fc",
    repositoryId: f.repository.id,
    path: "flight.c",
    line: 1,
    note: "Pin mapping",
  });
  await f.call("system.save", { system: good, expectedRevision: 0 });
  await assert.rejects(
    f.workspace.call("system.save", {
      projectId: f.project2.id,
      system: good,
      expectedRevision: 0,
    }),
    /in this project/u,
  );
  await assert.rejects(
    f.call("repositories.remove", { repositoryId: f.repository.id }),
    /referenced/u,
  );
  await assert.rejects(
    f.call("documents.delete", { documentId: doc.id }),
    /referenced/u,
  );
  await f.call("system.save", { system: model(), expectedRevision: 1 });
  const draft = await f.call<SystemDraft>("drafts.propose", {
    system: good,
    baseRevision: 2,
    summary: "Reference preserved",
  });
  await assert.rejects(
    f.call("documents.delete", { documentId: doc.id }),
    /draft/u,
  );
  await f.call("drafts.delete", { draftId: draft.id });
  await f.call("documents.delete", { documentId: doc.id });
  await f.call("repositories.remove", { repositoryId: f.repository.id });
});

test("document storage is scoped, persisted, searchable, and deleted without touching originals", async (t) => {
  const f = await fixture(t);
  const original = join(f.root, "manual.md");
  await writeFile(original, "# Rotor motor\n100% valid_a manual\n");
  const doc = await f.call<DocumentSummary>("documents.import", {
    path: original,
  });
  assert.equal(doc.pageCount, 1);
  assert.equal(doc.sha256.length, 64);
  const content = await f.call("documents.read", { documentId: doc.id });
  assert.match(content.pages[0].text, /Rotor/u);
  assert.equal(
    (await f.call("documents.search", { query: "% valid_a" })).hits.length,
    1,
  );
  assert.equal(
    (await f.call("documents.search", { query: "valid_b" })).hits.length,
    0,
  );
  const copy = await f.workspace.documentFile(f.project.id, doc.id);
  assert.notEqual(copy.path, original);
  assert.equal(
    await readFile(copy.path, "utf8"),
    await readFile(original, "utf8"),
  );
  await assert.rejects(
    f.workspace.documentFile(f.project2.id, doc.id),
    /in this project/u,
  );
  await assert.rejects(
    f.workspace.call("documents.read", {
      projectId: f.project2.id,
      documentId: doc.id,
    }),
    /in this project/u,
  );
  await assert.rejects(
    f.call("documents.read", { documentId: doc.id, page: 0 }),
    /page/u,
  );
  await assert.rejects(
    f.call("documents.page", { documentId: doc.id, page: 1 }),
    /PDF/u,
  );
  await assert.rejects(
    f.call("documents.upload", { name: "../escape.txt", base64: "eA==" }),
    /filename/u,
  );
  await assert.rejects(
    f.call("documents.upload", { name: "bad.txt", base64: "**" }),
    /base64/u,
  );
  await assert.rejects(
    f.call("documents.upload", {
      name: "bad.bin",
      base64: Buffer.from([0, 1, 2]).toString("base64"),
    }),
    /binary|UTF|supported|text/iu,
  );
  await f.call("documents.upload", {
    name: "another.txt",
    base64: Buffer.from("rotor text").toString("base64"),
  });
  const hits = await f.call("documents.search", { query: "rotor", limit: 1 });
  assert.equal(hits.hits.length, 1);
  assert.equal(hits.truncated, true);
  await f.call("projects.delete");
  await assert.rejects(readFile(copy.path), /ENOENT/u);
  assert.match(await readFile(original, "utf8"), /Rotor/u);
});

test("document imports reject symlinks when the platform cannot enforce O_NOFOLLOW", async (t) => {
  const f = await fixture(t);
  const original = join(f.root, "original.txt");
  const link = join(f.root, "linked.txt");
  await writeFile(original, "PRIVATE_DOCUMENT_CANARY");
  await symlink(original, link, "file");
  const moduleUrl = new URL("../src/core/workspace.ts", import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    import {Workspace} from ${JSON.stringify(moduleUrl)};
    const [data,projectId,path] = process.argv.slice(1);
    const originalOpen = fs.openSync;
    fs.openSync = function(path,flags,...args) { return originalOpen.call(this,path,typeof flags === 'number' ? flags & ~(fs.constants.O_NOFOLLOW || 0) : flags,...args); };
    syncBuiltinESMExports();
    fs.closeSync(fs.openSync(path,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)));
    const workspace = new Workspace(data);
    try {
      await assert.rejects(workspace.call('documents.import',{projectId,path}),/symlink/);
      assert.deepEqual(await workspace.call('documents.list',{projectId}),[]);
    } finally { workspace.close(); }
  `;
  await run(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      script,
      f.data,
      f.project.id,
      link,
    ],
    { timeout: 5000 },
  );
  assert.deepEqual(await f.call("documents.list"), []);
});

test("clone uses a new destination and removal leaves the clone on disk", async (t) => {
  const f = await fixture(t);
  const source = join(f.source, "local repository");
  await mkdir(source);
  await run("git", ["init", source]);
  await writeFile(join(source, "flight.c"), "controller\n");
  await run("git", ["-C", source, "add", "flight.c"]);
  await run("git", [
    "-C",
    source,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "commit",
    "-m",
    "fixture",
  ]);
  const destination = join(f.root, "clone with spaces");
  const clone = await f.call<Repository>("repositories.clone", {
    url: source,
    destination,
  });
  assert.equal(clone.path, await realpath(destination));
  assert.match(clone.revision ?? "", /^[a-f0-9]{40}$/u);
  await assert.rejects(
    f.call("repositories.clone", { url: source, destination }),
    /already exists/u,
  );
  await assert.rejects(
    f.call("repositories.clone", {
      url: "ext::malicious",
      destination: join(f.root, "new"),
    }),
    /Git URL/u,
  );
  await assert.rejects(
    f.call("repositories.clone", {
      url: "https://user:secret@example.test/repo.git",
      destination: join(f.root, "new"),
    }),
    /credentials/u,
  );
  const clonedContents = await readFile(join(destination, "flight.c"), "utf8");
  assert.match(clonedContents, /^controller\r?\n$/u);
  await f.call("repositories.remove", { repositoryId: clone.id });
  assert.equal(
    await readFile(join(destination, "flight.c"), "utf8"),
    clonedContents,
  );
});

test("separate processes cannot both save the same revision", async (t) => {
  const f = await fixture(t);
  const moduleUrl = new URL("../src/core/workspace.ts", import.meta.url).href;
  const script = `import {Workspace} from ${JSON.stringify(moduleUrl)}; const w = new Workspace(process.argv[1]); try { const result = await w.call('system.save', {projectId: process.argv[2], expectedRevision: 0, system: JSON.parse(process.argv[3])}); console.log(JSON.stringify({revision:result.revision})); } catch(error) {console.log(JSON.stringify({error:error.message}));} finally {w.close();}`;
  const results = await Promise.all(
    [1, 2].map((number) =>
      run(process.execPath, [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        script,
        f.data,
        f.project.id,
        JSON.stringify(model(`Process ${number}`)),
      ]),
    ),
  );
  const values = results.map((result) => JSON.parse(result.stdout));
  assert.equal(values.filter((value) => value.revision === 1).length, 1);
  assert.equal(
    values.filter((value) => /Revision conflict/u.test(value.error)).length,
    1,
  );
  assert.equal((await f.call<SystemModel>("system.get")).revision, 1);
});

test("missing stored blobs do not prevent document or project deletion", async (t) => {
  const f = await fixture(t);
  const first = await f.call<DocumentSummary>("documents.upload", {
    name: "first.txt",
    base64: "eA==",
  });
  const second = await f.call<DocumentSummary>("documents.upload", {
    name: "second.txt",
    base64: "eQ==",
  });
  const firstPath = (await f.workspace.documentFile(f.project.id, first.id))
    .path;
  const secondPath = (await f.workspace.documentFile(f.project.id, second.id))
    .path;
  await rm(firstPath);
  await f.call("documents.delete", { documentId: first.id });
  await rm(secondPath);
  await f.call("projects.delete");
  assert.equal(
    ((await f.workspace.call("projects.list")) as Project[]).length,
    1,
  );
});

test("uploads accept valid maximum-sized base64 without regex stack overflow", async (t) => {
  const f = await fixture(t);
  const document = await f.call<DocumentSummary>("documents.upload", {
    name: "large.txt",
    base64: Buffer.alloc(32 * 1024 * 1024, "a").toString("base64"),
  });
  assert.equal(document.bytes, 32 * 1024 * 1024);
  assert.match(document.coverage, /Partial/u);
  for (const base64 of ["====", "=AAA", "A=AA", "AA=A"])
    await assert.rejects(
      f.call("documents.upload", { name: "invalid.txt", base64 }),
      /base64/u,
    );
});

test(
  "FIFOs are rejected without blocking repository reads, evidence saves or document imports",
  {
    skip:
      process.platform === "win32"
        ? "POSIX FIFOs are not available on Windows."
        : false,
  },
  async (t) => {
    const f = await fixture(t);
    const fifo = join(f.source, "pipe");
    await run("mkfifo", [fifo]);
    const moduleUrl = new URL("../src/core/workspace.ts", import.meta.url).href;
    const system = model();
    system.components[0]!.evidence.push({
      type: "source",
      repositoryId: f.repository.id,
      path: "pipe",
    });
    const operations = [
      ["repositories.read", { repositoryId: f.repository.id, path: "pipe" }],
      ["documents.import", { path: fifo }],
      ["system.save", { system, expectedRevision: 0 }],
    ];
    const script = `import {Workspace} from ${JSON.stringify(moduleUrl)}; const w = new Workspace(process.argv[1]); try {for(const [method,args] of JSON.parse(process.argv[3])) { try {await w.call(method,{...args,projectId:process.argv[2]}); console.log('unexpected success');} catch(error) {console.log(error.message);}}} finally {w.close();}`;
    const result = await run(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        script,
        f.data,
        f.project.id,
        JSON.stringify(operations),
      ],
      { timeout: 5000 },
    );
    assert.doesNotMatch(result.stdout, /unexpected success/u);
    assert.equal(result.stdout.trim().split("\n").length, 3);
    assert.match(result.stdout, /regular file/u);
  },
);

test("source context excludes credentials consistently while retaining environment templates", async (t) => {
  const f = await fixture(t);
  for (const directory of [".ssh", ".aws", ".GIT", ".Hg", ".SvN"]) {
    await mkdir(join(f.source, directory));
    await writeFile(join(f.source, directory, "config"), "CANARY_SECRET");
  }
  for (const name of [
    ".env",
    ".env.local",
    ".netrc",
    ".npmrc",
    "credentials.json",
    "private.pem",
    "private.key",
    "id_ed25519",
    "private_key.txt",
  ])
    await writeFile(join(f.source, name), "CANARY_SECRET");
  for (const name of [".env.example", ".env.sample", ".env.template"])
    await writeFile(join(f.source, name), "PUBLIC_EXAMPLE");
  const files = await f.call("repositories.files", {
    repositoryId: f.repository.id,
  });
  assert.deepEqual(files.paths, [
    ".env.example",
    ".env.sample",
    ".env.template",
  ]);
  assert.deepEqual(
    (
      await f.call("repositories.search", {
        repositoryId: f.repository.id,
        query: "CANARY_SECRET",
      })
    ).hits,
    [],
  );
  for (const path of [
    ".env",
    ".aws/config",
    "private.pem",
    ".GIT/config",
    ".Hg/config",
    ".SvN/config",
  ]) {
    await assert.rejects(
      f.call("repositories.read", { repositoryId: f.repository.id, path }),
      /Credential|Version-control/u,
    );
    const system = model();
    system.components[0]!.evidence.push({
      type: "source",
      repositoryId: f.repository.id,
      path,
    });
    await assert.rejects(
      f.call("system.save", { system, expectedRevision: 0 }),
      /Credential|Version-control/u,
    );
  }
  assert.equal(
    (
      await f.call<SourceRead>("repositories.read", {
        repositoryId: f.repository.id,
        path: ".env.example",
      })
    ).text,
    "PUBLIC_EXAMPLE",
  );
});

test("graph string enums reject values that merely stringify to allowed values", async (t) => {
  const f = await fixture(t);
  const system = model();
  await assert.rejects(
    f.call("system.save", {
      system: { ...system, layout: ["blank"] },
      expectedRevision: 0,
    }),
    /layout/u,
  );
  await assert.rejects(
    f.call("system.save", {
      system: {
        ...system,
        components: [{ ...system.components[0], kind: ["hardware"] }],
      },
      expectedRevision: 0,
    }),
    /kind/u,
  );
});

test("character-bounded source pages report the last returned line for continuation", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.source, "lines.txt"),
    Array.from({ length: 1500 }, () => "a".repeat(100)).join("\n"),
  );
  const first = await f.call<SourceRead>("repositories.read", {
    repositoryId: f.repository.id,
    path: "lines.txt",
    endLine: 1500,
  });
  assert.ok(first.endLine < 1500);
  assert.equal(first.endLine, first.text.split("\n").length);
  const next = await f.call<SourceRead>("repositories.read", {
    repositoryId: f.repository.id,
    path: "lines.txt",
    startLine: first.endLine + 1,
  });
  assert.equal(
    first.text.split("\n").length + next.text.split("\n").length,
    1500,
  );
});

test("source reads reject an inode swapped outside the repository during open", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.source, "sub"));
  await mkdir(join(f.root, "outside"));
  await writeFile(join(f.source, "sub", "file.txt"), "public");
  await writeFile(join(f.root, "outside", "file.txt"), "PRIVATE_CANARY");
  const moduleUrl = new URL("../src/core/workspace.ts", import.meta.url).href;
  const script = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; import {join} from 'node:path'; import {Workspace} from ${JSON.stringify(moduleUrl)}; const [data,projectId,repositoryId,source,outside] = process.argv.slice(1); const w = new Workspace(data); const original = fs.openSync; let swapped = false; fs.openSync = function(path,...args) {if (!swapped && String(path) === join(source,'sub','file.txt')) {swapped=true; fs.renameSync(join(source,'sub'),join(source,'parked'));fs.symlinkSync(outside,join(source,'sub'),'dir');try {return original.call(this,path,...args);} finally {fs.unlinkSync(join(source,'sub'));fs.renameSync(join(source,'parked'),join(source,'sub'));}} return original.call(this,path,...args);}; syncBuiltinESMExports();try {const r=await w.call('repositories.read',{projectId,repositoryId,path:'sub/file.txt'});console.log(r.text);} catch(e) {console.log(e.message);}finally {w.close();}`;
  const result = await run(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      script,
      f.data,
      f.project.id,
      f.repository.id,
      await realpath(f.source),
      await realpath(join(f.root, "outside")),
    ],
    { timeout: 5000 },
  );
  assert.doesNotMatch(result.stdout, /PRIVATE_CANARY/u);
  assert.match(result.stdout, /changed/u);
});

test("scoped source searches reach selected subtrees and reject scope escapes", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.source, "drivers"));
  await mkdir(join(f.source, "other"));
  await writeFile(
    join(f.source, "drivers", "sensor.c"),
    "signal_temperature\n",
  );
  await writeFile(join(f.source, "other", "other.c"), "signal_temperature\n");
  const listed = await f.call("repositories.files", {
    repositoryId: f.repository.id,
    directory: "drivers",
  });
  assert.deepEqual(listed.paths, ["drivers/sensor.c"]);
  const found = await f.call("repositories.search", {
    repositoryId: f.repository.id,
    directory: "drivers",
    query: "signal_temperature",
  });
  assert.equal(found.hits.length, 1);
  assert.equal(found.hits[0].path, "drivers/sensor.c");
  await assert.rejects(
    f.call("repositories.search", {
      repositoryId: f.repository.id,
      directory: "../other",
      query: "signal",
    }),
    /traversal/,
  );
  await assert.rejects(
    f.call("repositories.files", {
      repositoryId: f.repository.id,
      directory: ".aws",
    }),
    /Credential|credential/,
  );
});

test("clone refuses URL-carried secrets before creating destinations", async (t) => {
  const f = await fixture(t);
  for (const url of [
    "https://example.invalid/repo?access_token=secret",
    "https://example.invalid/repo#secret",
    "ssh://git:secret@example.invalid/repo",
  ]) {
    await assert.rejects(
      f.call("repositories.clone", { url, destination: join(f.root, "new") }),
      /credentials/,
    );
  }
});
