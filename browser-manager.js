"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const candidates = process.platform === "win32" ? [
  process.env.MONEYPACK_BROWSER_EXECUTABLE,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
  path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  path.join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe")
] : [
  process.env.MONEYPACK_BROWSER_EXECUTABLE,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
];

function executablePath() {
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null;
}

class BrowserManager {
  constructor(options = {}) {
    this.options = options;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.starting = null;
  }

  capability() {
    try {
      require.resolve("playwright-core");
      const executable = this.options.executablePath || executablePath();
      return executable
        ? { available: true, executable }
        : { available: false, error: "No Chrome/Edge/Chromium executable found. Set MONEYPACK_BROWSER_EXECUTABLE." };
    } catch {
      return { available: false, error: "playwright-core is not installed. Run: npm install" };
    }
  }

  async ensurePage() {
    if (this.page && !this.page.isClosed()) return this.page;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const capability = this.capability();
      if (!capability.available) throw new Error(capability.error);
      const { chromium } = require("playwright-core");
      this.browser = await chromium.launch({
        headless: this.options.headless !== false,
        executablePath: capability.executable
      });
      this.context = await this.browser.newContext({ viewport: { width: 1280, height: 720 } });
      this.page = await this.context.newPage();
      this.browser.on("disconnected", () => {
        this.browser = null;
        this.context = null;
        this.page = null;
      });
      return this.page;
    })();
    try { return await this.starting; }
    finally { this.starting = null; }
  }

  currentPage() {
    if (!this.page || this.page.isClosed()) throw new Error("No browser page open. Use browser_open first.");
    return this.page;
  }

  async open(url, waitSeconds = 3) {
    const page = await this.ensurePage();
    const timeout = Math.max(1, Math.min(Number(waitSeconds) || 3, 60)) * 1000;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    if (waitSeconds > 0) await page.waitForTimeout(Math.min(timeout, 10000));
    const [title, text] = await Promise.all([
      page.title(),
      page.locator("body").innerText({ timeout: 5000 }).catch(() => "")
    ]);
    return { title, url: page.url(), text: text.slice(0, 10000) };
  }

  async click({ selector, text }) {
    const page = this.currentPage();
    if (!selector && !text) throw new Error("browser_click requires selector or text");
    const locator = selector ? page.locator(selector) : page.getByText(text, { exact: false });
    await locator.first().click({ timeout: 10000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
    return { url: page.url(), title: await page.title(), target: selector || text };
  }

  async type({ selector, text, submit = false }) {
    if (!selector) throw new Error("browser_type requires selector");
    const page = this.currentPage();
    const locator = page.locator(selector).first();
    await locator.fill(String(text), { timeout: 10000 });
    if (submit) await locator.press("Enter");
    return { selector, submitted: Boolean(submit), url: page.url() };
  }

  async evaluate(script) {
    if (!script) throw new Error("browser_evaluate requires script");
    const value = await this.currentPage().evaluate(code => {
      // The model-facing tool explicitly requests page-context JavaScript.
      // Indirect eval keeps the supplied code out of this module's scope.
      return (0, eval)(code);
    }, script);
    return { value, url: this.currentPage().url() };
  }

  async screenshot({ full_page = false, selector, path: outputPath } = {}) {
    const page = this.currentPage();
    const target = outputPath || path.join(os.tmpdir(), `moneypack-screenshot-${Date.now()}.png`);
    fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    if (selector) await page.locator(selector).first().screenshot({ path: target });
    else await page.screenshot({ path: target, fullPage: Boolean(full_page) });
    return { path: path.resolve(target), selector: selector || null, fullPage: Boolean(full_page) };
  }

  async close() {
    const browser = this.browser;
    this.page = null;
    this.context = null;
    this.browser = null;
    if (browser) await browser.close().catch(() => {});
  }
}

const browserManager = new BrowserManager();

module.exports = { BrowserManager, browserManager, executablePath };
