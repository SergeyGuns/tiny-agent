// ═══════════════════════════════════════════════════════════════
// tiny-agent Benchmark — типы и интерфейсы
// ═══════════════════════════════════════════════════════════════

import type { ToolCallRecord } from '../types.js';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

export type Category =
  | 'terminal'   // Файловые операции (Terminal-Bench style)
  | 'tool_use'   // Использование инструментов (Tau-Bench style)
  | 'research'   // Многошаговое исследование (GAIA style)
  | 'planning'   // Планирование и декомпозиция
  | 'rlm';       // Рекурсивные вызовы LLM (RLM)

export interface Task {
  id: string;                    // уникальный ID, например "T-001"
  category: Category;
  difficulty: Difficulty;
  title: string;                 // короткое название
  description: string;           // полное описание задачи
  prompt: string;                // промпт для агента
  setup?: () => Promise<void>;   // подготовка среды (создание файлов и т.д.)
  evaluate: (ctx: EvalContext) => Promise<EvalResult>;
}

export interface EvalContext {
  /** Временная директория задачи */
  workDir: string;
  /** Записанные агентом файлы (path → content) */
  writtenFiles: Map<string, string>;
  /** История вызовов инструментов */
  toolCalls: ToolCallRecord[];
}

export interface EvalResult {
  passed: boolean;
  score: number;          // 0.0 — 1.0
  maxScore: number;
  details: EvalCheck[];
}

export interface EvalCheck {
  name: string;
  passed: boolean;
  weight: number;
  message: string;
}

export interface TaskResult {
  task: Task;
  passed: boolean;
  score: number;
  maxScore: number;
  durationMs: number;
  steps: number;
  toolCalls: number;
  details: EvalCheck[];
  error?: string;
}

export interface BenchmarkReport {
  timestamp: string;
  totalTasks: number;
  passed: number;
  failed: number;
  totalScore: number;
  maxScore: number;
  percentage: number;
  avgSteps: number;
  avgToolCalls: number;
  avgDurationMs: number;
  byCategory: Record<Category, CategorySummary>;
  byDifficulty: Record<Difficulty, CategorySummary>;
  results: TaskResult[];
}

export interface CategorySummary {
  total: number;
  passed: number;
  score: number;
  maxScore: number;
  percentage: number;
}

export const DIFFICULTY_WEIGHTS: Record<Difficulty, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
  expert: 5,
};
