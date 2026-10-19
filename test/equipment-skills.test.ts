import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Workspace } from "../src/core/workspace.ts";
import type { DocumentSummary, EquipmentSkill, Project } from "../src/types.ts";
import { pdfFixture } from "./pdf-fixture.ts";

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "hyperbench-equipment-skills-"));
  const workspace = new Workspace(directory);
  const connections = [workspace];
  const connect = () => {
    const connection = new Workspace(directory);
    connections.push(connection);
    return connection;
  };
  t.after(async () => {
    for (const connection of connections) connection.close();
    await rm(directory, { recursive: true, force: true });
  });
  const project = (await workspace.call("projects.create", {
    name: "Sensor board",
  })) as Project;
  const otherProject = (await workspace.call("projects.create", {
    name: "Independent board",
  })) as Project;
  const bytes = pdfFixture(3);
  const document = (await workspace.call("documents.upload", {
    projectId: project.id,
    name: "Sensor rev-C.pdf",
    base64: bytes.toString("base64"),
  })) as DocumentSummary;
  const call = <T = unknown>(method: string, args: object = {}) =>
    workspace.call(method, { projectId: project.id, ...args }) as Promise<T>;
  const proposal = {
    name: "sensor-board-bringup",
    description: "Check the sensor board's initialization against its manual.",
    equipment: "Sensor board revision C",
    body: "# Sensor board\n\nCompare the configured bus with the cited drawing.\n",
    sources: [{ documentId: document.id, pageStart: 2, pageEnd: 3 }],
  };
  const propose = (args: object = {}) =>
    call<EquipmentSkill>("equipmentSkills.propose", { ...proposal, ...args });
  return {
    directory,
    workspace,
    project,
    otherProject,
    document,
    bytes,
    proposal,
    call,
    propose,
    connect,
  };
}

test("equipment proposals retain canonical evidence and require review across workspace connections", async (t) => {
  const f = await fixture(t);
  const draft = await f.propose({
    id: "caller-chosen-id",
    status: "accepted",
    acceptedAt: "2000-01-01T00:00:00.000Z",
    sources: [{
      ...f.proposal.sources[0],
      name: "invented-manual.pdf",
      sha256: "0".repeat(64),
    }],
  });
  assert.equal(draft.status, "draft");
  assert.equal(draft.acceptedAt, undefined);
  assert.notEqual(draft.id, "caller-chosen-id");
  assert.deepEqual(draft.sources, [{
    ...f.proposal.sources[0],
    name: f.document.name,
    sha256: createHash("sha256").update(f.bytes).digest("hex"),
  }]);
  const stored = structuredClone(draft);
  draft.body = "Changed after proposal";
  draft.sources[0].name = "Changed after proposal";
  const second = f.connect();
  assert.deepEqual(
    await second.call("equipmentSkills.list", { projectId: f.project.id }),
    [stored],
  );
  await assert.rejects(
    f.call("equipmentSkills.export", { skillId: draft.id }),
    /accept|review|draft/i,
  );
  await assert.rejects(f.call("equipmentSkills.update", {
    skillId: draft.id,
    body: "Replace reviewed contents",
  }));
  assert.deepEqual(await f.call("equipmentSkills.list"), [stored]);
});

