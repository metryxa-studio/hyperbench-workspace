import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { startBrowserServer } from "../src/server.js";
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "hb-http-"));
  await writeFile(path.join(dir, "index.html"), "<h1>Hyperbench</h1>");
  const calls: any[] = [];
  const server = await startBrowserServer(
    {
      async call(method, args) {
        calls.push({ method, args });
        return { ok: true };
      },
      async documentFile() {
        return {
          path: path.join(dir, "index.html"),
          name: "unsafe.html",
          mime: "text/html",
        };
      },
    },
    {
      dataDir: dir,
      uiDir: dir,
      cliPath: "/cli.js",
      nodePath: process.execPath,
    },
  );
  return {
    ...server,
    calls,
    dir,
    headers: {
      Authorization: `Bearer ${server.token}`,
      "Content-Type": "application/json",
    },
    cleanup: async () => {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test("local API requires session token; UI never embeds it", async () => {
  const s = await fixture();
  try {
    const ui = await fetch(s.origin);
    assert.equal(ui.status, 200);
    assert.equal((await ui.text()).includes(s.token), false);
    assert.equal((await fetch(s.origin + "/api/config")).status, 401);
    const config = await fetch(s.origin + "/api/config", {
      headers: s.headers,
    });
    assert.equal(config.status, 200);
    assert.equal((await config.json()).cliPath, "/cli.js");
  } finally {
    await s.cleanup();
  }
});
test("foreign origins and cross-site requests cannot use even a known bearer", async () => {
  const s = await fixture();
  try {
    for (const headers of [
      { ...s.headers, Origin: "https://evil.invalid" },
      { ...s.headers, "Sec-Fetch-Site": "cross-site" },
    ])
      assert.equal(
        (await fetch(s.origin + "/api/config", { headers })).status,
        403,
      );
    assert.equal(s.calls.length, 0);
  } finally {
    await s.cleanup();
  }
});
test("DNS rebinding host header is rejected", async () => {
  const s = await fixture();
  try {
    const status = await new Promise<number>((resolve) => {
      const req = http.get(
        s.origin,
        { headers: { Host: "evil.invalid" } },
        (r) => {
          r.resume();
          resolve(r.statusCode!);
        },
      );
      req.on("error", () => resolve(0));
    });
    assert.equal(status, 403);
  } finally {
    await s.cleanup();
  }
});
test("RPC validates requests and uses same-origin auth without query tokens", async () => {
  const s = await fixture();
  try {
    assert.equal(
      (
        await fetch(s.origin + "/api/call", {
          method: "POST",
          headers: s.headers,
          body: JSON.stringify({ method: "shell", args: {} }),
        })
      ).status,
      400,
    );
    const response = await fetch(s.origin + "/api/call", {
      method: "POST",
      headers: s.headers,
      body: JSON.stringify({ method: "projects.list", args: {} }),
    });
    assert.deepEqual(await response.json(), { result: { ok: true } });
    assert.equal(s.calls.length, 1);
    assert.equal(
      (await fetch(s.origin + "/api/config?token=" + s.token)).status,
      401,
    );
  } finally {
    await s.cleanup();
  }
});
test("original documents download as attachments and cannot execute HTML", async () => {
  const s = await fixture();
  try {
    const response = await fetch(
      s.origin + "/api/file?projectId=p&documentId=d",
      { headers: s.headers },
    );
    assert.equal(
      response.headers.get("content-type"),
      "application/octet-stream",
    );
    assert.match(response.headers.get("content-disposition")!, /^attachment/);
  } finally {
    await s.cleanup();
  }
});
test("static files do not permit filesystem escape", async () => {
  const s = await fixture();
  try {
    const response = await fetch(s.origin + "/%2e%2e%2fpackage.json");
    assert.equal(response.status, 404);
    const head = await fetch(s.origin, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  } finally {
    await s.cleanup();
  }
});
