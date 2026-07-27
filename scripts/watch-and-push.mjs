#!/usr/bin/env node
/**
 * Watches for changes under artifacts/api-server/src and lib/,
 * then debounces 8 seconds before auto-committing and pushing to GitHub.
 */
import { watch } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WATCH_DIRS = ["artifacts/api-server/src", "lib"];
const DEBOUNCE_MS = 8000;

let timer = null;
let pending = false;

function push() {
  try {
    const status = execSync("git status --porcelain", { cwd: ROOT })
      .toString()
      .trim();
    if (!status) {
      console.log("[autopush] No changes to commit.");
      return;
    }
    console.log("[autopush] Changes detected — committing and pushing...");
    execSync("git config user.email 'bot@replit.local'", { cwd: ROOT });
    execSync("git config user.name 'Replit Autopush'", { cwd: ROOT });
    execSync("git add -A", { cwd: ROOT, stdio: "inherit" });
    const msg = `Auto-update bot code ${new Date().toISOString()}`;
    execSync(`git commit -m "${msg}"`, { cwd: ROOT, stdio: "inherit" });
    execSync("git push origin main", { cwd: ROOT, stdio: "inherit" });
    console.log("[autopush] Pushed to GitHub ✓");
  } catch (err) {
    console.error("[autopush] Push failed:", err.message);
  }
  pending = false;
}

function schedule() {
  if (timer) clearTimeout(timer);
  if (!pending) {
    pending = true;
    console.log(`[autopush] Change detected — pushing in ${DEBOUNCE_MS / 1000}s...`);
  }
  timer = setTimeout(push, DEBOUNCE_MS);
}

for (const dir of WATCH_DIRS) {
  const abs = resolve(ROOT, dir);
  try {
    watch(abs, { recursive: true }, (event, filename) => {
      if (!filename) return;
      // Ignore build output and node_modules
      if (
        filename.includes("node_modules") ||
        filename.includes("dist/") ||
        filename.endsWith(".tsbuildinfo")
      )
        return;
      schedule();
    });
    console.log(`[autopush] Watching ${dir}`);
  } catch {
    console.warn(`[autopush] Could not watch ${dir} (may not exist yet)`);
  }
}

console.log("[autopush] Ready — saves will auto-push to GitHub after 8s of inactivity.");