test("equipment sources and skill operations reject cross-project IDs and invalid page ranges", async (t) => {
  const f = await fixture(t);
  const foreignDocument = (await f.workspace.call("documents.upload", {
    projectId: f.otherProject.id,
    name: "private-notes.txt",
    base64: Buffer.from("Other project's equipment").toString("base64"),
  })) as DocumentSummary;
  for (const source of [
    { documentId: "missing-document", pageStart: 1, pageEnd: 1 },
    { documentId: foreignDocument.id, pageStart: 1, pageEnd: 1 },
    { documentId: f.document.id, pageStart: 0, pageEnd: 1 },
    { documentId: f.document.id, pageStart: 1.5, pageEnd: 2 },
    { documentId: f.document.id, pageStart: 2, pageEnd: 1 },
    { documentId: f.document.id, pageStart: 1, pageEnd: 4 },
    { documentId: f.document.id, pageStart: 1, pageEnd: 2.5 },
    { documentId: f.document.id, pageStart: 1 },
    { documentId: f.document.id, pageEnd: 1 },
  ]) {
    await assert.rejects(f.propose({ sources: [source] }), JSON.stringify(source));
  }
  assert.deepEqual(await f.call("equipmentSkills.list"), []);
  const draft = await f.propose();
  assert.deepEqual(await f.workspace.call("equipmentSkills.list", {
    projectId: f.otherProject.id,
  }), []);
  for (const method of ["accept", "delete", "export"]) {
    await assert.rejects(f.workspace.call(`equipmentSkills.${method}`, {
      projectId: f.otherProject.id,
      skillId: draft.id,
    }), /project|exist|found/i);
    await assert.rejects(f.call(`equipmentSkills.${method}`, {
      skillId: "missing-skill",
    }), /exist|found/i);
  }
  assert.deepEqual(await f.call("equipmentSkills.list"), [draft]);
});

test("equipment proposals enforce safe names and bounded metadata, bodies, and source lists", async (t) => {
  const f = await fixture(t);
  for (const name of [
    "../escape", "a/b", "a\\b", "Uppercase", "two words", "under_score",
    "-leading", "trailing-", "double--dash", "", "a".repeat(65), "a\0b",
  ]) {
    await assert.rejects(f.propose({ name }), `name ${JSON.stringify(name)}`);
  }
  for (const args of [
    { description: "d".repeat(501) },
    { equipment: "e".repeat(201) },
    { body: "b".repeat(32_001) },
    { body: "   " },
    { sources: [] },
    { sources: Array.from({ length: 25 }, () => f.proposal.sources[0]) },
  ]) {
    await assert.rejects(f.propose(args));
  }
  assert.deepEqual(await f.call("equipmentSkills.list"), []);
  const boundary = await f.propose({
    name: "a".repeat(64),
    description: "d".repeat(500),
    equipment: "e".repeat(200),
    body: "b".repeat(32_000),
    sources: Array.from({ length: 24 }, () => f.proposal.sources[0]),
  });
  assert.equal(boundary.body.length, 32_000);
  assert.equal(boundary.sources.length, 24);
});

test("accepted export preserves reviewed content, safe YAML metadata, and source provenance", async (t) => {
  const f = await fixture(t);
  const description = 'Check ADC: "sample" # interpretation\n---\nextra: false';
  const draft = await f.propose({ description });
  const accepted = await f.call<EquipmentSkill>("equipmentSkills.accept", {
    skillId: draft.id,
    body: "Unreviewed replacement",
    name: "unreviewed-name",
    sources: [],
  });
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.body, draft.body);
  assert.equal(accepted.name, draft.name);
  assert.deepEqual(accepted.sources, draft.sources);
  assert.ok(accepted.acceptedAt);
  const second = f.connect();
  assert.deepEqual(await second.call("equipmentSkills.accept", {
    projectId: f.project.id,
    skillId: draft.id,
  }), accepted);
  const exported = await f.call<{ filename: string; content: string }>(
    "equipmentSkills.export",
    { skillId: draft.id },
  );
  assert.equal(exported.filename, "SKILL.md");
  const frontmatter = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(exported.content);
  assert.ok(frontmatter, "Frontmatter must remain two scalar fields despite embedded delimiters");
  assert.equal(JSON.parse(frontmatter[1]), draft.name);
  assert.equal(JSON.parse(frontmatter[2]), description);
  const remainder = exported.content.slice(frontmatter[0].length);
  const bodyStart = remainder.indexOf(draft.body);
  assert.ok(bodyStart >= 0, "Reviewed body must be preserved exactly");
  const provenance = remainder.slice(bodyStart + draft.body.length);
  for (const value of [f.document.id, f.document.name, f.document.sha256]) {
    assert.ok(provenance.includes(value), `Provenance must identify ${value}`);
  }
  assert.match(provenance, /2\s*[-–]\s*3/);
  assert.equal(exported.content.includes(f.directory), false);
  assert.deepEqual(await second.call("equipmentSkills.list", {
    projectId: f.project.id,
  }), [accepted]);
});

