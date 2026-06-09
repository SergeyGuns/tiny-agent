import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { runReActLoop, BENCH_SYSTEM_PROMPT } from './lib.js';

const C = {
  reset: '\x1b[0m', bright: '\x1b[1m', dim: '\x1b[2m',
  blue: '\x1b[34m', yellow: '\x1b[33m', cyan: '\x1b[36m',
  magenta: '\x1b[35m', green: '\x1b[32m', red: '\x1b[31m'
};

// ─── АВТОНОМНЫЙ РЕЖИМ ───────────────────────────────────────

async function runAutonomous(goal: string, maxSteps = 15) {
  console.clear();
  console.log(`${C.green}${C.bright}АВТОНОМНЫЙ АГЕНТ${C.reset}`);
  console.log(`${C.dim}Цель: ${goal}${C.reset}`);
  console.log(`${C.dim}Макс. шагов: ${maxSteps}${C.reset}\n`);

  await runReActLoop(goal, maxSteps, {
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
      console.log(`\n${C.green}${C.bright}ЗАВЕРШЕНО за ${steps} шагов${C.reset}\n`);
    },
  });
}

// ─── ИНТЕРАКТИВНЫЙ TUI ───────────────────────────────────────

async function startTUI() {
  const rl = readline.createInterface({ input, output });
  console.clear();
  console.log(`${C.green}${C.bright}TUI LLM-АГЕНТ${C.reset}`);
  console.log(`${C.dim}Введите команду (или 'exit')${C.reset}\n`);

  while (true) {
    const query = await rl.question(`${C.bright}Вы > ${C.reset}`);
    if (query.toLowerCase() === 'exit') break;
    if (!query.trim()) continue;
    await runAutonomous(query, 10);
  }
  rl.close();
}

// ─── ТОЧКА ВХОДА ─────────────────────────────────────────────

const taskArg = process.argv[2];

if (taskArg) {
  runAutonomous(taskArg).catch(err => {
    console.error(`${C.red}ОШИБКА: ${err.message}${C.reset}`);
    process.exit(1);
  });
} else {
  startTUI();
}
