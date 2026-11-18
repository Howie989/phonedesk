// bun 1.3.x on macOS 27 emits a compiled binary with a malformed signature slot, and the
// kernel SIGKILLs it on launch (exit 137). Strip it and ad-hoc sign again. No-op elsewhere.
const file = process.argv[2] ?? "dist/phonedesk";
if (process.platform === "darwin") {
  for (const args of [["--remove-signature", file], ["--force", "-s", "-", file]]) {
    const p = Bun.spawnSync(["codesign", ...args], { stderr: "pipe" });
    if (p.exitCode !== 0) throw new Error(`codesign ${args.join(" ")}: ${p.stderr.toString().trim()}`);
  }
  console.log(`signed ${file} (ad-hoc)`);
}
