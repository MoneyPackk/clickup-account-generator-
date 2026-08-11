#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────
//  MoneyPack TUI — split-pane terminal UI, zero dependencies.
//
//  Architecture:
//    screen   — a line buffer + damage tracker; only repaints changed rows
//    layout   — computes pane rectangles from terminal size
//    panes    — chat transcript, tool rail, status bar, input line
//    input    — raw-mode key decoding, mouse wheel, resize
//    agent    — reuses surplus-cli.js tools/streaming/sessions verbatim
// ─────────────────────────────────────────────────────────────────────

const os = require("os");
const path = require("path");
const fs = require("fs");
const cli = require("./surplus-cli.js");
const harness = require("./moneypack-harness.js");
const storage = require("./storage.js");
const autonomy = require("./autonomy.js");

async function executeTool(name, args) {
  return harness.execute(name, args, cli.executeTool);
}

const OUT = process.stdout;

// ── ANSI ─────────────────────────────────────────────────────────────
const esc = {
  alt: (on) => on ? "\x1b[?1049h" : "\x1b[?1049l",
  cursor: (on) => on ? "\x1b[?25h" : "\x1b[?25l",
  mouse: (on) => on ? "\x1b[?1000h\x1b[?1006h" : "\x1b[?1006l\x1b[?1000l",
  wrap: (on) => on ? "\x1b[?7h" : "\x1b[?7l",
  to: (r, c) => `\x1b[${r};${c}H`,
  clear: "\x1b[2J",
  eol: "\x1b[K",
  reset: "\x1b[0m"
};

const fg = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;
const bg = (r, g, b) => `\x1b[48;2;${r};${g};${b}m`;
const BOLD = "\x1b[1m";
const ITAL = "\x1b[3m";

// Palette — matches the CLI banner identity.
const T = {
  pink: fg(255, 105, 190),
  violet: fg(177, 116, 255),
  mint: fg(84, 237, 190),
  cyan: fg(111, 214, 255),
  amber: fg(245, 184, 90),
  red: fg(255, 107, 107),
  text: fg(231, 234, 240),
  dim: fg(122, 130, 145),
  faint: fg(80, 87, 100),
  panel: bg(20, 23, 31),
  panel2: bg(24, 27, 36),
  barBg: bg(27, 31, 42),
  barZone: bg(35, 39, 52),
  railBg: bg(17, 20, 28),
  canvas: bg(10, 12, 18),
  elevated: bg(29, 33, 45),
  selected: bg(42, 48, 65),
  gLow: bg(8, 10, 16),
  gMid: bg(18, 20, 28)
};
// Breathing spinner: a pulse of dots that expands and contracts.
const BREATHE = ["⠂", "⠒", "⠲", "⡪", "⢕", "⢸", "⢸", "⢕", "⡪", "⠲", "⠒", "⠂"];
// Rich divider that animates subtly.
const DIVS = ["▕", "▐", "▌", "▘", "▗"];

