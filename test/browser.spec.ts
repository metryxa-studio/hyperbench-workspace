import { test, expect, type Route } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Workspace } from "../src/core/workspace";
import { startBrowserServer } from "../src/server";
import { pdfFixture } from "./pdf-fixture";
import type { SystemModel, TestBench } from "../src/types";
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

async function seedMixedSystem(page: any) {
  await createProject(page);
  const model = (await workspace.call("system.get", {
    projectId,
  })) as SystemModel;
  const saved = (await workspace.call("system.save", {
    projectId,
    expectedRevision: model.revision,
    system: {
      ...model,
      layout: "truck",
      components: [
        {
          id: "controller",
          label: "Controller",
          kind: "hardware",
          description: "Control board",
          x: -2200,
          y: 1800,
          ports: [],
          evidence: [],
        },
        {
          id: "firmware",
          label: "Firmware",
          kind: "software",
          description: "Control loop",
          x: 3100,
          y: -1700,
          ports: [],
          evidence: [],
        },
        {
          id: "simulator",
          label: "Simulator",
          kind: "external",
          description: "External simulator",
          x: 2600,
          y: 2300,
          ports: [],
          evidence: [],
        },
      ],
      connections: [
        {
          id: "control",
          from: "controller",
          to: "firmware",
          label: "Runs firmware",
          evidence: [],
        },
      ],
    },
  })) as SystemModel;
  await page.reload();
  await expect(page.locator(".canvas-node")).toHaveCount(3);
  return saved;
}

async function expectNodeInsideCanvas(page: any, name: string) {
  const node = page.getByRole("button", { name, exact: true });
  await expect(node).toBeVisible();
  await expect
    .poll(async () => {
      const n = await node.boundingBox(),
        c = await page.locator(".canvas").boundingBox();
      return (
        !!n &&
        !!c &&
        n.x >= c.x - 1 &&
        n.y >= c.y - 1 &&
        n.x + n.width <= c.x + c.width + 1 &&
        n.y + n.height <= c.y + c.height + 1
      );
    })
    .toBe(true);
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

test("draft previews ignore the save shortcut and canceling acceptance preserves local edits", async ({
  page,
}) => {
  const original = await seedConnectedSystem(page);
  await page
    .getByRole("button", {
      name: "Controller, hardware component",
      exact: true,
    })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Unsaved controller");
  await workspace.call("drafts.propose", {
    projectId,
    baseRevision: original.revision,
    summary: "Rename the board from agent evidence",
    system: {
      ...original,
      components: original.components.map((item) =>
        item.id === "controller"
          ? { ...item, label: "Agent controller" }
          : item,
      ),
    },
  });
  await page.getByRole("button", { name: /Agent drafts/ }).click();
  await page.getByRole("button", { name: "Review on canvas" }).click();
  await expect(page.locator(".draft-review-bar")).toBeVisible();
  const saves: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/call") &&
      request.postDataJSON()?.method === "system.save"
    )
      saves.push(request.url());
  });
  await page.keyboard.press("Control+s");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  expect(saves).toEqual([]);
  expect(await workspace.call("system.get", { projectId })).toEqual(original);

  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Accept & save", exact: true })
    .click();
  await expect(page.locator(".draft-review-bar")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Agent controller, hardware component",
      exact: true,
    }),
  ).toBeVisible();
  expect(await workspace.call("system.get", { projectId })).toEqual(original);
  await page
    .getByRole("button", { name: "Close preview", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Unsaved controller, hardware component",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();
  expect(
    (await workspace.call("drafts.list", { projectId })) as any[],
  ).toHaveLength(1);
});

