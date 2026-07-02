#!/usr/bin/env node
/**
 * npm `prepare` hook. When this package is consumed as a `file:` dependency,
 * npm runs `prepare` here without installing our devDependencies first — so
 * bootstrap them (guarded against recursion) before building `dist/`.
 */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const GUARD = "MUSIC_ROLL_PREPARING";
if (process.env[GUARD]) process.exit(0); // inner install: the outer run builds

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, env = {}) =>
  execSync(cmd, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });

if (!existsSync(join(root, "node_modules", "typescript"))) {
  run("npm install --no-audit --no-fund", { [GUARD]: "1" });
}
run("npm run build");
