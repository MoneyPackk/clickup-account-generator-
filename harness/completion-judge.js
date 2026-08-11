"use strict";

function judge(mission) {
  const criteria = mission.criteria || [];
  const required = criteria.filter(item => item.required !== false);
  const optional = criteria.filter(item => item.required === false);
  const counts = criteria.reduce((out, item) => (out[item.status] = (out[item.status] || 0) + 1, out), {});
  let status, code, reason;
  if (required.some(item => item.status === "failed")) {
    status = "failed"; code = "REQUIRED_CRITERION_FAILED"; reason = "At least one required acceptance criterion failed.";
  } else if (required.some(item => item.status === "blocked")) {
    status = "blocked"; code = "REQUIRED_CRITERION_BLOCKED"; reason = "At least one required acceptance criterion is blocked.";
  } else if (required.some(item => !["verified", "skipped"].includes(item.status)) || required.some(item => item.status === "skipped")) {
    status = "incomplete"; code = "REQUIRED_CRITERIA_PENDING"; reason = "Required acceptance criteria remain unverified.";
  } else if (optional.some(item => item.status !== "verified")) {
    status = "complete_with_notes"; code = "OPTIONAL_CRITERIA_REMAIN"; reason = "All required criteria are verified; optional criteria remain.";
  } else {
    status = "complete"; code = "ALL_CRITERIA_VERIFIED"; reason = criteria.length ? "All acceptance criteria are verified." : "Mission has no acceptance criteria.";
  }
  return { status, code, reason, counts, requiredVerified: required.filter(item => item.status === "verified").length, requiredTotal: required.length, evaluatedAt: new Date().toISOString() };
}

function applyVerdict(mission) { const verdict = judge(mission); return { ...mission, status: verdict.status, verdict, updatedAt: verdict.evaluatedAt }; }
module.exports = { judge, applyVerdict };
