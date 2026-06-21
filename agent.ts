import { execSync } from 'child_process';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadEnv, DEFAULT_MAX_STEPS } from './lib.js';
import { runAgentLoop, runPlanLoop } from './lib.js';
import type { Message } from './types.js';
import { providerAdd, providerList, providerUse, providerRemove } from './src/provider.js';

// ═══════════════════════════════════════════════════════════════
// CYBERPUNK NEON PALETTE — 256-color ANSI
// ═══════════════════════════════════════════════════════════════

export const C = {
  reset:    '\x1b[0m',
  bold:     '\x1b[1m',
  dim:      '\x1b[2m',
  italic:   '\x1b[3m',
  underline:'\x1b[4m',
  blink:    '\x1b[5m',
  reverse:  '\x1b[7m',
  hidden:   '\x1b[8m',

  // Cyberpunk neon
  cyan:     '\x1b[38;5;51m',    // #00ffff
  magenta:  '\x1b[38;5;201m',   // #ff00ff
  blue:     '\x1b[38;5;27m',    // #0066ff
  pink:     '\x1b[38;5;198m',   // #ff1493
  yellow:   '\x1b[38;5;226m',   // #ffff00
  orange:   '\x1b[38;5;208m',   // #ff8800

  // Phosphor green accents
  green:    '\x1b[38;5;46m',    // #00ff00
  greenDim: '\x1b[38;5;40m',    // #00cc00

  // Standard
  red:      '\x1b[38;5;196m',   // #ff0000
  white:    '\x1b[38;5;255m',   // #ffffff
  gray:     '\x1b[38;5;245m',   // #8a8a8a
  darkGray: '\x1b[38;5;238m',   // #444444
  bright:   '\x1b[1m',          // bold alias

  // Backgrounds
  bgDark:   '\x1b[48;5;234m',   // #0a0a1a
  bgCyan:   '\x1b[48;5;14m',    // cyan bg
};

// ═══════════════════════════════════════════════════════════════
// BOX-DRAWING CHARACTERS
// ═══════════════════════════════════════════════════════════════

const B = {
  h:    '─', v:    '│',
  tl:   '┌', tr:   '┐', bl:   '└', br:   '┘',
  tDown:'┬', tUp:  '┴', tRight:'├', tLeft:'┤',
  cross:'┼',
  hH:   '━', vH:   '┃',
  tlH:  '┏', trH:  '┓', blH:  '┗', brH:  '┛',
  hD:   '═', vD:   '║',
  tlD:  '╔', trD:  '╗', blD:  '╚', brD:  '╝',
  tDownD:'╦', tUpD:  '╩', tRightD:'╠', tLeftD:'╣',
  crossD:'╬',
  tlR:  '╭', trR:  '╮', blR:  '╰', brR:  '╯',
  blockFull: '█', blockLight: '░', blockMed: '▒', blockDark: '▓',
  bullet: '•', arrow: '→', diamond: '◆', star: '★',
  check: '✓', crossMark: '✗',
};

// ═══════════════════════════════════════════════════════════════
// TERMINAL HELPERS
// ═══════════════════════════════════════════════════════════════

function termWidth(): number {
  return process.stdout.columns || 80;
}

function padRight(text: string, width: number): string {
  const visible = text.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, width - visible.length);
  return text + ' '.repeat(pad);
}

function hLine(width: number, heavy = false): string {
  const ch = heavy ? B.hH : B.h;
  return ch.repeat(Math.max(0, width));
}

function loadLogo(): string[] {
  try {
    const logoPath = path.resolve(process.cwd(), 'templates/logo.txt');
    const content = fs.readFileSync(logoPath, 'utf-8');
    return content.split('\n').filter(l => l.trim());
  } catch {
    return [];
  }
}

function topBorder(width: number, title?: string, heavy = false): string {
  const tl = heavy ? B.tlH : B.tl;
  const tr = heavy ? B.trH : B.tr;
  if (!title) return `${tl}${hLine(width - 2, heavy)}${tr}`;
  const t = ` ${title} `;
  const side = Math.max(0, width - 2 - t.length);
  const left = Math.floor(side / 2);
  const right = side - left;
  return `${tl}${hLine(left, heavy)}${t}${hLine(right, heavy)}${tr}`;
}

