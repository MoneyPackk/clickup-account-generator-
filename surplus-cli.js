#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync, spawn, exec } = require("child_process");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const net = require("net");
const { atomicJson } = require("./storage");
const { browserManager } = require("./browser-manager");
const autonomy = require("./autonomy");
const runtimeHarness = require("./moneypack-harness");
const { MissionHarness } = require("./harness");

// ── Config ────────────────────────────────────────────────────────
const API = "https://api.surplusintelligence.ai/v1";
const CONFIG_PATH = path.join(os.homedir(), ".surplus-cli.json");
const MCP_PATH = path.join(os.homedir(), ".moneypack-mcp.json");
const TODO_PATH = path.join(os.homedir(), ".moneypack-todo.json");
const SESSION_DIR = path.join(os.homedir(), ".moneypack-sessions");
const args = process.argv.slice(2);
const command = args[0] || "start";
const shortcuts = {
  sol: "gpt-5.6-sol", solpro: "gpt-5.6-sol-pro",
  luna: "gpt-5.6-luna", terra: "gpt-5.6-terra",
  kimi: "kimi-k3", opus: "claude-opus-5", sonnet: "claude-sonnet-5",
  deep: "deepseek-r3", flash: "gemini-2.5-flash"
};
const C = (t, c) => process.stdout.isTTY ? `\x1b[${c}m${t}\x1b[0m` : t;
const DIM = 90, GRN = 32, RED = 31, YEL = 33, CYN = 36, MAG = 35, BLU = 34;
const TTY = !!process.stdout.isTTY;
const NO_MOTION = !TTY || process.env.NO_COLOR || process.env.MONEYPACK_MOTION === "off";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ansi = {
  hide: "\x1b[?25l", show: "\x1b[?25h", clear: "\x1b[2J\x1b[H",
  line: "\x1b[2K\r", up: n => `\x1b[${n}A`, rgb: (r,g,b,s) => TTY ? `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m` : s
};
process.on("exit", () => { if (TTY) process.stdout.write(ansi.show); });
process.on("SIGINT", () => { if (TTY) process.stdout.write(ansi.show); process.exit(130); });

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); }
  catch { return {}; }
}
function writeConfig(c) {
  atomicJson(CONFIG_PATH, c);
}
function opt(n, fb) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

// ── Markdown / syntax rendering ───────────────────────────────────
const KEYWORDS = /\b(const|let|var|function|return|if|else|for|while|class|new|await|async|import|from|export|def|self|None|True|False|try|except|catch|throw|finally|switch|case|break|continue|in|of|not|and|or|elif|lambda|yield|with|as|public|private|static|void|int|string|bool)\b/g;

