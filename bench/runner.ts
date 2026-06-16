// ═══════════════════════════════════════════════════════════════
// Benchmark Runner — выполняет задачи и собирает результаты
// ═══════════════════════════════════════════════════════════════

import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runReActLoop, queryLLM, loadEnv } from '../lib.js';
import { allTasks } from './tasks/index.js';
import type { ToolCallRecord } from '../types.js';
import type {
  Task,
  TaskResult,
  EvalContext,
  BenchmarkReport,
  CategorySummary,
  Category,
  Difficulty,
} from './types.js';

// ─── ANSI цвета ──────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bright: '\x1b[1m', dim: '\x1b[2m',
  blue: '\x1b[34m', yellow: '\x1b[33m', cyan: '\x1b[36m',
  magenta: '\x1b[35m', green: '\x1b[32m', red: '\x1b[31m',
};

// ─── Подготовка среды задачи ─────────────────────────────────

async function prepareTask(task: Task, workDir: string): Promise<void> {
  fs.mkdirSync(workDir, { recursive: true });
  if (task.setup) await task.setup();
  await injectFixtures(task.id, workDir);
}

async function injectFixtures(taskId: string, workDir: string): Promise<void> {
  const fixtures: Record<string, Record<string, string>> = {
    'TERM-002': {
      'source.txt': 'Это исходный файл. Он содержит важную информацию.',
    },
    'TERM-004': {
      'data.json': JSON.stringify([
        { id: 1, name: 'Alice', value: 100 },
        { id: 2, name: 'Bob', value: 200 },
        { id: 3, name: 'Charlie', value: 150 },
      ], null, 2),
    },
    'TERM-005': {
      'notes.txt': 'This is an important note about the project.\nThis line is not important.\nAnother important finding here.',
      'readme.txt': 'Important: read this carefully.\nNot important stuff.\nImportant: deadline is tomorrow.',
    },
    'TERM-007': {
      'code.js': 'function calculate() {\n  let temp = getData();\n  let temp2 = process(temp);\n  return temp2;\n}\n\nfunction process(x) {\n  let temp = x * 2;\n  return temp;\n}',
    },
    'TERM-008': {
      'users_1.json': JSON.stringify([
        { name: 'Charlie', age: 30 },
        { name: 'Alice', age: 25 },
      ]),
      'users_2.json': JSON.stringify([
        { name: 'Bob', age: 35 },
        { name: 'Diana', age: 28 },
      ]),
      'users_3.json': JSON.stringify([
        { name: 'Eve', age: 22 },
      ]),
    },
    'TERM-009': {
      'orders.csv': 'id,status,amount\n1,completed,100\n2,pending,200\n3,completed,150\n4,cancelled,50\n5,completed,300\n6,pending,75',
    },
    'TOOL-004': {
      'input.json': JSON.stringify([
        { name: 'Alice', age: 25, city: 'Moscow' },
        { name: 'Bob', age: 30, city: 'SPb' },
        { name: 'Charlie', age: 35, city: 'Kazan' },
      ]),
    },
    'TOOL-006': {
      'users.json': JSON.stringify([
        { name: 'Alice', email: 'alice@example.com' },
        { name: 'Bob', email: 'bob@invalid' },
        { name: 'Charlie', email: '@@bad' },
        { name: 'Diana', email: 'diana@test.org' },
        { name: 'Eve', email: 'eve@nodot' },
      ]),
    },
    'RLM-004': {
      'notes.txt': 'This is an important note about the project.\nThis line is not important.\nAnother important finding here.\nWe discovered a critical bug in the system.\nThe team worked hard to fix it.',
    },
    'RLM-005': {
      'code.js': 'function calculate() {\n  let temp = getData();\n  let temp2 = process(temp);\n  return temp2;\n}\n\nfunction process(x) {\n  let temp = x * 2;\n  return temp;\n}',
    },
  };

  const data = fixtures[taskId];
  if (data) {
    for (const [file, content] of Object.entries(data)) {
      const filePath = path.join(workDir, file);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, content, 'utf-8');
    }
  }
}

// ─── Сбор файлов после выполнения ─────────────────────────────

