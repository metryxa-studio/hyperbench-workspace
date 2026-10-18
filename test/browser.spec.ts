import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Workspace } from "../src/core/workspace";
import { startBrowserServer } from "../src/server";
import { pdfFixture } from "./pdf-fixture";
import type { SystemModel } from "../src/types";
let directory: string,
  workspace: Workspace,
  local: Awaited<ReturnType<typeof startBrowserServer>>;
let projectId: string;
test.beforeEach(async ({ page }) => {
  directory = await mkdtemp(path.join(tmpdir(), "hb-browser-"));
  workspace = new Workspace(path.join(directory, "data"));
  local = await startBrowserServer(workspace, {
    dataDir: path.join(directory, "data"),
    cliPath: path.resolve("bin/hyperbench.mjs"),
    nodePath: process.execPath,
    uiDir: path.resolve("dist/ui"),
  });
  await page.goto(local.url);
});
test.afterEach(async () => {
  await local?.close();
  workspace?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function createProject(page: any) {
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await page.getByLabel("New project name").fill("Flight controller");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "System", exact: true }),
  ).toBeVisible();
  projectId = ((await workspace.call("projects.list", {})) as any[])[0].id;
}
async function component(page: any, name = "Controller") {
  await page
    .getByRole("button", { name: "Add component", exact: true })
    .first()
    .click();
  await page.getByLabel("Component name").fill(name);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add component", exact: true })
    .click();
}
async function save(page: any) {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("banner").getByText("Saved", { exact: true }),
  ).toHaveText("Saved");
}

async function seedConnectedSystem(page: any) {
  await createProject(page);
  const repoPath = path.join(directory, "controller");
  await mkdir(repoPath);
  await writeFile(
    path.join(repoPath, "serial.c"),
    "void send_temperature(void);\n",
  );
  const repository: any = await workspace.call("repositories.add", {
    projectId,
    path: repoPath,
  });
  const document: any = await workspace.call("documents.upload", {
    projectId,
    name: "connector.txt",
    base64: Buffer.from(
      "TX connects to RX on the temperature sensor.",
    ).toString("base64"),
  });
  const system: SystemModel = {
    revision: 0,
    title: "Flight controller",
    layout: "blank",
    components: [
      {
        id: "controller",
        label: "Controller",
        kind: "hardware",
        description: "Controller serial output",
        x: 100,
        y: 110,
        ports: ["TX"],
        evidence: [
          {
            type: "source",
            repositoryId: repository.id,
            path: "serial.c",
            line: 1,
          },
        ],
      },
      {
        id: "sensor",
        label: "Temperature sensor",
        kind: "hardware",
        description: "Sensor serial input",
        x: 470,
        y: 250,
        ports: ["RX"],
        evidence: [{ type: "document", documentId: document.id, page: 1 }],
      },
    ],
    connections: [
      {
        id: "serial",
        from: "controller",
        to: "sensor",
        label: "Serial",
        fromPort: "TX",
        toPort: "RX",
        evidence: [{ type: "document", documentId: document.id, page: 1 }],
      },
    ],
    links: [
      {
        id: "connector",
        documentId: document.id,
        page: 1,
        componentId: "controller",
        repositoryId: repository.id,
        path: "serial.c",
        line: 1,
        note: "Controller connector wiring",
      },
    ],
  };
  const saved = (await workspace.call("system.save", {
    projectId,
    expectedRevision: 0,
    system,
  })) as SystemModel;
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Controller, hardware component",
      exact: true,
    }),
  ).toBeVisible();
  return saved;
}

