#!/usr/bin/env bun
// web/deck/dist and web/manage/dist are generated (and git-ignored). Builds the web apps when either is missing,
// so a fresh clone can run the agent and the tests from scratch.
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const missing = ["deck", "manage"].filter((n) => !existsSync(join(root, "web", n, "dist", "index.html")));

if (missing.length) {
  console.log(`web/${missing.join(", web/")}: no dist yet, running build:web`);
  const p = Bun.spawn([process.execPath, "run", "build:web"], { cwd: root, stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) throw new Error("build:web failed");
}
