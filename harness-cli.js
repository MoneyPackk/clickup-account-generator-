#!/usr/bin/env node
"use strict";

const path = require("path");
const { MissionHarness } = require("./harness");

function option(args, name, fallback = null) {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
}
function printMission(mission) {
  console.log(JSON.stringify(mission, null, 2));
}
function usage() {
  console.log(`MoneyPack Harness V1

Usage:
  moneypack-mission create "goal" [--workspace PATH]
  moneypack-mission list
  moneypack-mission show ID
  moneypack-mission resume ID
  moneypack-mission cancel ID [reason]
  moneypack-mission verify ID [--workspace PATH]
  moneypack-mission brief ID

Mission files persist under MONEYPACK_MISSION_DIR or ~/.moneypack/missions.`);
}
function main(argv = process.argv.slice(2)) {
  const harness = new MissionHarness();
  const [command, id, ...rest] = argv;
  if (!command || command === "help" || command === "--help") return usage();
  if (command === "create") {
    if (!id) throw new Error("create requires a goal");
    return printMission(harness.create({ title: id, objective: id, metadata: { workspace: path.resolve(option(rest, "--workspace", process.cwd())) } }));
  }
  if (command === "list") {
    const missions = harness.list();
    if (!missions.length) return console.log("No missions.");
    for (const mission of missions) console.log(`${mission.id}\t${mission.status}\t${mission.title}`);
    return;
  }
  if (!id) throw new Error(`${command} requires a mission ID`);
  if (command === "show") return printMission(harness.load(id) || (() => { throw new Error(`Mission not found: ${id}`); })());
  if (command === "resume") return printMission(harness.resume(id));
  if (command === "cancel") return printMission(harness.cancel(id, rest.join(" ") || undefined));
  if (command === "verify") {
    const mission = harness.load(id);
    if (!mission) throw new Error(`Mission not found: ${id}`);
    const workspace = path.resolve(option(rest, "--workspace", mission.metadata.workspace || process.cwd()));
    harness.verifyAll(id, { workspace });
    return console.log(harness.brief(id));
  }
  if (command === "brief") return console.log(harness.brief(id));
  throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(`Error: ${error.message}`); process.exitCode = 1; }
}
module.exports = { main, usage };
