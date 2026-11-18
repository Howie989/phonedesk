#!/usr/bin/env bun
// web/shared/icon-catalog.json is generated (and git-ignored). Regenerates it (and web/shared/icons.ts) when missing,
// installing the icon packages first if needed, so a fresh clone can build and test from scratch.
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const catalog = join(root, "web", "shared", "icon-catalog.json");

async function run(argv: string[]) {
  const p = Bun.spawn(argv, { cwd: root, stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) throw new Error(`${argv.join(" ")} failed`);
}

if (!existsSync(catalog)) {
  if (!existsSync(join(root, "node_modules", "@tabler", "icons"))) await run([process.execPath, "install"]);
  console.log("icon-catalog.json is missing: running gen-icons");
  await run([process.execPath, "scripts/gen-icons.ts"]);
}