function bottomBorder(width: number, heavy = false): string {
  const bl = heavy ? B.blH : B.bl;
  const br = heavy ? B.brH : B.br;
  return `${bl}${hLine(width - 2, heavy)}${br}`;
}

function vLine(text: string, width: number, heavy = false): string {
  const v = heavy ? B.vH : B.v;
  const inner = padRight(text, width - 4);
  return `${v} ${inner} ${v}`;
}

function progressBar(current: number, total: number, width = 20): string {
  if (total <= 0) return B.blockLight.repeat(width);
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  return `${C.cyan}${B.blockFull.repeat(filled)}${C.darkGray}${B.blockLight.repeat(empty)}${C.reset}`;
}

// ═══════════════════════════════════════════════════════════════
// STATUS BAR
// ═══════════════════════════════════════════════════════════════

const MAX_CONTEXT_LENGTH = parseInt(process.env.LM_STUDIO_MAX_CONTEXT || '128000', 10);
let currentContextLength = 0;
let currentMode: 'plane' | 'write' = 'write';
let cachedBranch: string | null = null;
let lastBranchCheck = 0;

function getGitBranch(): string {
  const now = Date.now();
  if (cachedBranch === null || now - lastBranchCheck > 5000) {
    try {
      cachedBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim() || 'none';
      lastBranchCheck = now;
    } catch { cachedBranch = 'none'; }
  }
  return cachedBranch;
}

export function getModelName(): string {
  return process.env.LM_STUDIO_MODEL || 'local-model';
}

export function updateContextLength(messages: Message[]): void {
  const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
  currentContextLength = Math.ceil(totalChars / 4);
}

export function getContextDisplay(): string {
  const maxStr = MAX_CONTEXT_LENGTH >= 1000
    ? `${Math.round(MAX_CONTEXT_LENGTH / 1000)}k`
    : MAX_CONTEXT_LENGTH.toString();
  return `${currentContextLength}/${maxStr}`;
}

export function displayStatus(): void {
  const w = termWidth();
  const modeLabel = currentMode === 'plane' ? 'PLAN' : 'WRITE';
  const modeColor = currentMode === 'plane' ? C.blue : C.green;
  console.log(`${C.cyan}${topBorder(w, ' SYSTEM STATUS ', true)}${C.reset}`);
  console.log(`${C.cyan}${vLine(`${C.gray}MODEL:${C.reset} ${C.bold}${getModelName()}${C.reset}   ${C.gray}MODE:${C.reset} ${modeColor}${C.bold}${modeLabel}${C.reset}   ${C.gray}DIR:${C.reset} ${C.green}${process.cwd()}${C.reset}`, w, true)}`);
  console.log(`${C.cyan}${vLine(`${C.gray}GIT:${C.reset} ${C.yellow}${getGitBranch()}${C.reset}   ${C.gray}CTX:${C.reset} ${C.pink}${getContextDisplay()}${C.reset}`, w, true)}`);
  console.log(`${C.cyan}${bottomBorder(w, true)}${C.reset}`);
}

export function setMode(mode: 'plane' | 'write'): void { currentMode = mode; }
export function getMode(): 'plane' | 'write' { return currentMode; }
export function getStatusLine(): string {
  const model = getModelName();
  const dir = process.cwd();
  const branch = getGitBranch();
  const context = getContextDisplay();
  const mode = currentMode.toUpperCase();
  return `${C.cyan}[${C.bold}${model}${C.reset}${C.cyan}]${B.v}${C.magenta}${C.bold} MODE:${mode} ${C.reset}${C.cyan}${B.v}${C.green} ${dir} ${C.cyan}${B.v}${C.yellow} git:${branch} ${C.cyan}${B.v}${C.pink} ctx:${context}${C.reset}`;
}
export function getCurrentContextLength(): number { return currentContextLength; }
export function resetContextLength(): void { currentContextLength = 0; }

// ═══════════════════════════════════════════════════════════════
// STEP HISTORY (compact + expand)
// ═══════════════════════════════════════════════════════════════

interface StepRecord {
  id: number;
  type: 'plan' | 'write';
  response: string;
  toolCalls: { tool: string; args: Record<string, unknown>; result: string }[];
}

let stepHistory: StepRecord[] = [];
let stepCounter = 0;

