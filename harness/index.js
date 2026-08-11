"use strict";

const { MissionStore } = require("./mission-store");
const { EvidenceStore } = require("./evidence-store");
const schema = require("./mission-schema");
const completion = require("./completion-judge");
const reporter = require("./reporter");
const verifier = require("./verifier");

class MissionHarness {
  constructor(options = {}) {
    this.missions = options.missions || new MissionStore(options.root);
    this.evidence = options.evidence || new EvidenceStore(options.root);
  }
  create(input) { return this.missions.create(input); }
  load(id) { return this.missions.load(id); }
  list() { return this.missions.list(); }
  update(id, patch) { return this.missions.update(id, patch); }
  setStatus(id, status, note = "") {
    if (!schema.MISSION_STATUSES.has(status)) throw new Error(`Invalid mission status: ${status}`);
    return this.update(id, mission => {
      mission.status = status;
      if (note) mission.metadata.lastStatusNote = String(note);
      return mission;
    });
  }
  start(id) { return this.setStatus(id, "running"); }
  pause(id, note = "Paused") { return this.setStatus(id, "paused", note); }
  resume(id) {
    return this.update(id, mission => {
      if (["complete", "complete_with_notes", "cancelled"].includes(mission.status)) throw new Error(`Cannot resume ${mission.status} mission`);
      mission.status = "running";
      for (const step of mission.plan) if (step.status === "running") { step.status = "pending"; step.note = "Recovered after interruption"; }
      mission.metadata.resumedAt = new Date().toISOString();
      return mission;
    });
  }
  cancel(id, note = "Cancelled by operator") { return this.setStatus(id, "cancelled", note); }
  updateStep(id, stepId, status, note = "") {
    if (!schema.ITEM_STATUSES.has(status)) throw new Error(`Invalid step status: ${status}`);
    return this.update(id, mission => {
      const step = mission.plan.find(item => item.id === stepId);
      if (!step) throw new Error(`Step not found: ${stepId}`);
      step.status = status;
      if (note) step.note = String(note);
      if (status === "running" && mission.status === "planned") mission.status = "running";
      return mission;
    });
  }
  recover() {
    const recovered = [];
    for (const mission of this.list().filter(item => item.status === "running")) {
      if (!mission.plan.some(step => step.status === "running")) continue;
      recovered.push(this.update(mission.id, current => {
        current.status = "paused";
        current.metadata.recoveryRequired = true;
        for (const step of current.plan) if (step.status === "running") { step.status = "pending"; step.note = "Interrupted; safe to resume"; }
        return current;
      }));
    }
    return recovered;
  }
  record(missionId, input) {
    const mission = this.load(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);
    const item = this.evidence.append(missionId, input);
    this.missions.update(missionId, current => {
      current.evidenceIds = [...new Set([...(current.evidenceIds || []), item.id])];
      for (const criterionId of item.criterionIds) {
        const criterion = current.criteria.find(candidate => candidate.id === criterionId);
        if (!criterion) continue;
        criterion.evidenceIds = [...new Set([...(criterion.evidenceIds || []), item.id])];
        if (item.type === "verified") criterion.status = item.ok ? "verified" : "failed";
        if (item.type === "blocked") criterion.status = "blocked";
      }
      return current;
    });
    return item;
  }
  runVerifier(missionId, criterionId, options = {}) {
    const mission = this.load(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);
    const criterion = mission.criteria.find(item => item.id === criterionId);
    if (!criterion) throw new Error(`Criterion not found: ${criterionId}`);
    if (!criterion.verifier) throw new Error(`Criterion has no verifier: ${criterionId}`);
    const result = verifier.verify(criterion.verifier, options);
    const item = this.record(missionId, { type: "verified", summary: result.summary, ok: result.ok, criterionIds: [criterionId], data: result.data, error: result.error });
    return { result, evidence: item, mission: this.load(missionId) };
  }
  verifyAll(missionId, options = {}) {
    const mission = this.load(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);
    const results = [];
    for (const criterion of mission.criteria) {
      if (!criterion.verifier) continue;
      results.push({ criterionId: criterion.id, ...this.runVerifier(missionId, criterion.id, options) });
    }
    return { results, mission: this.judge(missionId) };
  }
  judge(missionId, persist = true) {
    const mission = this.load(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);
    const judged = completion.applyVerdict(mission);
    return persist ? this.missions.save(judged) : judged;
  }
  brief(missionId) {
    const mission = this.load(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);
    return reporter.brief(mission, this.evidence.list(missionId));
  }
}

module.exports = { MissionHarness, MissionStore, EvidenceStore, ...schema, ...completion, ...reporter, ...verifier };
