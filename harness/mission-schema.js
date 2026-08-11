"use strict";

const crypto = require("crypto");

const SCHEMA_VERSION = 1;
const MISSION_STATUSES = new Set(["planned", "running", "paused", "awaiting_approval", "complete", "complete_with_notes", "incomplete", "blocked", "failed", "cancelled"]);
const ITEM_STATUSES = new Set(["pending", "running", "verified", "failed", "blocked", "skipped"]);

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`; }
function text(value, fallback = "") { return String(value ?? fallback).trim(); }

function normalizeCriterion(value, index = 0) {
  const criterion = typeof value === "string" ? { requirement: value } : { ...(value || {}) };
  return {
    id: text(criterion.id) || `criterion-${index + 1}`,
    requirement: text(criterion.requirement || criterion.title),
    required: criterion.required !== false,
    status: ITEM_STATUSES.has(criterion.status) ? criterion.status : "pending",
    verifier: criterion.verifier || null,
    evidenceIds: [...new Set(Array.isArray(criterion.evidenceIds) ? criterion.evidenceIds.map(String) : [])],
    note: text(criterion.note)
  };
}

function normalizeStep(value, index = 0) {
  const step = typeof value === "string" ? { title: value } : { ...(value || {}) };
  return {
    id: text(step.id) || `step-${index + 1}`,
    title: text(step.title || step.requirement),
    status: ITEM_STATUSES.has(step.status) ? step.status : "pending",
    criterionIds: [...new Set(Array.isArray(step.criterionIds) ? step.criterionIds.map(String) : [])],
    note: text(step.note)
  };
}

function createMission(input = {}) {
  const createdAt = input.createdAt || now();
  const mission = {
    schemaVersion: SCHEMA_VERSION,
    id: text(input.id) || id("mission"),
    title: text(input.title, "Untitled Mission"),
    objective: text(input.objective || input.title),
    status: MISSION_STATUSES.has(input.status) ? input.status : "planned",
    criteria: (input.criteria || []).map(normalizeCriterion),
    constraints: [...new Set((input.constraints || []).map(item => text(item)).filter(Boolean))],
    plan: (input.plan || []).map(normalizeStep),
    evidenceIds: [...new Set((input.evidenceIds || []).map(String))],
    verdict: input.verdict || null,
    metadata: input.metadata && typeof input.metadata === "object" ? { ...input.metadata } : {},
    createdAt,
    updatedAt: input.updatedAt || createdAt
  };
  validateMission(mission);
  return mission;
}

function validateMission(mission) {
  const errors = [];
  if (!mission || typeof mission !== "object") errors.push("mission must be an object");
  else {
    if (!text(mission.id)) errors.push("id is required");
    if (!text(mission.title)) errors.push("title is required");
    if (!text(mission.objective)) errors.push("objective is required");
    if (!MISSION_STATUSES.has(mission.status)) errors.push(`invalid mission status: ${mission.status}`);
    const criterionIds = new Set();
    for (const criterion of mission.criteria || []) {
      if (!criterion.requirement) errors.push(`${criterion.id || "criterion"}: requirement is required`);
      if (criterionIds.has(criterion.id)) errors.push(`duplicate criterion id: ${criterion.id}`);
      criterionIds.add(criterion.id);
    }
    const stepIds = new Set();
    for (const step of mission.plan || []) {
      if (!step.title) errors.push(`${step.id || "step"}: title is required`);
      if (stepIds.has(step.id)) errors.push(`duplicate step id: ${step.id}`);
      stepIds.add(step.id);
      for (const criterionId of step.criterionIds || []) if (!criterionIds.has(criterionId)) errors.push(`${step.id}: unknown criterion ${criterionId}`);
    }
  }
  if (errors.length) throw new Error(`Invalid mission: ${errors.join("; ")}`);
  return true;
}

module.exports = { SCHEMA_VERSION, MISSION_STATUSES, ITEM_STATUSES, createMission, validateMission, normalizeCriterion, normalizeStep, id, now };
