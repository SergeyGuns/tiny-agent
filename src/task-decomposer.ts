// ─── task-decomposer.ts — break complex tasks into simple subtasks ──
// 1. Decompose: split task into atomic subtasks via LLM
// 2. Execute: each subtask executed directly via tool function
// 3. Reflect: after each step, check progress toward goal

import { queryLLM, LLM_PROFILES } from './llm.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Subtask {
  id: number;
  description: string;
  tool: string;
  args: Record<string, unknown>;
  done: boolean;
  result?: string;
}

export interface DecomposedTask {
  subtasks: Subtask[];
  originalTask: string;
}

/**
 * Step 1: Decompose a complex task into atomic subtasks.
 * Uses subagent to break down the task.
 */
export async function decomposeTask(task: string): Promise<DecomposedTask> {
  const prompt = `You are a task decomposer. Break the following task into atomic subtasks.

TASK: ${task}

RULES:
- Each subtask should be a single, clear action
- Specify the tool needed for each subtask
- Specify the arguments for each tool
- Order subtasks logically (dependencies first)
- Keep it simple: 3-8 subtasks max

OUTPUT FORMAT (JSON):
{
  "subtasks": [
    {
      "id": 1,
      "description": "What to do",
      "tool": "tool_name",
      "args": { "key": "value" }
    }
  ]
}

Output ONLY valid JSON, nothing else.`;

  try {
    const response = await queryLLM(
      [{ role: 'user', content: prompt }],
      LLM_PROFILES.planning,
    );

    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*"subtasks"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        subtasks: parsed.subtasks.map((s: any, i: number) => ({
          id: i + 1,
          description: s.description,
          tool: s.tool,
          args: s.args || {},
          done: false,
        })),
        originalTask: task,
      };
    }
  } catch { /* fallback */ }

  // Fallback: single subtask = the whole task
  return {
    subtasks: [{
      id: 1,
      description: task,
      tool: 'execute_full_task',
      args: { task },
      done: false,
    }],
    originalTask: task,
  };
}

/**
 * Step 2: Execute a single subtask directly.
 * Uses the actual tool function, not a subagent.
 */
export async function executeSubtask(subtask: Subtask): Promise<string> {
  const { tools } = await import('./tools.js');
  const toolFn = tools[subtask.tool];

  if (!toolFn) {
    return `Error: tool "${subtask.tool}" not found`;
  }

  try {
    const result = await toolFn(subtask.args);
    return result;
  } catch (e) {
    return `Error executing subtask ${subtask.id}: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * Step 3: Self-reflection — check progress toward goal.
 * After each subtask, verify we're on track.
 */
export async function reflectOnProgress(
  originalTask: string,
  completedSubtasks: Subtask[],
  remainingSubtasks: Subtask[],
): Promise<{ onTrack: boolean; feedback: string }> {
  const completed = completedSubtasks
    .map(s => `#${s.id}: ${s.description} → ${s.result?.substring(0, 100) || 'done'}`)
    .join('\n');

  const remaining = remainingSubtasks
    .map(s => `#${s.id}: ${s.description}`)
    .join('\n');

  const prompt = `You are a progress checker. Verify if the task is on track.

ORIGINAL TASK: ${originalTask}

COMPLETED STEPS:
${completed || '(none)'}

REMAINING STEPS:
${remaining || '(none)'}

QUESTION: Are we making correct progress toward completing the original task?

OUTPUT:
ON_TRACK: yes/no
FEEDBACK: [brief explanation]`;

  try {
    const response = await queryLLM(
      [{ role: 'user', content: prompt }],
      LLM_PROFILES.classifier,
    );

    const onTrack = /ON_TRACK:\s*yes/i.test(response);
    const feedback = response.replace(/ON_TRACK:.*\n?/i, '').replace(/FEEDBACK:\s*/i, '').trim();

    return { onTrack, feedback };
  } catch {
    return { onTrack: true, feedback: '' };
  }
}

/**
 * Full delegated execution: decompose → execute → reflect → complete
 */
export async function executeDelegated(task: string): Promise<{
  success: boolean;
  results: string[];
  error?: string;
}> {
  // Step 1: Decompose
  const decomposed = await decomposeTask(task);
  const results: string[] = [];

  for (const subtask of decomposed.subtasks) {
    // Step 2: Execute subtask
    const result = await executeSubtask(subtask);
    subtask.result = result;
    subtask.done = true;
    results.push(result);

    // Step 3: Reflect on progress
    const completed = decomposed.subtasks.filter(s => s.done);
    const remaining = decomposed.subtasks.filter(s => !s.done);

    if (remaining.length > 0) {
      const reflection = await reflectOnProgress(task, completed, remaining);
      if (!reflection.onTrack) {
        // Re-decompose remaining work
        const newDecomposition = await decomposeTask(
          `${task}\n\nPROGRESS SO FAR:\n${results.join('\n')}\n\nFEEDBACK: ${reflection.feedback}\n\nREMAINING WORK: focus on completing the original task.`
        );
        // Replace remaining subtasks
        decomposed.subtasks = [...completed, ...newDecomposition.subtasks];
      }
    }
  }

  return { success: true, results };
}
