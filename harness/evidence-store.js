"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const TYPES = new Set(["observed", "changed", "verified", "inferred", "user_confirmed", "blocked"]);
function defaultRoot() { return process.env.MONEYPACK_MISSION_DIR || path.join(os.homedir(), ".moneypack", "missions"); }
function safeId(id) { return String(id || "").replace(/[^a-zA-Z0-9_.-]/g, "_"); }

class EvidenceStore {
  constructor(root = defaultRoot()) { this.root = root; }
  file(missionId) { return path.join(this.root, "evidence", `${safeId(missionId)}.jsonl`); }
  append(missionId, input = {}) {
    if (!missionId) throw new Error("missionId is required for evidence");
    const type = String(input.type || "observed").toLowerCase();
    if (!TYPES.has(type)) throw new Error(`Invalid evidence type: ${type}`);
    const evidence = {
      id: input.id || `evidence-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`,
      missionId: String(missionId), type,
      summary: String(input.summary || "").trim(),
      ok: typeof input.ok === "boolean" ? input.ok : null,
      tool: input.tool || null, stepId: input.stepId || null,
      criterionIds: [...new Set((input.criterionIds || []).map(String))],
      data: input.data ?? null, error: input.error || null,
      createdAt: input.createdAt || new Date().toISOString()
    };
    if (!evidence.summary) throw new Error("evidence summary is required");
    const file = this.file(missionId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(evidence) + "\n", "utf8");
    return evidence;
  }
  list(missionId) {
    try { return fs.readFileSync(this.file(missionId), "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  }
  get(missionId, evidenceId) { return this.list(missionId).find(item => item.id === evidenceId) || null; }
}

module.exports = { EvidenceStore, TYPES, defaultRoot };
