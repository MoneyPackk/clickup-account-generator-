"use strict";

const assert = require("assert/strict");
const harness = require("./moneypack-harness");
const cli = require("./surplus-cli");
const tui = require("./moneypack-tui");
const autonomy = require("./autonomy");

function testToolRegistry() {
  assert.equal(cli.TOOLS.length, 31, "expected the advertised 31 tools");
  const names = cli.TOOLS.map(tool => tool?.function?.name);
  assert.equal(new Set(names).size, names.length, "tool names must be unique");
  for (const tool of cli.TOOLS) {
    assert.equal(tool.type, "function", "tool type must be function");
    assert.match(tool.function.name, /^[a-z][a-z0-9_]*$/, "invalid tool name");
    assert.equal(typeof tool.function.description, "string", "tool description missing");
    assert.equal(tool.function.parameters?.type, "object", "tool parameters must be an object schema");
    assert.equal(typeof tool.function.parameters.properties, "object", "tool properties missing");
    for (const required of tool.function.parameters.required || []) {
      assert.ok(required in tool.function.parameters.properties, `${tool.function.name}: required property ${required} is undefined`);
    }
  }
}

function testPolicy() {
  const cases = [
    ["read_file", { path: "README.md" }, true],
    ["shell", { command: "echo safe" }, true],
    ["shell", { command: "rm -rf /" }, false],
    ["shell", { command: "RM   -RF   /" }, false],
    ["shell", { command: "echo ok && shutdown /s" }, false],
    ["shell", { command: "Remove-Item C:\\temp -Recurse" }, false],
    ["shell", { command: "reg delete HKCU\\Software\\Example" }, false],
    ["process_kill", { pid: 4 }, false],
    ["process_kill", { pid: 0 }, false],
    ["process_kill", { pid: "not-a-pid" }, false],
    ["process_kill", { pid: 99999 }, true]
  ];
  for (const [tool, args, expected] of cases) {
    assert.equal(harness.decision(tool, args).allowed, expected, `${tool}: ${JSON.stringify(args)}`);
  }
}

function testRedaction() {
  const redacted = harness.redact({
    Authorization: "Bearer abc",
    headers: { Cookie: "session=x", Accept: "application/json" },
    nested: { api_key: "abc", password: "abc", accessToken: "abc" },
    harmless: "visible"
  });
  assert.equal(redacted.Authorization, "[REDACTED]");
  assert.equal(redacted.headers.Cookie, "[REDACTED]");
  assert.equal(redacted.headers.Accept, "application/json");
  assert.equal(redacted.nested.api_key, "[REDACTED]");
  assert.equal(redacted.nested.password, "[REDACTED]");
  assert.equal(redacted.nested.accessToken, "[REDACTED]");
  assert.equal(redacted.harmless, "visible");
  assert.match(harness.redact("x".repeat(2100)), /\[TRUNCATED\]$/);
}

function testExports() {
  for (const name of ["run", "submit", "paint", "restoreSession"]) {
    assert.equal(typeof tui[name], "function", `missing TUI export ${name}`);
  }
  for (const name of ["executeTool", "sendChat", "saveSession", "loadSession", "listSessions"]) {
    assert.equal(typeof cli[name], "function", `missing CLI export ${name}`);
  }
}

async function testHarnessExecution() {
  let ran = false;
  const allowed = await harness.execute("read_file", { path: "README.md" }, async () => {
    ran = true;
    return "ok";
  });
  assert.equal(allowed, "ok");
  assert.equal(ran, true);

  ran = false;
  const denied = await harness.execute("shell", { command: "rm -rf /" }, async () => {
    ran = true;
    return "must not run";
  });
  assert.match(denied, /^Error: blocked/);
  assert.equal(ran, false, "denied executor must not run");
}


function resetTui() {
  Object.assign(tui.state, { input:"", cursor:0, completions:[], compIdx:0, entries:[], selection:null, modal:null, tabs:[], activeTab:0, attachedPaths:[], objective:null, objectiveProgress:0, reportNo:0, objectiveFiles:[], objectiveLearnings:[] });
}

function testEditor() {
  resetTui();
  tui.insertEditor("a😀b\nxy");
  assert.equal(tui.state.cursor, "a😀b\nxy".length);
  tui.moveEditor("up"); assert.equal(tui.state.cursor, 1, "vertical cursor lands on a grapheme boundary at the preferred cell column");
  tui.moveEditor("home"); assert.equal(tui.state.cursor, 0);
  tui.moveEditor("right"); tui.moveEditor("right"); assert.equal(tui.state.cursor, 3, "right moves over emoji grapheme");
  tui.deleteEditor(true); assert.equal(tui.state.input, "ab\nxy", "backspace deletes one grapheme");
  tui.state.cursor=0; tui.deleteEditor(false); assert.equal(tui.state.input,"b\nxy");
}

function testPaletteAndLayout() {
  assert.ok(tui.fuzzyScore("ses","/sessions") > -Infinity);
  assert.equal(tui.fuzzyScore("zzz","/sessions"), -Infinity);
  tui.state.input="/ss"; const items=tui.completionItems();
  assert.ok(items.some(x=>x.value==="/sessions"));
  const oldCols=process.stdout.columns,oldRows=process.stdout.rows;
  Object.defineProperty(process.stdout,"columns",{value:60,configurable:true}); Object.defineProperty(process.stdout,"rows",{value:14,configurable:true});
  assert.equal(tui.layout().mode,"compact"); assert.equal(tui.layout().rail,0); assert.ok(tui.layout().bodyRows>=3);
  Object.defineProperty(process.stdout,"columns",{value:130,configurable:true}); assert.equal(tui.layout().mode,"wide");
  Object.defineProperty(process.stdout,"columns",{value:oldCols,configurable:true}); Object.defineProperty(process.stdout,"rows",{value:oldRows,configurable:true});
}