test("draft and accepted skills protect referenced documents until the skill is deleted", async (t) => {
  const f = await fixture(t);
  const draft = await f.propose();
  const second = f.connect();
  const removeDocument = () => second.call("documents.delete", {
    projectId: f.project.id,
    documentId: f.document.id,
  });
  await assert.rejects(removeDocument(), /referenc|skill/i);
  await f.call("equipmentSkills.accept", { skillId: draft.id });
  await assert.rejects(removeDocument(), /referenc|skill/i);
  assert.deepEqual(await f.call("documents.list"), [f.document]);
  await f.call("equipmentSkills.delete", { skillId: draft.id });
  assert.deepEqual(await second.call("equipmentSkills.list", {
    projectId: f.project.id,
  }), []);
  await removeDocument();
  assert.deepEqual(await f.call("documents.list"), []);
});

test("project deletion cascades equipment skills and stored documents without touching other projects", async (t) => {
  const f = await fixture(t);
  const draft = await f.propose();
  await f.call("equipmentSkills.accept", { skillId: draft.id });
  const otherDocument = (await f.workspace.call("documents.upload", {
    projectId: f.otherProject.id,
    name: "other.txt",
    base64: Buffer.from("Independent equipment instructions").toString("base64"),
  })) as DocumentSummary;
  const otherSkill = await f.workspace.call("equipmentSkills.propose", {
    ...f.proposal,
    projectId: f.otherProject.id,
    sources: [{ documentId: otherDocument.id, pageStart: 1, pageEnd: 1 }],
  });
  const storedFile = await f.workspace.documentFile(f.project.id, f.document.id);
  const second = f.connect();
  await f.call("projects.delete");
  await assert.rejects(access(storedFile.path), { code: "ENOENT" });
  await assert.rejects(second.call("equipmentSkills.list", {
    projectId: f.project.id,
  }), /Project does not exist/);
  assert.deepEqual(await second.call("equipmentSkills.list", {
    projectId: f.otherProject.id,
  }), [otherSkill]);
  const database = new DatabaseSync(join(f.directory, "workspace.sqlite"), { readOnly: true });
  try {
    const row = database.prepare("SELECT COUNT(*) AS total FROM equipment_skills WHERE projectId=?")
      .get(f.project.id);
    assert.equal(row?.total, 0);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("equipment-skill capacity is shared across connections and released by deletion", async (t) => {
  const f = await fixture(t);
  const second = f.connect();
  for (let index = 0; index < 19; index++) {
    const draft = await f.propose({ name: `sensor-${index}` });
    if (index === 0) await f.call("equipmentSkills.accept", { skillId: draft.id });
  }
  const attempts = await Promise.allSettled([
    f.propose({ name: "last-local" }),
    second.call("equipmentSkills.propose", {
      ...f.proposal,
      projectId: f.project.id,
      name: "last-other-connection",
    }),
  ]);
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);
  const skills = await f.call<EquipmentSkill[]>("equipmentSkills.list");
  assert.equal(skills.length, 20);
  assert.equal(skills.filter((skill) => skill.status === "accepted").length, 1);
  await f.call("equipmentSkills.delete", { skillId: skills[0].id });
  await second.call("equipmentSkills.propose", {
    ...f.proposal,
    projectId: f.project.id,
    name: "replacement",
  });
  assert.equal((await f.call<EquipmentSkill[]>("equipmentSkills.list")).length, 20);
});