// Visible width, ignoring ANSI escapes. Wide CJK/emoji count as 2 cells.
// Matches CSI sequences including private-mode forms such as \x1b[?25h.
const ANSI_RE = /\x1b\[[?!<>=]?[0-9;]*[A-Za-z]/g;
function strip(s) { return s.replace(ANSI_RE, ""); }
function charWidth(cp) {
  if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
  if (cp >= 0x1f300 && cp <= 0x1faff) return 2;
  if (cp >= 0x2e80 && cp <= 0xa4cf) return 2;
  if (cp >= 0xac00 && cp <= 0xd7a3) return 2;
  if (cp >= 0xff00 && cp <= 0xff60) return 2;
  return 1;
}
function width(s) {
  let w = 0;
  for (const ch of strip(s)) w += charWidth(ch.codePointAt(0));
  return w;
}
// Truncate to a cell budget without slicing an escape sequence in half.
function fit(s, max) {
  if (width(s) <= max) return s;
  let out = "", w = 0, i = 0;
  while (i < s.length) {
    if (s[i] === "\x1b") {
      const m = /^\x1b\[[?!<>=]?[0-9;]*[A-Za-z]/.exec(s.slice(i));
      if (m) { out += m[0]; i += m[0].length; continue; }
    }
    const ch = String.fromCodePoint(s.codePointAt(i));
    const cw = charWidth(ch.codePointAt(0));
    if (w + cw > max - 1) break;
    out += ch; w += cw; i += ch.length;
  }
  return out + T.faint + "…" + esc.reset;
}
function pad(s, w) {
  const gap = w - width(s);
  return gap > 0 ? s + " ".repeat(gap) : fit(s, w);
}

// Splits a run too long for the pane into width-bounded chunks.
// Returns [...fullChunks, remainder] — remainder may be "".
function hardSplit(word, w) {
  const out = [];
  let rest = word;
  while (width(rest) > w) {
    let cut = "", ww = 0, i = 0;
    while (i < rest.length) {
      if (rest[i] === "\x1b") {
        const m = /^\x1b\[[0-9;]*[A-Za-z]/.exec(rest.slice(i));
        if (m) { cut += m[0]; i += m[0].length; continue; }
      }
      const ch = String.fromCodePoint(rest.codePointAt(i));
      const cw = charWidth(ch.codePointAt(0));
      if (ww + cw > w) break;
      ww += cw; cut += ch; i += ch.length;
    }
    if (!cut) break;                 // degenerate width; bail rather than spin
    out.push(cut);
    rest = rest.slice(cut.length);
  }
  out.push(rest);
  return out;
}

// Wrap to a cell width, preserving words and honouring existing colour runs.
function wrap(text, w) {
  if (w < 4) return String(text).split("\n");
  const lines = [];
  for (const raw of String(text).split("\n")) {
    if (width(raw) <= w) { lines.push(raw); continue; }
    let line = "";
    for (const word of raw.split(" ")) {
      if (line && width(line) + 1 + width(word) <= w) { line += " " + word; continue; }
      if (line) { lines.push(line); line = ""; }
      if (width(word) > w) {
        const parts = hardSplit(word, w);
        line = parts.pop();
        lines.push(...parts);
      } else {
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

// ── Screen: damage-tracked line buffer ───────────────────────────────
// Repainting only changed rows keeps streaming smooth and flicker-free.
class Screen {
  constructor() { this.prev = []; this.buf = []; this.rows = 0; this.cols = 0; }

  begin(rows, cols) {
    if (rows !== this.rows || cols !== this.cols) {
      this.rows = rows; this.cols = cols;
      this.prev = [];               // force a full repaint on resize
    }
    this.buf = new Array(rows).fill("");
  }

  set(row, text) {
    if (row >= 0 && row < this.rows) this.buf[row] = text;
  }

  flush() {
    let out = "";
    for (let r = 0; r < this.rows; r++) {
      const line = this.buf[r] ?? "";
      if (this.prev[r] === line) continue;
      out += esc.to(r + 1, 1) + line + esc.reset + esc.eol;
    }
    if (out) OUT.write(out);
    this.prev = this.buf.slice();
  }

  invalidate() { this.prev = []; }
}

// ── Model ────────────────────────────────────────────────────────────
// Transcript entries are plain data; rendering happens at paint time so
// a resize reflows everything correctly.
const state = {
  model: cli.readConfig().model || "gpt-5.6-sol",
  entries: [],          // { kind, text, tool?, ms?, ok?, args?, collapsed? }
  toolLog: [],          // { name, ok, ms }
  history: [],
  input: "",
  cursor: 0,
  inputHistory: [],
  histIdx: -1,
  scroll: 0,            // rows scrolled up from the bottom
  busy: false,
  status: "ready",
  spinner: 0,
  sessionId: new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19),
  showRail: true,
  railScroll: 0,
  elapsed: 0,
  startedAt: 0,
  notice: "",
  completions: [],        // live command/path suggestions
  compIdx: 0,               // highlighted suggestion
  sessionPicker: [],        // sessions currently shown as clickable rows
  modal: null,              // {type, query, index, items, action} keyboard-first overlays
  selection: null,          // {anchor, focus}; whole-message keyboard range
  preferredCol: null,
  attachedPaths: [],
  toolGroups: [],
  composerRows: 1,
  tabs: [],                 // persistent application workspaces
  activeTab: 0,
  hitTargets: [],           // mouse targets rebuilt on each paint
  cursorOn: true,           // cursor blink state (toggled by timer)
  blinkTimer: null,
  controller: null,
  autonomy: autonomy.readSettings().profile,
  objective: null,         // locked mission text; survives follow-up reports in this workspace
  objectiveProgress: 0,    // evidence-based estimate, never presented as guaranteed completion
  reportNo: 0,
  objectiveFiles: [],
  objectiveLearnings: [],
  oneshot: { active:false, objective:null, startedAt:0, maxSteps:20, stepsUsed:0, verificationCommand:null, dryRun:false, status:"idle" }
};

function addEntry(e) {
  state.entries.push(e);
  state.scroll = 0;     // any new output jumps to the live tail
  state.railScroll = 0; // new tool activity resets rail to show latest
  return state.entries[state.entries.length - 1];
}

// ── Layout ───────────────────────────────────────────────────────────
// Rail collapses automatically on narrow terminals so chat never starves.
function layout() {
  const cols = Math.max(40, OUT.columns || 80);
  const rows = Math.max(12, OUT.rows || 24);
  const mode = cols < 76 ? "compact" : cols >= 120 ? "wide" : "standard";
  const railWanted = state.showRail && mode !== "compact";
  const rail = railWanted ? Math.min(mode === "wide" ? 34 : 28, Math.max(22, Math.floor(cols * 0.24))) : 0;
  const composerRows = Math.max(1, Math.min(5, String(state.input).split("\n").length));
  state.composerRows = composerRows;
  return { cols, rows, mode, rail, chatW: cols - rail - (rail ? 1 : 0), inputW: cols,
    headRow: 0, bodyTop: 2, bodyRows: Math.max(3, rows - 4 - composerRows), railH: Math.max(3, rows - 4 - composerRows),
    statusRow: rows - 2 - composerRows, inputRow: rows - 1 - composerRows, hintRow: rows - 1 };
}

// ── Transcript rendering ─────────────────────────────────────────────
const SPIN = BREATHE;

// Renders one entry to styled lines. Kept pure so resize reflows cleanly.
function entryLines(e, w) {
  const out = [];
  if (e.kind === "user") {
    out.push(`${T.mint}╭─ ${T.elevated}${BOLD} YOU ${esc.reset}${T.mint} ─────────────────`);
    for (const l of wrap(e.text, w - 5)) out.push(`${T.mint}│   ${T.text}${l}`);
    out.push(`${T.mint}╰─`);
    out.push("");
    return out;
  }
  if (e.kind === "assistant") {
    out.push(`${T.pink}╭─ ${T.elevated}${BOLD} MONEYPACK ${esc.reset}${T.pink} ─────────────`);
    for (const l of markdownLines(e.text, w - 5)) out.push(`${T.pink}│   ${l}`);
    out.push(`${T.pink}╰─`);
    out.push("");
    return out;
  }
  if (e.kind === "tool") {
    const icon = cli.TOOL_ICONS[e.tool] || "◆";
    const running = e.running;
    const status = running ? `${T.amber}${BREATHE[state.spinner % BREATHE.length]}` : e.ok ? `${T.mint}✓` : `${T.red}✕`;
    const time = e.ms != null ? `${T.faint}  ${e.ms}ms` : "";
    out.push(fit(`  ${status} ${T.dim}${icon} ${T.violet}${e.tool}${T.faint}  ${e.summary || ""}${time}`, w));
    if (!e.collapsed && e.result && (e.expanded || !e.ok)) {
      const body = e.result.split(/\r?\n/).filter(l => l.trim());
      const shown = body.slice(0, e.expanded ? 40 : 4);
      for (const l of shown) out.push(`    ${T.faint}${fit(l, w - 5)}`);
      if (body.length > shown.length) out.push(`    ${T.faint}… ${body.length - shown.length} more lines`);
    }
    return out;
  }
  if (e.kind === "diff") {
    const bar = DIVS[Math.floor(state.spinner / 2) % DIVS.length];
    out.push(`${T.violet}${bar}─ ${BOLD}${e.path}${esc.reset}`);
    for (const l of e.lines.slice(0, 30)) {
      const c = l.startsWith("+") ? T.mint : l.startsWith("-") ? T.red : T.faint;
      out.push(`${T.faint}│ ${c}${fit(l, w - 4)}`);
    }
    out.push(`${T.faint}└${"─".repeat(w - 2)}`);
    out.push("");
    return out;
  }
  if (e.kind === "note") {
    for (const l of wrap(e.text, w - 4)) out.push(`${T.faint}│ ${T.faint}${l}`);
    out.push(`${T.faint}└${"─".repeat(w - 2)}`);
    out.push("");
    return out;
  }
  if (e.kind === "report") {
    out.push(`${T.cyan}╭─ ${T.elevated}${BOLD} EXECUTION REPORT ${esc.reset}${T.cyan} ───────`);
    for (const l of markdownLines(e.text, w - 5)) out.push(`${T.cyan}│   ${l}`);
    out.push(`${T.cyan}╰─`); out.push(""); return out;
  }
  if (e.kind === "error") {
    for (const l of wrap(e.text, w - 4)) out.push(`${T.red}  ${l}`);
    out.push("");
    return out;
  }
  return out;
}

// Markdown → styled lines, with fenced blocks boxed and highlighted.
function markdownLines(text, w) {
  const out = [];
  let inFence = false, lang = "";
  for (const raw of String(text).split("\n")) {
    const fence = raw.match(/^\s*```(\w*)/);
    if (fence) {
      if (!inFence) { inFence = true; lang = fence[1] || ""; out.push(`${T.faint}┌─ ${lang || "code"} ${"─".repeat(Math.max(2, w - 6 - lang.length))}`); }
      else { inFence = false; out.push(`${T.faint}└${"─".repeat(Math.max(2, w - 2))}`); }
      continue;
    }
    if (inFence) {
      for (const l of wrap(raw, w - 4)) out.push(`${T.faint}│ ${cli.highlight(l, lang)}`);
      continue;
    }
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) { for (const l of wrap(h[2], w)) out.push(`${T.pink}${BOLD}${l}${esc.reset}`); continue; }
    let s = raw
      .replace(/^(\s*)([-*+])\s+/, (_, sp) => `${sp}${T.violet}• ${T.text}`)
      .replace(/^(\s*)(\d+\.)\s+/, (_, sp, n) => `${sp}${T.violet}${n} ${T.text}`)
      .replace(/`([^`\n]+)`/g, (_, c) => `${T.cyan}${c}${T.text}`)
      .replace(/\*\*([^*\n]+)\*\*/g, (_, b) => `${BOLD}${b}${esc.reset}${T.text}`)
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, (_, p, i) => `${p}${ITAL}${i}${esc.reset}${T.text}`);
    for (const l of wrap(s, w)) out.push(T.text + l);
  }
  return out;
}

// Flattens the transcript into a scrollable line array.
function transcriptRows(w) {
  const rows = [];
  let codeNo = 0;
  state.entries.forEach((e, index) => {
    if (e.kind === "tool" && state.entries[index - 1]?.kind !== "tool") { const group=[];for(let i=index;i<state.entries.length&&state.entries[i].kind==="tool";i++)group.push(state.entries[i]);const failed=group.filter(x=>x.ok===false).length,elapsed=group.reduce((n,x)=>n+(x.ms||0),0),collapsed=group.every(x=>x.collapsed);rows.push({text:`${T.violet}  ${collapsed?"▶":"▼"} TOOL RUN${T.faint} · ${group.length} tools · ${failed?T.red+failed+" failed":T.mint+"ok"}${T.faint} · ${elapsed}ms`,action:{type:"toolGroup",index}}); }
    const rendered = entryLines(e, w);
    if (state.selection && index >= Math.min(state.selection.anchor,state.selection.focus) && index <= Math.max(state.selection.anchor,state.selection.focus) && rendered.length) rendered[0] = `${T.selected}${T.mint}▶ ${rendered[0]}${esc.reset}`;
    let inCode = false;
    for (let text of rendered) {
      let action = e.kind === "tool" ? { type: "tool", index } : { type: "select", index };
      const plain = strip(text);
      if (/┌─ .*─/.test(plain)) { inCode=true; codeNo++; text += `${T.cyan}  [⧉ copy ${codeNo}]`; action={type:"code",number:codeNo}; }
      else if (/^.*└─+/.test(plain) && inCode) inCode=false;
      const links=extractLinks(plain);
      const actions=[];
      if(links.length) for(const url of links){const col=plain.indexOf(url)+2;actions.push({type:"link",url,colStart:col,colEnd:col+width(url)-1});}
      if(action.type==="code")actions.push({...action,colStart:Math.max(1,w-13),colEnd:w});
      else actions.push(action);
      rows.push({text,action:actions[0],actions});
    }
  });
  return rows;
}
function transcriptLines(w) { return transcriptRows(w).map(r => r.text); }

function extractLinks(text) { return [...String(text).matchAll(/https?:\/\/[^\s<>()]+/g)].map(m => m[0].replace(/[.,;:]$/, "")); }
function extractCodeBlocks(text) { return [...String(text).matchAll(/```(?:\w+)?\n([\s\S]*?)```/g)].map(m => m[1].replace(/\n$/, "")); }
function relativeTime(ms) { const d=Math.max(0,Date.now()-(ms||0)), m=Math.floor(d/60000); return m<1?"now":m<60?`${m}m ago`:m<1440?`${Math.floor(m/60)}h ago`:`${Math.floor(m/1440)}d ago`; }

// ── Painting ─────────────────────────────────────────────────────────
const screen = new Screen();

function paint() {
  const L = layout();
  screen.begin(L.rows, L.cols);

  // Header — title floats left, status dots float right, divider animates.
  const mark = `${T.pink}${BOLD}◆ MONEYPACK${esc.reset}`;
  const activeWorkspace = state.tabs[state.activeTab]?.name || path.basename(process.cwd());
  const tabs = state.tabs.length > 1 ? `${T.faint}  ${state.tabs.map((t,i)=>i===state.activeTab?`${T.selected}${T.text} ${i+1}:${t.name} ${esc.reset}`:`${T.dim}${i+1}:${t.name}`).join(" ")}` : "";
  const workspace = `${T.faint}⌁ ${T.dim}${activeWorkspace}${tabs}`;
  const modelChip = `${T.elevated}${T.cyan} AI ${T.text} ${state.model} ${esc.reset}`;
  const liveChip = state.busy ? `${T.elevated}${T.amber} ● LIVE ${esc.reset}` : `${T.elevated}${T.mint} ● READY ${esc.reset}`;
  const left = ` ${mark}  ${workspace}`;
  const right = `${modelChip} ${liveChip} `;
  const gap = Math.max(1, L.cols - width(left) - width(right));
  screen.set(0, T.canvas + fit(left, L.cols - width(right)) + " ".repeat(gap) + right);
  // A branded gradient-like rule anchors the workspace chrome.
  const dv = DIVS[Math.floor(state.spinner / 3) % DIVS.length];
  const div = `${T.pink}${dv}${"━".repeat(Math.max(8, Math.floor(L.cols * .18)))}${T.violet}${"━".repeat(Math.max(8, Math.floor(L.cols * .18)))}${T.faint}${"─".repeat(L.cols)}`;
  screen.set(1, fit(div, L.cols));

  // Chat body
  state.hitTargets = [];
  const allRows = transcriptRows(L.chatW - 1);
  const all = allRows.map(r => r.text);
  const maxScroll = Math.max(0, all.length - L.bodyRows);
  state.scroll = Math.min(state.scroll, maxScroll);
  const start = Math.max(0, all.length - L.bodyRows - state.scroll);
  const viewRows = allRows.slice(start, start + L.bodyRows);
  const view = viewRows.map(r => r.text);

  for (let i = 0; i < L.bodyRows; i++) {
    const chat = view[i] != null ? " " + view[i] : "";
    let line = T.canvas + pad(chat, L.chatW);
    if (L.rail) {
      // Rail gets its own background that spans its full width.
      line += T.railBg + " " + T.faint + "│" + esc.reset + railLine(i, L.rail - 1, L.railH);
    } else {
      line += T.faint + "│";
    }
    screen.set(L.bodyTop + i, line);
    for(const action of viewRows[i]?.actions||[viewRows[i]?.action].filter(Boolean)) state.hitTargets.push({row:L.bodyTop+i+1,colStart:action.colStart||1,colEnd:action.colEnd||L.chatW,...action});
  }

  // A compact mouse-friendly session picker overlays the chat pane.
  if (state.modal?.type === "sessions") {
    const filtered = state.modal.items.filter(x => `${x.title} ${x.context || ""} ${(x.keywords || []).join(" ")} ${x.id}`.toLowerCase().includes(state.modal.query.toLowerCase()));
    state.sessionPicker = filtered;
    const rows = [
      `${T.elevated}${T.pink}${BOLD}  SESSION SWITCHER  ${esc.reset}${T.faint}  search: ${state.modal.query || "type to filter"}`,
      `${T.faint}  Click to select · ↑↓ navigate · Enter open · F2 rename · Del delete · Esc close`
    ];
    for (const [si, session] of state.sessionPicker.slice(0, Math.max(0, L.bodyRows - 2)).entries()) {
      const turns = (session.history || []).filter(m => m.role === "user").length;
      const preview = session.context || (session.history || []).find(m => m.role === "user")?.content || "No context saved";
      const bgc = si === state.modal.index ? T.selected : T.elevated;
      rows.push(`${bgc}${T.violet}  ${si === state.modal.index ? "▶" : " "}  ${T.text}${session.title || "untitled"}${T.faint} · ${turns} turns · ${relativeTime(session.updated)} · ${fit(preview, 34)} ${T.mint}[Resume]${T.cyan}[Rename]${T.red}[Delete]${esc.reset}`);
    }
    for (let i = 0; i < Math.min(rows.length, L.bodyRows); i++) {
      screen.set(L.bodyTop + i, pad(" " + fit(rows[i], L.chatW - 1), L.chatW) +
        (L.rail ? T.railBg + " " + T.faint + "│" + esc.reset + railLine(i, L.rail - 1, L.railH) : T.faint + "│"));
      if (i >= 2) { const id=state.sessionPicker[i-2].id; state.hitTargets.push({row:L.bodyTop+i+1,colStart:1,colEnd:Math.max(1,L.chatW-24),type:"session",id}); state.hitTargets.push({row:L.bodyTop+i+1,colStart:Math.max(1,L.chatW-23),colEnd:L.chatW-16,type:"sessionAction",action:"resume",id}); state.hitTargets.push({row:L.bodyTop+i+1,colStart:Math.max(1,L.chatW-15),colEnd:L.chatW-8,type:"sessionAction",action:"rename",id}); state.hitTargets.push({row:L.bodyTop+i+1,colStart:Math.max(1,L.chatW-7),colEnd:L.chatW,type:"sessionAction",action:"delete",id}); }
    }
  }

  if (state.modal?.type === "rename") {
    const row=L.bodyTop+Math.min(3,L.bodyRows-1);
    screen.set(row,pad(` ${T.elevated}${T.pink}${BOLD} RENAME SESSION ${esc.reset}${T.text} ${state.modal.value}▌`,L.chatW)+(L.rail?T.railBg+" │"+railLine(row-L.bodyTop,L.rail-1,L.railH):"│"));
  }
  if(state.modal?.type === "confirmDelete") { const row=L.bodyTop+2; screen.set(row,pad(` ${T.red}${BOLD} Delete “${state.modal.session.title}”? ${T.text}[Y] confirm  [N/Esc] cancel`,L.chatW)+(L.rail?T.railBg+" │"+railLine(2,L.rail-1,L.railH):"│")); }
  if(state.modal?.type === "tabs") { const rows=[`${T.pink}${BOLD} WORKSPACES ${T.faint} ↑↓ select · Enter switch · Del close · Esc`,...state.tabs.map((t,i)=>`${i===state.modal.index?T.selected+T.mint+" ▶ ":T.elevated+T.faint+"   "}${i+1}. ${T.text}${t.name}${T.faint} · ${t.model}`)]; rows.slice(0,L.bodyRows).forEach((x,i)=>{screen.set(L.bodyTop+i,pad(" "+fit(x,L.chatW-1),L.chatW)+(L.rail?T.railBg+" │"+railLine(i,L.rail-1,L.railH):"│"));state.hitTargets.push({row:L.bodyTop+i+1,colStart:1,colEnd:L.chatW,type:"tab",index:i-1});}); }

  // Scroll indicator
  if (state.scroll > 0) {
    screen.set(L.bodyTop, pad(`${T.amber} ↑ ${state.scroll} lines below${T.faint} (End to jump)`, L.chatW));
  }

  // Live completion popup directly above the status/input area.
  if (!state.busy && state.completions.length) {
    const shownCompletions = state.completions.slice(0, Math.min(6, L.bodyRows));
    const firstRow = Math.max(L.bodyTop, L.statusRow - shownCompletions.length);
    shownCompletions.forEach((item, index) => {
      const value=typeof item === "string"?item:item.value, selected = index === state.compIdx;
      const kind=typeof item === "string"?"COMMAND":item.kind, description=typeof item === "string"?"":item.description;
      const surface = selected ? T.selected : T.elevated;
      const label = `${surface}${selected ? T.mint + " ▶ " : T.faint + "   "}${selected ? T.text : T.dim}${typeof item==="string"?item:item.label}${T.faint}  ${kind} · ${description} ${selected?"↵ select":""} ${esc.reset}`;
      screen.set(firstRow + index, pad(" " + fit(label, L.chatW - 1), L.chatW) +
        (L.rail ? T.railBg + " " + T.faint + "│" + esc.reset + railLine(firstRow + index - L.bodyTop, L.rail - 1, L.railH) : T.faint + "│"));
      state.hitTargets.push({ row: firstRow + index + 1, colStart: 1, colEnd: L.chatW, type: "completion", value });
    });
  }

  // Status bar — three colored zones: status / timing / metrics.
  const u = cli.usageTotals;
  const tok = u.prompt + u.completion;
  const spin = state.busy ? `${T.amber}${BREATHE[state.spinner % BREATHE.length]} ` : `${T.mint}● `;
  const secs = state.busy ? `${T.amber} ${((Date.now() - state.startedAt) / 1000).toFixed(1)}s` : "";
  // Zone 1: status with breathing spinner; zone 2: token + request metrics.
  const zone1 = `${spin}${T.text}${state.status}${secs} ${T.faint}· ${T.mint}${state.autonomy.toUpperCase()}`;
  const zone2 = L.mode==="compact" ? `${T.cyan}${tok.toLocaleString()}${T.faint}t · ${T.pink}${u.calls}${T.faint}r` : `${T.faint}CONTEXT  ${T.cyan}${tok.toLocaleString()}${T.faint} tok   API  ${T.pink}${u.calls}${T.faint} req${L.mode==="wide"?`   FILES ${T.cyan}${state.attachedPaths.length}${T.faint}   WS ${T.violet}${state.activeTab+1}/${state.tabs.length}`:""}`;
  const zgap = Math.max(1, L.cols - width(zone1) - width(zone2) - 6);
  screen.set(L.statusRow, T.barBg + ` ${T.violet}◈ ${zone1}` + " ".repeat(zgap) + zone2 + "  " + esc.reset);

  // Multi-line composer: Enter sends; Shift+Enter inserts a newline.
  const inputLines = String(state.input).split("\n");
  const before = state.input.slice(0, state.cursor);
  const cursorRow = before.split("\n").length - 1;
  const cursorCol = width(before.split("\n").pop());
  const inputLabel = state.busy ? `${T.amber} RUNNING ` : `${T.mint} ASK `;
  for (let i = 0; i < state.composerRows; i++) {
    const row = L.inputRow + i;
    const lead = i === 0 ? `${T.faint}╭${T.violet} ${inputLabel}${T.faint}│ ` : `${T.faint}│       │ `;
    let body = inputLines[i] || "";
    if (i === cursorRow && !state.busy && state.cursorOn) body = body.slice(0, cursorCol) + `${T.mint}▌${T.text}` + body.slice(cursorCol);
    screen.set(row, T.elevated + lead + T.text + fit(body, L.cols - 10));
  }

  // Hint line
  screen.set(L.hintRow, T.elevated + T.faint + "╰─ " + fit(state.notice || hint(), L.cols - 4));

  screen.flush();
  // Park the hardware cursor in the input field.
  OUT.write(esc.to(L.inputRow + cursorRow + 1, 10 + cursorCol) + esc.cursor(true));
}

// Hint line helper — defined before paint so it's available via function hoisting.
function hint() {
  if (state.busy) return "esc cancel   ctrl+c quit";
  const c = state.completions.length > 1
    ? `${T.violet}${state.compIdx + 1}${T.faint}/${state.completions.length}${T.faint}  `
    : "";
  return LHint(c);
}

function LHint(c){const m=layout().mode;return m==="compact"?`${c}↵ send · S+↵ newline · / palette · ? help`:`${c}↵ send   S+↵ newline   ↑↓ navigate   ⇥ palette   ctrl+s select   ctrl+y copy   ctrl+w workspace   ? help`; }

// Right rail: recent tool activity + session facts, with a soft gradient bg.
function railLine(i, w, total) {
  const toolsH = 2;
  const sessionH = 5;
  const gap = 1;
  const avail = total - toolsH - sessionH - gap;
  const log = state.toolLog;
  // When the rail is too short for any tool rows, show a summary line.
  const recent = avail > 0 ? log.slice(-(avail + state.railScroll)) : [];
  const hidden = log.length - state.railScroll - recent.length;

  const rows = [];
  rows.push(`${T.violet}${T.railBg}${BOLD}  ACTIVITY${esc.reset}${T.railBg}${T.faint}  ─────`);
  if (!recent.length) {
    if (log.length > 0 && hidden > 0) {
      rows.push(`${T.railBg} ${T.faint}◆ ${log.length} tools · ${hidden} hidden (shift+↑/↓)${esc.reset}`);
    } else if (log.length > 0) {
      rows.push(`${T.railBg} ${T.mint}✓ ${log.length} tool${log.length > 1 ? "s" : ""}${esc.reset}`);
    } else {
      rows.push(`${T.railBg} ${T.faint}none yet`);
    }
  }
  for (const t of recent) {
    const mark = t.ok ? `${T.mint}✓` : `${T.red}✕`;
    const icon = cli.TOOL_ICONS[t.name] || "◆";
    rows.push(`${T.railBg} ${mark} ${T.dim}${icon} ${fit(t.name, w - 8)}${T.faint} ${t.ms}ms${esc.reset}`);
  }
  if (hidden > 0) rows.push(`${T.railBg} ${T.faint}▼ ${hidden} older${esc.reset}`);
  rows.push(`${T.railBg} `);
  rows.push(`${T.violet}${T.railBg}${BOLD}  CONTEXT${esc.reset}${T.railBg}${T.faint}  ──────`);
  rows.push(`${T.railBg} ${T.faint}id  ${T.dim}${fit(state.sessionId.slice(11), w - 5)}`);
  rows.push(`${T.railBg} ${T.faint}msg ${T.dim}${state.history.length}`);
  rows.push(`${T.railBg} ${T.faint}auto ${T.mint}${state.autonomy}` ,
  `${T.railBg} ${T.faint}tmp ${T.dim}${cli.readConfig().temperature ?? 0.4}`);
  rows.push(`${T.railBg} ${T.faint}mod ${T.dim}${fit(state.model, w - 5)}`);
  rows.push(`${T.railBg} ${T.faint}cwd ${T.dim}${fit(process.cwd(), w - 5)}`);
  for(const p of state.attachedPaths.slice(-Math.max(0,total-rows.length))) rows.push(`${T.railBg} ${T.cyan}@ ${T.dim}${fit(path.basename(p),w-4)}`);
  return `${T.railBg}${pad(rows[i] ?? "", w)}${esc.reset}`;
}

// ── Agent loop ───────────────────────────────────────────────────────
function missionSnapshot() {
  return { objective:state.objective, objectiveProgress:state.objectiveProgress, reportNo:state.reportNo, objectiveFiles:state.objectiveFiles, objectiveLearnings:state.objectiveLearnings };
}

function restoreSession(id) {
  const saved = cli.loadSession(id);
  if (!saved) return { ok: false, error: `session not found: ${id}` };
  if (!Array.isArray(saved.history)) return { ok: false, error: `invalid session: ${id}` };

  state.sessionId = saved.id || id;
  state.model = saved.model || state.model;
  state.history = saved.history;
  state.entries = [];
  state.toolLog = [];
  state.objective = saved.objective || null;
  state.objectiveProgress = Number(saved.objectiveProgress || 0);
  state.reportNo = Number(saved.reportNo || 0);
  state.objectiveFiles = Array.isArray(saved.objectiveFiles) ? saved.objectiveFiles : [];
  state.objectiveLearnings = Array.isArray(saved.objectiveLearnings) ? saved.objectiveLearnings : [];
  for (const message of state.history) {
    if (message.role === "user" && typeof message.content === "string") {
      addEntry({ kind: "user", text: message.content });
    } else if (message.role === "assistant" && typeof message.content === "string" && message.content) {
      addEntry({ kind: "assistant", text: message.content });
    }
  }
  state.scroll = 0;
  state.sessionPicker = [];
  return { ok: true, session: saved };
}

function progressBar(percent, cells = 24) {
  const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)));
  return `[${"█".repeat(filled)}${"░".repeat(cells - filled)}] ${percent}%`;
}

function addExecutionReport(startIndex, request) {
  const batch = state.entries.slice(startIndex);
  const tools = batch.filter(e => e.kind === "tool");
  const diffs = batch.filter(e => e.kind === "diff");
  if (!tools.length) return null;

  const succeeded = tools.filter(t => t.ok === true);
  const failed = tools.filter(t => t.ok !== true);
  const changed = [...new Set(diffs.map(d => d.path).filter(Boolean))];
  const elapsed = tools.reduce((total, t) => total + (t.ms || 0), 0);
  const subject = String(request || "the request").replace(/\s+/g, " ").trim().slice(0, 120);
  const clean = value => String(value || "").replace(/\x1b\[[0-9;]*m/g, "").trim();
  const firstUsefulLine = result => clean(result).split(/\r?\n/).find(line => line.trim()) || "No output was returned.";
  const clipped = value => value.length > 180 ? value.slice(0, 177) + "…" : value;
  const combinedOutput = tools.map(t => clean(t.result)).join("\n");
  const verification = failed.length === 0 && /(?:\bpass(?:ed)?\b|\btests?\b.*\b(?:ok|pass)|0 failed|build succeeded)/i.test(combinedOutput);

  if (!state.objective) state.objective = subject || "Complete the active request";
  state.reportNo += 1;
  state.objectiveFiles = [...new Set([...(state.objectiveFiles || []), ...changed])];

  const before = Number(state.objectiveProgress || 0);
  let gain = 0;
  if (succeeded.length) gain += Math.min(12, succeeded.length * 3);
  if (changed.length) gain += Math.min(18, changed.length * 6);
  if (verification) gain += 20;
  if (failed.length && !succeeded.length) gain = 0;
  const ceiling = verification ? 100 : changed.length || state.objectiveFiles.length ? 90 : 65;
  state.objectiveProgress = Math.min(ceiling, before + gain);
  const movement = state.objectiveProgress > before ? `+${state.objectiveProgress - before}% this run` : "held — blocker must be cleared";

  let status;
  if (failed.length === 0 && verification) status = "VERIFIED — objective checkpoint passed";
  else if (failed.length === 0) status = changed.length ? "MOMENTUM — changes were written" : "MOMENTUM — investigation advanced";
  else if (succeeded.length) status = "PARTIAL — progress made, blocker isolated";
  else status = "BLOCKED — progress held honestly";

  const learning = failed.length
    ? `${failed[0].tool} is the current constraint: ${clipped(firstUsefulLine(failed[0].result))}`
    : changed.length
      ? `The active implementation now touches ${changed.join(", ")}.`
      : `This run established evidence through ${succeeded.map(t => t.tool).join(", ") || "tool output"}.`;
  state.objectiveLearnings = [...(state.objectiveLearnings || []), learning].slice(-3);

  const evidence = tools.map(t => `- ${t.ok === true ? "✓" : "✕"} **${t.tool}** — ${clipped(firstUsefulLine(t.result))}`);
  const notDone = failed.length
    ? failed.map(t => `- **${t.tool} failed:** ${clipped(firstUsefulLine(t.result))}`)
    : !verification
      ? ["- Final completion is not claimed yet: a clear test/build verification signal is still required."]
      : ["- No failed operation was detected in this checkpoint."];
  const next = failed.length
    ? `\`Clear the ${failed[0].tool} blocker, rerun that step, and stay inside the locked objective.\``
    : verification
      ? "`Review the objective against the original request and close any remaining acceptance gap.`"
      : "`Run the most relevant test or build for the locked objective; report exact failures only.`";

  return addEntry({ kind: "report", progress: state.objectiveProgress, reportNo: state.reportNo, text: [
    `### ${status}`,
    `**LOCKED OBJECTIVE:** ${state.objective}`,
    `**MISSION ${state.reportNo}:** ${progressBar(state.objectiveProgress)} · ${movement}`,
    "", "### Signal",
    `- This run: ${succeeded.length} succeeded · ${failed.length} failed · ${elapsed} ms`,
    `- Objective files: ${state.objectiveFiles.length ? state.objectiveFiles.map(p => `\`${p}\``).join(", ") : "none yet"}`,
    `- Verification: ${verification ? "detected" : "still required"}`,
    "", "### What actually happened", ...evidence,
    "", "### What MoneyPack learned", ...state.objectiveLearnings.map(x => `- ${x}`),
    "", "### Not done / uncertain", ...notDone,
    "", "### Best next move", next,
    "", `**Locked in:** every next report stays on this objective until you use \`/objective clear\`.`
  ].join("\n") });
}

function parseOneshot(raw) {
  let objective=String(raw||"").trim(), maxSteps=20, verificationCommand=null, dryRun=false;
  objective=objective.replace(/--dry-run\b/ig,()=>{dryRun=true;return "";});
  objective=objective.replace(/--max-steps\s+(\d+)/i,(_,n)=>{maxSteps=Math.max(1,Math.min(50,Number(n)));return "";});
  objective=objective.replace(/--verify\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i,(_,a,b,c)=>{verificationCommand=a||b||c;return "";}).replace(/\s+/g," ").trim();
  return objective ? {objective,maxSteps,verificationCommand,dryRun} : null;
}

async function submit(text) {
  if (state.busy) {
    if (text.toLowerCase() === "/oneshot cancel" && state.oneshot.active) { state.oneshot.status="cancelled"; state.controller?.abort(); addEntry({kind:"note",text:"ONESHOT cancellation requested."}); paint(); }
    return;
  }
  let oneshotOptions = null;
  if (/^\/oneshot(?:\s|$)/i.test(text)) {
    const raw=text.replace(/^\/oneshot\s*/i,"").trim();
    if (!raw || raw.toLowerCase()==="status") { const o=state.oneshot; addEntry({kind:"note",text:o.active ? `ONESHOT — ${o.status}
Objective: ${o.objective}
Steps: ${o.stepsUsed}/${o.maxSteps}` : `ONESHOT — ${o.status}`}); return paint(); }
    if (raw.toLowerCase()==="cancel") { state.oneshot.status="cancelled"; addEntry({kind:"note",text:"No active ONESHOT to cancel."}); return paint(); }
    oneshotOptions=parseOneshot(raw);
    if (!oneshotOptions) { addEntry({kind:"error",text:'usage: /oneshot [--dry-run] [--max-steps N] [--verify "COMMAND"] OBJECTIVE'}); return paint(); }
    const {objective,maxSteps,verificationCommand,dryRun}=oneshotOptions;
    state.objective=objective.slice(0,240); state.objectiveProgress=0; state.reportNo=0; state.objectiveFiles=[]; state.objectiveLearnings=[];
    state.oneshot={active:true,objective:state.objective,startedAt:Date.now(),maxSteps,stepsUsed:0,verificationCommand,dryRun,status:"running"};
    text=objective;
  }
  state.inputHistory.push(oneshotOptions ? `/oneshot ${text}` : text);
  state.histIdx = -1;

  // Local escapes handled without a round trip.
  if (text === "/exit" || text === "/quit") return shutdown();
  if (text === "/clear") { state.entries = []; state.history = []; state.objective = null; state.objectiveProgress = 0; state.reportNo = 0; state.objectiveFiles = []; state.objectiveLearnings = []; return paint(); }
  if (text === "/objective" || text.startsWith("/objective ")) {
    const value = text.slice(10).trim();
    if (!value) addEntry({kind:"note",text:state.objective ? `LOCKED OBJECTIVE: ${state.objective}
${progressBar(state.objectiveProgress)} · report ${state.reportNo}` : "No objective is locked. Use `/objective describe the outcome` or run a tool-based request."});
    else if (value.toLowerCase() === "clear") { state.objective=null; state.objectiveProgress=0; state.reportNo=0; state.objectiveFiles=[]; state.objectiveLearnings=[]; addEntry({kind:"note",text:"Objective cleared. The next tool-based request will become the new locked mission."}); }
    else { state.objective=value.slice(0,240); state.objectiveProgress=0; state.reportNo=0; state.objectiveFiles=[]; state.objectiveLearnings=[]; addEntry({kind:"note",text:`OBJECTIVE LOCKED: ${state.objective}
${progressBar(0)} · ready for mission 1`}); }
    return paint();
  }
  if (text === "/help" || text === "?") return showHelp();
  if (text === "/sessions") {
    const sessions = cli.listSessions();
    const lines = sessions.slice(0, 20).map(s => {
      const turns = (s.history || []).filter(m => m.role === "user").length;
      const when = new Date(s.updated || 0).toLocaleString();
      return `- \`${s.id}\` — ${s.title || "untitled"} (${turns} turns · ${s.model || "unknown"} · ${when})`;
    });
    state.sessionPicker = sessions.slice(0, 100);
    state.modal = { type: "sessions", query: "", index: 0, items: state.sessionPicker };
    if (!sessions.length) addEntry({ kind: "note", text: "No saved sessions yet." });
    return paint();
  }
  if (text === "/save") {
    const id = cli.saveSession(state.sessionId, state.model, state.history, missionSnapshot());
    const saved = id && cli.loadSession(id);
    addEntry({ kind: id ? "note" : "error", text: id ? `saved “${saved?.title || id}”\n${saved?.context || "Session context captured."}` : "nothing to save" });
    return paint();
  }
  if (text === "/history") {
    const turns = state.history.filter(m => m.role === "user").length;
    addEntry({ kind: "note", text: `${state.history.length} messages · ${turns} user turns · session ${state.sessionId}` });
    return paint();
  }
  if (text === "/resume" || text.startsWith("/resume ")) {
    const id = text.slice(7).trim();
    if (!id) addEntry({ kind: "error", text: "usage: /resume SESSION_ID" });
    else {
      const result = restoreSession(id);
      if (!result.ok) addEntry({ kind: "error", text: result.error });
      else { const resumed=cli.loadSession(state.sessionId); addEntry({ kind: "note", text: `resumed “${resumed?.title || state.sessionId}” · ${state.history.length} messages\n${resumed?.context || ""}`.trim() }); }
    }
    return paint();
  }
  if (text === "/copy" || text === "/copy all") {
    const all = text.endsWith(" all");
    const entries = all ? state.entries : [...state.entries].reverse().filter(e => e.kind === "assistant").slice(0, 1);
    const copyText = (all ? entries : entries.reverse()).filter(e => ["user", "assistant", "note", "error"].includes(e.kind))
      .map(e => e.kind === "user" ? `You:\n${e.text}` : e.kind === "assistant" ? `MoneyPack:\n${e.text}` : e.text).join("\n\n");
    if (!copyText) addEntry({ kind: "error", text: "nothing to copy yet" });
    else {
      const result = await executeTool("clipboard_write", { text: copyText });
      addEntry({ kind: /^Error:/i.test(result) ? "error" : "note", text: /^Error:/i.test(result) ? result : `copied ${all ? "chat" : "latest reply"} to clipboard` });
    }
    return paint();
  }
  if (text === "/select") { state.selection = { anchor: Math.max(0, state.entries.length - 1), focus: Math.max(0, state.entries.length - 1) }; return paint(); }
  if (text.startsWith("/open ")) { const url=text.slice(6).trim(); if (!/^https?:\/\//i.test(url)) addEntry({kind:"error",text:"usage: /open https://…"}); else await executeTool("shell", {command:`start "" "${url.replace(/"/g, "")}"`}); return paint(); }
  if (text.startsWith("/code ")) { const n=Math.max(1,Number(text.slice(6))||1); const blocks=state.entries.flatMap(e=>e.kind==="assistant"?extractCodeBlocks(e.text):[]); if (!blocks[n-1]) addEntry({kind:"error",text:`code block ${n} not found`}); else { await executeTool("clipboard_write",{text:blocks[n-1]}); addEntry({kind:"note",text:`copied code block ${n}`}); } return paint(); }
  if (text === "/tabs") { state.modal={type:"tabs",index:state.activeTab}; return paint(); }
  if (text === "/tab close") { if(!closeTab()) addEntry({kind:"error",text:"cannot close the only workspace"}); return paint(); }
  if (text === "/tab new") { snapshotTab(); state.tabs.push({name:`workspace ${state.tabs.length+1}`,sessionId:new Date().toISOString().replace(/[:.]/g,"-").slice(0,19),model:state.model,history:[],entries:[]}); state.activeTab=state.tabs.length-1; loadTab(state.activeTab); persistTabs(); return paint(); }
  if (text.startsWith("/workspace ")) { const name=text.slice(11).trim(); if(state.tabs[state.activeTab]) state.tabs[state.activeTab].name=name||state.tabs[state.activeTab].name; persistTabs(); return paint(); }
  if (text === "/rail") { state.showRail = !state.showRail; screen.invalidate(); return paint(); }
  if (text === "/autonomy" || text.startsWith("/autonomy ")) {
    const requested=text.slice(9).trim();
    if(!requested) addEntry({kind:"note",text:`autonomy: ${state.autonomy}\nAvailable: ${Object.entries(autonomy.PROFILES).map(([k,v])=>`${k} — ${v.description}`).join("\n")}`});
    else if(!Object.hasOwn(autonomy.PROFILES,requested.toLowerCase())) addEntry({kind:"error",text:"usage: /autonomy creative|sandbox|trusted|readonly"});
    else {state.autonomy=autonomy.setProfile(requested).profile;addEntry({kind:"note",text:`autonomy → ${state.autonomy}
${autonomy.PROFILES[state.autonomy].description}`});}
    return paint();
  }
  if (text.startsWith("/use ")) {
    const m = text.slice(5).trim();
    state.model = cli.shortcuts[m] || m;
    cli.writeConfig({ ...cli.readConfig(), model: state.model });
    addEntry({ kind: "note", text: `model → ${state.model}` });
    return paint();
  }
  if (text.startsWith("/temp ")) {
    const t = Number(text.slice(6).trim());
    if (!Number.isNaN(t) && t >= 0 && t <= 2) {
      cli.writeConfig({ ...cli.readConfig(), temperature: t });
      addEntry({ kind: "note", text: `temperature → ${t}` });
    } else addEntry({ kind: "error", text: "temperature must be 0–2" });
    return paint();
  }
  if (text.startsWith("!")) {
    const cmd = text.slice(1).trim();
    if (!cmd) return;
    addEntry({ kind: "user", text });
    const started = Date.now();
    const e = addEntry({ kind: "tool", tool: "shell", summary: cmd, running: true });
    paint();
    const result = await executeTool("shell", { command: cmd });
    Object.assign(e, { running: false, ok: !/^Exit \d/.test(result), ms: Date.now() - started, result });
    state.toolLog.push({ name: "shell", ok: e.ok, ms: e.ms });
    return paint();
  }

  addEntry({ kind: "user", text });
  if (!state.objective) state.objective = String(text).replace(/\s+/g," ").trim().slice(0,240);
  const executionStart = state.entries.length;
  const prompt = expandRefs(text);

  state.busy = true;
  state.status = "thinking";
  state.startedAt = Date.now();
  const controller = new AbortController();
  state.controller = controller;
  paint();

  let streamEntry = null;
  const tick = setInterval(() => { state.spinner++; paint(); }, 120);

  try {
    const res = await runAgent(prompt, controller.signal, {
      onText: (chunk) => {
        if (!streamEntry) streamEntry = addEntry({ kind: "assistant", text: "" });
        streamEntry.text += chunk;
        state.status = "writing";
      },
      onToolStart: (name, args) => {
        streamEntry = null;
        state.status = name;
        return addEntry({
          kind: "tool", tool: name, running: true, args,
          summary: cli.summarizeArgs(name, args)
        });
      },
      onToolEnd: (entry, result, ms) => {
        const ok = !/^(Error|Exit \d|.*failed)/i.test(result.split("\n")[0] || "");
        Object.assign(entry, { running: false, ok, ms, result });
        state.toolLog.push({ name: entry.tool, ok, ms });
      }
    }, oneshotOptions);
    if (oneshotOptions) state.oneshot.stepsUsed = res.rounds || 0;
    state.history = res.messages;
    cli.saveSession(state.sessionId, state.model, state.history, missionSnapshot());
  } catch (err) {
    if (controller.signal.aborted) { addEntry({ kind: "note", text: "cancelled" }); if (state.oneshot.active) state.oneshot.status="cancelled"; }
    else { addEntry({ kind: "error", text: err.message }); if (state.oneshot.active) state.oneshot.status="blocked"; }
  } finally {
    clearInterval(tick);
    state.busy = false;
    state.controller = null;
    state.status = "ready";
    const report=addExecutionReport(executionStart, text);
    if (oneshotOptions) {
      state.oneshot.active=false;
      if (state.oneshot.status !== "cancelled" && state.oneshot.status !== "blocked") state.oneshot.status = state.objectiveProgress===100 ? "verified" : "partial";
      addEntry({kind:"note",text:`ONESHOT — ${state.oneshot.status.toUpperCase()} · ${state.oneshot.stepsUsed}/${state.oneshot.maxSteps} rounds · ${Date.now()-state.oneshot.startedAt} ms${report ? `
${progressBar(state.objectiveProgress)}` : ""}`});
    }
    paint();
  }
}

// Drives the model + tool loop, emitting UI events instead of printing.
async function runAgent(prompt, signal, ev, oneshot = null) {
  const cfg = cli.readConfig();
  const messages = [
    {
      role: "system",
      content: `You are MoneyPack AI, a terminal assistant with ${cli.TOOLS.length} tools. Use tools to actually DO things rather than describing them. Answer conversational questions directly without tools. Format in concise markdown.

Available tools: ${cli.TOOLS.map(t => t.function.name).join(", ")}.

LOCKED OBJECTIVE: ${state.objective || "No objective locked yet"}
Stay focused on this objective. Treat the user's latest message as a refinement or next step unless they explicitly reset the objective. Use prior tool evidence and avoid repeating failed approaches without a reason.
${oneshot ? `
ONESHOT MODE: Complete this bounded mission autonomously in at most ${oneshot.maxSteps} model rounds. ${oneshot.dryRun ? "DRY RUN: inspect and propose a plan, but do not mutate files or external state." : "Inspect, implement, recover from failures, and verify before stopping."}${oneshot.verificationCommand ? ` Required verification command: ${oneshot.verificationCommand}` : " Select and run the most relevant test/build verification."} Do not expand scope. End VERIFIED, PARTIAL, or BLOCKED.` : ""}

Autonomy profile: ${state.autonomy}
${autonomy.CREATION_POLICY}

Current dir: ${process.cwd()}
OS: ${os.type()} ${os.release()}
User: ${os.userInfo().username}${cfg.instructions ? `\n\nUser instructions: ${cfg.instructions}` : ""}`
    },
    ...cli.trimHistory(state.history, 30),
    { role: "user", content: prompt }
  ];

  const roundLimit = oneshot ? oneshot.maxSteps : 12;
  for (let round = 0; round < roundLimit; round++) {
    const choice = await cli.apiStream(
      {
        model: state.model,
        messages,
        tools: cli.TOOLS,
        tool_choice: "auto",
        temperature: Number(cfg.temperature ?? 0.4)
      },
      { signal, onDelta: ev.onText }
    );

    if (choice.usage) {
      cli.usageTotals.prompt += choice.usage.prompt_tokens || 0;
      cli.usageTotals.completion += choice.usage.completion_tokens || 0;
    }
    cli.usageTotals.calls++;

    const calls = choice.message?.tool_calls;
    if (!calls?.length) {
      messages.push({ role: "assistant", content: choice.message?.content || "" });
      return { messages: messages.slice(1), rounds: round + 1 };
    }

    messages.push(choice.message);
    for (const tc of calls) {
      if (signal.aborted) throw new Error("cancelled");
      let a;
      try { a = JSON.parse(tc.function.arguments || "{}"); } catch { a = {}; }

      const entry = ev.onToolStart(tc.function.name, a);
      state.status = tc.function.name + "…";
      paint();
      const started = Date.now();
      const result = await executeTool(tc.function.name, a);
      const str = typeof result === "string" ? result : JSON.stringify(result);
      ev.onToolEnd(entry, str, Date.now() - started);

      // Surface file writes as a diff-style preview.
      if (tc.function.name === "write_file" && a.content) {
        addEntry({
          kind: "diff", path: a.path,
          lines: String(a.content).split("\n").slice(0, 30).map(l => "+" + l)
        });
      } else if (tc.function.name === "edit_file" && a.old_text) {
        addEntry({
          kind: "diff", path: a.path,
          lines: [
            ...String(a.old_text).split("\n").slice(0, 12).map(l => "-" + l),
            ...String(a.new_text || "").split("\n").slice(0, 12).map(l => "+" + l)
          ]
        });
      }
      paint();
      messages.push({ role: "tool", tool_call_id: tc.id, content: str.slice(0, 12000) });
    }
  }
  return { messages: messages.slice(1), rounds: roundLimit };
}

// Inlines @path references, mirroring the CLI behaviour.
function expandRefs(input) {
  const refs = [...input.matchAll(/@([\w./\\:~-]+)/g)];
  if (!refs.length) return input;
  let out = input;
  const blocks = [];
  for (const [full, ref] of refs) {
    const p = path.resolve(ref.replace(/^~/, os.homedir()));
    try {
      const st = fs.statSync(p);
      const body = st.isDirectory()
        ? fs.readdirSync(p).slice(0, 100).join("\n")
        : fs.readFileSync(p, "utf8").slice(0, 40000);
      blocks.push(`--- ${st.isDirectory() ? "directory" : "file"} ${p} ---\n${body}`);
      out = out.replace(full, p);
      if(!state.attachedPaths.includes(p)) state.attachedPaths.push(p);
      addEntry({ kind: "note", text: `attached ${p}` });
    } catch { /* not a real path — leave the literal text */ }
  }
  return blocks.length ? `${out}\n\n${blocks.join("\n\n")}` : out;
}

function showHelp() {
  addEntry({
    kind: "assistant",
    text: [
      "## MoneyPack TUI",
      "",
      "**Input**",
      "- `@path` attach a file or directory",
      "- `!cmd` run a shell command directly",
      "- Commands suggest automatically; `Tab`/`Shift+Tab` chooses · click a suggestion",
      "- `↑↓` history/palette · `PgUp/PgDn` scroll · `End` latest",
      "- `Shift+Enter` newline · `Ctrl+S` select message · `Ctrl+W` next workspace",
      "- `Ctrl+Y` copy latest reply · Shift+drag selects chat · `Ctrl+Shift+C` copies selection",
      "- `Ctrl+R` toggle rail · `Ctrl+O` expand tool output · `Ctrl+L` redraw",
      "- `Esc` cancel generation · `Ctrl+C` quit",
      "",
      "**Commands**",
      "- `/objective TEXT` lock a mission · `/objective` inspect it · `/objective clear` reset it",
      "- `/oneshot [--dry-run] [--max-steps N] [--verify CMD] OBJECTIVE` · `/oneshot status` · `/oneshot cancel`",
      "- `/sessions` (search, preview, rename, delete) · `/resume ID` · `/save`",
      "- `/tab new` · `/tabs` · `/workspace NAME` · `/open URL` · `/code N`",
      "- `/autonomy creative|sandbox|trusted|readonly` · `/use MODEL` · `/temp N` · `/clear` · `/rail` · `/exit`"
    ].join("\n")
  });
  paint();
}

// ── Completion ───────────────────────────────────────────────────────
const COMMANDS = [
  "/help", "/objective ", "/oneshot ", "/sessions", "/resume ", "/save", "/history",
  "/use ", "/temp ", "/autonomy ", "/copy", "/copy all", "/select", "/open ", "/code ", "/tab new", "/tabs", "/workspace ", "/clear", "/rail", "/exit"
];

function refreshCompletions() { state.completions=completionItems(state.input); state.compIdx=Math.min(state.compIdx,Math.max(0,state.completions.length-1)); }
function applyCompletion(value) {
  value=typeof value === "object" ? value.value : value;
  const at=state.input.lastIndexOf("@");
  if(at>=0&&!/\s/.test(state.input.slice(at+1))&&!value.startsWith("/")) state.input=state.input.slice(0,at+1)+value;
  else state.input=value;
  state.cursor=state.input.length; state.completions=[];
}
function complete(){refreshCompletions();if(state.completions.length===1)applyCompletion(state.completions[0]);}

// ── Editor, palette and selection primitives ─────────────────────────
function graphemes(text) {
  if (global.Intl?.Segmenter) return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(String(text))].map(x => x.segment);
  return Array.from(String(text));
}
function prevBoundary(text, at) { const a=graphemes(text.slice(0,at)); return at-(a.pop()?.length||0); }
function nextBoundary(text, at) { return at+(graphemes(text.slice(at))[0]?.length||0); }
function lineBounds(text, at) { const start=text.lastIndexOf("\n",Math.max(0,at-1))+1, n=text.indexOf("\n",at); return {start,end:n<0?text.length:n}; }
function cellToOffset(text, cells) { let off=0,w=0; for(const g of graphemes(text)){const cw=width(g);if(w+cw>cells)break;w+=cw;off+=g.length;}return off; }
function moveEditor(direction) {
  const b=lineBounds(state.input,state.cursor);
  if(direction==="home") state.cursor=b.start;
  else if(direction==="end") state.cursor=b.end;
  else if(direction==="left") state.cursor=prevBoundary(state.input,state.cursor);
  else if(direction==="right") state.cursor=nextBoundary(state.input,state.cursor);
  else {
    const col=state.preferredCol??width(state.input.slice(b.start,state.cursor)); state.preferredCol=col;
    if(direction==="up"&&b.start>0){const pb=lineBounds(state.input,b.start-1);state.cursor=pb.start+cellToOffset(state.input.slice(pb.start,pb.end),col);}
    if(direction==="down"&&b.end<state.input.length){const nb=lineBounds(state.input,b.end+1);state.cursor=nb.start+cellToOffset(state.input.slice(nb.start,nb.end),col);}
    return;
  }
  state.preferredCol=null;
}
function insertEditor(text){ state.input=state.input.slice(0,state.cursor)+text+state.input.slice(state.cursor);state.cursor+=text.length;state.preferredCol=null;refreshCompletions(); }
function deleteEditor(backward=true){ if(backward&&state.cursor>0){const p=prevBoundary(state.input,state.cursor);state.input=state.input.slice(0,p)+state.input.slice(state.cursor);state.cursor=p;} else if(!backward&&state.cursor<state.input.length){const n=nextBoundary(state.input,state.cursor);state.input=state.input.slice(0,state.cursor)+state.input.slice(n);}refreshCompletions(); }
function selectMessage(delta=0,extend=false){if(!state.entries.length)return;const old=state.selection?.focus??state.entries.length;const focus=Math.max(0,Math.min(state.entries.length-1,old+delta));state.selection=extend?{anchor:state.selection?.anchor??old,focus}:{anchor:focus,focus};}
function selectedText(){if(!state.selection)return "";const a=Math.min(state.selection.anchor,state.selection.focus),b=Math.max(state.selection.anchor,state.selection.focus);return state.entries.slice(a,b+1).map(e=>e.text||e.result||"").filter(Boolean).join("\n\n");}
const COMMAND_INFO = {
 "/help":"Open keyboard and mouse help", "/objective ":"Lock, inspect, or clear the active mission", "/oneshot ":"Run one bounded autonomous mission through verification", "/autonomy ":"Set creation and execution autonomy profile", "/sessions":"Search and manage saved sessions", "/resume ":"Resume a session by ID", "/save":"Save this session", "/history":"Show session statistics", "/use ":"Choose a model", "/temp ":"Set temperature 0–2", "/copy":"Copy latest response", "/copy all":"Copy transcript", "/select":"Select latest message", "/open ":"Open a web link", "/code ":"Copy a fenced code block", "/tab new":"Create workspace", "/tab close":"Close workspace", "/tabs":"Manage workspaces", "/workspace ":"Rename workspace", "/clear":"Clear transcript", "/rail":"Toggle context rail", "/exit":"Exit MoneyPack"
};
function fuzzyScore(query,value){query=query.toLowerCase();value=value.toLowerCase();let qi=0,score=0,last=-2;for(let i=0;i<value.length&&qi<query.length;i++)if(value[i]===query[qi]){score+=i===last+1?4:1;last=i;qi++;}return qi===query.length?score-value.length*.01:-Infinity;}
function completionItems(input=state.input){
 const v=String(input), out=[];
 const at=v.lastIndexOf("@");
 if(at>=0&&!/\s/.test(v.slice(at+1))){const frag=v.slice(at+1),dir=/[\\/]/.test(frag)?path.dirname(frag):".",base=path.basename(frag);try{for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(!e.name.toLowerCase().includes(base.toLowerCase()))continue;const full=(dir==="."?e.name:path.join(dir,e.name))+(e.isDirectory()?path.sep:"");let meta=e.isDirectory()?"directory":"file";try{if(!e.isDirectory())meta+=` · ${fs.statSync(path.join(dir,e.name)).size} B`;}catch{}out.push({value:full,label:full,kind:"FILE",description:meta});}}catch{}return out.slice(0,50);}
 if(v.startsWith("/use ")){const q=v.slice(5);return [...new Set([...Object.keys(cli.shortcuts),...Object.values(cli.shortcuts)])].map(m=>({value:"/use "+m,label:m,kind:"MODEL",description:"Switch active model",score:fuzzyScore(q,m)})).filter(x=>x.score>-Infinity).sort((a,b)=>b.score-a.score);}
 if(v.startsWith("/resume ")){const q=v.slice(8);return cli.listSessions().map(x=>({value:"/resume "+x.id,label:x.title||x.id,kind:"SESSION",description:`${x.id} · ${relativeTime(x.updated)}`,score:fuzzyScore(q,x.id+" "+x.title+" "+(x.context||"")+" "+(x.keywords||[]).join(" "))})).filter(x=>x.score>-Infinity).sort((a,b)=>b.score-a.score);}
 if(v.startsWith("/")){return Object.entries(COMMAND_INFO).map(([value,description])=>({value,label:value,kind:"COMMAND",description,score:fuzzyScore(v,value)})).filter(x=>x.score>-Infinity).sort((a,b)=>b.score-a.score);}
 if(v.startsWith("!")){const q=v.slice(1),cmds=(process.env.PATH||"").split(path.delimiter).flatMap(d=>{try{return fs.readdirSync(d).filter(n=>/\.(exe|cmd|bat|ps1)$/i.test(n)).map(n=>n.replace(/\.(exe|cmd|bat|ps1)$/i,""));}catch{return[];}});return [...new Set(cmds)].map(c=>({value:"!"+c,label:c,kind:"SHELL",description:"Executable on PATH",score:fuzzyScore(q,c)})).filter(x=>x.score>-Infinity).sort((a,b)=>b.score-a.score).slice(0,50);}
 return out;
}
function closeTab(index=state.activeTab){if(state.tabs.length<=1)return false;snapshotTab();state.tabs.splice(index,1);state.activeTab=Math.min(index,state.tabs.length-1);loadTab(state.activeTab);persistTabs();return true;}
function switchTab(index){if(index<0||index>=state.tabs.length)return false;snapshotTab();state.activeTab=index;loadTab(index);persistTabs();return true;}
function sessionResults(){const m=state.modal;if(!m)return[];return m.items.filter(x=>`${x.title} ${x.context||""} ${(x.keywords||[]).join(" ")} ${x.id}`.toLowerCase().includes((m.query||"").toLowerCase()));}

// ── Input handling ───────────────────────────────────────────────────
// A terminal normally delivers an escape sequence in one chunk, but a slow
// pipe or paste can split it. Hold an incomplete CSI until it terminates so
// its bytes never leak into the text buffer.
let pendingEsc = "";
let escTimer = null;

function onKey(buf) {
  let s = buf.toString("utf8");

  if (pendingEsc) {
    s = pendingEsc + s;
    pendingEsc = "";
    if (escTimer) { clearTimeout(escTimer); escTimer = null; }
  }

  // \x1b alone, or a CSI/SS3 introducer with no final byte yet, is incomplete.
  if (s === "\x1b" || /^\x1b[[O][?!<>=]?[0-9;]*$/.test(s)) {
    pendingEsc = s;
    // A lone Esc that never completes is a real Esc keypress.
    escTimer = setTimeout(() => {
      const held = pendingEsc;
      pendingEsc = "";
      escTimer = null;
      if (held === "\x1b") dispatch("\x1b");
    }, 40);
    return;
  }

  dispatch(s);
}

function dispatch(s) {
  const L=layout();
  const mouse=/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(s);
  if(mouse){const btn=Number(mouse[1]),col=Number(mouse[2]),row=Number(mouse[3]),down=mouse[4]==="M";
    if(btn===64){if(state.modal?.type==="sessions")state.modal.index=Math.max(0,state.modal.index-1);else state.scroll+=3;}
    else if(btn===65){if(state.modal?.type==="sessions")state.modal.index=Math.min(Math.max(0,sessionResults().length-1),state.modal.index+1);else state.scroll=Math.max(0,state.scroll-3);}
    else if(btn===0&&down){
      if(row>=L.inputRow+1&&row<L.inputRow+1+state.composerRows){const line=row-(L.inputRow+1),lines=state.input.split("\n"),base=lines.slice(0,line).reduce((n,x)=>n+x.length+1,0),cell=Math.max(0,col-10);state.cursor=Math.min(state.input.length,base+cellToOffset(lines[line]||"",cell));}
      else {const t=state.hitTargets.find(h=>h.row===row&&col>=h.colStart&&col<=h.colEnd);if(t?.type==="session"){const i=sessionResults().findIndex(x=>x.id===t.id);if(i>=0)state.modal.index=i;}else if(t?.type==="completion")applyCompletion(t.value);else if(t?.type==="select")state.selection={anchor:t.index,focus:t.index};else if(t?.type==="tool")state.entries[t.index].expanded=!state.entries[t.index].expanded;else if(t?.type==="toolGroup")for(let i=t.index;i<state.entries.length&&state.entries[i].kind==="tool";i++)state.entries[i].collapsed=!state.entries[i].collapsed;else if(t?.type==="code")submit(`/code ${t.number}`);else if(t?.type==="link")submit(`/open ${t.url}`);else if(t?.type==="sessionAction")handleSessionAction(t.action,t.id);else if(t?.type==="tab")switchTab(t.index);}
    }return paint();
  }
  if(state.notice)state.notice="";
  if(state.modal?.type==="confirmDelete"){if(/^y$/i.test(s)){cli.deleteSession(state.modal.session.id);state.modal={type:"sessions",query:"",index:0,items:cli.listSessions()};}else if(s==="\x1b"||/^n$/i.test(s))state.modal={type:"sessions",query:"",index:0,items:cli.listSessions()};return paint();}
  if(state.modal?.type==="rename"){
    if(s==="\x1b")state.modal={type:"sessions",query:"",index:0,items:cli.listSessions()};else if(s==="\r"||s==="\n"){cli.renameSession(state.modal.session.id,state.modal.value);state.modal={type:"sessions",query:"",index:0,items:cli.listSessions()};}else if(s==="\x7f"||s==="\b")state.modal.value=state.modal.value.slice(0,-1);else if(!s.startsWith("\x1b"))state.modal.value+=s.replace(/[\x00-\x1f\x7f]/g,"");return paint();
  }
  if(state.modal?.type==="tabs"){
    if(s==="\x1b")state.modal=null;else if(s==="\x1b[A")state.modal.index=Math.max(0,state.modal.index-1);else if(s==="\x1b[B")state.modal.index=Math.min(state.tabs.length-1,state.modal.index+1);else if(s==="\r"||s==="\n"){switchTab(state.modal.index);state.modal=null;}else if(s==="\x1b[3~")closeTab(state.modal.index);return paint();
  }
  if(state.modal?.type==="sessions"){
    const items=sessionResults();state.modal.index=Math.min(state.modal.index,Math.max(0,items.length-1));
    if(s==="\x1b"){state.modal=null;state.sessionPicker=[];}else if(s==="\x1b[A")state.modal.index=Math.max(0,state.modal.index-1);else if(s==="\x1b[B")state.modal.index=Math.min(Math.max(0,items.length-1),state.modal.index+1);else if(s==="\r"||s==="\n"){const hit=items[state.modal.index];if(hit)restoreSession(hit.id);state.modal=null;}else if(s==="\x1b[3~"){const hit=items[state.modal.index];if(hit)state.modal={type:"confirmDelete",session:hit};}else if(s==="\x1bOQ"||s==="\x1b[12~"){const hit=items[state.modal.index];if(hit)state.modal={type:"rename",session:hit,value:hit.title||""};}else if(s==="\x7f"||s==="\b")state.modal.query=state.modal.query.slice(0,-1);else if(!s.startsWith("\x1b")){state.modal.query+=s.replace(/[\x00-\x1f\x7f]/g,"");state.modal.index=0;}return paint();
  }
  if(s==="\x03"){if(state.busy&&state.controller)state.controller.abort();else shutdown();return;}
  if(s==="\x1b"){if(state.busy&&state.controller)state.controller.abort();state.completions=[];state.selection=null;return paint();}
  if(s==="\x1b[13;2u"||s==="\x1b[27;2;13~"||s==="\x1b\r"||s==="\x1b\n"){insertEditor("\n");return paint();}
  if(s==="\r"||s==="\n"){if(state.completions.length){applyCompletion(state.completions[state.compIdx]);return paint();}const v=state.input.trim();state.input="";state.cursor=0;if(v)submit(v);return paint();}
  if(s==="\x7f"||s==="\b"){deleteEditor(true);return paint();}if(s==="\x1b[3~"){deleteEditor(false);return paint();}
  if(s==="\t"||s==="\x1b[Z"){if(!state.completions.length)refreshCompletions();if(state.completions.length){state.compIdx=(state.compIdx+(s==="\t"?1:-1)+state.completions.length)%state.completions.length;}return paint();}
  if(s==="\x1b[A"||s==="\x1b[B"){
    if(state.completions.length){state.compIdx=(state.compIdx+(s.endsWith("A")?-1:1)+state.completions.length)%state.completions.length;return paint();}
    const multiline=state.input.includes("\n");if(multiline){moveEditor(s.endsWith("A")?"up":"down");return paint();}
    if(state.inputHistory.length){if(s.endsWith("A")){state.histIdx=state.histIdx<0?state.inputHistory.length-1:Math.max(0,state.histIdx-1);}else if(state.histIdx>=0)state.histIdx++;if(state.histIdx>=state.inputHistory.length){state.histIdx=-1;state.input="";}else state.input=state.inputHistory[state.histIdx]||"";state.cursor=state.input.length;}return paint();
  }
  if(s==="\x1b[1;2A"||s==="\x1b[1;2B"){selectMessage(s.endsWith("A")?-1:1,true);return paint();}
  if(s==="\x1b[D"){moveEditor("left");return paint();}if(s==="\x1b[C"){moveEditor("right");return paint();}if(s==="\x1b[H"||s==="\x01"){moveEditor("home");return paint();}if(s==="\x1b[F"||s==="\x05"){moveEditor("end");return paint();}
  if(s==="\x13"){selectMessage(-1,false);return paint();}if(s==="\x19"){const text=selectedText();if(text)executeTool("clipboard_write",{text});else submit("/copy");return paint();}
  if(s==="\x17"){if(state.tabs.length)switchTab((state.activeTab+1)%state.tabs.length);return paint();}if(s==="\x0c"){screen.invalidate();return paint();}if(s==="\x12"){state.showRail=!state.showRail;screen.invalidate();return paint();}if(s==="\x0f"){const e=[...state.entries].reverse().find(x=>x.kind==="tool");if(e)e.expanded=!e.expanded;return paint();}
  if(s==="\x15"){state.input=state.input.slice(state.cursor);state.cursor=0;return paint();}if(s==="\x1b[5~"){state.scroll+=L.bodyRows-2;return paint();}if(s==="\x1b[6~"){state.scroll=Math.max(0,state.scroll-(L.bodyRows-2));return paint();}
  const altTab=/^\x1b\[([1-9]);3u$/.exec(s);if(altTab){switchTab(Number(altTab[1])-1);return paint();}if(s.startsWith("\x1b"))return;
  const clean=s.replace(/[\x00-\x09\x0b-\x1f\x7f]/g,"");if(clean){insertEditor(clean);paint();}
}
function handleSessionAction(action,id){const hit=cli.loadSession(id);if(!hit)return;if(action==="resume")restoreSession(id);else if(action==="rename")state.modal={type:"rename",session:hit,value:hit.title||""};else if(action==="delete")state.modal={type:"confirmDelete",session:hit};}

// ── Persistent application tabs/workspaces ─────────────────────────
const TAB_FILE = path.join(os.homedir(), ".moneypack", "tabs.json");
function persistTabs(){ try { storage.atomicJson(TAB_FILE,{active:state.activeTab,tabs:state.tabs.map(t=>({...t,entries:undefined}))}); return true; } catch { return false; } }
function initTabs(){ try { const d=JSON.parse(fs.readFileSync(TAB_FILE,"utf8")); state.tabs=Array.isArray(d.tabs)?d.tabs:[]; state.activeTab=Math.min(d.active||0,Math.max(0,state.tabs.length-1)); } catch {} if(!state.tabs.length) state.tabs=[{name:path.basename(process.cwd()),sessionId:state.sessionId,model:state.model,history:[],entries:[]}]; }
function snapshotTab(){ const t=state.tabs[state.activeTab]; if(t) Object.assign(t,{sessionId:state.sessionId,model:state.model,history:state.history,entries:state.entries,objective:state.objective,objectiveProgress:state.objectiveProgress,reportNo:state.reportNo,objectiveFiles:state.objectiveFiles,objectiveLearnings:state.objectiveLearnings}); }
function loadTab(i){ const t=state.tabs[i]; if(!t)return; state.sessionId=t.sessionId; state.model=t.model; state.history=t.history||[]; state.entries=t.entries||[]; state.objective=t.objective||null; state.objectiveProgress=t.objectiveProgress||0; state.reportNo=t.reportNo||0; state.objectiveFiles=t.objectiveFiles||[]; state.objectiveLearnings=t.objectiveLearnings||[]; if(!state.entries.length) for(const m of state.history) if((m.role==="user"||m.role==="assistant")&&typeof m.content==="string") state.entries.push({kind:m.role,text:m.content}); }

// ── Lifecycle ────────────────────────────────────────────────────────
let active = false;

function shutdown(code = 0) {
  if (!active) return;
  active = false;
  try { cli.saveSession(state.sessionId, state.model, state.history, missionSnapshot()); snapshotTab(); persistTabs(); } catch {}
  if (state.blinkTimer) clearInterval(state.blinkTimer);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  OUT.write(esc.mouse(false) + esc.wrap(true) + esc.cursor(true) + esc.alt(false));
  const closing = typeof cli.closeBrowser === "function" ? cli.closeBrowser() : Promise.resolve();
  Promise.resolve(closing).finally(() => process.exit(code));
}

async function run() {
  initTabs();
  if (!OUT.isTTY) {
    console.error("The TUI needs an interactive terminal. Use `start` for the plain CLI.");
    process.exitCode = 1;
    return;
  }
  if (!cli.readConfig().key) {
    console.error("No API key. Run: surplus setup --key inf_your_key");
    process.exitCode = 1;
    return;
  }

  const resumeAt = process.argv.indexOf("--resume");
  let startupResume = null;
  if (resumeAt !== -1) {
    const id = process.argv[resumeAt + 1];
    startupResume = id
      ? restoreSession(id)
      : { ok: false, error: "--resume requires a session ID" };
  }

  active = true;
  OUT.write(esc.alt(true) + esc.clear + esc.wrap(false) + esc.mouse(true));
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", onKey);
  OUT.on("resize", () => { screen.invalidate(); paint(); });
  process.once("SIGINT", () => shutdown(130));
  process.once("SIGTERM", () => shutdown(143));
  process.once("unhandledRejection", (e) => {
    OUT.write(esc.mouse(false) + esc.wrap(true) + esc.cursor(true) + esc.alt(false));
    console.error("TUI promise rejection:", e && e.stack || e);
    process.exit(1);
  });
  process.once("uncaughtException", (e) => {
    OUT.write(esc.mouse(false) + esc.cursor(true) + esc.alt(false));
    console.error("TUI crashed:", e && e.stack || e);
    process.exit(1);
  });

  addEntry({
    kind: startupResume && !startupResume.ok ? "error" : "note",
    text: startupResume
      ? (startupResume.ok
          ? `Resumed ${state.sessionId} · ${state.history.length} messages · ${state.model}`
          : startupResume.error)
      : `MoneyPack TUI · ${state.model} · ${cli.TOOLS.length} tools · type ? for help`
  });
  paint();
   // Spinner + cursor blink: drive visual life while idle or busy.
  state.blinkTimer = setInterval(() => {
    state.spinner = (state.spinner + 1) % BREATHE.length;
    state.cursorOn = !state.cursorOn;
    paint();
  }, 120);

  // Hold the process open; all work is event-driven from here.
  await new Promise(() => {});
}

module.exports = {
  state, addEntry, paint,
  invalidate: () => screen.invalidate(),
  layout, entryLines, markdownLines, transcriptLines, transcriptRows, hardSplit,
  complete, refreshCompletions, applyCompletion, expandRefs, restoreSession, submit, run, onKey, hint, railLine,
  extractLinks, extractCodeBlocks, relativeTime, initTabs, snapshotTab, loadTab, persistTabs, closeTab, switchTab,
  graphemes, prevBoundary, nextBoundary, lineBounds, cellToOffset, moveEditor, insertEditor, deleteEditor,
  selectMessage, selectedText, fuzzyScore, addExecutionReport, parseOneshot, completionItems, sessionResults, dispatch, TAB_FILE,
};

// MoneyPack product entry point.
if (require.main === module) {
  run().catch((error) => {
    console.error("MoneyPack failed:", error && error.stack || error);
    process.exitCode = 1;
  });
}
