"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const runtime = require("./moneypack-harness");
const { MissionHarness } = require("./harness");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "moneypack-harness-v1-"));
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "proof.txt"), "Plan. Execute. Prove.\n");
  try {
    const harness = new MissionHarness({ root: path.join(root, "missions") });
    let mission = harness.create({
      title: "Harness V1 Proof",
      objective: "Prove persistent missions and deterministic verification",
      criteria: [
        { id: "file", requirement: "Proof file exists", verifier: { type: "file-exists", path: "proof.txt" } },
        { id: "content", requirement: "Proof contains the product principle", verifier: { type: "file-contains", path: "proof.txt", pattern: "Plan\\. Execute\\. Prove\\." } },
        { id: "optional", requirement: "Optional future check", required: false }
      ],
      plan: [{ id: "verify", title: "Verify fixture", criterionIds: ["file", "content"] }]
    });
    assert.ok(fs.existsSync(path.join(root, "missions", `${mission.id}.json`)), "mission persists atomically");
    assert.equal(new MissionHarness({ root: path.join(root, "missions") }).load(mission.id).title, mission.title, "mission survives a new harness instance");

    const scoped = await runtime.executeStructured("read_file", { path: path.join(workspace, "proof.txt") }, async () => "observed output", {
      missionId: mission.id, missionRoot: path.join(root, "missions"), stepId: "verify", criterionIds: ["file"], evidenceType: "observed",
      workspace, mode: "safe"
    });
    assert.equal(scoped.ok, true);
    mission = harness.load(mission.id);
    assert.equal(mission.criteria.find(item => item.id === "file").status, "pending", "observation must not claim verification");

    assert.equal(harness.runVerifier(mission.id, "file", { workspace }).result.ok, true);
    assert.equal(harness.runVerifier(mission.id, "content", { workspace }).result.ok, true);
    mission = harness.judge(mission.id);
    assert.equal(mission.status, "complete_with_notes");
    assert.equal(mission.criteria.find(item => item.id === "file").status, "verified");
    assert.match(harness.brief(mission.id), /2\/3 verified/);
    assert.match(harness.brief(mission.id), /OPTIONAL FUTURE CHECK/i);

    const lines = fs.readFileSync(path.join(root, "missions", "evidence", `${mission.id}.jsonl`), "utf8").trim().split(/\r?\n/);
    assert.equal(lines.length, 3, "tool observation and two verifier results are append-only evidence");

    const failed = harness.create({ title: "Honest Failure", criteria: [{ id: "missing", requirement: "Missing file exists", verifier: { type: "file-exists", path: "missing.txt" } }] });
    assert.equal(harness.runVerifier(failed.id, "missing", { workspace }).result.ok, false);
    assert.equal(harness.judge(failed.id).status, "failed");

    const recovered = harness.create({ title: "Recovery", plan: [{ id: "work", title: "Work", status: "running" }] });
    harness.start(recovered.id);
    assert.equal(harness.recover().some(item => item.id === recovered.id), true);
    assert.equal(harness.load(recovered.id).plan[0].status, "pending", "interrupted running step is safely reset");
    assert.equal(harness.resume(recovered.id).status, "running");
    assert.equal(harness.cancel(recovered.id).status, "cancelled");

    const all = harness.create({ title: "Verify All", criteria: [{ id: "proof", requirement: "proof", verifier: { type: "file-exists", path: "proof.txt" } }] });
    assert.equal(harness.verifyAll(all.id, { workspace }).mission.status, "complete");

    console.log("PASS: Harness V1 persistence, lifecycle/recovery, scoped evidence, verification, honest verdicts, CLI-ready API, MoneyPack Brief");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.stack || error); process.exit(1); });
