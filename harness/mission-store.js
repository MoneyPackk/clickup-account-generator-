"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createMission, validateMission, now } = require("./mission-schema");

function defaultRoot() { return process.env.MONEYPACK_MISSION_DIR || path.join(os.homedir(), ".moneypack", "missions"); }
function safeId(id) { return String(id || "").replace(/[^a-zA-Z0-9_.-]/g, "_"); }
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temp, file);
}

class MissionStore {
  constructor(root = defaultRoot()) { this.root = root; }
  file(id) { return path.join(this.root, `${safeId(id)}.json`); }
  create(input) { const mission = createMission(input); return this.save(mission); }
  save(input) {
    const mission = createMission({ ...input, updatedAt: now() });
    validateMission(mission);
    atomicJson(this.file(mission.id), mission);
    return mission;
  }
  load(id) {
    try { return createMission(JSON.parse(fs.readFileSync(this.file(id), "utf8"))); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  update(id, mutate) {
    const current = this.load(id);
    if (!current) throw new Error(`Mission not found: ${id}`);
    const changed = typeof mutate === "function" ? mutate(structuredClone(current)) : { ...current, ...(mutate || {}) };
    if (!changed || changed.id !== current.id) throw new Error("Mission update cannot change its identity");
    return this.save(changed);
  }
  list() {
    try { return fs.readdirSync(this.root).filter(name => name.endsWith(".json")).map(name => this.load(name.slice(0, -5))).filter(Boolean).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  }
}

module.exports = { MissionStore, defaultRoot, atomicJson };
