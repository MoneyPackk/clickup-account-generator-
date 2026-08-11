"use strict";

const os = require("os");
const path = require("path");
const { atomicJson, safeJson } = require("./storage");

const SETTINGS_FILE = process.env.MONEYPACK_SETTINGS_FILE || path.join(os.homedir(), ".moneypack", "settings.json");
const PROFILES = Object.freeze({
  readonly: { label: "READ ONLY", description: "Inspect and reason without persistent mutations." },
  creative: { label: "CREATIVE", description: "Build freely in the workspace; confirm only consequential external actions." },
  sandbox: { label: "SANDBOX", description: "Experiment freely inside an isolated workspace." },
  trusted: { label: "TRUSTED", description: "Broad local autonomy with irreversible safeguards retained." }
});

function normalizeProfile(value) {
  const name = String(value || "creative").toLowerCase();
  return Object.hasOwn(PROFILES, name) ? name : "creative";
}
function readSettings() {
  const saved = safeJson(SETTINGS_FILE, {});
  return { profile: normalizeProfile(process.env.MONEYPACK_AUTONOMY || saved.profile), workspace: saved.workspace || process.cwd(), ...saved };
}
function writeSettings(patch) {
  const next = { ...readSettings(), ...patch, profile: normalizeProfile(patch.profile ?? readSettings().profile) };
  atomicJson(SETTINGS_FILE, next);
  return next;
}
function setProfile(profile) { return writeSettings({ profile: normalizeProfile(profile) }); }

const CREATION_POLICY = `You are a creation-first coding agent working for the user. Default to helping and producing a working result. Do not reject requests merely because they are unusual, experimental, controversial, complex, or potentially dual-use. Assume the user is authorized to create and modify resources inside the active workspace. Use tools to inspect, build, test, and verify rather than stopping at advice. Distinguish generating code from executing consequential actions. If an operation is unavailable or blocked, preserve the user's intent: identify the exact technical blocker, try a safe scoped or reversible alternative, and continue with a patch, simulation, or instructions when execution is impossible. Do not moralize or infer harmful intent without concrete evidence. Ask a question only when ambiguity would materially change an irreversible or external result; otherwise state a reasonable assumption and proceed. Never claim an action succeeded unless tool output verifies it.`;

module.exports = { SETTINGS_FILE, PROFILES, CREATION_POLICY, normalizeProfile, readSettings, writeSettings, setProfile };