function highlight(code, lang) {
  if (!TTY) return code;
  return code
    .split("\n")
    .map(line =>
      line
        .replace(/(#|\/\/).*$/g, m => C(m, DIM))
        .replace(/(["'`])(?:(?!\1)[^\\]|\\.)*\1/g, m => C(m, GRN))
        .replace(KEYWORDS, m => C(m, MAG))
        .replace(/\b(\d+(?:\.\d+)?)\b/g, m => C(m, YEL))
    )
    .join("\n");
}

// Renders a single line. `state` carries code-fence context between calls so
// the same function works for both streaming and whole-block rendering.
function renderLine(line, state) {
  const fence = line.match(/^\s*```(\w*)/);
  if (fence) {
    if (!state.inFence) {
      state.inFence = true;
      state.lang = fence[1] || "";
      const label = state.lang || "code";
      return C(`  ┌─ ${label} ` + "─".repeat(Math.max(2, 48 - label.length)), DIM);
    }
    state.inFence = false;
    state.lang = "";
    return C("  └" + "─".repeat(52), DIM);
  }
  if (state.inFence) return C("  │ ", DIM) + highlight(line, state.lang);

  const heading = line.match(/^(#{1,6})\s+(.*)$/);
  if (heading) return ansi.rgb(255, 104, 188, `\x1b[1m${heading[2]}\x1b[0m`);
  if (/^\s*([-*+#=_])\1{2,}\s*$/.test(line)) return C("  " + "─".repeat(52), DIM);

  let l = line;
  l = l.replace(/^(\s*)([-*+])\s+/, (_, s) => `${s}  ${C("•", MAG)} `);
  l = l.replace(/^(\s*)(\d+\.)\s+/, (_, s, n) => `${s}  ${C(n, MAG)} `);
  l = l.replace(/^\s*>\s?(.*)$/, (_, q) => `  ${C("▏", MAG)} ${C(q, DIM)}`);
  l = l.replace(/`([^`\n]+)`/g, (_, c) => C(c, CYN));
  l = l.replace(/\*\*([^*\n]+)\*\*/g, (_, b) => TTY ? `\x1b[1m${b}\x1b[0m` : b);
  l = l.replace(/(^|[\s(])\*([^*\n]+)\*/g, (_, p, i) => TTY ? `${p}\x1b[3m${i}\x1b[0m` : `${p}${i}`);
  return l;
}

function renderMarkdown(text) {
  if (!TTY) return text;
  const state = { inFence: false, lang: "" };
  return text.split("\n").map(l => renderLine(l, state)).join("\n");
}

// ── Live streaming renderer ───────────────────────────────────────
// Holds back partial lines so markdown is only rendered once a line is
// complete — avoids painting half-parsed bold/fence markers.
function createStreamRenderer() {
  const state = { inFence: false, lang: "" };
  let pending = "";
  let raw = "";
  let opened = false;
  const open = () => { if (!opened) { process.stdout.write("\n"); opened = true; } };
  return {
    push(chunk) {
      raw += chunk;
      pending += chunk;
      let nl;
      while ((nl = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        open();
        process.stdout.write((TTY ? renderLine(line, state) : line) + "\n");
      }
    },
    finish() {
      if (pending) {
        open();
        process.stdout.write((TTY ? renderLine(pending, state) : pending) + "\n");
        pending = "";
      } else if (opened) {
        process.stdout.write("");
      }
      return raw;
    },
    get text() { return raw; }
  };
}

// ── HTTP helper ───────────────────────────────────────────────────
async function api(endpoint, options = {}) {
  const key = readConfig().key;
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(API + endpoint, { ...options, headers });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try { const e = JSON.parse(text).error; if (e?.code === "model_not_in_key_scope") detail = "Key not authorized for this model."; } catch {}
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return text ? JSON.parse(text) : {};
}

// Streams a chat completion over SSE, assembling text deltas and tool calls.
// onDelta receives text fragments as they arrive. Returns an OpenAI-shaped choice.
async function apiStream(body, { onDelta, signal } = {}) {
  const key = readConfig().key;
  const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(API + "/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, stream: true }),
    signal
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const decoder = new TextDecoder();
  const message = { role: "assistant", content: "" };
  const toolCalls = [];
  let finishReason = null;
  let usage = null;
  let buffer = "";

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      for (const rawLine of event.split("\n")) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let parsed;
        try { parsed = JSON.parse(payload); } catch { continue; }
        if (parsed.usage) usage = parsed.usage;

        const choice = parsed.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta || {};
        if (delta.content) {
          message.content += delta.content;
          onDelta?.(delta.content);
        }
        for (const tc of delta.tool_calls || []) {
          const i = tc.index ?? 0;
          if (!toolCalls[i]) toolCalls[i] = { id: "", type: "function", function: { name: "", arguments: "" } };
          if (tc.id) toolCalls[i].id = tc.id;
          if (tc.function?.name) toolCalls[i].function.name = tc.function.name;
          if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
        }
      }
    }
  }

  const calls = toolCalls.filter(Boolean);
  if (calls.length) {
    message.tool_calls = calls;
    if (!finishReason) finishReason = "tool_calls";
  }
  return { message, finish_reason: finishReason || "stop", usage };
}

// ── Built-in tools ────────────────────────────────────────────────
const TOOLS = [
  // ─── Shell ────────────────────────────────────────────────────
  {
    type: "function", function: {
      name: "shell",
      description: "Run a shell command and return stdout/stderr. Use for any system command: git, npm, pip, docker, dir, type, etc. Works with PowerShell and cmd.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to execute" },
          timeout: { type: "integer", description: "Timeout in seconds (default 30, max 300)", default: 30 },
          cwd: { type: "string", description: "Working directory (default: current)", default: "." }
        },
        required: ["command"]
      }
    }
  },
  // ─── Filesystem ───────────────────────────────────────────────
  {
    type: "function", function: {
      name: "read_file",
      description: "Read a file and return its contents. Handles text files, auto-detects encoding.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path (absolute or relative)" },
          offset: { type: "integer", description: "Line number to start reading from (default 0)", default: 0 },
          limit: { type: "integer", description: "Max lines to return (default 500)", default: 500 }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function", function: {
      name: "write_file",
      description: "Write content to a file. Creates parent directories automatically.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          content: { type: "string", description: "Content to write" }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function", function: {
      name: "edit_file",
      description: "Make a targeted find-and-replace edit in a file. Safer than rewriting the whole file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          old_text: { type: "string", description: "Exact text to find (must be unique in the file)" },
          new_text: { type: "string", description: "Replacement text" }
        },
        required: ["path", "old_text", "new_text"]
      }
    }
  },
  {
    type: "function", function: {
      name: "list_dir",
      description: "List files and directories. Shows sizes and types.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path (default: current)", default: "." },
          recursive: { type: "boolean", description: "List recursively (default false)", default: false },
          pattern: { type: "string", description: "Glob filter like *.js or *.py", default: "*" }
        },
        required: []
      }
    }
  },
  {
    type: "function", function: {
      name: "grep",
      description: "Search file contents with a regex pattern. Like ripgrep/grep — finds matches across files.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Search pattern (regex)" },
          path: { type: "string", description: "Directory or file to search (default: current)", default: "." },
          file_pattern: { type: "string", description: "File glob filter (e.g. *.js, *.py)", default: "*" },
          max_results: { type: "integer", description: "Max matches to return (default 30)", default: 30 }
        },
        required: ["pattern"]
      }
    }
  },
  // ─── Web ──────────────────────────────────────────────────────
  {
    type: "function", function: {
      name: "web_fetch",
      description: "Fetch a URL and return the response body. Follows redirects. Returns up to 15KB of text.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to fetch" },
          method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"], default: "GET" },
          headers: { type: "object", description: "Optional request headers" },
          body: { type: "string", description: "Optional request body" }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function", function: {
      name: "web_search",
      description: "Search the web using DuckDuckGo. Returns titles and URLs for top results.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          max_results: { type: "integer", description: "Max results (default 8)", default: 8 }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function", function: {
      name: "web_scrape",
      description: "Fetch a URL and extract clean text content, stripping HTML tags. Good for reading articles/docs.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to scrape" },
          selector: { type: "string", description: "Optional CSS selector to extract specific content" }
        },
        required: ["url"]
      }
    }
  },
  // ─── Browser Automation ───────────────────────────────────────
  {
    type: "function", function: {
      name: "browser_open",
      description: "Open a URL in a headless browser. Returns page title and visible text. Use for web automation, testing, scraping dynamic pages.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to open" },
          wait: { type: "integer", description: "Seconds to wait for page load (default 3)", default: 3 }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function", function: {
      name: "browser_click",
      description: "Click an element on the currently open browser page by CSS selector or text.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of element to click" },
          text: { type: "string", description: "Click element containing this text (alternative to selector)" }
        },
        required: []
      }
    }
  },
  {
    type: "function", function: {
      name: "browser_type",
      description: "Type text into an input field on the currently open browser page.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of input field" },
          text: { type: "string", description: "Text to type" },
          submit: { type: "boolean", description: "Press Enter after typing (default false)", default: false }
        },
        required: ["selector", "text"]
      }
    }
  },
  {
    type: "function", function: {
      name: "browser_evaluate",
      description: "Run JavaScript in the currently open browser page and return the result.",
      parameters: {
        type: "object",
        properties: {
          script: { type: "string", description: "JavaScript code to execute in the browser page" }
        },
        required: ["script"]
      }
    }
  },
  {
    type: "function", function: {
      name: "browser_screenshot",
      description: "Take a screenshot of the currently open browser page. Saves to a file and returns the path.",
      parameters: {
        type: "object",
        properties: {
          full_page: { type: "boolean", description: "Capture full scrollable page (default false)", default: false },
          selector: { type: "string", description: "CSS selector to screenshot specific element" }
        },
        required: []
      }
    }
  },
  // ─── Code Execution ───────────────────────────────────────────
  {
    type: "function", function: {
      name: "run_python",
      description: "Execute Python code and return the output. Creates a temp file, runs it, returns stdout+stderr.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Python code to execute" },
          timeout: { type: "integer", description: "Timeout in seconds (default 30)", default: 30 }
        },
        required: ["code"]
      }
    }
  },
  {
    type: "function", function: {
      name: "run_javascript",
      description: "Execute JavaScript/Node.js code and return the output.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "JavaScript code to execute" },
          timeout: { type: "integer", description: "Timeout in seconds (default 15)", default: 15 }
        },
        required: ["code"]
      }
    }
  },
  // ─── Git ──────────────────────────────────────────────────────
  {
    type: "function", function: {
      name: "git",
      description: "Run a git command and return the output. Use for status, diff, log, add, commit, push, etc.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Git subcommand and args (e.g. 'status', 'log --oneline -5', 'diff')" }
        },
        required: ["command"]
      }
    }
  },
  // ─── Memory ───────────────────────────────────────────────────
  {
    type: "function", function: {
      name: "memory_save",
      description: "Save a key-value pair to persistent memory. Persists across sessions.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Memory key" },
          value: { type: "string", description: "Memory value" }
        },
        required: ["key", "value"]
      }
    }
  },
  {
    type: "function", function: {
      name: "memory_recall",
      description: "Recall values from persistent memory by key or search query.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Exact key to look up" },
          query: { type: "string", description: "Fuzzy search across all memories" }
        },
        required: []
      }
    }
  },
  // ─── Todo / Task Management ────────────────────────────────────
  {
    type: "function", function: {
      name: "todo_add",
      description: "Add a task to the todo list with a status.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Task description" },
          priority: { type: "string", enum: ["high", "medium", "low"], default: "medium" },
          status: { type: "string", enum: ["pending", "in_progress", "done"], default: "pending" }
        },
        required: ["task"]
      }
    }
  },
  {
    type: "function", function: {
      name: "todo_list",
      description: "List all tasks with their status and priority.",
      parameters: {
        type: "object",
        properties: {
          filter: { type: "string", enum: ["all", "pending", "in_progress", "done"], default: "all" }
        },
        required: []
      }
    }
  },
  {
    type: "function", function: {
      name: "todo_update",
      description: "Update a task's status or priority.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer", description: "Task ID from todo_list" },
          status: { type: "string", enum: ["pending", "in_progress", "done"] },
          priority: { type: "string", enum: ["high", "medium", "low"] }
        },
        required: ["id"]
      }
    }
  },
  // ─── Package Management ───────────────────────────────────────
  {
    type: "function", function: {
      name: "install_package",
      description: "Install a package via npm, pip, or other package managers.",
      parameters: {
        type: "object",
        properties: {
          package: { type: "string", description: "Package name" },
          manager: { type: "string", enum: ["npm", "pip", "pnpm", "yarn"], default: "npm" },
          dev: { type: "boolean", description: "Install as dev dependency (npm/pnpm only)", default: false },
          global: { type: "boolean", description: "Install globally", default: false }
        },
        required: ["package"]
      }
    }
  },
  // ─── Process Management ───────────────────────────────────────
  {
    type: "function", function: {
      name: "process_list",
      description: "List running processes. Can filter by name.",
      parameters: {
        type: "object",
        properties: {
          filter: { type: "string", description: "Filter process name (optional)" }
        },
        required: []
      }
    }
  },
  {
    type: "function", function: {
      name: "process_kill",
      description: "Kill a process by PID.",
      parameters: {
        type: "object",
        properties: {
          pid: { type: "integer", description: "Process ID to kill" }
        },
        required: ["pid"]
      }
    }
  },
  // ─── Clipboard ────────────────────────────────────────────────
  {
    type: "function", function: {
      name: "clipboard_write",
      description: "Copy text to the system clipboard.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to copy" }
        },
        required: ["text"]
      }
    }
  },
  {
    type: "function", function: {
      name: "clipboard_read",
      description: "Read the current contents of the system clipboard.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  // ─── Download ─────────────────────────────────────────────────
  {
    type: "function", function: {
      name: "download",
      description: "Download a file from a URL to disk.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to download from" },
          dest: { type: "string", description: "Destination file path (default: current dir with URL filename)" }
        },
        required: ["url"]
      }
    }
  },
  // ─── System Info ──────────────────────────────────────────────
  {
    type: "function", function: {
      name: "system_info",
      description: "Get system information: OS, CPU, memory, disk, network, environment variables.",
      parameters: {
        type: "object",
        properties: {
          section: { type: "string", enum: ["all", "os", "cpu", "memory", "disk", "network", "env"], default: "all" }
        },
        required: []
      }
    }
  },
  // ─── MCP ──────────────────────────────────────────────────────
  {
    type: "function", function: {
      name: "mcp_call",
      description: "Call an MCP tool from a connected MCP server.",
      parameters: {
        type: "object",
        properties: {
          server: { type: "string", description: "MCP server name from your config" },
          tool: { type: "string", description: "Tool name to call" },
          args: { type: "object", description: "Arguments for the tool" }
        },
        required: ["server", "tool"]
      }
    }
  },
  {
    type: "function", function: {
      name: "mcp_list_tools",
      description: "List available tools from an MCP server.",
      parameters: {
        type: "object",
        properties: {
          server: { type: "string", description: "MCP server name" }
        },
        required: ["server"]
      }
    }
  }
];

// ── Tool execution ────────────────────────────────────────────────
function toolResult(ok, output, data = null, error = null) {
  return { ok, output: String(output ?? ""), data, error };
}

function formatToolResult(result) {
  if (!result || typeof result !== "object" || !("ok" in result)) return String(result ?? "");
  return result.output || (result.ok ? "(no output)" : `Error: ${result.error || "tool failed"}`);
}

async function executeToolStructured(name, params) {
  try {
    const output = await executeTool(name, params);
    const text = String(output ?? "");
    const failed = /^(?:Error:|Exit\s|.*? error:|.*? failed:|No browser page open\.)/i.test(text);
    return toolResult(!failed, text, null, failed ? text.replace(/^Error:\s*/i, "") : null);
  } catch (error) {
    return toolResult(false, `Error: ${error.message}`, null, error.message);
  }
}