function testSelectionAndActions() {
  resetTui(); tui.state.entries=[{kind:"user",text:"one"},{kind:"assistant",text:"two"},{kind:"note",text:"three"}];
  tui.selectMessage(-1,false); tui.selectMessage(-1,true); assert.equal(tui.selectedText(),"two\n\nthree");
  assert.deepEqual(tui.extractLinks("https://a.test x https://b.test."),["https://a.test","https://b.test"]);
  assert.deepEqual(tui.extractCodeBlocks("```js\na()\n```"),["a()"]);
  const rows=tui.transcriptRows(80); assert.ok(rows.some(r=>r.actions?.some(a=>a.type==="select")));
}

function testSessionsMutations() {
  const id=`unit-session-${Date.now()}`,history=[{role:"user",content:"Please build automatic context aware names for saved sessions"}];
  const meta=cli.deriveSessionMetadata(history);
  assert.equal(meta.title,"Session Management"); assert.equal(meta.topicKey,"session-management"); assert.match(meta.context,/automatic context aware names/i); assert.ok(meta.keywords.includes("context"));
  cli.saveSession(id,"unit-model",history);
  let saved=cli.loadSession(id); assert.equal(saved.titleMode,"auto"); assert.ok(saved.context); assert.ok(saved.created);
  assert.ok(cli.renameSession(id,"renamed")); assert.equal(cli.loadSession(id).title,"renamed");
  cli.saveSession(id,"unit-model",history.concat({role:"user",content:"add searchable keywords"}));
  saved=cli.loadSession(id); assert.equal(saved.title,"renamed"); assert.equal(saved.titleMode,"manual"); assert.match(saved.context,/searchable keywords/i);
  assert.ok(cli.deleteSession(id)); assert.equal(cli.loadSession(id),null);
}

function testWorkspaceState() {
  resetTui(); const id=tui.state.sessionId;
  tui.state.tabs=[{name:"one",sessionId:id,model:"a",history:[],entries:[]},{name:"two",sessionId:id+"x",model:"b",history:[],entries:[]}];
  assert.ok(tui.switchTab(1)); assert.equal(tui.state.model,"b"); assert.ok(tui.closeTab()); assert.equal(tui.state.tabs.length,1); assert.equal(tui.closeTab(),false);
}

function testOneshotParser() {
  assert.deepEqual(tui.parseOneshot("ship the feature"), {objective:"ship the feature",maxSteps:20,verificationCommand:null,dryRun:false});
  assert.deepEqual(tui.parseOneshot('--dry-run --max-steps 7 --verify "npm test" ship it'), {objective:"ship it",maxSteps:7,verificationCommand:"npm test",dryRun:true});
  assert.equal(tui.parseOneshot("--max-steps 0 bounded").maxSteps,1);
  assert.equal(tui.parseOneshot("--max-steps 999 bounded").maxSteps,50);
  assert.equal(tui.parseOneshot("--dry-run"),null);
}

function testAutonomyAndExecutionReport() {
  assert.equal(autonomy.normalizeProfile("CREATIVE"), "creative");
  assert.equal(autonomy.normalizeProfile("unknown"), "creative");
  assert.equal(harness.decision("write_file", {path:"x"}, {profile:"readonly"}).code, "READ_ONLY_PROFILE");
  resetTui();
  tui.state.entries=[
    {kind:"user",text:"build it"},
    {kind:"tool",tool:"write_file",ok:true,ms:12,result:"ok"},
    {kind:"diff",path:"app.js",lines:["+ok"]}
  ];
  const report=tui.addExecutionReport(1,"build it");
  assert.equal(report.kind,"report");
  assert.match(report.text,/MOMENTUM — changes were written/);
  assert.match(report.text,/This run: 1 succeeded · 0 failed/);
  assert.match(report.text,/app\.js/);
  assert.match(report.text,/What actually happened/);
  assert.match(report.text,/LOCKED OBJECTIVE:\*\* build it/);
  assert.match(report.text,/MISSION 1:\*\*.*%/);
  assert.match(report.text,/What MoneyPack learned/);
  assert.match(report.text,/Best next move/);

  resetTui();
  tui.state.entries=[
    {kind:"tool",tool:"shell",ok:false,ms:9,result:"Exit 1\nTests failed in app.js:12"}
  ];
  const failed=tui.addExecutionReport(0,"test it");
  assert.match(failed.text,/BLOCKED — progress held honestly/);
  assert.match(failed.text,/shell failed:.*Exit 1/);
  assert.match(failed.text,/Clear the shell blocker/);
  assert.match(failed.text,/progress held honestly/);
}

(async () => {
  testToolRegistry();
  testPolicy();
  testRedaction();
  testExports();
  testEditor();
  testPaletteAndLayout();
  testSelectionAndActions();
  testSessionsMutations();
  testWorkspaceState();
  testOneshotParser();
  testAutonomyAndExecutionReport();
  await testHarnessExecution();
  console.log("PASS: editor, palette, responsive layout, selection/actions, sessions, workspaces, autonomy/reporting, 31 tools, policy, redaction, exports");
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
