"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { BrowserManager } = require("./browser-manager");
const harness = require("./moneypack-harness");
const cli = require("./surplus-cli");

async function testStructuredResults() {
  const ok = await harness.executeStructured("read_file", { path: "README.md" }, async () => "done");
  assert.deepEqual(ok, { ok: true, output: "done", data: null, error: null });

  const failed = await harness.executeStructured("read_file", { path: "missing" }, async () => "Error: missing");
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "missing");

  const denied = await harness.executeStructured("shell", { command: "rm -rf /" }, async () => "never");
  assert.equal(denied.ok, false);
  assert.match(denied.error, /blocked/);

  const cliResult = await cli.executeToolStructured("read_file", { path: __filename });
  assert.equal(cliResult.ok, true);
  assert.match(cliResult.output, /testStructuredResults/);
}

function testPolicyModes() {
  assert.equal(harness.decision("shell", { command: "rm -rf /" }, { mode: "off" }).allowed, true);
  assert.equal(harness.decision("shell", { command: "rm -rf /" }, { mode: "audit" }).allowed, true);
  assert.equal(harness.decision("shell", { command: "rm -rf /" }, { mode: "safe" }).allowed, false);
  assert.equal(harness.decision("shell", { command: "curl https://example.com" }, { mode: "strict" }).allowed, false);
  assert.equal(harness.decision("read_file", { path: "inside.txt" }, { mode: "safe", workspace: process.cwd() }).allowed, true);
  assert.equal(harness.decision("read_file", { path: path.resolve(process.cwd(), "..", "outside.txt") }, { mode: "safe", workspace: process.cwd() }).allowed, false);
}

async function testBrowser() {
  const manager = new BrowserManager();
  const capability = manager.capability();
  if (!capability.available) {
    console.log(`SKIP: browser integration (${capability.error})`);
    return;
  }
  const screenshot = path.join(os.tmpdir(), `moneypack-test-${process.pid}.png`);
  try {
    const html = `<title>MoneyPack Fixture</title><main><input id="name"><button id="go" onclick="document.querySelector('main').dataset.value=document.querySelector('#name').value">Go</button></main>`;
    const opened = await manager.open(`data:text/html,${encodeURIComponent(html)}`, 0);
    assert.equal(opened.title, "MoneyPack Fixture");
    await manager.type({ selector: "#name", text: "persistent-state" });
    await manager.click({ selector: "#go" });
    const evaluated = await manager.evaluate("document.querySelector('main').dataset.value");
    assert.equal(evaluated.value, "persistent-state");
    const shot = await manager.screenshot({ selector: "main", path: screenshot });
    assert.equal(shot.path, screenshot);
    assert.ok(fs.statSync(screenshot).size > 0, "screenshot should not be empty");
  } finally {
    await manager.close();
    fs.rmSync(screenshot, { force: true });
  }
  assert.equal(manager.browser, null);
  assert.equal(manager.page, null);
}

(async () => {
  await testStructuredResults();
  testPolicyModes();
  await testBrowser();
  console.log("PASS: structured results, policy modes/workspace, persistent browser, screenshot, cleanup");
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
