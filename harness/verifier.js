"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
function resolveSafe(workspace, file) {
  const resolved = path.resolve(workspace, file);
  if (!inside(workspace, resolved)) throw new Error(`Verifier path is outside workspace: ${file}`);
  return resolved;
}

function verify(definition, options = {}) {
  const verifier = definition || {};
  const workspace = path.resolve(options.workspace || process.cwd());
  const started = Date.now();
  try {
    if (verifier.type === "command") {
      if (!verifier.command) throw new Error("command verifier requires command");
      const result = spawnSync(verifier.command, { cwd: workspace, shell: true, encoding: "utf8", timeout: verifier.timeout || 120000, maxBuffer: 2 * 1024 * 1024 });
      const expected = verifier.expectExitCode ?? 0;
      const exitCode = result.status ?? (result.error ? -1 : 0);
      return { ok: exitCode === expected, summary: `Command ${exitCode === expected ? "passed" : "failed"}: ${verifier.command}`, data: { command: verifier.command, exitCode, expectedExitCode: expected, stdout: String(result.stdout || "").slice(0, 8000), stderr: String(result.stderr || "").slice(0, 8000), ms: Date.now() - started }, error: result.error?.message || (exitCode === expected ? null : `expected exit ${expected}, received ${exitCode}`) };
    }
    if (verifier.type === "file-exists") {
      const file = resolveSafe(workspace, verifier.path);
      const ok = fs.existsSync(file);
      return { ok, summary: `File ${ok ? "exists" : "is missing"}: ${verifier.path}`, data: { path: file, ms: Date.now() - started }, error: ok ? null : "file not found" };
    }
    if (verifier.type === "file-contains") {
      const file = resolveSafe(workspace, verifier.path);
      const content = fs.readFileSync(file, "utf8");
      const pattern = verifier.pattern instanceof RegExp ? verifier.pattern : new RegExp(String(verifier.pattern), verifier.flags || "");
      const ok = pattern.test(content);
      return { ok, summary: `Content pattern ${ok ? "found" : "not found"} in ${verifier.path}`, data: { path: file, pattern: String(verifier.pattern), ms: Date.now() - started }, error: ok ? null : "content pattern not found" };
    }
    if (verifier.type === "json-field") {
      const file = resolveSafe(workspace, verifier.path);
      const value = String(verifier.field || "").split(".").filter(Boolean).reduce((current, key) => current?.[key], JSON.parse(fs.readFileSync(file, "utf8")));
      const ok = verifier.exists === false ? value === undefined : value !== undefined && (!("equals" in verifier) || value === verifier.equals);
      return { ok, summary: `JSON field ${verifier.field} ${ok ? "satisfied" : "failed"} in ${verifier.path}`, data: { path: file, field: verifier.field, value, ms: Date.now() - started }, error: ok ? null : "JSON assertion failed" };
    }
    throw new Error(`Unsupported verifier type: ${verifier.type || "missing"}`);
  } catch (error) {
    return { ok: false, summary: `Verifier failed: ${verifier.type || "unknown"}`, data: { ms: Date.now() - started }, error: error.message };
  }
}

module.exports = { verify, inside, resolveSafe };