test("onboarding, component editing and save survive browser reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await createProject(page);
  await component(page);
  await save(page);
  expect(
    ((await workspace.call("system.get", { projectId })) as any).components[0]
      .label,
  ).toBe("Controller");
  await page.reload();
  await expect(
    page.locator(".canvas-node").filter({ hasText: "Controller" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Connect agent", exact: false })
    .click();
  await expect(page.getByRole("dialog")).toContainText("mcp");
  expect(errors).toEqual([]);
});

test("repository files and source search work without indexing", async ({
  page,
}) => {
  await createProject(page);
  const repo = path.join(directory, "firmware");
  await mkdir(repo);
  await writeFile(path.join(repo, "sensor.c"), "int temperature = 42;\n");
  await writeFile(path.join(repo, ".env"), "SECRET=do-not-show");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /Repositories/ })
    .click();
  await page
    .getByRole("button", { name: "Add repository", exact: true })
    .first()
    .click();
  await page.getByLabel("Absolute folder path").fill(repo);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add repository", exact: true })
    .click();
  await page.getByRole("button", { name: "sensor.c", exact: true }).click();
  await expect(page.getByLabel("Source of sensor.c")).toContainText(
    "int temperature = 42;",
  );
  await expect(
    page.getByRole("button", { name: ".env", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Search repository content").fill("temperature");
  await page.getByRole("button", { name: "Search code", exact: true }).click();
  await expect(page.locator(".search-results")).toContainText("sensor.c");
});

test("document upload, component link, save and link removal are coherent", async ({
  page,
}) => {
  await createProject(page);
  await component(page);
  await save(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /Documents/ })
    .click();
  await page.getByLabel("Upload documents").setInputFiles({
    name: "board.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Controller pin 3 carries temperature data."),
  });
  await expect(page.locator(".document-text")).toContainText(
    "Controller pin 3",
  );
  await page.getByRole("button", { name: "Link to system or code" }).click();
  const id = ((await workspace.call("system.get", { projectId })) as any)
    .components[0].id;
  await page.getByLabel("Component (optional)").selectOption(id);
  await page.getByRole("button", { name: "Add context link" }).click();
  await page.getByRole("button", { name: "Save system", exact: true }).click();
  await expect(
    page.getByRole("banner").getByText("Saved", { exact: true }),
  ).toHaveText("Saved");
  expect(
    ((await workspace.call("system.get", { projectId })) as any).links.length,
  ).toBe(1);
  await page.getByRole("button", { name: "Remove document link" }).click();
  await page.getByRole("button", { name: "Save system", exact: true }).click();
  await expect(
    page.getByRole("banner").getByText("Saved", { exact: true }),
  ).toHaveText("Saved");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete document", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No documents" }),
  ).toBeVisible();
  expect(
    ((await workspace.call("documents.list", { projectId })) as any[]).length,
  ).toBe(0);
});

