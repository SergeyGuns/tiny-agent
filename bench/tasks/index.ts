import type { Task } from '../types.js';
import { terminalTasks } from './terminal.js';
import { toolUseTasks } from './tool-use.js';
import { researchTasks } from './research.js';
import { planningTasks } from './planning.js';
import { rlmTasks } from './rlm.js';

export const allTasks: Task[] = [
  ...terminalTasks,
  ...toolUseTasks,
  ...researchTasks,
  ...planningTasks,
  ...rlmTasks,
];

export function getTaskById(id: string): Task | undefined {
  return allTasks.find(t => t.id === id);
}

export function getTasksByCategory(category: Task['category']): Task[] {
  return allTasks.filter(t => t.category === category);
}

export function getTasksByDifficulty(difficulty: Task['difficulty']): Task[] {
  return allTasks.filter(t => t.difficulty === difficulty);
}

export const taskCount = allTasks.length;
export const categoryCount = 4;