function compactStepLine(id: number, type: string, response: string, w: number): string {
  const firstLine = response.split('\n').find(l => l.trim().length > 0) || '(empty)';
  const truncated = firstLine.length > w - 20 ? firstLine.substring(0, w - 23) + '...' : firstLine;
  const typeIcon = type === 'plane' ? `${C.blue}◆${C.reset}` : `${C.green}▸${C.reset}`;
  return `${C.darkGray}${String(id).padStart(2, ' ')}${C.reset} ${typeIcon} ${truncated}`;
}

function printStepDetail(step: StepRecord, w: number): void {
  const color = step.type === 'plan' ? C.blue : C.cyan;
  console.log(`${color}${topBorder(w, ` STEP ${step.id} (expanded) `)}${C.reset}`);
  const formatted = step.response
    .replace(/^Plan:/gm, `${C.blue}${C.bright}PLAN:${C.reset}`)
    .replace(/^Thought:/gm, `${C.yellow}${C.bright}THOUGHT:${C.reset}`)
    .replace(/^Action:/gm, `${C.cyan}${C.bright}ACTION:${C.reset}`);
  for (const line of formatted.split('\n')) {
    if (line.trim()) console.log(`${color}${vLine(line, w)}`);
  }
  for (const tc of step.toolCalls) {
    const argStr = JSON.stringify(tc.args);
    const truncArg = argStr.length > 50 ? argStr.substring(0, 47) + '...' : argStr;
    const truncResult = tc.result.length > 80 ? tc.result.substring(0, 77) + '...' : tc.result;
    console.log(`${C.darkGray}  ${B.diamond}${C.reset} ${C.bold}${tc.tool}${C.reset}${C.gray}(${truncArg})${C.reset}`);
    console.log(`${C.darkGray}  ${B.arrow}${C.reset} ${truncResult}${C.reset}`);
  }
  console.log(`${color}${bottomBorder(w)}${C.reset}`);
}

