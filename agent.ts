import { execSync } from 'child_process';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { loadEnv, DEFAULT_MAX_STEPS } from './lib.js';
import { runReActLoop, runPlanLoop } from './lib.js';
import type { Message } from './types.js';
import { providerAdd, providerList, providerUse, providerRemove } from './src/provider.js';

export const C = {
  reset: '\x1b[0m', bright: '\x1b[1m', dim: '\x1b[2m',
  blue: '\x1b[34m', yellow: '\x1b[33m', cyan: '\x1b[36m',
  magenta: '\x1b[35m', green: '\x1b[32m', red: '\x1b[31m'
};

// ─── STATUS BAR ──────────────────────────────────────
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
    } catch {
      cachedBranch = 'none';
    }
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
  return `${currentContextLength} of ${maxStr}`;
}

export function getStatusLine(): string {
  const model = getModelName();
  const dir = process.cwd();
  const branch = getGitBranch();
  const context = getContextDisplay();
  return `${C.dim}[${model}]>[mode:${currentMode}]>[${dir}]>[git:${branch}]>[${context}]${C.reset}`;
}

export function displayStatus(): void {
  console.log(getStatusLine());
  console.log(`${C.dim}${'─'.repeat(50)}${C.reset}`);
}

// ─── MODE TRACKING ──────────────────────────────────────────

export function setMode(mode: 'plane' | 'write'): void {
  currentMode = mode;
}

export function getMode(): 'plane' | 'write' {
  return currentMode;
}

// ─── CONTEXT LENGTH ACCESS ──────────────────────────────────

export function getCurrentContextLength(): number {
  return currentContextLength;
}

export function resetContextLength(): void {
  currentContextLength = 0;
}

// ─── AUTONOMOUS MODE ───────────────────────────────────────

export async function runAutonomous(goal: string, maxSteps = parseInt(process.env.MAX_STEP || process.env.MAX_STEPS || String(DEFAULT_MAX_STEPS), 10)) {
  console.clear();
  console.log(`${C.green}${C.bright}АВТОНОМНЫЙ АГЕНТ${C.reset}`);
  console.log(`${C.dim}Цель: ${goal}${C.reset}`);
  displayStatus();
  console.log(`${C.dim}Макс. шагов: ${maxSteps}${C.reset}\n`);

  await runReActLoop(goal, maxSteps, {
    onStep: (step, response) => {
      if (/^(Plan|Thought):/m.test(response)) {
        currentMode = 'plane';
      } else {
        currentMode = 'write';
      }
      console.log(`${C.dim}${'─'.repeat(50)} [Шаг ${step}]${C.reset}`);
      const formatted = response
        .replace(/^Plan:/gm, `${C.blue}${C.bright}ПЛАН:${C.reset}`)
        .replace(/^Thought:/gm, `${C.yellow}${C.bright}МЫСЛЬ:${C.reset}`)
        .replace(/^Action:/gm, `${C.cyan}${C.bright}ДЕЙСТВИЕ:${C.reset}`);
      console.log(formatted);
    },
    onToolCall: (step, tool, args, result) => {
      console.log(`${C.cyan}  ⚙ ${tool}(${JSON.stringify(args)})${C.reset}`);
      console.log(`${C.magenta}  → ${result.substring(0, 200)}${result.length > 200 ? '...' : ''}${C.reset}\n`);
    },
    onComplete: (steps) => {
      console.log(`\n${C.green}${C.bright}ЗАВЕРШЕНО за ${steps} шагов${C.reset}\n`);
    },
    onContextUpdate: (messages) => {
      updateContextLength(messages);
    },
  });
}

// ─── INTERACTIVE TUI ───────────────────────────────────────

export async function startTUI(rl?: readline.Interface) {
  const rl_ = rl ?? readline.createInterface({ input, output });
  console.clear();
  displayStatus();
  console.log(`${C.green}${C.bright}TUI LLM-АГЕНТ${C.reset}`);
  console.log(`${C.dim}Команда: \\plan \\write \\provider \\exit${C.reset}\n`);

  while (true) {
    displayStatus();
    const query = (await rl_.question(`${C.bright}Вы > ${C.reset}`)).trim();
    if (query.toLowerCase() === 'exit' || query === '\\exit') break;
    if (query === '\\plan') {
      setMode('plane');
      console.log(`${C.blue}${C.bright}Режим: ПЛАНИРОВАНИЕ (только чтение и поиск)${C.reset}\n`);
      continue;
    }
    if (query === '\\write') {
      setMode('write');
      console.log(`${C.green}${C.bright}Режим: ЗАПИСЬ (полный доступ)${C.reset}\n`);
      continue;
    }
    if (query === '\\provider' || query.startsWith('\\provider ')) {
      const parts = query.split(/\s+/);
      const sub = parts[1];

      if (sub === 'add') {
        await providerAdd(rl_);
      } else if (sub === 'list') {
        providerList();
      } else if (sub === 'use' && parts[2]) {
        providerUse(parts.slice(2).join(' '));
      } else if (sub === 'remove' && parts[2]) {
        providerRemove(parts.slice(2).join(' '));
      } else {
        console.log(`${C.bright}Команды:\\${C.reset}`);
        console.log(`  ${C.cyan}\\provider add${C.reset}     — добавить провайдер`);
        console.log(`  ${C.cyan}\\provider list${C.reset}    — список провайдеров`);
        console.log(`  ${C.cyan}\\provider use <name>${C.reset} — выбрать активный`);
        console.log(`  ${C.cyan}\\provider remove <name>${C.reset} — удалить провайдер\n`);
      }
      continue;
    }
    if (!query) continue;
    if (getMode() === 'plane') {
      await runPlanLoop(query, 10, {
        onStep: (step, response) => {
          console.log(`${C.dim}${'─'.repeat(50)} [Шаг ${step}]${C.reset}`);
          const formatted = response
            .replace(/^Plan:/gm, `${C.blue}${C.bright}ПЛАН:${C.reset}`)
            .replace(/^Thought:/gm, `${C.yellow}${C.bright}МЫСЛЬ:${C.reset}`)
            .replace(/^Action:/gm, `${C.cyan}${C.bright}ДЕЙСТВИЕ:${C.reset}`);
          console.log(formatted);
        },
        onToolCall: (step, tool, args, result) => {
          console.log(`${C.cyan}  ⚙ ${tool}(${JSON.stringify(args)})${C.reset}`);
          console.log(`${C.magenta}  → ${result.substring(0, 200)}${result.length > 200 ? '...' : ''}${C.reset}\n`);
        },
        onComplete: (steps) => {
          console.log(`\n${C.blue}${C.bright}ПЛАНИРОВАНИЕ ЗАВЕРШЕНО за ${steps} шагов${C.reset}\n`);
        },
        onContextUpdate: (messages) => {
          updateContextLength(messages);
        },
      });
    } else {
      await runAutonomous(query, 10);
    }
  }
  rl_.close();
}

// ─── ENTRY POINT ─────────────────────────────────────────────
loadEnv();


const taskArg = process.argv[2];

if (taskArg) {
  runAutonomous(taskArg).catch(err => {
    console.error(`${C.red}ОШИБКА: ${err.message}${C.reset}`);
    process.exit(1);
  });
} else {
  startTUI();
}
