"use strict";

// Policy/audit control layer. Public execute() remains string-compatible;
// executeStructured() provides the stable internal contract.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const autonomy = require("./autonomy");
const missionApi = require("./harness");

const auditDir = process.env.MONEYPACK_AUDIT_DIR || path.join(os.homedir(), ".moneypack", "audit");
const destructiveCommands = [
  /(^|[;&|]\s*)format(?:\.com)?\s/i,
  /(^|[;&|]\s*)diskpart(?:\.exe)?(?:\s|$)/i,
  /\bremove-item\b(?=[^\r\n]*\s-(?:recurse|r)\b)/i,
  /\brm\s+-[^\r\n]*r[^\r\n]*f[^\r\n]*(?:^|\s)[/\\](?:\s|$)/i,
  /(^|[;&|]\s*)shutdown(?:\.exe)?\s/i,
  /(^|[;&|]\s*)reg(?:\.exe)?\s+delete\s/i,
  /\bdel\s+\/s\s+\/q\s+[a-z]:\\/i,
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/
];
const strictCommands = [
  ...destructiveCommands,
  /\b(?:curl|wget|invoke-webrequest)\b/i,
  /\b(?:powershell|pwsh|cmd)\b[^\r\n]*(?:-enc|-encodedcommand|\/c)/i
];
const secretKey = /authorization|api[-_]?key|token|password|secret|cookie/i;
const pathArguments = {
  read_file: ["path"], write_file: ["path"], edit_file: ["path"],
  list_dir: ["path"], grep: ["path"], download: ["dest"], shell: ["cwd"]
};