test("a clean browser receives external system revisions and can accept a new valid draft without reloading", async ({
  page,
}) => {
  const original = await seedConnectedSystem(page);
  const external = (await workspace.call("system.save", {
    projectId,
    expectedRevision: original.revision,
    system: { ...original, title: "Updated by another client" },
  })) as SystemModel;
  await workspace.call("drafts.propose", {
    projectId,
    baseRevision: external.revision,
    summary: "Add the vehicle outline to the latest system",
    system: { ...external, layout: "truck" },
  });
  await expect(
    page.getByRole("heading", {
      name: "Updated by another client",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Agent drafts/ }).click();
  await page.getByRole("button", { name: "Review on canvas" }).click();
  await expect(
    page.getByRole("button", { name: "Accept & save", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Accept & save", exact: true })
    .click();
  await expect(page.locator(".draft-review-bar")).toHaveCount(0);
  const saved = (await workspace.call("system.get", {
    projectId,
  })) as SystemModel;
  expect(saved.revision).toBe(external.revision + 1);
  expect(saved.title).toBe(external.title);
  expect(saved.layout).toBe("truck");
  expect(saved.components).toEqual(original.components);
  expect(saved.connections).toEqual(original.connections);
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
  await page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/call") &&
      response.request().postDataJSON()?.method === "drafts.list",
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await expect(
    page.getByRole("button", {
      name: "Unsaved controller, hardware component",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Revision conflict");
  expect(
    ((await workspace.call("system.get", { projectId })) as any).title,
  ).toBe("Updated elsewhere");
  await expect(
    page.getByText("Unsaved controller", { exact: true }).first(),
  ).toBeVisible();
});

test("an in-flight clean refresh cannot replace new local edits or advance their save baseline", async ({
  page,
}) => {
  await createProject(page);
  const original = (await workspace.call("system.get", {
    projectId,
  })) as SystemModel;
  expect(original.revision).toBe(0);

  let notifyHeld!: () => void,
    release!: () => void,
    held = false;
  const responseHeld = new Promise<void>((resolve) => {
    notifyHeld = resolve;
  });
  const releaseResponse = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holdRefresh = async (route: Route) => {
    if (held || route.request().postDataJSON()?.method !== "system.get") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = await response.json();
    if (body.result?.revision === 1) {
      held = true;
      notifyHeld();
      await releaseResponse;
    }
    await route.fulfill({ response });
  };
  await page.route("**/api/call", holdRefresh);
  try {
    const external = (await workspace.call("system.save", {
      projectId,
      expectedRevision: 0,
      system: { ...original, title: "External revision" },
    })) as SystemModel;
    await responseHeld;
    await component(page, "Edited during refresh");
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeEnabled();

    const delivered = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/call") &&
        response.request().postDataJSON()?.method === "system.get",
    );
    release();
    await delivered;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await expect(
      page.getByRole("button", {
        name: "Edited during refresh, hardware component",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Revision conflict");
    expect(await workspace.call("system.get", { projectId })).toEqual(external);
    await expect(
      page.getByRole("button", {
        name: "Edited during refresh, hardware component",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
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
  const fromPort = page.getByRole("combobox", {
    name: "From port",
    exact: true,
  });
  const toPort = page.getByRole("combobox", { name: "To port", exact: true });
  await expect(fromPort.locator("option")).toHaveText(["None", "TX"]);
  await expect(toPort.locator("option")).toHaveText(["None", "RX"]);
  await fromPort.selectOption("TX");
  await toPort.selectOption("RX");
  await expect(
    fromPort.selectOption("undeclared-port", { timeout: 250 }),
  ).rejects.toThrow();
  await expect(fromPort).toHaveValue("TX");
  await expect(toPort).toHaveValue("RX");
  await save(page);
  await fromPort.selectOption("");
  await save(page);
  let saved: any = await workspace.call("system.get", { projectId });
  expect(saved.connections[0].fromPort).toBeUndefined();
  await fromPort.selectOption("TX");
  await page
    .getByLabel("From", { exact: true })
    .selectOption({ label: "Sensor" });
  await page
    .getByLabel("To", { exact: true })
    .selectOption({ label: "Controller" });
  await expect(fromPort.locator("option")).toHaveText(["None", "RX"]);
  await expect(toPort.locator("option")).toHaveText(["None", "TX"]);
  await expect(fromPort).toHaveValue("");
  await expect(toPort).toHaveValue("");
  await save(page);
  saved = await workspace.call("system.get", { projectId });
  expect(saved.connections[0].fromPort).toBeUndefined();
  expect(saved.connections[0].toPort).toBeUndefined();
});

test("component ports normalize before shortcut saves and remove stale connection endpoints without losing evidence", async ({
  page,
}) => {
  const original = await seedConnectedSystem(page);
  await page
    .getByRole("button", {
      name: "Controller, hardware component",
      exact: true,
    })
    .click();
  const ports = page.getByLabel("Ports", { exact: true });
  await ports.fill("");
  await ports.pressSequentially("TX, SPI");
  await page.keyboard.press("Control+s");
  await expect(ports).toBeFocused();
  await expect
    .poll(async () => {
      const saved = (await workspace.call("system.get", {
        projectId,
      })) as SystemModel;
      return saved.components.find((item) => item.id === "controller")?.ports;
    })
    .toEqual(["TX", "SPI"]);
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  let saved = (await workspace.call("system.get", {
    projectId,
  })) as SystemModel;
  expect(saved.connections[0].fromPort).toBe("TX");

  await ports.fill("TX, , TX, SPI, I2C, ");
  await page.keyboard.press("Control+s");
  await expect(ports).toBeFocused();
  await expect
    .poll(async () => {
      const current = (await workspace.call("system.get", {
        projectId,
      })) as SystemModel;
      return current.components.find((item) => item.id === "controller")?.ports;
    })
    .toEqual(["TX", "SPI", "I2C"]);
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  saved = (await workspace.call("system.get", { projectId })) as SystemModel;
  expect(saved.connections[0].fromPort).toBe("TX");

  await ports.fill("SPI, , SPI,");
  await page.keyboard.press("Control+s");
  await expect(ports).toBeFocused();
  await expect
    .poll(async () => {
      const current = (await workspace.call("system.get", {
        projectId,
      })) as SystemModel;
      return current.components.find((item) => item.id === "controller")?.ports;
    })
    .toEqual(["SPI"]);
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  saved = (await workspace.call("system.get", { projectId })) as SystemModel;
  expect(saved.connections[0].fromPort).toBeUndefined();
  expect(saved.connections[0].toPort).toBe("RX");

  await page
    .getByRole("button", {
      name: "Temperature sensor, hardware component",
      exact: true,
    })
    .click();
  await ports.fill("I2C, I2C, ,");
  await page.keyboard.press("Control+s");
  await expect
    .poll(async () => {
      const current = (await workspace.call("system.get", {
        projectId,
      })) as SystemModel;
      return current.components.find((item) => item.id === "sensor")?.ports;
    })
    .toEqual(["I2C"]);
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  saved = (await workspace.call("system.get", { projectId })) as SystemModel;
  const { fromPort, toPort, ...originalConnection } = original.connections[0];
  expect(saved.connections).toEqual([originalConnection]);
  expect(saved.components[0].evidence).toEqual(original.components[0].evidence);
  expect(saved.components[1].evidence).toEqual(original.components[1].evidence);
  expect(saved.links).toEqual(original.links);
  await expect(page.getByRole("alert")).toHaveCount(0);
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

test("component views fit their own nodes, hide unrelated selections and preserve the saved graph", async ({
  page,
}) => {
  const original = await seedMixedSystem(page);
  const modes = [
    ["Hardware", "Controller, hardware component"],
    ["Software", "Firmware, software component"],
    ["External", "Simulator, external component"],
  ];
  for (const [mode, name] of modes) {
    const button = page.getByRole("button", { name: new RegExp(`^${mode}`) });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".canvas-node")).toHaveCount(1);
    await expectNodeInsideCanvas(page, name);
    await expect(page.locator(".device-outline")).toHaveCount(0);
    await expect(
      page.getByLabel("Device outline", { exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".canvas-connection")).toHaveCount(0);
    await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
  }
  await page.getByRole("button", { name: /^Diagram/ }).click();
  await expect(page.locator(".canvas-node")).toHaveCount(3);
  await expect(page.locator(".canvas-connection")).toHaveCount(1);
  await expect(page.getByLabel("Device outline", { exact: true })).toHaveValue(
    "truck",
  );
  expect(await workspace.call("system.get", { projectId })).toEqual(original);
});

test("empty hardware and software views replace an outline with a clear type-specific empty state", async ({
  page,
}) => {
  await createProject(page);
  await page
    .getByLabel("Device outline", { exact: true })
    .selectOption("quadrotor");
  await save(page);
  const original = await workspace.call("system.get", { projectId });
  for (const kind of ["hardware", "software", "external"]) {
    await page
      .getByRole("button", { name: new RegExp(`^${kind}`, "i") })
      .click();
    await expect(
      page.getByRole("heading", {
        name: `No ${kind} components`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".device-outline")).toHaveCount(0);
    await expect(
      page.getByLabel("Device outline", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
  }
  await page.getByRole("button", { name: /^Diagram/ }).click();
  await expect(page.locator(".device-outline")).toHaveAttribute(
    "data-layout",
    "quadrotor",
  );
  await expect(page.getByLabel("Device outline", { exact: true })).toHaveValue(
    "quadrotor",
  );
  expect(await workspace.call("system.get", { projectId })).toEqual(original);
});

test("adding components defaults to the active view and reveals an explicitly different type", async ({
  page,
}) => {
  await createProject(page);
  await page.getByRole("button", { name: /^Software/ }).click();
  await page
    .getByRole("button", { name: "Add component", exact: true })
    .first()
    .click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Type", { exact: true })).toHaveValue(
    "software",
  );
  await dialog.getByLabel("Component name").fill("Flight controller firmware");
  await dialog
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  await expect(page.getByRole("button", { name: /^Software/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expectNodeInsideCanvas(
    page,
    "Flight controller firmware, software component",
  );
  await save(page);

  await page
    .getByRole("button", { name: "Add component", exact: true })
    .first()
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Type", { exact: true })).toHaveValue(
    "software",
  );
  await dialog.getByLabel("Type", { exact: true }).selectOption("hardware");
  await dialog.getByLabel("Component name").fill("Flight controller board");
  await dialog
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  await expectNodeInsideCanvas(
    page,
    "Flight controller board, hardware component",
  );
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Flight controller board",
  );
  await save(page);
  const saved = (await workspace.call("system.get", {
    projectId,
  })) as SystemModel;
  expect(saved.components.map(({ label, kind }) => ({ label, kind }))).toEqual([
    { label: "Flight controller firmware", kind: "software" },
    { label: "Flight controller board", kind: "hardware" },
  ]);
});

test("Connect defaults to visible components and creating or editing cross-type edges reveals the diagram", async ({
  page,
}) => {
  const original = await seedConnectedSystem(page);
  await workspace.call("system.save", {
    projectId,
    expectedRevision: original.revision,
    system: {
      ...original,
      components: [
        ...original.components,
        {
          id: "firmware",
          label: "Firmware",
          kind: "software",
          description: "Control loop",
          x: 300,
          y: 450,
          ports: [],
          evidence: [],
        },
        {
          id: "driver",
          label: "Sensor driver",
          kind: "software",
          description: "Sensor input",
          x: 650,
          y: 450,
          ports: [],
          evidence: [],
        },
      ],
    },
  });
  await page.reload();
  await page.getByRole("button", { name: /^Hardware/ }).click();
  await page
    .getByRole("button", {
      name: "Connection from Controller to Temperature sensor: Serial",
      exact: true,
    })
    .click();
  await page.getByLabel("To", { exact: true }).selectOption("firmware");
  await expect(page.getByRole("button", { name: /^Diagram/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", {
      name: "Connection from Controller to Firmware: Serial",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Serial");
  await save(page);
  await page.getByRole("button", { name: /^Software/ }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("From", { exact: true })).toHaveValue(
    "firmware",
  );
  await expect(dialog.getByLabel("To", { exact: true })).toHaveValue("driver");
  await dialog.getByLabel("To", { exact: true }).selectOption("controller");
  await dialog.getByLabel("Connection label").fill("Controls board");
  await dialog
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  await expect(page.getByRole("button", { name: /^Diagram/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", {
      name: "Connection from Firmware to Controller: Controls board",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Controls board",
  );
  await save(page);
  const saved = (await workspace.call("system.get", {
    projectId,
  })) as SystemModel;
  expect(saved.connections).toHaveLength(2);
  expect(saved.connections[0]).toMatchObject({
    from: "controller",
    to: "firmware",
    label: "Serial",
    fromPort: "TX",
    evidence: original.connections[0].evidence,
  });
  expect(saved.connections[0].toPort).toBeUndefined();
  expect(saved.connections[1]).toMatchObject({
    from: "firmware",
    to: "controller",
    label: "Controls board",
  });
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
    const control = await selector.boundingBox();
    const chevron = await page.locator(".outline-control svg").boundingBox();
    expect(control).not.toBeNull();
    expect(chevron).not.toBeNull();
    const labelGeometry = await selector.evaluate(
      (element: HTMLSelectElement) => {
        const style = getComputedStyle(element);
        const context = document.createElement("canvas").getContext("2d")!;
        context.font = style.font;
        return {
          textWidth: context.measureText(element.selectedOptions[0].text).width,
          paddingLeft: parseFloat(style.paddingLeft),
        };
      },
    );
    expect(
      control!.x + labelGeometry.paddingLeft + labelGeometry.textWidth + 8,
    ).toBeLessThanOrEqual(chevron!.x);
    expect(chevron!.x + chevron!.width + 8).toBeLessThanOrEqual(
      control!.x + control!.width,
    );
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

test("test benches can be connected, enabled as tools, edited, and removed", async ({ page }, testInfo) => {
  await createProject(page);
  const requests: { method: string; args: Record<string, unknown> }[] = [];
  await page.route("**/api/call", async (route) => {
    const request = route.request().postDataJSON();
    if (!["benches.test", "benches.execute"].includes(request?.method)) {
      await route.continue();
      return;
    }
    requests.push(request);
    await route.fulfill({
      json: {
        result: {
          benchId: request.args.benchId,
          command: request.args.command || "printf 'Hyperbench SSH connection OK'",
          stdout: request.args.command === "big-output" ? "x".repeat(34_000) : request.method === "benches.test" ? "Hyperbench SSH connection OK\nLinux\n" : "<script>not executable markup</script>\nBench ready\n",
          stderr: "",
          exitCode: 0,
          signal: null,
          timedOut: false,
          truncated: request.args.command === "big-output",
          durationMs: 125,
        },
      },
    });
  });
  await page.getByRole("button", { name: /^Test benches/ }).click();
  await expect(page.getByRole("heading", { name: "Bring your test bench into the workspace" })).toBeVisible();
  await page.getByRole("button", { name: "Add your first test bench" }).click();
  await page.getByLabel("Bench name").fill("Motor bench");
  await page.getByLabel("Description (optional)").fill("Motor controller and UART loopback");
  await page.getByLabel("SSH host or config alias").fill("lab-bench");
  await expect(page.getByLabel("Port", { exact: true })).toHaveValue("22");
  await page.getByLabel("SSH username (optional)").fill("tester");
  await page.getByText("SSH key and host verification", { exact: true }).click();
  await page.getByLabel("Identity file (optional)").fill("~/.ssh/bench_ed25519");
  await page.getByLabel("Known hosts file (optional)").fill("~/.ssh/bench_known_hosts");
  const enable = page.getByRole("checkbox", { name: /^Enable remote commands for this bench/ });
  await expect(enable).not.toBeChecked();
  await page.getByRole("dialog").getByRole("button", { name: "Add test bench", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Motor bench", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Test benches/ })).toContainText("1");
  await expect(page.getByRole("button", { name: "Run command", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Shell command", { exact: true })).toBeDisabled();
  const added = (await workspace.call("benches.list", { projectId })) as TestBench[];
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ name: "Motor bench", host: "lab-bench", port: 22, username: "tester", enabled: false });
  expect(added[0].knownHostsFile).toMatch(/\/\.ssh\/bench_known_hosts$/);
  await page.getByRole("button", { name: "Test connection", exact: true }).click();
  await expect(page.getByText("Connection successful", { exact: true })).toBeVisible();
  expect(requests[0].method).toBe("benches.test");
  await expect(page.getByRole("button", { name: "Run command", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Edit bench", exact: true }).click();
  await expect(page.getByLabel("SSH host or config alias")).toHaveValue("lab-bench");
  await page.getByLabel("Port", { exact: true }).fill("2222");
  await enable.check();
  await page.getByRole("button", { name: "Save bench", exact: true }).click();
  await expect(page.getByText("Available to your agent", { exact: true })).toBeVisible();
  await page.getByLabel("Shell command", { exact: true }).fill("printf 'Bench ready\\n'");
  await page.getByLabel("Timeout (seconds)").fill("12");
  await page.getByRole("button", { name: "Run command", exact: true }).click();
  await expect(page.getByText("Command completed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Standard output", { exact: true })).toContainText("<script>not executable markup</script>");
  expect(requests[1]).toEqual({ method: "benches.execute", args: { projectId, benchId: added[0].id, command: "printf 'Bench ready\\n'", timeoutSeconds: 12 } });
  await expect(page.locator(".bench-result-heading")).toContainText("Exit 0");
  await page.screenshot({ path: testInfo.outputPath("test-bench-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Shell command", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("test-bench-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Shell command", { exact: true }).fill("big-output");
  await page.getByRole("button", { name: "Run command", exact: true }).click();
  await expect(page.getByText("Output limit reached", { exact: true })).toBeVisible();
  await expect(page.getByText("Command completed", { exact: true })).toHaveCount(0);
  expect((await page.getByLabel("Standard output", { exact: true }).textContent())?.length).toBe(32_000);
  await expect(page.getByText("Output was shortened to keep this result manageable.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /^Test benches/ }).click();
  await expect(page.getByRole("heading", { name: "Motor bench", exact: true })).toBeVisible();
  await expect(page.getByText("Available to your agent", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit bench", exact: true }).click();
  await expect(page.getByLabel("Port", { exact: true })).toHaveValue("2222");
  await enable.uncheck();
  await page.getByRole("button", { name: "Save bench", exact: true }).click();
  await expect(page.getByLabel("Shell command", { exact: true })).toBeDisabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bring your test bench into the workspace" })).toBeVisible();
  expect(await workspace.call("benches.list", { projectId })).toEqual([]);
});

test("a remote command result stays with its project when switching projects", async ({ page }) => {
  await createProject(page);
  const oldProjectId = projectId;
  const bench = await workspace.call("benches.add", { projectId, name: "Old project bench", host: "lab-bench", enabled: true }) as TestBench;
  await workspace.call("projects.create", { name: "New hardware project" });
  await page.reload();
  await page.getByRole("button", { name: /^Test benches/ }).click();
  await expect(page.getByRole("heading", { name: "Old project bench", exact: true })).toBeVisible();
  let release!: () => void;
  let notifyHeld!: () => void;
  const held = new Promise<void>((resolve) => { notifyHeld = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/call", async (route) => {
    const request = route.request().postDataJSON();
    if (request?.method !== "benches.execute") {
      await route.continue();
      return;
    }
    expect(request.args.projectId).toBe(oldProjectId);
    notifyHeld();
    await released;
    await route.fulfill({ json: { result: { benchId: bench.id, command: "uname -a", stdout: "Previous project output", stderr: "", exitCode: 0, signal: null, timedOut: false, truncated: false, durationMs: 100 } } });
  });
  try {
    await page.getByLabel("Shell command", { exact: true }).fill("uname -a");
    await page.getByRole("button", { name: "Run command", exact: true }).click();
    await held;
    await expect(page.getByText("Waiting for the remote command…", { exact: false })).toBeVisible();
    await page.locator(".project-switcher").click();
    await page.getByRole("dialog").getByRole("button", { name: /^N New hardware project/ }).click();
    await expect(page.getByRole("heading", { name: "Bring your test bench into the workspace" })).toBeVisible();
    const delivered = page.waitForResponse((response) => response.request().postDataJSON()?.method === "benches.execute");
    release();
    await delivered;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByText("Previous project output", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Command completed", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Test benches/ })).toContainText("—");
    await page.locator(".project-switcher").click();
    await page.getByRole("dialog").getByRole("button", { name: /^F Flight controller/ }).click();
    await expect(page.getByRole("heading", { name: "Old project bench", exact: true })).toBeVisible();
    await expect(page.getByLabel("Shell command", { exact: true })).toHaveValue("");
    await expect(page.getByText("Previous project output", { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
});