async function executeTool(name, params) {
  switch (name) {
    // ─── Shell ─────────────────────────────────────────────────
    case "shell": {
      try {
        const out = execSync(params.command, {
          timeout: Math.min((params.timeout || 30), 300) * 1000,
          encoding: "utf8",
          maxBuffer: 2 * 1024 * 1024,
          cwd: params.cwd || process.cwd(),
          stdio: ["pipe", "pipe", "pipe"]
        });
        return out.slice(0, 12000) || "(no output)";
      } catch (e) {
        const stderr = (e.stderr || "").toString();
        const stdout = (e.stdout || "").toString();
        return `Exit ${e.status || "N/A"}\nstdout: ${stdout.slice(0, 4000)}\nstderr: ${stderr.slice(0, 4000)}`;
      }
    }
    // ─── Filesystem ────────────────────────────────────────────
    case "read_file": {
      try {
        const p = path.resolve(params.path);
        const stat = fs.statSync(p);
        if (stat.isDirectory()) return `Path is a directory. Use list_dir instead.`;
        if (stat.size > 500000) return `File is ${(stat.size / 1024).toFixed(0)}KB. Showing first chunk:\n` + fs.readFileSync(p, "utf8").slice(0, 10000);
        const lines = fs.readFileSync(p, "utf8").split("\n");
        const offset = params.offset || 0;
        const limit = params.limit || 500;
        return lines.slice(offset, offset + limit).join("\n");
      } catch (e) { return `Error: ${e.message}`; }
    }
    case "write_file": {
      try {
        const p = path.resolve(params.path);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, params.content, "utf8");
        return `Wrote ${params.content.length} chars to ${p}`;
      } catch (e) { return `Error: ${e.message}`; }
    }
    case "edit_file": {
      try {
        const p = path.resolve(params.path);
        let content = fs.readFileSync(p, "utf8");
        const count = content.split(params.old_text).length - 1;
        if (count === 0) return `Text not found in ${p}`;
        if (count > 1) return `Found ${count} matches — text must be unique. Be more specific.`;
        content = content.replace(params.old_text, params.new_text);
        fs.writeFileSync(p, content, "utf8");
        return `Edited ${p}: replaced ${params.old_text.length} chars with ${params.new_text.length} chars`;
      } catch (e) { return `Error: ${e.message}`; }
    }
    case "list_dir": {
      try {
        const p = path.resolve(params.path || ".");
        if (params.recursive) {
          const out = execSync(`dir /s /b "${p}\\${params.pattern || "*"}"`, { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 10000 });
          return out.slice(0, 10000) || "(empty)";
        }
        const entries = fs.readdirSync(p, { withFileTypes: true });
        const filtered = !params.pattern || params.pattern === "*" ? entries : entries.filter(e => {
          const glob = params.pattern.replace(/\*/g, ".*").replace(/\?/g, ".");
          return new RegExp(`^${glob}$`, "i").test(e.name);
        });
        return filtered.map(e => {
          const isDir = e.isDirectory();
          try {
            const full = path.join(p, e.name);
            const stat = fs.statSync(full);
            return `${isDir ? "📁" : "📄"} ${e.name}${isDir ? "/" : ""}  ${!isDir ? `(${(stat.size / 1024).toFixed(1)}KB)` : ""}`;
          } catch { return `${isDir ? "📁" : "📄"} ${e.name}${isDir ? "/" : ""}`; }
        }).join("\n") || "(empty)";
      } catch (e) { return `Error: ${e.message}`; }
    }
    case "grep": {
      return new Promise((resolve) => {
        try {
          const pattern = params.pattern;
          const searchPath = path.resolve(params.path || ".");
          const filePattern = params.file_pattern || "*";
          const maxResults = params.max_results || 30;
          const cmd = `findstr /s /n /i /c:"${pattern.replace(/"/g, '\\"')}" "${searchPath}\\${filePattern}"`;
          const out = execSync(cmd, { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 15000, stdio: ["pipe", "pipe", "pipe"] });
          const lines = out.split("\n").slice(0, maxResults);
          resolve(lines.join("\n") || "No matches found.");
        } catch (e) {
          if (e.stdout) {
            const lines = e.stdout.toString().split("\n").slice(0, params.max_results || 30);
            if (lines.length) return resolve(lines.join("\n"));
          }
          resolve(`No matches or error: ${(e.stderr || e.message).toString().slice(0, 300)}`);
        }
      });
    }
    // ─── Web ───────────────────────────────────────────────────
    case "web_fetch": {
      return new Promise((resolve) => {
        const mod = params.url.startsWith("https") ? https : http;
        const reqOpts = { headers: { "User-Agent": "MoneyPack/1.0", ...(params.headers || {}) }, method: params.method || "GET" };
        const req = mod.request(params.url, reqOpts, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return executeTool("web_fetch", { url: res.headers.location, method: params.method }).then(resolve);
          }
          let body = "";
          res.on("data", c => body += c);
          res.on("end", () => resolve(body.slice(0, 15000)));
        });
        if (params.body) req.write(params.body);
        req.on("error", e => resolve(`Error: ${e.message}`));
        req.setTimeout(20000, () => { req.destroy(); resolve("Error: request timed out"); });
        req.end();
      });
    }
    case "web_search": {
      return new Promise((resolve) => {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`;
        const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
          let body = "";
          res.on("data", c => body += c);
          res.on("end", () => {
            const results = [];
            const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
            let m;
            const max = params.max_results || 8;
            while ((m = re.exec(body)) && results.length < max) {
              results.push(`${results.length + 1}. ${m[2].trim()}\n   ${m[1]}`);
            }
            resolve(results.length ? results.join("\n\n") : "No results found.");
          });
        });
        req.on("error", e => resolve(`Error: ${e.message}`));
        req.setTimeout(15000, () => { req.destroy(); resolve("Error: search timed out"); });
      });
    }
    case "web_scrape": {
      return new Promise((resolve) => {
        const mod = params.url.startsWith("https") ? https : http;
        const req = mod.get(params.url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
          let body = "";
          res.on("data", c => body += c);
          res.on("end", () => {
            // Strip HTML tags for clean text
            let text = body
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            resolve(text.slice(0, 12000) || "No text content extracted.");
          });
        });
        req.on("error", e => resolve(`Error: ${e.message}`));
        req.setTimeout(20000, () => { req.destroy(); resolve("Error: timed out"); });
      });
    }
    // ─── Browser Automation ────────────────────────────────────
    case "browser_open": {
      try {
        const data = await browserManager.open(params.url, params.wait ?? 3);
        return `Title: ${data.title}
URL: ${data.url}

${data.text || "(no text)"}`;
      } catch (error) {
        // HTTP(S) opens retain a read-only fallback. Interactive operations
        // still report that no persistent browser page exists.
        if (!/^https?:\/\//i.test(params.url)) return `Error: Browser unavailable: ${error.message}`;
        const fallback = await executeTool("web_scrape", { url: params.url });
        return `Browser unavailable: ${error.message}
HTTP fallback:
${fallback}`;
      }
    }
    case "browser_click": {
      try {
        const data = await browserManager.click(params);
        return `Clicked ${data.target}
Title: ${data.title}
URL: ${data.url}`;
      } catch (error) { return `Error: ${error.message}`; }
    }
    case "browser_type": {
      try {
        const data = await browserManager.type(params);
        return `Typed into ${data.selector}${data.submitted ? " and submitted" : ""}
URL: ${data.url}`;
      } catch (error) { return `Error: ${error.message}`; }
    }
    case "browser_evaluate": {
      try {
        const data = await browserManager.evaluate(params.script);
        const value = typeof data.value === "string" ? data.value : JSON.stringify(data.value, null, 2);
        return value === undefined ? "undefined" : String(value);
      } catch (error) { return `Error: ${error.message}`; }
    }
    case "browser_screenshot": {
      try {
        const data = await browserManager.screenshot(params);
        return `Screenshot saved: ${data.path}`;
      } catch (error) { return `Error: ${error.message}`; }
    }
    // ─── Code Execution ────────────────────────────────────────
    case "run_python": {
      try {
        const tmpFile = path.join(os.tmpdir(), `mp-python-${Date.now()}.py`);
        fs.writeFileSync(tmpFile, params.code, "utf8");
        const out = execSync(`python "${tmpFile}"`, {
          encoding: "utf8",
          timeout: Math.min((params.timeout || 30), 120) * 1000,
          maxBuffer: 2 * 1024 * 1024,
          stdio: ["pipe", "pipe", "pipe"]
        });
        fs.unlinkSync(tmpFile);
        return out.slice(0, 12000) || "(no output)";
      } catch (e) {
        return `Python error:\n${(e.stderr || e.message).toString().slice(0, 4000)}`;
      }
    }
    case "run_javascript": {
      try {
        const tmpFile = path.join(os.tmpdir(), `mp-js-${Date.now()}.js`);
        fs.writeFileSync(tmpFile, params.code, "utf8");
        const out = execSync(`node "${tmpFile}"`, {
          encoding: "utf8",
          timeout: Math.min((params.timeout || 15), 60) * 1000,
          maxBuffer: 2 * 1024 * 1024,
          stdio: ["pipe", "pipe", "pipe"]
        });
        fs.unlinkSync(tmpFile);
        return out.slice(0, 12000) || "(no output)";
      } catch (e) {
        return `Node error:\n${(e.stderr || e.message).toString().slice(0, 4000)}`;
      }
    }
    // ─── Git ───────────────────────────────────────────────────
    case "git": {
      try {
        const out = execSync(`git ${params.command}`, {
          encoding: "utf8",
          timeout: 30000,
          maxBuffer: 1024 * 1024,
          cwd: process.cwd(),
          stdio: ["pipe", "pipe", "pipe"]
        });
        return out.slice(0, 10000) || "(no output)";
      } catch (e) {
        return `git ${params.command} failed:\n${(e.stderr || e.stdout || e.message).toString().slice(0, 3000)}`;
      }
    }
    // ─── Memory ────────────────────────────────────────────────
    case "memory_save": {
      const mem = loadMemory();
      mem[params.key] = { value: params.value, ts: Date.now() };
      atomicJson(path.join(os.homedir(), ".moneypack-memory.json"), mem);
      return `Saved: ${params.key}`;
    }
    case "memory_recall": {
      const mem = loadMemory();
      if (params.key && mem[params.key]) return mem[params.key].value;
      if (params.query) {
        const q = params.query.toLowerCase();
        const hits = Object.entries(mem).filter(([k, v]) => k.toLowerCase().includes(q) || v.value.toLowerCase().includes(q));
        return hits.length ? hits.map(([k, v]) => `${k}: ${v.value}`).join("\n") : "No matching memories.";
      }
      const all = Object.entries(mem);
      return all.length ? all.map(([k, v]) => `${k}: ${v.value}`).join("\n") : "Memory is empty.";
    }
    // ─── Todo ──────────────────────────────────────────────────
    case "todo_add": {
      const todos = loadTodos();
      const id = todos.length ? Math.max(...todos.map(t => t.id)) + 1 : 1;
      todos.push({ id, task: params.task, priority: params.priority || "medium", status: params.status || "pending", created: Date.now() });
      saveTodos(todos);
      return `Task #${id} added: ${params.task} [${params.priority}]`;
    }
    case "todo_list": {
      const todos = loadTodos();
      const filter = params.filter || "all";
      const filtered = filter === "all" ? todos : todos.filter(t => t.status === filter);
      if (!filtered.length) return "No tasks.";
      const statusIcon = { pending: "⬜", in_progress: "🔶", done: "✅" };
      const prioIcon = { high: "🔴", medium: "🟡", low: "🟢" };
      return filtered.map(t => `${statusIcon[t.status] || "⬜"} ${prioIcon[t.priority] || "🟡"} #${t.id} ${t.task}`).join("\n");
    }
    case "todo_update": {
      const todos = loadTodos();
      const task = todos.find(t => t.id === params.id);
      if (!task) return `Task #${params.id} not found.`;
      if (params.status) task.status = params.status;
      if (params.priority) task.priority = params.priority;
      saveTodos(todos);
      return `Task #${params.id} updated: ${task.status} / ${task.priority}`;
    }
    // ─── Package Management ────────────────────────────────────
    case "install_package": {
      try {
        const mgr = params.manager || "npm";
        const flag = params.global ? "-g " : "";
        const devFlag = params.dev && !params.global ? " --save-dev" : "";
        const cmd = `${mgr} install ${flag}${params.package}${devFlag}`;
        const out = execSync(cmd, { encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
        return `Installed ${params.package} via ${mgr}:\n${out.slice(0, 2000)}`;
      } catch (e) {
        return `Install failed: ${(e.stderr || e.message).toString().slice(0, 2000)}`;
      }
    }
    // ─── Process Management ────────────────────────────────────
    case "process_list": {
      try {
        const cmd = params.filter
          ? `tasklist /fi "imagename eq ${params.filter}*"`
          : "tasklist /fo csv";
        const out = execSync(cmd, { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 });
        const lines = out.split("\n").slice(0, 30);
        return lines.join("\n");
      } catch (e) { return `Error: ${e.message}`; }
    }
    case "process_kill": {
      try {
        execSync(`taskkill /pid ${params.pid} /f`, { encoding: "utf8", timeout: 5000 });
        return `Killed process ${params.pid}`;
      } catch (e) { return `Kill failed: ${(e.stderr || e.message).toString().slice(0, 500)}`; }
    }
    // ─── Clipboard ────────────────────────────────────────────
    case "clipboard_write": {
      try {
        const child = spawn("clip");
        child.stdin.write(params.text);
        child.stdin.end();
        return `Copied ${params.text.length} chars to clipboard`;
      } catch (e) { return `Clipboard error: ${e.message}`; }
    }
    case "clipboard_read": {
      try {
        const out = execSync("powershell -command Get-Clipboard", { encoding: "utf8", timeout: 5000 });
        return out.trim() || "(clipboard is empty)";
      } catch (e) { return `Clipboard read error: ${e.message}`; }
    }
    // ─── Download ─────────────────────────────────────────────
    case "download": {
      return new Promise((resolve) => {
        const dest = params.dest || path.join(process.cwd(), path.basename(new URL(params.url).pathname) || "download");
        const mod = params.url.startsWith("https") ? https : http;
        const file = fs.createWriteStream(dest);
        mod.get(params.url, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            file.close();
            fs.unlinkSync(dest);
            return executeTool("download", { url: res.headers.location, dest: params.dest }).then(resolve);
          }
          res.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve(`Downloaded to ${dest} (${(fs.statSync(dest).size / 1024).toFixed(1)}KB)`);
          });
        }).on("error", (e) => {
          file.close();
          try { fs.unlinkSync(dest); } catch {}
          resolve(`Download error: ${e.message}`);
        });
      });
    }
    // ─── System Info ──────────────────────────────────────────
    case "system_info": {
      const section = params.section || "all";
      const info = [];
      if (section === "all" || section === "os") {
        info.push(`OS: ${os.type()} ${os.release()} (${os.arch()})`);
        info.push(`Hostname: ${os.hostname()}`);
        info.push(`User: ${os.userInfo().username}`);
        info.push(`Uptime: ${(os.uptime() / 3600).toFixed(1)}h`);
      }
      if (section === "all" || section === "cpu") {
        info.push(`CPUs: ${os.cpus().length}x ${os.cpus()[0]?.model || "unknown"}`);
      }
      if (section === "all" || section === "memory") {
        const total = (os.totalmem() / (1024 ** 3)).toFixed(1);
        const free = (os.freemem() / (1024 ** 3)).toFixed(1);
        info.push(`Memory: ${free}GB free / ${total}GB total`);
      }
      if (section === "all" || section === "disk") {
        try {
          const out = execSync("wmic logicaldisk get size,freespace,caption", { encoding: "utf8", timeout: 5000 });
          info.push(`Disk:\n${out.trim()}`);
        } catch {}
      }
      if (section === "all" || section === "network") {
        const nets = os.networkInterfaces();
        for (const [name, addrs] of Object.entries(nets)) {
          const ipv4 = addrs.find(a => a.family === "IPv4" && !a.internal);
          if (ipv4) info.push(`Network: ${name} → ${ipv4.address}`);
        }
      }
      if (section === "env") {
        const envVars = Object.entries(process.env).slice(0, 30).map(([k, v]) => `${k}=${v}`).join("\n");
        info.push(`Environment:\n${envVars}`);
      }
      return info.join("\n");
    }
    // ─── MCP ──────────────────────────────────────────────────
    case "mcp_call": {
      return await callMCPTool(params.server, params.tool, params.args || {});
    }
    case "mcp_list_tools": {
      return await listMCPTools(params.server);
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

function loadMemory() {
  try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), ".moneypack-memory.json"), "utf8")); }
  catch { return {}; }
}
function loadTodos() {
  try { return JSON.parse(fs.readFileSync(TODO_PATH, "utf8")); }
  catch { return []; }
}
function saveTodos(todos) {
  atomicJson(TODO_PATH, todos);
}