function printToolCall(tool: string, args: Record<string, unknown>, result: string): void {
  const argStr = JSON.stringify(args);
  const truncArg = argStr.length > 50 ? argStr.substring(0, 47) + '...' : argStr;
  
  // Special handling for LLM responses
  if (tool === 'query_language_model') {
    console.log(`${C.green}${B.diamond} ${C.bold}🤖 ASSISTANT:${C.reset}`);
    // Word wrap the result to terminal width
    const w = termWidth();
    const maxLen = w - 6; // indent
    // Split by existing newlines first, then wrap long lines
    const paragraphs = result.split('\n');
    for (const para of paragraphs) {
      if (para.length === 0) {
        console.log(`${C.darkGray}  ${C.reset}`);
        continue;
      }
      // Simple word wrap
      let line = '';
      for (const word of para.split(' ')) {
        if ((line + word).length > maxLen && line.length > 0) {
          console.log(`${C.darkGray}  ${C.reset}${C.gray}${line}${C.reset}`);
          line = word + ' ';
        } else {
          line += word + ' ';
        }
      }
      if (line.trim().length > 0) {
        console.log(`${C.darkGray}  ${C.reset}${C.gray}${line.trim()}${C.reset}`);
      }
    }
    console.log();
    return;
  }
  
  // Normal tool call output
  console.log(`${C.darkGray}    ${B.diamond}${C.reset} ${C.bold}${tool}${C.reset}${C.gray}(${truncArg})${C.reset}`);
  
  // Print result (truncated for non-LLM tools)
  const displayResult = result.length > 200 ? result.substring(0, 197) + '...' : result;
  const resultLines = displayResult.split('\n');
  for (let i = 0; i < Math.min(resultLines.length, 3); i++) {
    console.log(`${C.darkGray}    ${B.arrow}${C.reset} ${C.gray}${resultLines[i]}${C.reset}`);
  }
  if (resultLines.length > 3) {
    console.log(`${C.darkGray}    ${B.arrow}${C.reset} ${C.yellow}... (${resultLines.length - 3} more lines)${C.reset}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTONOMOUS MODE (compact output)
// ═══════════════════════════════════════════════════════════════

export async function runAutonomous(goal: string, maxSteps = parseInt(process.env.MAX_STEPS || String(DEFAULT_MAX_STEPS), 10)) {
  const w = termWidth();
  console.clear();
  console.log(`${C.cyan}${topBorder(w, ' AUTONOMOUS AGENT ', true)}${C.reset}`);
  console.log(`${C.cyan}${vLine(`${C.gray}GOAL:${C.reset} ${C.white}${goal}${C.reset}`, w, true)}`);
  console.log(`${C.cyan}${vLine(`${C.gray}MAX STEPS:${C.reset} ${C.yellow}${maxSteps}${C.reset}`, w, true)}`);
  console.log(`${C.cyan}${bottomBorder(w, true)}${C.reset}`);
  console.log();

  const startTime = Date.now();
  const currentStepId = stepCounter + 1;
  let currentResponse = '';
  const currentToolCalls: StepRecord['toolCalls'] = [];

  await runAgentLoop(goal, maxSteps, {
    onStep: (step, response) => {
      currentResponse += response + '\n';
      if (/^(Plan|Thought):/m.test(response)) { currentMode = 'plane'; }
      else { currentMode = 'write'; }
      const w2 = termWidth();
      // Progress bar
      const pct = Math.round((step / maxSteps) * 100);
      const bar = progressBar(step, maxSteps, 20);
      console.log(`${C.cyan}${vLine(`${C.darkGray}Step ${step}/${maxSteps} ${bar} ${pct}%${C.reset}`, w2, true)}`);
      console.log(`${C.cyan}${vLine(compactStepLine(currentStepId + step - 1, currentMode, response, w2), w2)}`);
    },
    onToolCall: (step, tool, args, result) => {
      currentToolCalls.push({ tool, args, result });
      printToolCall(tool, args, result);
      console.log();
    },
    onComplete: (steps) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      stepHistory.push({ id: currentStepId, type: currentMode === 'plane' ? 'plan' : 'write', response: currentResponse.trim(), toolCalls: currentToolCalls });
      stepCounter = currentStepId;
      const w2 = termWidth();

      // Collect summary stats
      const filesWritten = currentToolCalls.filter(tc => tc.tool === 'write_file_content' && !tc.result.startsWith('Error') && !tc.result.startsWith('Ошибка'));
      const filesRead = currentToolCalls.filter(tc => tc.tool === 'read_file_content' && !tc.result.startsWith('Error') && !tc.result.startsWith('Ошибка'));
      const errors = currentToolCalls.filter(tc => tc.result.startsWith('Error') || tc.result.startsWith('Ошибка') || tc.result.startsWith('Tool'));

      const completeIcon = errors.length === 0 ? ' ✓' : ' ✗';
      console.log(`${C.green}${topBorder(w2, `${completeIcon} COMPLETE `, true)}${C.reset}`);
      console.log(`${C.green}${vLine(`${C.bold}${steps}${C.reset}${C.green} steps  ${C.darkGray}│${C.reset}  ${C.gray}time:${C.reset} ${C.yellow}${elapsed}s${C.reset}  ${C.darkGray}│${C.reset}  ${C.gray}tools:${C.reset} ${C.cyan}${currentToolCalls.length}${C.reset}`, w2, true)}`);

      if (filesWritten.length > 0 || filesRead.length > 0) {
        const fileSummary: string[] = [];
        if (filesWritten.length > 0) fileSummary.push(`${C.green}${filesWritten.length} written${C.reset}`);
        if (filesRead.length > 0) fileSummary.push(`${C.blue}${filesRead.length} read${C.reset}`);
        console.log(`${C.green}${vLine(`${C.gray}files:${C.reset} ${fileSummary.join(', ')}`, w2, true)}`);
      }

      if (errors.length > 0) {
        console.log(`${C.green}${vLine(`${C.gray}errors:${C.reset} ${C.red}${errors.length} tool error(s)${C.reset}`, w2, true)}`);
      }

      // Build task result summary
      const resultParts: string[] = [];
      if (filesWritten.length > 0) {
        const fileNames = [...new Set(filesWritten.map(tc => {
          const p = tc.args.path as string;
          return p ? p.split('/').pop() || p : 'unknown';
        }))].slice(0, 3).join(', ');
        resultParts.push(`${C.green}${filesWritten.length} file(s) written${C.reset}${C.darkGray}(${fileNames})${C.reset}`);
      }
      if (filesRead.length > 0) {
        const fileNames = [...new Set(filesRead.map(tc => {
          const p = tc.args.path as string;
          return p ? p.split('/').pop() || p : 'unknown';
        }))].slice(0, 3).join(', ');
        resultParts.push(`${C.blue}${filesRead.length} file(s) read${C.reset}${C.darkGray}(${fileNames})${C.reset}`);
      }
      if (errors.length > 0) {
        resultParts.push(`${C.red}${errors.length} error(s)${C.reset}`);
      }
      if (resultParts.length === 0 && currentToolCalls.length > 0) {
        resultParts.push(`${C.gray}task finished${C.reset}`);
      }
      if (resultParts.length > 0) {
        console.log(`${C.green}${vLine(`${C.gray}result:${C.reset} ${resultParts.join(C.darkGray + ' | ' + C.reset)}`, w2, true)}`);
      }

      console.log(`${C.green}${bottomBorder(w2, true)}${C.reset}`);
      console.log();
    },
    onContextUpdate: (messages) => { updateContextLength(messages); },
  });
}

// ═══════════════════════════════════════════════════════════════
// INTERACTIVE TUI
// ═══════════════════════════════════════════════════════════════

export async function startTUI(rl?: readline.Interface) {
  const rl_ = rl ?? readline.createInterface({ input, output });
  let w = termWidth();
  console.clear();

  // ─── WELCOME HEADER ──────────────────────────────────────
  const logoLines = loadLogo();
  console.log(`${C.cyan}${topBorder(w, undefined, true)}${C.reset}`);
  for (const line of logoLines) {
    const colorLine = `${C.white}${C.bold}  ${line}${C.reset}`;
    console.log(`${C.cyan}${vLine(colorLine, w, true)}`);
  }
  console.log(`${C.cyan}${vLine(`${C.darkGray}  tiny-agent ${C.reset}`, w, true)}`);
  console.log(`${C.cyan}${bottomBorder(w, true)}${C.reset}`);
  console.log();

  // ─── COMMANDS ────────────────────────────────────────────
  console.log(`${C.cyan}${topBorder(w, ' COMMANDS ')}${C.reset}`);
  console.log(`${C.cyan}${vLine(`${C.yellow}\\plan${C.reset}     ${C.gray}— planning mode (read/search only)${C.reset}`, w)}`);
  console.log(`${C.cyan}${vLine(`${C.yellow}\\write${C.reset}    ${C.gray}— write mode (full access)${C.reset}`, w)}`);
  console.log(`${C.cyan}${vLine(`${C.yellow}\\steps${C.reset}    ${C.gray}— show step history${C.reset}`, w)}`);
  console.log(`${C.cyan}${vLine(`${C.yellow}\\expand N${C.reset}  ${C.gray}— expand step N${C.reset}`, w)}`);
  console.log(`${C.cyan}${vLine(`${C.yellow}\\test${C.reset}     ${C.gray}— run test output (no LLM)${C.reset}`, w)}`);
  console.log(`${C.cyan}${vLine(`${C.yellow}\\provider${C.reset} ${C.gray}— manage LLM providers${C.reset}`, w)}`);
  console.log(`${C.cyan}${vLine(`${C.yellow}\\exit${C.reset}     ${C.gray}— exit agent${C.reset}`, w)}`);
  console.log(`${C.cyan}${bottomBorder(w)}${C.reset}`);
  console.log();

  displayStatus();
  console.log();

  while (true) {
    const modeColor = currentMode === 'plane' ? C.blue : C.green;
    const modeLabel = currentMode === 'plane' ? 'PLAN' : 'WRITE';
    const prompt = `${C.cyan}${B.v}${C.reset} ${modeColor}${C.bold}[${modeLabel}]${C.reset} ${C.cyan}${B.v}${C.reset} ${C.bold}>${C.reset} `;
    const query = (await rl_.question(prompt)).trim();

    // ── EXIT ──
    if (query.toLowerCase() === 'exit' || query === '\\exit') {
      console.log();
      console.log(`${C.cyan}${topBorder(w, ' SHUTDOWN ', true)}${C.reset}`);
      console.log(`${C.cyan}${vLine(`${C.magenta}SYSTEM HALTED${C.reset}`, w, true)}`);
      console.log(`${C.cyan}${bottomBorder(w, true)}${C.reset}`);
      break;
    }

    // ── MODE SWITCH ──
    if (query === '\\plan') {
      setMode('plane');
      console.log(`${C.blue}${B.tRight} ${B.arrow} MODE: PLANNING (read/search only)${C.reset}\n`);
      continue;
    }
    if (query === '\\write') {
      setMode('write');
      console.log(`${C.green}${B.tRight} ${B.arrow} MODE: WRITE (full access)${C.reset}\n`);
      continue;
    }

    // ── STEPS HISTORY ──
    if (query === '\\steps') {
      if (stepHistory.length === 0) {
        console.log(`${C.gray}  (no steps recorded)${C.reset}\n`);
      } else {
        console.log(`${C.cyan}${topBorder(w, ' STEP HISTORY ')}${C.reset}`);
        for (const step of stepHistory) {
          console.log(`${C.cyan}${vLine(compactStepLine(step.id, step.type, step.response, w), w)}`);
        }
        console.log(`${C.cyan}${bottomBorder(w)}${C.reset}`);
        console.log(`${C.gray}  Use \\expand <N> to expand a step${C.reset}\n`);
      }
      continue;
    }

    // ── EXPAND STEP ──
    if (query.startsWith('\\expand ')) {
      const n = parseInt(query.split(/\s+/)[1], 10);
      const step = stepHistory.find(s => s.id === n);
      if (step) { printStepDetail(step, w); }
      else { console.log(`${C.red}  Step ${n} not found. Use \\steps to list.${C.reset}`); }
      console.log();
      continue;
    }

    // ── TEST MODE ──
    if (query === '\\test') {
      console.log(`${C.cyan}${topBorder(w, ' TEST MODE ', true)}${C.reset}`);
      console.log(`${C.cyan}${vLine(`${C.gray}Simulating agent output...${C.reset}`, w, true)}`);
      console.log(`${C.cyan}${bottomBorder(w, true)}${C.reset}\n`);

      const testSteps: StepRecord[] = [
        { id: ++stepCounter, type: 'plan', response: 'Plan: Read the file and find the definition\nThought: src/lib.ts contains the main exports\nAction: read_file_content', toolCalls: [{ tool: 'read_file_content', args: { path: 'src/lib.ts' }, result: 'File src/lib.ts, 23 lines read successfully' }] },
        { id: ++stepCounter, type: 'plan', response: 'Thought: Found the function at line 15\nPlan: Check the imports next', toolCalls: [{ tool: 'read_file_content', args: { path: 'src/config.ts' }, result: 'File src/config.ts, 114 lines read successfully' }] },
        { id: ++stepCounter, type: 'write', response: 'Thought: All data collected, writing report\nAction: write_file_content', toolCalls: [{ tool: 'write_file_content', args: { path: 'output.md', content: '# Report' }, result: 'File written: output.md (1024 bytes)' }] },
      ];
      for (const step of testSteps) {
        stepHistory.push(step);
        console.log(`${C.cyan}${vLine(compactStepLine(step.id, step.type, step.response, w), w)}`);
        for (const tc of step.toolCalls) printToolCall(tc.tool, tc.args, tc.result);
        console.log();
      }
      console.log(`${C.green}${topBorder(w, ' COMPLETE ', true)}${C.reset}`);
      console.log(`${C.green}${vLine(`${C.bold}${testSteps.length}${C.reset}${C.green} steps — use \\steps to review${C.reset}`, w, true)}`);
      console.log(`${C.green}${bottomBorder(w, true)}${C.reset}\n`);
      continue;
    }

    // ── PROVIDER ──
    if (query === '\\provider' || query.startsWith('\\provider ')) {
      const parts = query.split(/\s+/);
      const sub = parts[1];
      if (sub === 'add') await providerAdd(rl_);
      else if (sub === 'list') providerList();
      else if (sub === 'use' && parts[2]) providerUse(parts.slice(2).join(' '));
      else if (sub === 'remove' && parts[2]) providerRemove(parts.slice(2).join(' '));
      else {
        console.log(`${C.cyan}${topBorder(w, ' PROVIDER ')}${C.reset}`);
        console.log(`${C.cyan}${vLine(`  ${C.yellow}\\provider add${C.reset}        ${C.gray}— add provider${C.reset}`, w)}`);
        console.log(`${C.cyan}${vLine(`  ${C.yellow}\\provider list${C.reset}       ${C.gray}— list providers${C.reset}`, w)}`);
        console.log(`${C.cyan}${vLine(`  ${C.yellow}\\provider use <name>${C.reset} ${C.gray}— select active${C.reset}`, w)}`);
        console.log(`${C.cyan}${vLine(`  ${C.yellow}\\provider remove <name>${C.reset} ${C.gray}— remove provider${C.reset}`, w)}`);
        console.log(`${C.cyan}${bottomBorder(w)}${C.reset}`);
      }
      continue;
    }

    if (!query) continue;
    console.log();

    // Show user message prominently
    w = termWidth();
    console.log(`${C.cyan}${vLine(`${C.green}👤${C.reset} ${C.bold}You:${C.reset} ${query}`, w)}`);
    console.log();

    // ── PLAN MODE ──
    if (getMode() === 'plane') {
      const currentStepId = stepCounter + 1;
      let currentResponse = '';
      const currentToolCalls: StepRecord['toolCalls'] = [];
      const planStart = Date.now();

      await runPlanLoop(query, 10, {
        onStep: (step, response) => {
          currentResponse += response + '\n';
          const w2 = termWidth();
          // Progress bar for plan mode (max 10 steps)
          const pct = Math.round((step / 10) * 100);
          const bar = progressBar(step, 10, 15);
          console.log(`${C.blue}${vLine(`${C.darkGray}Step ${step}/10 ${bar} ${pct}%${C.reset}`, w2)}`);
          console.log(`${C.blue}${vLine(compactStepLine(currentStepId + step - 1, 'plan', response, w2), w2)}`);
        },
        onToolCall: (step, tool, args, result) => {
          currentToolCalls.push({ tool, args, result });
          printToolCall(tool, args, result);
          console.log();
        },
        onComplete: (steps) => {
          const elapsed = ((Date.now() - planStart) / 1000).toFixed(1);
          stepHistory.push({ id: currentStepId, type: 'plan', response: currentResponse.trim(), toolCalls: currentToolCalls });
          stepCounter = currentStepId;
          const w2 = termWidth();

          const filesRead = currentToolCalls.filter(tc => tc.tool === 'read_file_content' && !tc.result.startsWith('Error') && !tc.result.startsWith('Ошибка'));
          const errors = currentToolCalls.filter(tc => tc.result.startsWith('Error') || tc.result.startsWith('Ошибка') || tc.result.startsWith('Tool'));

          const completeIcon = errors.length === 0 ? ' ✓' : ' ✗';
          console.log(`${C.blue}${topBorder(w2, ` PLAN COMPLETE${completeIcon} `, true)}${C.reset}`);
          console.log(`${C.blue}${vLine(`${C.bold}${steps}${C.reset}${C.blue} steps  ${C.darkGray}│${C.reset}  ${C.gray}time:${C.reset} ${C.yellow}${elapsed}s${C.reset}  ${C.darkGray}│${C.reset}  ${C.gray}tools:${C.reset} ${C.cyan}${currentToolCalls.length}${C.reset}`, w2, true)}`);

          if (filesRead.length > 0) {
            const fileNames = [...new Set(filesRead.map(tc => {
              const p = tc.args.path as string;
              return p ? p.split('/').pop() || p : 'unknown';
            }))].slice(0, 3).join(', ');
            console.log(`${C.blue}${vLine(`${C.gray}files:${C.reset} ${C.blue}${filesRead.length} read${C.reset}${C.darkGray}(${fileNames})${C.reset}`, w2, true)}`);
          }

          if (errors.length > 0) {
            console.log(`${C.blue}${vLine(`${C.gray}errors:${C.reset} ${C.red}${errors.length} tool error(s)${C.reset}`, w2, true)}`);
          }

          // Build task result summary
          const resultParts: string[] = [];
          if (filesRead.length > 0) {
            const fileNames = [...new Set(filesRead.map(tc => {
              const p = tc.args.path as string;
              return p ? p.split('/').pop() || p : 'unknown';
            }))].slice(0, 3).join(', ');
            resultParts.push(`${C.blue}${filesRead.length} file(s) read${C.reset}${C.darkGray}(${fileNames})${C.reset}`);
          }
          if (errors.length > 0) {
            resultParts.push(`${C.red}${errors.length} error(s)${C.reset}`);
          }
          if (resultParts.length === 0 && currentToolCalls.length > 0) {
            resultParts.push(`${C.gray}task finished${C.reset}`);
          }
          if (resultParts.length > 0) {
            console.log(`${C.blue}${vLine(`${C.gray}result:${C.reset} ${resultParts.join(C.darkGray + ' | ' + C.reset)}`, w2, true)}`);
          }

          console.log(`${C.blue}${bottomBorder(w2, true)}${C.reset}\n`);
        },
        onContextUpdate: (messages) => { updateContextLength(messages); },
      });
    } else {
      // ── WRITE MODE ──
      const currentStepId = stepCounter + 1;
      let currentResponse = '';
      const currentToolCalls: StepRecord['toolCalls'] = [];
      const writeStart = Date.now();

      await runAgentLoop(query, parseInt(process.env.MAX_STEPS || String(DEFAULT_MAX_STEPS), 10), {
        onStep: (step, response) => {
          currentResponse += response + '\n';
          if (/^(Plan|Thought):/m.test(response)) { currentMode = 'plane'; }
          else { currentMode = 'write'; }
          console.log(`${C.cyan}${vLine(compactStepLine(currentStepId + step - 1, currentMode, response, w), w)}`);
        },
        onToolCall: (step, tool, args, result) => {
          currentToolCalls.push({ tool, args, result });
          printToolCall(tool, args, result);
          console.log();
        },
        onComplete: (steps) => {
          const elapsed = ((Date.now() - writeStart) / 1000).toFixed(1);
          stepHistory.push({ id: currentStepId, type: currentMode === 'plane' ? 'plan' : 'write', response: currentResponse.trim(), toolCalls: currentToolCalls });
          stepCounter = currentStepId;
          const w2 = termWidth();

          const filesWritten = currentToolCalls.filter(tc => tc.tool === 'write_file_content' && !tc.result.startsWith('Error') && !tc.result.startsWith('Ошибка'));
          const filesRead = currentToolCalls.filter(tc => tc.tool === 'read_file_content' && !tc.result.startsWith('Error') && !tc.result.startsWith('Ошибка'));
          const errors = currentToolCalls.filter(tc => tc.result.startsWith('Error') || tc.result.startsWith('Ошибка') || tc.result.startsWith('Tool'));

          const completeIcon = errors.length === 0 ? ' ✓' : ' ✗';
          console.log(`${C.green}${topBorder(w2, `${completeIcon} COMPLETE `, true)}${C.reset}`);
          console.log(`${C.green}${vLine(`${C.bold}${steps}${C.reset}${C.green} steps  ${C.darkGray}│${C.reset}  ${C.gray}time:${C.reset} ${C.yellow}${elapsed}s${C.reset}  ${C.darkGray}│${C.reset}  ${C.gray}tools:${C.reset} ${C.cyan}${currentToolCalls.length}${C.reset}`, w2, true)}`);

          // Build task result summary
          const resultParts: string[] = [];
          if (filesWritten.length > 0) {
            const fileNames = [...new Set(filesWritten.map(tc => {
              const p = tc.args.path as string;
              return p ? p.split('/').pop() || p : 'unknown';
            }))].slice(0, 3).join(', ');
            resultParts.push(`${C.green}${filesWritten.length} file(s) written${C.reset}${C.darkGray}(${fileNames})${C.reset}`);
          }
          if (filesRead.length > 0) {
            const fileNames = [...new Set(filesRead.map(tc => {
              const p = tc.args.path as string;
              return p ? p.split('/').pop() || p : 'unknown';
            }))].slice(0, 3).join(', ');
            resultParts.push(`${C.blue}${filesRead.length} file(s) read${C.reset}${C.darkGray}(${fileNames})${C.reset}`);
          }
          if (errors.length > 0) {
            resultParts.push(`${C.red}${errors.length} error(s)${C.reset}`);
          }
          if (resultParts.length === 0 && currentToolCalls.length > 0) {
            resultParts.push(`${C.gray}task finished${C.reset}`);
          }

          if (resultParts.length > 0) {
            console.log(`${C.green}${vLine(`${C.gray}result:${C.reset} ${resultParts.join(C.darkGray + ' | ' + C.reset)}`, w2, true)}`);
          }

          console.log(`${C.green}${bottomBorder(w2, true)}${C.reset}\n`);
        },
        onContextUpdate: (messages) => { updateContextLength(messages); },
      });
    }

    console.log();
    displayStatus();
    console.log();
  }

  rl_.close();
}

// ─── ENTRY POINT ─────────────────────────────────────────────
loadEnv();

const taskArg = process.argv[2];
if (taskArg) {
  runAutonomous(taskArg).catch(err => {
    console.error(`${C.red}${B.crossMark} ERROR: ${err.message}${C.reset}`);
    process.exit(1);
  });
} else {
  startTUI();
}