test("an external agent draft is visible for review and only explicit acceptance saves it", async ({
  page,
}) => {
  await createProject(page);
  const model: any = await workspace.call("system.get", { projectId });
  model.layout = "truck";
  model.components = [
    {
      id: "temperature",
      label: "Temperature sensor",
      kind: "hardware",
      description: "Proposed local sensor",
      x: 100,
      y: 100,
      ports: [],
      evidence: [],
    },
  ];
  await workspace.call("drafts.propose", {
    projectId,
    baseRevision: 0,
    summary: "Add temperature sensor",
    system: model,
  });
  expect(
    ((await workspace.call("system.get", { projectId })) as any).components
      .length,
  ).toBe(0);
  await page.getByRole("button", { name: /Agent drafts/ }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Add temperature sensor",
  );
  await page.getByRole("button", { name: "Review on canvas" }).click();
  await expect(
    page.getByText("Temperature sensor", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByLabel("Device outline", { exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".device-outline")).toHaveAttribute(
    "data-layout",
    "truck",
  );
  expect(
    ((await workspace.call("system.get", { projectId })) as SystemModel).layout,
  ).toBe("blank");
  await page
    .getByRole("button", { name: "Accept & save", exact: true })
    .click();
  await expect(
    page.getByRole("banner").getByText("Saved", { exact: true }),
  ).toHaveText("Saved");
  await expect
    .poll(
      async () =>
        ((await workspace.call("system.get", { projectId })) as any).components
          .length,
    )
    .toBe(1);
  await expect(
    page.getByLabel("Device outline", { exact: true }),
  ).toBeEnabled();
  expect(
    ((await workspace.call("system.get", { projectId })) as SystemModel).layout,
  ).toBe("truck");
});

test("stale external edits cannot overwrite a browser draft", async ({
  page,
}) => {
  await createProject(page);
  await component(page, "Unsaved controller");
  const latest: any = await workspace.call("system.get", { projectId });
  await workspace.call("system.save", {
    projectId,
    expectedRevision: 0,
    system: { ...latest, title: "Updated elsewhere" },
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Revision conflict");
  expect(
    ((await workspace.call("system.get", { projectId })) as any).title,
  ).toBe("Updated elsewhere");
  await expect(
    page.getByText("Unsaved controller", { exact: true }).first(),
  ).toBeVisible();
});

test("PDF pages render, extracted text is readable and original download preserves bytes", async ({
  page,
}) => {
  await createProject(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /Documents/ })
    .click();
  const pdf = pdfFixture(2);
  await page.getByLabel("Upload documents").setInputFiles({
    name: "connector.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await expect(
    page.getByRole("img", { name: "Page 1 of connector.pdf" }),
  ).toBeVisible();
  await page.getByLabel("Page number").selectOption("2");
  const image = page.getByRole("img", { name: "Page 2 of connector.pdf" });
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  await page
    .getByRole("button", { name: "Extracted text", exact: true })
    .click();
  await expect(page.locator(".document-text")).toContainText(
    "Hardware context",
  );
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download original document" })
    .click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("connector.pdf");
  expect(await readFile((await download.path())!)).toEqual(pdf);
});

test("connections save when optional ports are cleared or endpoints change", async ({
  page,
}) => {
  await createProject(page);
  await component(page, "Controller");
  await page.getByLabel("Ports", { exact: true }).fill("TX");
  await page.getByLabel("Description", { exact: true }).click();
  await component(page, "Sensor");
  await page.getByLabel("Ports", { exact: true }).fill("RX");
  await page.getByLabel("Description", { exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("From", { exact: true })
    .selectOption({ label: "Controller" });
  await dialog
    .getByLabel("To", { exact: true })
    .selectOption({ label: "Sensor" });
  await dialog.getByLabel("Connection label").fill("Serial");
  await dialog
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  await page.getByLabel("From port", { exact: true }).fill("TX");
  await page.getByLabel("To port", { exact: true }).fill("RX");
  await save(page);
  await page.getByLabel("From port", { exact: true }).fill("");
  await save(page);
  let saved: any = await workspace.call("system.get", { projectId });
  expect(saved.connections[0].fromPort).toBeUndefined();
  await page.getByLabel("From port", { exact: true }).fill("TX");
  await page
    .getByLabel("From", { exact: true })
    .selectOption({ label: "Sensor" });
  await page
    .getByLabel("To", { exact: true })
    .selectOption({ label: "Controller" });
  await save(page);
  saved = await workspace.call("system.get", { projectId });
  expect(saved.connections[0].fromPort).toBeUndefined();
  expect(saved.connections[0].toPort).toBeUndefined();
});

test("narrow layout keeps navigation, editing and save reachable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createProject(page);
  await component(page, "Controller");
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Updated controller");
  await page.getByRole("button", { name: "Deselect item" }).click();
  await save(page);
  await page.reload();
  const node = page.getByRole("button", {
    name: "Updated controller, hardware component",
  });
  await expect(node).toBeVisible();
  await expect
    .poll(async () => {
      const n = await node.boundingBox(),
        c = await page.locator(".canvas").boundingBox();
      return !!n && !!c && n.x >= c.x && n.x + n.width <= c.x + c.width;
    })
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("workspace-narrow.png") });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /Documents/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Documents", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import documents", exact: true }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("device outlines preserve the complete system through switching, saving, reload and discard", async ({
  page,
}) => {
  const original = await seedConnectedSystem(page);
  const layouts = [
    "quadrotor",
    "hexarotor",
    "octorotor",
    "fixed-wing",
    "robot-arm",
    "truck",
    "blank",
  ];
  const selector = page.getByLabel("Device outline", { exact: true });
  for (const layout of layouts) {
    await selector.selectOption(layout);
    await save(page);
    const saved = (await workspace.call("system.get", {
      projectId,
    })) as SystemModel;
    expect(saved.layout).toBe(layout);
    expect(saved.components).toEqual(original.components);
    expect(saved.connections).toEqual(original.connections);
    expect(saved.links).toEqual(original.links);
    await page.reload();
    await expect(selector).toHaveValue(layout);
    if (layout === "blank") {
      await expect(page.locator(".device-outline")).toHaveCount(0);
    } else {
      await expect(page.locator(".device-outline")).toHaveAttribute(
        "data-layout",
        layout,
      );
      await expect(page.locator(".device-outline")).toBeVisible();
    }
    await expect(page.locator(".canvas-node")).toHaveCount(2);
    await expect(
      page.getByRole("button", {
        name: "Connection from Controller to Temperature sensor: Serial",
        exact: true,
      }),
    ).toBeVisible();
  }
  await selector.selectOption("robot-arm");
  await expect(page.locator(".device-outline")).toHaveAttribute(
    "data-layout",
    "robot-arm",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(selector).toHaveValue("blank");
  await expect(page.locator(".device-outline")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  const saved = (await workspace.call("system.get", {
    projectId,
  })) as SystemModel;
  expect(saved.components).toEqual(original.components);
  expect(saved.connections).toEqual(original.connections);
  expect(saved.links).toEqual(original.links);
});

test("every device outline fits a narrow canvas without hiding the selector or save action", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createProject(page);
  const selector = page.getByLabel("Device outline", { exact: true });
  for (const layout of [
    "quadrotor",
    "hexarotor",
    "octorotor",
    "fixed-wing",
    "robot-arm",
    "truck",
  ]) {
    await selector.selectOption(layout);
    const outline = page.locator(".device-outline");
    await expect(outline).toHaveAttribute("data-layout", layout);
    await expect
      .poll(async () => {
        const image = await outline.boundingBox(),
          canvas = await page.locator(".canvas").boundingBox();
        return (
          !!image &&
          !!canvas &&
          image.width > 0 &&
          image.height > 0 &&
          image.x >= canvas.x - 1 &&
          image.y >= canvas.y - 1 &&
          image.x + image.width <= canvas.x + canvas.width + 1 &&
          image.y + image.height <= canvas.y + canvas.height + 1
        );
      })
      .toBe(true);
    await expect(selector).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await save(page);
  await page.reload();
  await expect(selector).toHaveValue("truck");
  await expect(page.locator(".device-outline")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("workspace-truck-narrow.png"),
  });
});

test("outline artwork does not block panning or dragging connected components", async ({
  page,
}) => {
  const original = await seedConnectedSystem(page);
  await page
    .getByLabel("Device outline", { exact: true })
    .selectOption("quadrotor");
  await save(page);
  const outline = page.locator(".device-outline");
  const beforePan = (await outline.boundingBox())!;
  const panStart = {
    x: beforePan.x + beforePan.width / 2,
    y: beforePan.y + beforePan.height / 10,
  };
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  await page.mouse.move(panStart.x + 32, panStart.y + 18, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Math.round((await outline.boundingBox())!.x - beforePan.x),
    )
    .toBe(32);
  await expect
    .poll(async () =>
      Math.round((await outline.boundingBox())!.y - beforePan.y),
    )
    .toBe(18);
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();

  const node = page.getByRole("button", {
    name: "Controller, hardware component",
    exact: true,
  });
  const beforeDrag = (await node.boundingBox())!;
  const dragStart = {
    x: beforeDrag.x + beforeDrag.width / 2,
    y: beforeDrag.y + beforeDrag.height / 2,
  };
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragStart.x + 45, dragStart.y + 30, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Math.abs((await node.boundingBox())!.x - beforeDrag.x - 45),
    )
    .toBeLessThan(1);
  await expect
    .poll(async () =>
      Math.abs((await node.boundingBox())!.y - beforeDrag.y - 30),
    )
    .toBeLessThan(1);
  await save(page);
  const saved = (await workspace.call("system.get", {
    projectId,
  })) as SystemModel;
  expect(saved.components[0].x).toBeGreaterThan(original.components[0].x);
  expect(saved.components[0].y).toBeGreaterThan(original.components[0].y);
  expect(saved.components[0].evidence).toEqual(original.components[0].evidence);
  expect(saved.components[1]).toEqual(original.components[1]);
  expect(saved.connections).toEqual(original.connections);
  expect(saved.links).toEqual(original.links);
});
