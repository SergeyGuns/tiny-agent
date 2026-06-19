// ├── task-decomposer.ts — break complex tasks into simple subtasks ──
// 1. Decompose: split task into atomic subtasks
// 2. Execute: each subtask delegated to subagent
// 3. Reflect: after each step, check progress toward goal

import { queryLLM, LLM_PROFILES } from './llm.js';
import { getFileSpec, formatSpecHint, validateAndWriteFile } from './format-specs.js';
import { validateToolResult } from './with-subagent.js';
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
 * Step 2: Execute a single subtask via subagent.
 * The subagent receives clear, narrow instructions.
 */
export async function executeSubtask(subtask: Subtask): Promise<string> {
  // Get format spec if writing a file
  const filePath = (subtask.args.path as string) || (subtask.args.file as string);
  let specHint = '';
  if (filePath) {
    try {
      const spec = await getFileSpec(filePath, async (q: string) => {
        const { getMcpClient } = await import('./mcp-client.js');
        const client = await getMcpClient();
        if (!client) return '';
        return client.callTool('get-web-search-summaries', { query: q, limit: 3 });
      });
      specHint = formatSpecHint(spec);
    } catch { /* no MCP */ }
  }

  const prompt = `You are a subtask executor. Execute this single subtask and return the result.

SUBTASK #${subtask.id}: ${subtask.description}

TOOL TO USE: ${subtask.tool}
ARGUMENTS: ${JSON.stringify(subtask.args, null, 2)}

${specHint}

INSTRUCTIONS:
1. Execute the subtask using the specified tool
2. Validate the result
3. Return the result as a clear, concise string
4. If the tool call fails, explain the error and suggest a fix

OUTPUT: The tool execution result only.`;

  try {
    const response = await queryLLM(
      [{ role: 'user', content: prompt }],
      LLM_PROFILES.toolCall,
    );

    // Execute the actual tool
    const { tools } = await import('./tools.js');
    const toolFn = tools[subtask.tool];
    if (toolFn) {
      const result = await toolFn(subtask.args);

      // Validate via subagent
      const validated = await validateToolResult(subtask.tool, subtask.args, result);
      return validated.output;
    }

    return response;
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