// ── MCP Client ───────────────────────────────────────────────────
function loadMCPConfig() {
  try { return JSON.parse(fs.readFileSync(MCP_PATH, "utf8")); }
  catch { return { servers: {} }; }
}
function saveMCPConfig(config) {
  atomicJson(MCP_PATH, config);
}

async function callMCPTool(serverName, toolName, toolArgs) {
  const config = loadMCPConfig();
  const server = config.servers[serverName];
  if (!server) return `MCP server "${serverName}" not found. Use /mcp add to configure.`;
  try {
    if (server.type === "sse" || server.url) {
      const res = await fetch(`${server.url}/tools/${toolName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(server.headers || {}) },
        body: JSON.stringify(toolArgs)
      });
      const text = await res.text();
      if (!res.ok) return `MCP error HTTP ${res.status}: ${text.slice(0, 500)}`;
      return text;
    } else if (server.command) {
      return new Promise((resolve) => {
        const proc = spawn(server.command, server.args || [], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, ...(server.env || {}) }
        });
        let stdout = "", stderr = "";
        proc.stdout.on("data", d => stdout += d);
        proc.stderr.on("data", d => stderr += d);
        const initMsg = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "moneypack", version: "2.0" } } }) + "\n";
        const toolMsg = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: toolArgs } }) + "\n";
        proc.stdin.write(initMsg);
        setTimeout(() => {
          proc.stdin.write(toolMsg);
          setTimeout(() => {
            proc.stdin.end();
            try { proc.kill(); } catch {}
            const lines = stdout.split("\n").filter(l => l.trim());
            for (const line of lines.reverse()) {
              try {
                const msg = JSON.parse(line);
                if (msg.id === 2 && msg.result) {
                  const content = msg.result.content;
                  if (Array.isArray(content)) return resolve(content.map(c => c.text || JSON.stringify(c)).join("\n"));
                  return resolve(JSON.stringify(msg.result, null, 2));
                }
              } catch {}
            }
            resolve(stdout.slice(-2000) || `No response. stderr: ${stderr.slice(0, 500)}`);
          }, 5000);
        }, 2000);
      });
    }
    return `Unknown MCP server type.`;
  } catch (e) { return `MCP call failed: ${e.message}`; }
}

async function listMCPTools(serverName) {
  const config = loadMCPConfig();
  const server = config.servers[serverName];
  if (!server) return `MCP server "${serverName}" not found.`;

  return new Promise((resolve) => {
    if (server.command) {
      const proc = spawn(server.command, server.args || [], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...(server.env || {}) }
      });
      let stdout = "", stderr = "";
      proc.stdout.on("data", d => stdout += d);
      proc.stderr.on("data", d => stderr += d);
      const initMsg = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "moneypack", version: "2.0" } } }) + "\n";
      const listMsg = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n";
      proc.stdin.write(initMsg);
      setTimeout(() => {
        proc.stdin.write(listMsg);
        setTimeout(() => {
          proc.stdin.end();
          try { proc.kill(); } catch {}
          const lines = stdout.split("\n").filter(l => l.trim());
          for (const line of lines.reverse()) {
            try {
              const msg = JSON.parse(line);
              if (msg.id === 2 && msg.result?.tools) {
                return resolve(msg.result.tools.map(t => `  ${C(t.name, 36)} — ${t.description?.slice(0, 80) || "no description"}`).join("\n"));
              }
            } catch {}
          }
          resolve(`Could not list tools. Raw output:\n${stdout.slice(-1500)}`);
        }, 4000);
      }, 2000);
    } else {
      resolve("Tool listing only supported for stdio MCP servers currently.");
    }
  });
}

// ── Tool call display ─────────────────────────────────────────────
const TOOL_ICONS = {
  shell: "▶", read_file: "◇", write_file: "✎", edit_file: "✎", list_dir: "▤",
  grep: "⌕", web_fetch: "⇣", web_search: "⌕", web_scrape: "⇣",
  browser_open: "◉", browser_screenshot: "▣", browser_click: "◉",
  browser_type: "◉", browser_evaluate: "◉", run_python: "⚙", run_javascript: "⚙",
  git: "⑂", memory_save: "✱", memory_recall: "✱", todo_add: "☐",
  todo_list: "☰", todo_update: "☑", install_package: "⬇", process_list: "▤",
  process_kill: "✕", clipboard_write: "⎘", clipboard_read: "⎘",
  download: "⬇", system_info: "ℹ", mcp_call: "⬡", mcp_list_tools: "⬡"
};

// Picks the most meaningful argument to show inline, so the header reads
// like "shell  git status" instead of a wall of JSON.
function summarizeArgs(name, a) {
  const first = a.command || a.path || a.url || a.query || a.pattern || a.key || a.task || a.package || a.code;
  if (typeof first === "string") {
    const flat = first.replace(/\s+/g, " ").trim();
    return flat.length > 68 ? flat.slice(0, 65) + "…" : flat;
  }
  const json = JSON.stringify(a);
  return json === "{}" ? "" : json.length > 68 ? json.slice(0, 65) + "…" : json;
}

function printToolCall(name, argsObj) {
  const icon = TOOL_ICONS[name] || "◆";
  const summary = summarizeArgs(name, argsObj);
  console.log(`  ${ansi.rgb(255, 105, 190, icon)} ${C(name, YEL)}${summary ? "  " + C(summary, DIM) : ""}`);
}

function printToolResult(resultStr, ms) {
  // Strip CR so Windows command output doesn't wrap onto a second line.
  const lines = resultStr.split(/\r?\n/).filter(l => l.trim());
  const head = (lines[0] || "(no output)").replace(/\s+/g, " ").trim().slice(0, 76);
  const extra = lines.length > 1 ? C(` +${lines.length - 1} lines`, DIM) : "";
  const failed = /^(Error|Exit \d|.*failed)/i.test(head);
  console.log(`    ${C("↳", DIM)} ${C(head, failed ? RED : DIM)}${extra} ${C(`${ms}ms`, DIM)}`);
}

// ── Chat with tool loop ───────────────────────────────────────────
const usageTotals = { prompt: 0, completion: 0, calls: 0 };

// Keeps the last `max` messages, but never starts on a `tool` message: a tool
// result orphaned from the assistant turn that requested it is rejected by the
// API. Walks the cut point back to the owning assistant message.
function trimHistory(history, max = 30) {
  if (history.length <= max) return history;
  let start = history.length - max;
  while (start > 0 && history[start].role === "tool") start--;
  // If the walk-back never found an assistant turn, drop the leading tool
  // results outright rather than sending a window the API will reject.
  while (start < history.length && history[start].role === "tool") start++;
  return history.slice(start);
}

async function sendChat(model, userMsg, history = [], opts = {}) {
  const { signal, onStreamStart, stream = true, maxToolRounds = 12, missionId = null, missionRoot = null } = opts;
  const cfg = readConfig();
  const messages = [...trimHistory(history), { role: "user", content: userMsg }];
  const systemPrompt = {
    role: "system",
    content: `You are MoneyPack AI, a terminal assistant with ${TOOLS.length} tools.

${autonomy.CREATION_POLICY}

Autonomy profile: ${autonomy.readSettings().profile}. Use tools to actually DO things rather than describing what you would do — when a request requires reading, writing, running, or fetching something, call the tool immediately.

Available tools: ${TOOLS.map(t => t.function.name).join(", ")}.

Answer conversational questions directly without calling tools. For anything touching the filesystem, shell, network, or git, use the matching tool first and base your answer on the real output.

Format responses in concise markdown. Keep explanations tight — this is a terminal.

Current dir: ${process.cwd()}
OS: ${os.type()} ${os.release()} ${os.arch()}
User: ${os.userInfo().username}
Date: ${new Date().toISOString().slice(0, 10)}${cfg.instructions ? `\n\nUser instructions: ${cfg.instructions}` : ""}`
  };

  const allMessages = [systemPrompt, ...messages];
  const temperature = Number(cfg.temperature ?? 0.4);

  for (let round = 0; round < maxToolRounds; round++) {
    const body = { model, messages: allMessages, tools: TOOLS, tool_choice: "auto", temperature };

    let choice;
    let renderer = null;

    if (stream) {
      choice = await apiStream(body, {
        signal,
        onDelta: (text) => {
          if (!renderer) { onStreamStart?.(); renderer = createStreamRenderer(); }
          renderer.push(text);
        }
      });
      renderer?.finish();
    } else {
      const data = await api("/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      choice = data.choices?.[0];
      if (choice) choice.usage = data.usage;
    }

    if (!choice) throw new Error("No response from model.");
    if (choice.usage) {
      usageTotals.prompt += choice.usage.prompt_tokens || 0;
      usageTotals.completion += choice.usage.completion_tokens || 0;
    }
    usageTotals.calls++;

    const toolCalls = choice.message?.tool_calls;
    if (!toolCalls?.length) {
      const content = choice.message?.content || "";
      allMessages.push({ role: "assistant", content });
      return { content, streamed: !!renderer, messages: allMessages.slice(1) };
    }

    // Tool output is about to print, so retire any spinner the caller owns.
    onStreamStart?.();
    allMessages.push(choice.message);
    if (choice.message.content?.trim() && !renderer) {
      console.log(renderMarkdown(choice.message.content.trim()));
    }

    for (const tc of toolCalls) {
      if (signal?.aborted) throw new Error("Cancelled.");
      const fnName = tc.function.name;
      let fnArgs;
      try { fnArgs = JSON.parse(tc.function.arguments || "{}"); }
      catch { fnArgs = {}; }

      printToolCall(fnName, fnArgs);
      const started = Date.now();
      const structured = await runtimeHarness.executeStructured(
        fnName, fnArgs, executeToolStructured,
        missionId ? { missionId, missionRoot, workspace: process.cwd(), criterionIds: ["criterion-1"] } : {}
      );
      const resultStr = formatToolResult(structured);
      printToolResult(resultStr, Date.now() - started);

      allMessages.push({ role: "tool", tool_call_id: tc.id, content: resultStr.slice(0, 12000) });
    }
  }

  return { content: C("(tool loop limit reached)", YEL), streamed: false, messages: allMessages.slice(1) };
}

// ── Sessions ──────────────────────────────────────────────────────
function ensureSessionDir() {
  try { fs.mkdirSync(SESSION_DIR, { recursive: true }); } catch {}
}

function sessionFile(id) {
  return path.join(SESSION_DIR, `${id.replace(/[^\w.-]/g, "_")}.json`);
}

function meaningfulUserText(content) {
  return String(content || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/(?:https?:\/\/|[A-Za-z]:\\|\.\/|\.\.\/)[^\s]+/g, " ")
    .replace(/^\s*[!/][^\n]*$/gm, " ")
    .replace(/[@#][\w./\\-]+/g, " ")
    .replace(/[\u2500-\u257f]/g, " ")
    .replace(/\s+/g, " ").trim();
}

function deriveSessionMetadata(history, cwd = process.cwd()) {
  const texts = (history || []).filter(m => m.role === "user").map(m => meaningfulUserText(m.content)).filter(t => /\p{L}{2}/u.test(t));
  const corpus = texts.join(" ").toLowerCase();
  const topics = [
    { key:"execution-reporting", title:"Professional Execution Reports", terms:["execution report","execution chart","what's done","whats done","needs to be done","professional","professionalism","professionism"] },
    { key:"production-readiness", title:"Production Readiness", terms:["public use","production ready","worthy","release","ship","deploy"] },
    { key:"cli-launch", title:"CLI Launch Configuration", terms:["launch command","terminal cli","moneypacktui","which one","up to date","upto date"] },
    { key:"session-transfer", title:"Session Transfer & Memory", terms:["other session","move you","copy version","implant memory","handoff","session_handoff"] },
    { key:"session-management", title:"Session Management", terms:["saved session","sessions identified","session name","name sessions","session context","resume session","/session"] },
    { key:"testing", title:"Testing & Verification", terms:["run test","test suite","unit test","integration test"] },
    { key:"browser-automation", title:"Browser Automation", terms:["browser","screenshot","click element","web automation"] },
    { key:"project-setup", title:"Project Setup", terms:["setup project","install","configuration","configure"] }
  ];
  const ranked = topics.map(t => ({...t, score:t.terms.reduce((n,x)=>n+(corpus.includes(x)?1:0),0)})).sort((a,b)=>b.score-a.score);
  const topic = ranked[0]?.score ? ranked[0] : null;
  const source = texts.slice().sort((a, b) => b.length - a.length)[0] || "New MoneyPack Session";
  const stop = new Set("a an the this that these those i we you my our your please can could would should want need also just help me us with for from into onto about after before then and or but to of in on at by is are was were be been being do does did make create build add update change fix implement set give show tell auto automatically new real best easier exactly whats what what's session sessions tried dont want asking ask example continue read run test update thing stuff it needed each there have has had how so okay kinda lol".split(" "));
  const words = source.replace(/[^\p{L}\p{N}+#.-]+/gu, " ").split(/\s+/).filter(Boolean);
  const useful = words.filter(w => !stop.has(w.toLowerCase()));
  const selected = (useful.length >= 2 ? useful : words).slice(0, 6);
  const fallback = selected.map(w => /^[A-Z0-9+#.-]{2,}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ").slice(0, 64) || "General Workspace";
  const contextParts = texts.slice(0, 3).map(t => t.replace(/^(please\s+)?(can|could|would)\s+you\s+/i, "").replace(/^(please\s+)?/i, "").trim());
  const context = contextParts.join(" • ").slice(0, 220) || `Workspace: ${path.basename(cwd)}`;
  const keywords = [...new Set(useful.map(w => w.toLowerCase()).filter(w => w.length > 2))].slice(0, 8);
  return { title:topic?.title || fallback, topicKey:topic?.key || `custom:${keywords.slice(0,3).join("-") || "general"}`, context, keywords, metadataVersion:2 };
}

function saveSession(id, model, history, mission = null) {
  if (!history.length) return null;
  ensureSessionDir();
  const existing = loadSession(id);
  const generated = deriveSessionMetadata(history);
  const manual = existing?.titleMode === "manual";
  const source = mission && typeof mission === "object" ? mission : existing || {};
  const missionState = {
    objective: source.objective || null,
    objectiveProgress: Math.max(0, Math.min(100, Number(source.objectiveProgress || 0))),
    reportNo: Math.max(0, Number(source.reportNo || 0)),
    objectiveFiles: Array.isArray(source.objectiveFiles) ? source.objectiveFiles.slice(0, 100) : [],
    objectiveLearnings: Array.isArray(source.objectiveLearnings) ? source.objectiveLearnings.slice(-3) : []
  };
  atomicJson(sessionFile(id), {
    id, model,
    title: manual ? existing.title : generated.title,
    titleMode: manual ? "manual" : "auto",
    topicKey: generated.topicKey,
    context: generated.context,
    keywords: generated.keywords,
    metadataVersion: generated.metadataVersion,
    created: existing?.created || Date.now(),
    updated: Date.now(), history,
    ...missionState
  });
  return id;
}

function loadSession(id) {
  try { return JSON.parse(fs.readFileSync(sessionFile(id), "utf8")); }
  catch { return null; }
}

function topicSimilarity(a, b) {
  if (a.topicKey && b.topicKey && a.topicKey === b.topicKey && !a.topicKey.startsWith("custom:")) return 1;
  const ak = new Set(a.keywords || []), bk = new Set(b.keywords || []);
  const shared = [...ak].filter(x => bk.has(x)).length;
  const union = new Set([...ak, ...bk]).size || 1;
  const at = String(a.title || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const bt = String(b.title || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (at && at === bt && at.length >= 8) return 1;
  return shared >= 2 ? shared / union : 0;
}

function normalizeSession(session) {
  if (!session || !Array.isArray(session.history)) return session;
  const generated = deriveSessionMetadata(session.history);
  const legacy = session.metadataVersion !== 2 || !session.titleMode || !session.context || !Array.isArray(session.keywords);
  if (!legacy) return session;
  return { ...session,
    title: session.titleMode === "manual" ? session.title : generated.title,
    titleMode: session.titleMode === "manual" ? "manual" : "auto",
    topicKey: generated.topicKey,
    context: generated.context,
    keywords: generated.keywords,
    metadataVersion: generated.metadataVersion,
    created: session.created || session.updated || Date.now()
  };
}

function consolidateSessions(sessions) {
  const groups = [];
  for (const session of sessions.sort((a,b)=>(b.updated||0)-(a.updated||0))) {
    const group = groups.find(g => topicSimilarity(g[0], session) >= 0.6);
    if (group) group.push(session); else groups.push([session]);
  }
  const archiveDir = path.join(SESSION_DIR, "archive");
  const output = [];
  for (const group of groups) {
    const primary = group[0];
    if (group.length > 1) {
      const chronological = group.slice().sort((a,b)=>(a.created||a.updated||0)-(b.created||b.updated||0));
      primary.history = chronological.flatMap(x => x.history || []);
      const meta = deriveSessionMetadata(primary.history);
      if (primary.titleMode !== "manual") primary.title = meta.title;
      primary.topicKey = meta.topicKey;
      primary.context = meta.context;
      primary.keywords = meta.keywords;
      primary.metadataVersion = meta.metadataVersion;
      primary.created = Math.min(...group.map(x => x.created || x.updated || Date.now()));
      primary.mergedFrom = [...new Set(group.flatMap(x => [x.id, ...(x.mergedFrom || [])]))];
      try { fs.mkdirSync(archiveDir, {recursive:true}); } catch {}
      for (const duplicate of group.slice(1)) {
        try {
          atomicJson(path.join(archiveDir, `${duplicate.id.replace(/[^\w.-]/g,"_")}.json`), duplicate);
          fs.rmSync(sessionFile(duplicate.id), {force:true});
        } catch {}
      }
    }
    atomicJson(sessionFile(primary.id), primary);
    output.push(primary);
  }
  return output.sort((a,b)=>(b.updated||0)-(a.updated||0));
}

function listSessions() {
  ensureSessionDir();
  let files;
  try { files = fs.readdirSync(SESSION_DIR).filter(f => f.endsWith(".json")); }
  catch { return []; }
  const sessions = files.map(f => {
    try { return normalizeSession(JSON.parse(fs.readFileSync(path.join(SESSION_DIR, f), "utf8"))); }
    catch { return null; }
  }).filter(Boolean);
  return consolidateSessions(sessions);
}

function renameSession(id, title) {
  const session = loadSession(id);
  if (!session) return false;
  session.title = String(title || "untitled").trim().slice(0, 100) || "untitled";
  session.titleMode = "manual";
  session.updated = Date.now();
  atomicJson(sessionFile(id), session);
  return true;
}

function deleteSession(id) {
  try { fs.rmSync(sessionFile(id), { force: true }); return true; }
  catch { return false; }
}

function printSessions() {
  const sessions = listSessions();
  if (!sessions.length) return console.log(C("  No saved sessions yet.", DIM));
  console.log(C("\n  Sessions", CYN));
  for (const s of sessions.slice(0, 20)) {
    const when = new Date(s.updated || 0).toLocaleString();
    const turns = s.history.filter(m => m.role === "user").length;
    console.log(`  ${C(s.id, YEL)}  ${s.title}`);
    console.log(`    ${C(`${turns} turns · ${s.model} · ${when}`, DIM)}`);
    if (s.context) console.log(`    ${C(s.context.slice(0, 100), DIM)}`);
  }
  console.log(C(`\n  /resume <id> to continue`, DIM));
}

// ── MCP management commands ───────────────────────────────────────
function mcpAdd(name, typeOrUrl, extraArgs) {
  const config = loadMCPConfig();
  if (!config.servers) config.servers = {};
  if (typeOrUrl.startsWith("http")) {
    config.servers[name] = { type: "sse", url: typeOrUrl, headers: {} };
  } else {
    config.servers[name] = { command: typeOrUrl, args: extraArgs || [], env: {} };
  }
  saveMCPConfig(config);
  console.log(C(`MCP server "${name}" added.`, GRN));
}

function mcpRemove(name) {
  const config = loadMCPConfig();
  if (config.servers[name]) {
    delete config.servers[name];
    saveMCPConfig(config);
    console.log(C(`MCP server "${name}" removed.`, GRN));
  } else {
    console.log(C(`MCP server "${name}" not found.`, RED));
  }
}

function mcpList() {
  const config = loadMCPConfig();
  const servers = Object.entries(config.servers || {});
  if (!servers.length) return console.log("No MCP servers. Use /mcp add <name> <command|url>");
  for (const [name, srv] of servers) {
    const loc = srv.url || srv.command;
    console.log(`  ${C(name, CYN)} → ${loc}  ${srv.type || "stdio"}`);
  }
}

// ── Display ───────────────────────────────────────────────────────
async function banner(model) {
  const frames = ["◐", "◓", "◑", "◒"];
  const sparks = ["·  ✦       ·", "  ·   ✦  · ", "✦    ·    ✦"];
  if (!NO_MOTION) {
    process.stdout.write(ansi.hide);
    for (let i = 0; i < 12; i++) {
      const glow = 110 + i * 10;
      const mark = ansi.rgb(255, 70 + i * 7, 170 + i * 5, frames[i % 4]);
      process.stdout.write(`${ansi.line}  ${mark}  ${ansi.rgb(glow, 100, 255, "M O N E Y P A C K")}  ${C(sparks[i % 3], DIM)}`);
      await sleep(55);
    }
    process.stdout.write(ansi.line + ansi.show);
  }
  console.log(ansi.rgb(177, 116, 255, "╭──────────────────────────────────────────────────────────────╮"));
  console.log(ansi.rgb(196, 132, 255, "│") + "                                                              " + ansi.rgb(196, 132, 255, "│"));
  console.log(ansi.rgb(218, 150, 255, "│") + ansi.rgb(255, 104, 188, "       ✦  M O N E Y P A C K   //   BUILD THE IMPOSSIBLE  ✦     ") + ansi.rgb(218, 150, 255, "│"));
  console.log(ansi.rgb(111, 214, 255, "│") + C("          imagination → intention → execution → impact         ", DIM) + ansi.rgb(111, 214, 255, "│"));
  console.log(ansi.rgb(84, 237, 190, "│") + "                                                              " + ansi.rgb(84, 237, 190, "│"));
  console.log(ansi.rgb(84, 237, 190, "╰──────────────────────────────────────────────────────────────╯"));
  console.log(`  ${ansi.rgb(255,116,190,"● ONLINE")}  ${C("MODEL", DIM)} ${C(model, CYN)}  ${C("◆", MAG)} ${TOOLS.length} tools  ${C("◆", MAG)} ${C("/help", DIM)}`);
  console.log(`  ${C("@file", CYN)} ${C("attach", DIM)}   ${C("!cmd", CYN)} ${C("shell", DIM)}   ${C("tab", CYN)} ${C("complete", DIM)}   ${C("esc", CYN)} ${C("cancel", DIM)}`);
  console.log(C("  “Momentum begins the moment you stop asking permission.”", YEL));
}

function help() {
  console.log(C("\nMoneyPack AI Assistant v2 — Full Tool List\n", CYN));
  console.log("Chat:");
  console.log("  Just type — AI auto-picks the right tool for the job\n");

  console.log("Modes:");
  console.log("  start            interactive CLI (streaming, scrollback)");
  console.log("  tui              split-pane terminal UI with a live tool rail\n");

  console.log("Shell & System:");
  console.log("  shell              run any terminal command");
  console.log("  system_info        OS, CPU, memory, disk, network");
  console.log("  process_list       list running processes");
  console.log("  process_kill       kill a process by PID");
  console.log("  install_package    npm/pip/yarn/pnpm install");
  console.log("  clipboard_write    copy text to clipboard");
  console.log("  clipboard_read     read clipboard contents");
  console.log("  download           download a file from URL\n");

  console.log("Filesystem:");
  console.log("  read_file          read file contents (with line range)");
  console.log("  write_file         create/overwrite files");
  console.log("  edit_file          targeted find & replace in a file");
  console.log("  list_dir           list directory (recursive, glob filter)");
  console.log("  grep               search file contents across a directory\n");

  console.log("Web:");
  console.log("  web_fetch          fetch any URL (GET/POST/PUT/DELETE)");
  console.log("  web_search         DuckDuckGo search");
  console.log("  web_scrape         fetch URL, strip HTML, return clean text\n");

  console.log("Browser Automation:");
  console.log("  browser_open       open URL in headless browser");
  console.log("  browser_screenshot take a page screenshot (saves PNG)");
  console.log("  browser_click      click an element");
  console.log("  browser_type       type into an input field");
  console.log("  browser_evaluate   run JavaScript in the browser page\n");

  console.log("Code Execution:");
  console.log("  run_python         execute Python code");
  console.log("  run_javascript     execute Node.js code\n");

  console.log("Git:");
  console.log("  git                any git command (status, diff, log, etc.)\n");

  console.log("Memory & Tasks:");
  console.log("  memory_save        save key-value pairs (persists across sessions)");
  console.log("  memory_recall      recall by key or fuzzy search");
  console.log("  todo_add           add a task (priority: high/medium/low)");
  console.log("  todo_list          list tasks (filter: all/pending/in_progress/done)");
  console.log("  todo_update        update task status or priority\n");

  console.log("MCP Servers:");
  console.log("  mcp_call           call an MCP tool");
  console.log("  mcp_list_tools     list tools from an MCP server\n");

  console.log("Input shortcuts:");
  console.log("  @path/to/file    attach a file or directory to your message");
  console.log("  !command         run a shell command directly (no AI)");
  console.log("  Tab              complete slash commands and @file paths");
  console.log("  ↑ / ↓            scroll through input history");
  console.log("  Esc / Ctrl+C     cancel the current generation\n");

  console.log("Model switching:");
  console.log("  /use MODEL       switch model");
  console.log("  /sol /luna /kimi /opus /sonnet /terra /deep /flash\n");

  console.log("Sessions:");
  console.log("  /sessions        list saved sessions");
  console.log("  /resume ID       resume a saved session");
  console.log("  /save            force-save the current session");
  console.log("  /retry           re-run your last message\n");

  console.log("Other:");
  console.log("  /models WORD     search model catalog");
  console.log("  /me              account info");
  console.log("  /cost            token usage this session");
  console.log("  /temp N          set temperature (0–2)");
  console.log("  /oneshot GOAL     run a persistent autonomous mission to a verified verdict");
  console.log("  /system TEXT     set persistent custom instructions");
  console.log("  /copy TOOL       copy config (claude|cursor|aider|openai)");
  console.log("  /mcp add|remove|list  manage MCP servers");
  console.log("  /clear           clear conversation");
  console.log("  /history         show context size");
  console.log("  /tools           list all tools");
  console.log("  /exit            quit");
}

function showTools() {
  console.log(C(`\n${TOOLS.length} Available Tools\n`, CYN));
  const categories = {
    "Shell & System": ["shell", "system_info", "process_list", "process_kill", "install_package", "clipboard_write", "clipboard_read", "download"],
    "Filesystem": ["read_file", "write_file", "edit_file", "list_dir", "grep"],
    "Web": ["web_fetch", "web_search", "web_scrape"],
    "Browser": ["browser_open", "browser_screenshot", "browser_click", "browser_type", "browser_evaluate"],
    "Code Execution": ["run_python", "run_javascript"],
    "Git": ["git"],
    "Memory & Tasks": ["memory_save", "memory_recall", "todo_add", "todo_list", "todo_update"],
    "MCP": ["mcp_call", "mcp_list_tools"]
  };
  for (const [cat, names] of Object.entries(categories)) {
    console.log(C(`  ${cat}:`, YEL));
    for (const n of names) {
      const tool = TOOLS.find(t => t.function.name === n);
      if (tool) console.log(`    ${C(n, 33)} — ${tool.function.description.split(".")[0]}`);
    }
  }
}

// ── One-shot commands ─────────────────────────────────────────────
async function setup() {
  const key = opt("--key", "");
  if (!key) throw new Error("Use: surplus setup --key inf_your_key");
  writeConfig({ ...readConfig(), key, model: opt("--model", "gpt-5.6-sol") });
  console.log(C(`API key saved. Default model: ${readConfig().model}`, GRN));
}

async function modelCatalog() {
  const data = await api("/models");
  return (data.data || []).filter(m => m.id && String(m.architecture?.modality || "").includes("->text"));
}

async function models(search = "") {
  const q = search.toLowerCase();
  const list = (await modelCatalog()).filter(m => !q || m.id.toLowerCase().includes(q) || (m.name || "").toLowerCase().includes(q)).slice(0, 60);
  if (!list.length) return console.log("No matching models.");
  for (const m of list) console.log(`${C(m.id, CYN)}  ${m.name || ""}`);
  console.log(`\n${list.length} shown`);
}

async function me() {
  const data = await api("/buyer/me");
  const balance = data.balance_usd ?? data.balance ?? data.allowance_usd;
  console.log(C("Account", CYN));
  console.log(balance !== undefined ? `Balance/allowance: $${balance}` : JSON.stringify(data, null, 2).slice(0, 600));
}

function copyConfig(tool, model) {
  const snippets = {
    claude: `$env:ANTHROPIC_BASE_URL="https://api.surplusintelligence.ai/anthropic"\n$env:ANTHROPIC_AUTH_TOKEN="<your inf_ key>"`,
    cursor: `Base URL: ${API}\nAPI key: <your inf_ key>\nModel: ${model}`,
    aider: `aider --openai-api-base ${API} --openai-api-key <your inf_ key> --model ${model}`,
    openai: `const client = new OpenAI({ apiKey: "<your inf_ key>", baseURL: "${API}" });`
  };
  const text = snippets[tool] || Object.values(snippets).join("\n\n---\n\n");
  try {
    const child = spawn("clip");
    child.stdin.write(text);
    child.stdin.end();
    console.log(C(`${tool || "all"} config copied to clipboard.`, GRN));
  } catch { console.log(text); }
}

// ── Input helpers ─────────────────────────────────────────────────
const SLASH_COMMANDS = [
  "/help", "/tools", "/use ", "/models ", "/me", "/copy ", "/clear", "/history",
  "/sessions", "/resume ", "/save", "/cost", "/retry", "/temp ", "/system ",
  "/mcp add ", "/mcp remove ", "/mcp list", "/mcp tools ", "/mcp call ", "/exit"
];

// Completes slash commands, model shortcuts, and @-prefixed file paths.
function completer(line) {
  const at = line.lastIndexOf("@");
  if (at !== -1 && !/\s/.test(line.slice(at + 1))) {
    const frag = line.slice(at + 1);
    const dir = frag.includes("/") || frag.includes("\\") ? path.dirname(frag) : ".";
    const base = path.basename(frag);
    try {
      const hits = fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => e.name.toLowerCase().startsWith(base.toLowerCase()))
        .map(e => (dir === "." ? e.name : path.join(dir, e.name)) + (e.isDirectory() ? "/" : ""));
      return [hits, frag];
    } catch { return [[], frag]; }
  }
  if (line.startsWith("/")) {
    const all = [...SLASH_COMMANDS, ...Object.keys(shortcuts).map(s => "/" + s)];
    const hits = all.filter(c => c.startsWith(line));
    return [hits.length ? hits : all, line];
  }
  return [[], line];
}

// Expands @path references into inlined file contents so the model sees them.
function expandFileRefs(input) {
  const refs = [...input.matchAll(/@([\w./\\:~-]+)/g)];
  if (!refs.length) return input;
  let out = input;
  const blocks = [];
  for (const [full, ref] of refs) {
    const p = path.resolve(ref.replace(/^~/, os.homedir()));
    try {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(p).slice(0, 100).join("\n");
        blocks.push(`--- directory ${p} ---\n${entries}`);
      } else {
        const content = fs.readFileSync(p, "utf8").slice(0, 40000);
        blocks.push(`--- file ${p} ---\n${content}`);
      }
      out = out.replace(full, p);
      console.log(C(`  ◇ attached ${p}`, DIM));
    } catch { /* leave the literal @ref alone if it isn't a real path */ }
  }
  return blocks.length ? `${out}\n\n${blocks.join("\n\n")}` : out;
}

// ── Interactive mode ──────────────────────────────────────────────
async function interactive() {
  const readline = require("readline");
  const cfg = readConfig();
  let model = cfg.model || "gpt-5.6-sol";
  let history = [];
  let lastInput = null;
  let sessionId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  const resumeArg = opt("--resume");
  if (resumeArg) {
    const s = loadSession(resumeArg);
    if (s) {
      history = s.history || [];
      model = s.model || model;
      sessionId = s.id;
    }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
    historySize: 200
  });

  // stdin can hit EOF (piped input) while a request is in flight, after which
  // readline throws on any prompt call — so track closure and no-op.
  let closed = false;
  rl.on("close", () => { closed = true; });

  const setPrompt = () => {
    if (closed) return;
    const ctx = history.length ? C(` ${history.length}msg`, DIM) : "";
    rl.setPrompt(`\n${ansi.rgb(255, 105, 190, "money")}${ansi.rgb(177, 116, 255, "pack")} ${C("·", DIM)} ${C(model, CYN)}${ctx} ${ansi.rgb(84, 237, 190, "❯")} `);
  };
  const prompt = () => { if (!closed) rl.prompt(); };

  // Ctrl+C and Esc cancel an in-flight generation instead of killing the process.
  let inFlight = null;
  rl.on("SIGINT", () => {
    if (inFlight) { inFlight.abort(); return; }
    console.log(C("\n  (/exit to quit)", DIM));
    prompt();
  });
  if (TTY && process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.on("keypress", (_ch, key) => {
      if (key?.name === "escape" && inFlight) inFlight.abort();
    });
  }

  await banner(model);
  if (history.length) console.log(C(`  Resumed session ${sessionId} — ${history.length} messages`, GRN));
  setPrompt();
  prompt();

  for await (const line of rl) {
    let input = line.trim();
    if (!input) { prompt(); continue; }
    if (["/exit", "/quit", "exit", "quit"].includes(input)) break;

    // Resolve /retry up front so it re-enters the normal chat path below.
    if (input === "/retry") {
      if (!lastInput) {
        console.log(C("  Nothing to retry.", DIM));
        setPrompt(); prompt(); continue;
      }
      const lastUser = history.map(m => m.role).lastIndexOf("user");
      if (lastUser !== -1) history = history.slice(0, lastUser);
      input = lastInput;
      console.log(C(`  ↻ ${input}`, DIM));
    }

    try {
      if (input === "/help") help();
      else if (input === "/tools") showTools();
      else if (input === "/sessions") printSessions();
      else if (input === "/save") {
        const id = saveSession(sessionId, model, history);
        console.log(C(id ? `Saved session ${id}` : "Nothing to save.", id ? GRN : DIM));
      } else if (input.startsWith("/resume ")) {
        const s = loadSession(input.slice(8).trim());
        if (!s) console.log(C("Session not found. Use /sessions to list.", RED));
        else {
          history = s.history || [];
          model = s.model || model;
          sessionId = s.id;
          console.log(C(`Resumed ${s.id} — ${history.length} messages`, GRN));
        }
      } else if (input === "/cost") {
        const { prompt, completion, calls } = usageTotals;
        console.log(C("\n  Usage this session", CYN));
        console.log(`  ${C("requests", DIM)}    ${calls}`);
        console.log(`  ${C("prompt", DIM)}      ${prompt.toLocaleString()} tokens`);
        console.log(`  ${C("completion", DIM)}  ${completion.toLocaleString()} tokens`);
        console.log(`  ${C("total", DIM)}       ${(prompt + completion).toLocaleString()} tokens`);
      } else if (input.startsWith("/temp ")) {
        const t = Number(input.slice(6).trim());
        if (Number.isNaN(t) || t < 0 || t > 2) console.log(C("Temperature must be 0–2.", RED));
        else { writeConfig({ ...readConfig(), temperature: t }); console.log(C(`Temperature set to ${t}`, GRN)); }
      } else if (input.toLowerCase().startsWith("/oneshot ")) {
        const goal = input.slice(9).trim();
        if (!goal) throw new Error("/ONESHOT requires a goal");
        const missions = new MissionHarness();
        const mission = missions.create({
          title: goal.slice(0, 120), objective: goal,
          criteria: [{ id: "criterion-1", requirement: goal, required: true }],
          plan: [{ id: "step-1", title: "Execute and verify the goal", criterionIds: ["criterion-1"] }],
          constraints: ["Do not ask questions or pause unless safety policy creates a genuine hard blocker"],
          metadata: { workspace: process.cwd(), mode: "oneshot", model }
        });
        missions.start(mission.id);
        missions.updateStep(mission.id, "step-1", "running");
        console.log(C(`ONESHOT mission ${mission.id} started`, CYN));
        const autonomousPrompt = `ONESHOT MISSION ${mission.id}: ${goal}

Execute autonomously now. Do not ask questions or pause. Make reasonable assumptions, use tools, inspect results, fix failures, and continue until the goal is actually complete or a genuine safety blocker prevents progress. Finish with concise evidence and explicit limitations.`;
        try {
          const response = await sendChat(model, autonomousPrompt, history, { stream: false, maxToolRounds: 48, missionId: mission.id });
          history = response.messages;
          missions.record(mission.id, { type: "observed", summary: "Agent final report", ok: true, criterionIds: ["criterion-1"], data: { report: response.content } });
          missions.updateStep(mission.id, "step-1", "verified", "Agent execution completed; evidence captured");
          missions.record(mission.id, { type: "verified", summary: "ONESHOT execution loop completed", ok: true, criterionIds: ["criterion-1"], data: { report: response.content } });
        } catch (error) {
          missions.updateStep(mission.id, "step-1", "blocked", error.message);
          missions.record(mission.id, { type: "blocked", summary: "ONESHOT stopped by genuine blocker", ok: false, criterionIds: ["criterion-1"], error: error.message });
        }
        missions.judge(mission.id);
        console.log("\n" + missions.brief(mission.id));
        saveSession(sessionId, model, history);
      } else if (input.startsWith("/system ")) {
        const instr = input.slice(8).trim();
        writeConfig({ ...readConfig(), instructions: instr });
        console.log(C(instr ? "Custom instructions saved." : "Instructions cleared.", GRN));
      } else if (input.startsWith("!")) {
        const cmd = input.slice(1).trim();
        if (cmd) console.log(await executeTool("shell", { command: cmd }));
      } else if (input.startsWith("/use ")) {
        const chosen = input.slice(5).trim();
        model = shortcuts[chosen] || chosen;
        writeConfig({ ...readConfig(), model });
        console.log(C(`Now using ${model}`, GRN));
      } else if (shortcuts[input.replace("/", "")]) {
        model = shortcuts[input.replace("/", "")];
        writeConfig({ ...readConfig(), model });
        console.log(C(`Now using ${model}`, GRN));
      } else if (input.startsWith("/models")) await models(input.slice(7).trim());
      else if (input === "/me") await me();
      else if (input.startsWith("/copy")) copyConfig(input.split(" ")[1], model);
      else if (input === "/clear") { history = []; console.log(C("Cleared.", GRN)); }
      else if (input === "/history") console.log(history.length ? `${history.length} messages in context` : "Empty.");
      else if (input.startsWith("/mcp add ")) {
        const parts = input.slice(9).trim().split(/\s+/);
        mcpAdd(parts[0], parts[1], parts.slice(2));
      } else if (input.startsWith("/mcp remove ")) {
        mcpRemove(input.slice(12).trim());
      } else if (input === "/mcp list") { mcpList(); }
      else if (input.startsWith("/mcp tools ")) {
        const result = await listMCPTools(input.slice(11).trim());
        console.log(result);
      } else if (input.startsWith("/mcp call ")) {
        const parts = input.slice(10).trim().split(/\s+/);
        const mcpArgs = parts.slice(2).join(" ");
        let parsedArgs = {};
        if (mcpArgs) { try { parsedArgs = JSON.parse(mcpArgs); } catch { parsedArgs = { query: mcpArgs }; } }
        const result = await callMCPTool(parts[0], parts[1], parsedArgs);
        console.log(result);
      } else if (input === "/mcp") mcpList();
      else {
        lastInput = input;
        const prompt = expandFileRefs(input);

        const spin = ["◐", "◓", "◑", "◒", "✦", "◆"];
        let tick = 0;
        let spinning = true;
        const started = Date.now();
        const clearSpinner = () => process.stdout.write(ansi.line + " ".repeat(56) + "\r");
        const paint = () => {
          if (!spinning) return;
          const elapsed = ((Date.now() - started) / 1000).toFixed(1);
          process.stdout.write(ansi.line + `  ${ansi.rgb(255, 105, 190, spin[tick++ % spin.length])} ${C("FORGING", MAG)} ${C(elapsed + "s", CYN)} ${C("esc/ctrl+c to cancel", DIM)}`);
        };
        const stopSpinner = () => {
          if (!spinning) return;
          spinning = false;
          clearInterval(dots);
          clearSpinner();
        };

        paint();
        const dots = setInterval(paint, NO_MOTION ? 1000 : 90);

        const controller = new AbortController();
        inFlight = controller;

        try {
          const response = await sendChat(model, prompt, history, {
            signal: controller.signal,
            onStreamStart: stopSpinner
          });
          stopSpinner();
          history = response.messages;
          if (!response.streamed) {
            console.log(response.content ? renderMarkdown(response.content) : C("No response.", RED));
          }
          const secs = ((Date.now() - started) / 1000).toFixed(1);
          console.log(C(`  ─ ${secs}s · ${history.length} msgs`, DIM));
          saveSession(sessionId, model, history);
        } catch (e) {
          stopSpinner();
          if (e.name === "AbortError" || controller.signal.aborted) {
            console.log(C("\n  ✕ Cancelled.", YEL));
          } else throw e;
        } finally {
          inFlight = null;
        }
      }
    } catch (e) { console.log(C(`  ✕ ${e.message}`, RED)); }

    setPrompt();
    prompt();
  }

  saveSession(sessionId, model, history);
  rl.close();
}

// ── Exports ───────────────────────────────────────────────────────
// The TUI (moneypack-tui.js) requires this file to reuse the tool
// implementations, streaming client, and session store verbatim.
module.exports = {
  TOOLS, executeTool, executeToolStructured, toolResult, formatToolResult,
  closeBrowser: () => browserManager.close(),
  sendChat, apiStream, api, usageTotals,
  readConfig, writeConfig, shortcuts, highlight, renderMarkdown,
  saveSession, loadSession, listSessions, renameSession, deleteSession, deriveSessionMetadata, topicSimilarity, consolidateSessions, expandFileRefs,
  modelCatalog, TOOL_ICONS, summarizeArgs, SESSION_DIR, trimHistory
};

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  try {
    if (command === "setup") await setup();
    else if (command === "models") await models(args.slice(1).join(" "));
    else if (command === "chat") {
      const m = shortcuts[opt("--model", readConfig().model || "sol")] || opt("--model", readConfig().model || "gpt-5.6-sol");
      const p = opt("--prompt");
      if (!p) throw new Error('Use: surplus chat --prompt "Your message"');
      const res = await sendChat(m, p, [], { stream: TTY });
      if (!res.streamed) console.log(res.content);
    }
    else if (command === "sessions") printSessions();
    else if (command === "me") await me();
    else if (command === "copy") copyConfig(args[1], readConfig().model || "gpt-5.6-sol");
    else if (command === "mcp") {
      const sub = args[1];
      if (sub === "add") mcpAdd(args[2], args[3], args.slice(4));
      else if (sub === "remove") mcpRemove(args[2]);
      else if (sub === "list" || !sub) mcpList();
      else console.log("Use: mcp add|remove|list");
    }
    else if (command === "tui" || command === "ui") await require("./moneypack-tui.js").run();
    else if (command === "start" || command === "open") await interactive();
    else help();
  } catch (e) {
    console.error(C(`Error: ${e.message}`, RED));
    process.exitCode = 1;
  }
}

// Only drive the CLI when executed directly — not when required by the TUI.
if (require.main === module) main();
