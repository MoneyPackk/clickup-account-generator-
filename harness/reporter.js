"use strict";

function brief(mission, evidence = []) {
  const verdict = mission.verdict || require("./completion-judge").judge(mission);
  const verified = (mission.criteria || []).filter(item => item.status === "verified");
  const remaining = (mission.criteria || []).filter(item => item.status !== "verified");
  const types = evidence.reduce((out, item) => (out[item.type] = (out[item.type] || 0) + 1, out), {});
  const lines = [
    `MONEYPACK BRIEF — ${mission.title.toUpperCase()}`,
    "",
    `Verdict     ${verdict.status.replaceAll("_", " ").toUpperCase()}`,
    `Criteria    ${verified.length}/${(mission.criteria || []).length} verified`,
    `Evidence    ${evidence.length} records`,
    `Mission ID  ${mission.id}`,
    "",
    "Verified"
  ];
  lines.push(...(verified.length ? verified.map(item => `✓ ${item.requirement}`) : ["— Nothing verified yet"]));
  lines.push("", "Remaining");
  lines.push(...(remaining.length ? remaining.map(item => `${item.status === "blocked" ? "!" : "○"} ${item.requirement} [${item.status}]`) : ["— No remaining criteria"]));
  lines.push("", "Evidence ledger");
  lines.push(...(Object.keys(types).length ? Object.entries(types).map(([type,count]) => `${type.toUpperCase()}  ${count}`) : ["— No evidence recorded"]));
  lines.push("", `Reason: ${verdict.reason}`);
  return lines.join("\n");
}
module.exports = { brief };
