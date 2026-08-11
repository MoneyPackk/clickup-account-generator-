"use strict";

const fs = require("fs");
const path = require("path");

function atomicWrite(file, content, options = {}) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temp, content, options);
    fs.renameSync(temp, target);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch {}
    throw error;
  }
}

function atomicJson(file, value, options = {}) {
  atomicWrite(file, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600, ...options });
}

function safeJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return typeof fallback === "function" ? fallback() : fallback; }
}

module.exports = { atomicWrite, atomicJson, safeJson };