function policyMode(env = process.env) {
  const mode = String(env.MONEYPACK_POLICY || "safe").toLowerCase();
  return ["off", "audit", "safe", "strict"].includes(mode) ? mode : "safe";
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function redact(value, key = "") {
  if (secretKey.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  if (typeof value === "string" && value.length > 2000) return value.slice(0, 2000) + "…[TRUNCATED]";
  return value;
}

function rotateAudit() {
  try {
    const retention = Math.max(1, Number(process.env.MONEYPACK_AUDIT_RETENTION_DAYS) || 30);
    const cutoff = Date.now() - retention * 86400000;
    for (const name of fs.readdirSync(auditDir)) {
      const file = path.join(auditDir, name);
      if (name.endsWith(".jsonl") && fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
    }
  } catch {}
}

function record(event, data = {}) {
  fs.mkdirSync(auditDir, { recursive: true });
  rotateAudit();
  const row = JSON.stringify({ time: new Date().toISOString(), event, ...redact(data) }) + "\n";
  fs.appendFileSync(path.join(auditDir, new Date().toISOString().slice(0, 10) + ".jsonl"), row);
}

function blocked(code, reason, mode, alternatives = [], confirmation = false) {
  return { allowed: false, status: confirmation ? "needs_confirmation" : "blocked", code, reason, mode, alternatives, confirmation };
}
function decision(tool, args = {}, options = {}) {
  const mode = options.mode || policyMode();
  const profile = autonomy.normalizeProfile(options.profile || autonomy.readSettings().profile);
  if (mode === "off" || mode === "audit") return { allowed: true, status: "allowed", reason: mode, mode, profile };

  const mutations = new Set(["write_file","edit_file","download","install_package","process_kill","clipboard_write"]);
  if (profile === "readonly" && (mutations.has(tool) || tool === "shell"))
    return blocked("READ_ONLY_PROFILE", `${tool} mutates state in read-only mode`, mode, ["switch_to_creative", "generate_patch_only"], false);

  if (tool === "process_kill") {
    const pid = Number(args.pid);
    if (!Number.isInteger(pid) || pid <= 4 || pid === process.pid)
      return blocked("PROTECTED_PROCESS", "protected or invalid process ID", mode, ["inspect_process", "choose_valid_pid"]);
  }

  if (tool === "shell") {
    const command = String(args.command || "").replace(/\s+/g, " ").trim();
    const patterns = mode === "strict" ? strictCommands : destructiveCommands;
    if (patterns.some(pattern => pattern.test(command)))
      return blocked("DESTRUCTIVE_COMMAND", `command requires an explicit, isolated execution path`, mode, ["run_in_sandbox", "reduce_scope", "create_checkpoint"], true);
  }

  const root = options.workspace || process.env.MONEYPACK_WORKSPACE || autonomy.readSettings().workspace;
  if (root && pathArguments[tool]) for (const key of pathArguments[tool]) {
    if (!args[key]) continue;
    const candidate = path.isAbsolute(args[key]) ? args[key] : path.resolve(args.cwd || process.cwd(), args[key]);
    if (!isWithin(root, candidate) && profile !== "trusted")
      return blocked("OUTSIDE_WORKSPACE", `${key} is outside the active workspace`, mode, ["grant_path_for_session", "copy_into_workspace", "generate_patch_only"], true);
  }
  return { allowed: true, status: "allowed", reason: "allowed", mode, profile };
}

function normalizeResult(value) {
  if (value && typeof value === "object" && typeof value.ok === "boolean" && "output" in value) return value;
  const output = String(value ?? "");
  const failed = /^(?:Error:|Exit\s|.*? error:|.*? failed:)/i.test(output);
  return { ok: !failed, output, data: null, error: failed ? output.replace(/^Error:\s*/i, "") : null };
}

async function executeStructured(tool, args, executor, options = {}) {
  const id = crypto.randomUUID();
  const scope = options.missionId ? {
    missionId: String(options.missionId),
    stepId: options.stepId ? String(options.stepId) : null,
    criterionIds: [...new Set((options.criterionIds || []).map(String))],
    root: options.missionRoot || null
  } : null;
  const policy = decision(tool, args, options);
  record("tool.requested", { id, tool, args, policy, scope });
  if (!policy.allowed) {
    const result = { ok: false, output: `Error: blocked [${policy.code}] ${policy.reason}. Alternatives: ${(policy.alternatives || []).join(", ") || "none"}`, data: { policy, blocker: policy }, error: `blocked [${policy.code}]: ${policy.reason}` };
    record("tool.denied", { id, tool, reason: policy.reason, scope });
    if (scope) recordMissionEvidence(scope, tool, result, "blocked");
    return result;
  }
  const started = Date.now();
  try {
    const result = normalizeResult(await executor(tool, args));
    record(result.ok ? "tool.completed" : "tool.failed", {
      id, tool, ms: Date.now() - started, error: result.error, scope
    });
    if (scope) recordMissionEvidence(scope, tool, result, result.ok ? (options.evidenceType || "observed") : "observed");
    return result;
  } catch (error) {
    const result = { ok: false, output: `Error: ${error.message}`, data: null, error: error.message };
    record("tool.failed", { id, tool, ms: Date.now() - started, error: error.message, scope });
    if (scope) recordMissionEvidence(scope, tool, result, "observed");
    return result;
  }
}

function recordMissionEvidence(scope, tool, result, type) {
  try {
    const missions = new missionApi.MissionHarness({ root: scope.root || undefined });
    missions.record(scope.missionId, {
      type,
      summary: `${tool} ${result.ok ? "completed" : "failed"}`,
      ok: result.ok,
      tool,
      stepId: scope.stepId,
      criterionIds: scope.criterionIds,
      data: { output: String(result.output || "").slice(0, 8000), resultData: result.data },
      error: result.error
    });
  } catch (error) {
    record("mission.evidence_failed", { missionId: scope.missionId, tool, error: error.message });
  }
}

async function execute(tool, args, executor, options = {}) {
  return (await executeStructured(tool, args, executor, options)).output;
}

module.exports = {
  execute, executeStructured, normalizeResult, decision, policyMode, blocked,
  record, redact, auditDir, isWithin,
  mission: missionApi, MissionHarness: missionApi.MissionHarness
};