function collectWrittenFiles(workDir: string): Map<string, string> {
  const files = new Map<string, string>();

  function scanDir(dir: string, prefix: string): void {
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const relPath = prefix ? `${prefix}/${entry}` : entry;
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
          scanDir(fullPath, relPath);
        } else if (stat.isFile()) {
          try {
            files.set(relPath, fs.readFileSync(fullPath, 'utf-8'));
          } catch { /* binary */ }
        }
      }
    } catch { /* inaccessible */ }
  }

  scanDir(workDir, '');
  return files;
}

// ─── Выполнение одной задачи ──────────────────────────────────

async function executeTask(task: Task, maxSteps = 15): Promise<TaskResult> {
  const adaptiveSteps = task.difficulty === 'expert' ? 25 : task.difficulty === 'hard' ? 20 : maxSteps;
  const workDir = mkdtempSync(path.join(tmpdir(), `bench-${task.id}-`));
  const toolRecords: ToolCallRecord[] = [];
  const startTime = Date.now();

  const origCwd = process.cwd();
  process.chdir(workDir);

  const taskTimeout = task.difficulty === 'expert' ? 1800000 : task.difficulty === 'hard' ? 1200000 : task.difficulty === 'medium' ? 900000 : 600000;

  try {
    await prepareTask(task, workDir);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Таймаут задачи (${taskTimeout / 1000}s)`)), taskTimeout)
    );
    const runPromise = runReActLoop(task.prompt, adaptiveSteps, {
      onStep: (step, response) => {
        const preview = response.substring(0, 120).replace(/\n/g, ' ');
        console.log(`    ${C.dim}step ${step}: ${preview}...${C.reset}`);
      },
      onToolCall: (step, tool, args, result) => {
        const argsStr = JSON.stringify(args).substring(0, 80);
        const resultStr = result.substring(0, 60).replace(/\n/g, ' ');
        console.log(`    ${C.cyan}${tool}${C.reset}(${argsStr}) → ${resultStr}`);
      },
      onComplete: (steps) => {
        console.log(`    ${C.dim}loop completed: ${steps} steps${C.reset}`);
      },
    });

    const { steps, toolCalls } = await Promise.race([runPromise, timeoutPromise]);

    toolRecords.push(...toolCalls);

    const writtenFiles = collectWrittenFiles(workDir);
    const evalCtx: EvalContext = { workDir, writtenFiles, toolCalls: toolRecords };
    const evalResult = await task.evaluate(evalCtx);

    return {
      task,
      passed: evalResult.passed,
      score: evalResult.score,
      maxScore: evalResult.maxScore,
      durationMs: Date.now() - startTime,
      steps,
      toolCalls: toolRecords.length,
      details: evalResult.details,
    };
  } catch (e: any) {
    return {
      task,
      passed: false,
      score: 0,
      maxScore: 1,
      durationMs: Date.now() - startTime,
      steps: 0,
      toolCalls: 0,
      details: [],
      error: e.message,
    };
  } finally {
    process.chdir(origCwd);
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}

// ═══════════════════════════════════════════════════════════════
// РАННЕР
// ═══════════════════════════════════════════════════════════════

interface RunOptions {
  categories?: Category[];
  difficulties?: Difficulty[];
  taskIds?: string[];
  maxSteps?: number;
  verbose?: boolean;
}

async function runBenchmark(opts: RunOptions = {}): Promise<BenchmarkReport> {
  loadEnv();
  // Clear reasoning log for new benchmark session
  try { fs.writeFileSync('/tmp/rlm-reasoning.log', ''); } catch {}
  const { categories, difficulties, taskIds, maxSteps = 15, verbose = true } = opts;

  let tasks = allTasks;
  if (taskIds?.length) {
    tasks = taskIds.map(id => {
      const t = allTasks.find(x => x.id === id);
      if (!t) throw new Error(`Задача ${id} не найдена`);
      return t;
    });
  } else {
    if (categories?.length) tasks = tasks.filter(t => categories.includes(t.category));
    if (difficulties?.length) tasks = tasks.filter(t => difficulties.includes(t.difficulty));
  }

  if (verbose) {
    console.log(`${C.green}${C.bright}TINY-AGENT BENCHMARK${C.reset}`);
    console.log(`${C.dim}Задач: ${tasks.length}  Макс. шагов: ${maxSteps}${C.reset}`);
    console.log('');
  }

  const results: TaskResult[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const progress = `[${i + 1}/${tasks.length}]`;

    if (verbose) {
      const diffColor = { easy: C.green, medium: C.yellow, hard: C.magenta, expert: C.red }[task.difficulty];
      console.log(`${C.dim}${progress} ${task.id} ${diffColor}${task.difficulty.padEnd(6)}${C.reset} ${task.category.padEnd(10)} ${task.title}`);
    }

    const result = await executeTask(task, maxSteps);
    results.push(result);

    // Cooldown между задачами чтобы LM Studio не перегружался (v9: уменьшен до 1s)
    if (i < tasks.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }

    if (verbose) {
      const statusIcon = result.passed ? `${C.green}PASS${C.reset}` : `${C.red}FAIL${C.reset}`;
      const scorePct = result.maxScore > 0
        ? `${C.bright}${Math.round(result.score / result.maxScore * 100)}%${C.reset}` : 'N/A';
      const dur = `${(result.durationMs / 1000).toFixed(1)}s`;
      console.log(`  ${statusIcon} ${scorePct}  ${dur}  ${result.steps}ш ${result.toolCalls}т`);

      if (!result.passed && !result.error) {
        for (const check of result.details) {
          const icon = check.passed ? `${C.green}+${C.reset}` : `${C.red}-${C.reset}`;
          console.log(`    ${icon} ${check.name}: ${check.message}`);
        }
      }
      if (result.error) console.log(`  ${C.red}ERROR: ${result.error}${C.reset}`);
      console.log('');
    }
  }

  const report = buildReport(results);
  if (verbose) printReport(report);
  return report;
}

// ─── Отчёт ────────────────────────────────────────────────────

function buildReport(results: TaskResult[]): BenchmarkReport {
  const cats: Category[] = ['terminal', 'tool_use', 'research', 'planning', 'rlm'];
  const diffs: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

  const byCategory = {} as Record<Category, CategorySummary>;
  const byDifficulty = {} as Record<Difficulty, CategorySummary>;

  for (const cat of cats) {
    const r = results.filter(x => x.task.category === cat);
    byCategory[cat] = {
      total: r.length,
      passed: r.filter(x => x.passed).length,
      score: r.reduce((s, x) => s + x.score, 0),
      maxScore: r.reduce((s, x) => s + x.maxScore, 0),
      percentage: 0,
    };
    byCategory[cat].percentage = byCategory[cat].maxScore > 0
      ? Math.round(byCategory[cat].score / byCategory[cat].maxScore * 100) : 0;
  }

  for (const diff of diffs) {
    const r = results.filter(x => x.task.difficulty === diff);
    byDifficulty[diff] = {
      total: r.length,
      passed: r.filter(x => x.passed).length,
      score: r.reduce((s, x) => s + x.score, 0),
      maxScore: r.reduce((s, x) => s + x.maxScore, 0),
      percentage: 0,
    };
    byDifficulty[diff].percentage = byDifficulty[diff].maxScore > 0
      ? Math.round(byDifficulty[diff].score / byDifficulty[diff].maxScore * 100) : 0;
  }

  const totalScore = results.reduce((s, r) => s + r.score, 0);
  const maxScore = results.reduce((s, r) => s + r.maxScore, 0);

  return {
    timestamp: new Date().toISOString(),
    totalTasks: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    totalScore,
    maxScore,
    percentage: maxScore > 0 ? Math.round(totalScore / maxScore * 100) : 0,
    avgSteps: results.length > 0 ? Math.round(results.reduce((s, r) => s + r.steps, 0) / results.length) : 0,
    avgToolCalls: results.length > 0 ? Math.round(results.reduce((s, r) => s + r.toolCalls, 0) / results.length) : 0,
    avgDurationMs: results.length > 0 ? Math.round(results.reduce((s, r) => s + r.durationMs, 0) / results.length) : 0,
    byCategory,
    byDifficulty,
    results,
  };
}

function printReport(report: BenchmarkReport): void {
  console.log('');
  console.log(`${C.bright}${'═'.repeat(60)}${C.reset}`);
  console.log(`${C.green}${C.bright}  ОТЧЁТ БЕНЧМАРКА${C.reset}`);
  console.log(`${C.bright}${'═'.repeat(60)}${C.reset}`);
  console.log('');

  const pctColor = report.percentage >= 80 ? C.green : report.percentage >= 50 ? C.yellow : C.red;

  console.log(`  Всего задач:     ${report.totalTasks}`);
  console.log(`  Пройдено:        ${C.green}${report.passed}${C.reset} / ${report.totalTasks}`);
  console.log(`  Провалено:       ${C.red}${report.failed}${C.reset}`);
  console.log(`  Общий счёт:      ${pctColor}${report.totalScore}/${report.maxScore} (${report.percentage}%)${C.reset}`);
  console.log(`  Среднее время:   ${(report.avgDurationMs / 1000).toFixed(1)}s`);
  console.log(`  Средних шагов:  ${report.avgSteps}`);
  console.log(`  Средних вызовов: ${report.avgToolCalls}`);
  console.log('');

  console.log(`  ${C.bright}ПО КАТЕГОРИЯМ:${C.reset}`);
  const catNames: Record<Category, string> = { terminal: 'Terminal', tool_use: 'Tool Use', research: 'Research', planning: 'Planning', rlm: 'RLM' };
  for (const [cat, s] of Object.entries(report.byCategory) as [Category, CategorySummary][]) {
    const color = s.percentage >= 80 ? C.green : s.percentage >= 50 ? C.yellow : C.red;
    const bar = '█'.repeat(Math.round(s.percentage / 5)).padEnd(20, '░');
    console.log(`    ${catNames[cat].padEnd(10)} ${color}${bar}${C.reset} ${String(s.percentage).padStart(3)}%  (${s.passed}/${s.total})`);
  }
  console.log('');

  console.log(`  ${C.bright}ПО СЛОЖНОСТИ:${C.reset}`);
  const diffNames: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
  for (const [diff, s] of Object.entries(report.byDifficulty) as [Difficulty, CategorySummary][]) {
    const color = s.percentage >= 80 ? C.green : s.percentage >= 50 ? C.yellow : C.red;
    const bar = '█'.repeat(Math.round(s.percentage / 5)).padEnd(20, '░');
    console.log(`    ${diffNames[diff].padEnd(10)} ${color}${bar}${C.reset} ${String(s.percentage).padStart(3)}%  (${s.passed}/${s.total})`);
  }
  console.log('');

  console.log(`  ${C.bright}ДЕТАЛИ:${C.reset}`);
  for (const r of report.results) {
    const icon = r.passed ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    const pct = r.maxScore > 0 ? `${Math.round(r.score / r.maxScore * 100)}%` : 'N/A';
    console.log(`    ${icon} ${r.task.id} ${C.dim}${r.task.difficulty.padEnd(6)}${C.reset} ${r.task.title.padEnd(35)} ${pct.padStart(4)}  ${(r.durationMs / 1000).toFixed(1)}s`);
  }
  console.log('');
  console.log(`${C.bright}${'═'.repeat(60)}${C.reset}`);
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
tiny-agent benchmark

Использование:
  npm run bench                         — все задачи
  npm run bench -- --category terminal  — по категории
  npm run bench -- --difficulty easy    — по сложности
  npm run bench -- --task TERM-001      — одна задача
  npm run bench -- --max-steps 20       — лимит шагов
  npm run bench -- --quiet              — без деталей

Категории: terminal, tool_use, research, planning
Сложности: easy, medium, hard, expert
  `);
  process.exit(0);
}

const opts: RunOptions = { verbose: true };

const catIdx = args.indexOf('--category');
if (catIdx !== -1) opts.categories = args[catIdx + 1].split(',') as Category[];

const diffIdx = args.indexOf('--difficulty');
if (diffIdx !== -1) opts.difficulties = args[diffIdx + 1].split(',') as Difficulty[];

const taskIdx = args.indexOf('--task');
if (taskIdx !== -1) opts.taskIds = args[taskIdx + 1].split(',');

const stepsIdx = args.indexOf('--max-steps');
if (stepsIdx !== -1) opts.maxSteps = parseInt(args[stepsIdx + 1], 10);

if (args.includes('--quiet')) opts.verbose = false;

runBenchmark(opts).then(report => {
  const reportPath = path.join(process.cwd(), 'bench-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  if (opts.verbose) console.log(`${C.dim}Отчёт: ${reportPath}${C.reset}`);
  process.exit(report.failed > 0 ? 1 : 0);
}).catch(err => {
  console.error(`${C.red}Benchmark error: ${err.message}${C.reset}`);
  process.exit(1);
});
