import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  sourcemap: true,
});
await viteBuild({
  root: "ui",
  base: "./",
  build: { outDir: "../dist/ui", emptyOutDir: true },
  logLevel: "warn",
});
console.log("Built local CLI, MCP server and browser workspace.");
