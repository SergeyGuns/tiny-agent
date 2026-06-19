// ─── rlm.ts — Recursive Language Model executor ──────────
// Based on https://alexzhang13.github.io/blog/2025/rlm/
// Key idea: model decides how many tool calls to make per turn.
// We aggregate all results and feed them back as a batch.
// ─────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Message, ToolCallRecord } from '../types.js';
import { tools, Tool } from './tools.js';
import { parseAllActions, parseWriteFileArgs } from './parser.js';
import { queryLLM, classifyIsReady, classifySearchLoop } from './llm.js';
import { validateToolResult } from './with-subagent.js';
import { LLM_PROFILES, LLMProfileName } from './llm.js';
import { BENCH_SYSTEM_PROMPT } from './prompt.js';
import { RESULT_TRUNCATE_LENGTH } from './config.js';

// ─── Callbacks ───────────────────────────────────────────
export interface RLMCallbacks {
  onStep?: (step: number, response: string, results: { tool: string; args: Record<string, unknown>; result: string }[]) => void;
  onToolCall?: (step: number, tool: string, args: Record<string, unknown>, result: string) => void;
  onComplete?: (steps: number) => void;
  onContextUpdate?: (messages: Message[]) => void;
}

// ─── Execute a single tool call ─────────────────────────────
async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  // Reject absolute paths for write_file_content
  if (toolName === Tool.WriteFile) {
    const rawPath = (args.path ?? args.file ?? args.filename) as string;
    if (rawPath && (rawPath.startsWith('/') || rawPath.startsWith('C:\\'))) {
      return `write_file_content: absolute path "${rawPath}" rejected. Use relative path.`;
    }
  }

  const toolFn = tools[toolName];
  if (!toolFn) return `Tool "${toolName}" not found.`;

  try {
    let result = await toolFn(args);
    if (typeof result !== 'string') result = String(result);
    return result;
  } catch (e: unknown) {
    return `Error: ${e instanceof Error ? e.message?.substring(0, 200) : String(e)}`;
  }
}

// ─── RLM Executor ─────────────────────────────────────────────
export async function runRLM(
  prompt: string,
  maxSteps: number = 15,
  callbacks?: RLMCallbacks,
  profile: LLMProfileName = 'rlm',
  toolsFilter?: string[],
): Promise<{ steps: number; toolCalls: ToolCallRecord[] }> {
  const history: Message[] = [
    { role: 'system', content: BENCH_SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];
  callbacks?.onContextUpdate?.(history);
  const allToolCalls: ToolCallRecord[] = [];
  const filesCreated: string[] = [];
  let emptySteps = 0;

  for (let step = 1; step <= maxSteps; step++) {
    callbacks?.onContextUpdate?.(history);
    let response: string;
    try {
      response = await queryLLM(history, {
        ...LLM_PROFILES[profile],
        toolsFilter,
      });
    } catch (e) {
      if (step < maxSteps) {
        history.push({ role: 'user', content: 'LLM returned empty response. Try again.' });
        continue;
      }
      callbacks?.onComplete?.(step);
      return { steps: step, toolCalls: allToolCalls };
    }
    history.push({ role: 'assistant', content: response });

    // Parse ALL actions from the response
    const actions = parseAllActions(response);

    // ── No actions parsed → check if LLM is ready to answer ──
    if (actions.length === 0) {
      // Case 1: No tools called yet → direct answer (e.g. "Привет!")
      if (allToolCalls.length === 0 && response.trim().length > 0) {
        callbacks?.onStep?.(step, response, []);
        callbacks?.onComplete?.(step);
        return { steps: step, toolCalls: allToolCalls };
      }

      // Case 2: Tools were called → use classifier to decide
      if (allToolCalls.length > 0 && response.trim().length >= 20) {
        const readiness = await classifyIsReady(prompt, response, allToolCalls);
        if (readiness.isReady) {
          callbacks?.onStep?.(step, response, []);
          callbacks?.onComplete?.(step);
          return { steps: step, toolCalls: allToolCalls };
        }
        // Classifier says MORE_WORK — fall through to nudge below
      }

      // Case 3: Short/empty response → nudge
      emptySteps++;
      if (emptySteps >= 3) {
        history.push({
          role: 'user',
          content: `NO TOOL ${emptySteps} steps! Use Action: toolName[{"key":"value"}] or signal_task_complete[]`,
        });
        emptySteps = 0;
        continue;
      }
      if (step === 1) {
        history.push({
          role: 'user',
          content: `NO TOOL! Example: Action: write_file_content[{"path":"result.txt","content":"..."}] Call a tool!`,
        });
      } else {
        history.push({
          role: 'user',
          content: `NO TOOL (step ${step})! Use Action: toolName[{"key":"value"}]`,
        });
      }
      continue;
    }

    emptySteps = 0;

    // ── Execute all actions in sequence, collect results ──
    const stepResults: { tool: string; args: Record<string, unknown>; result: string }[] = [];
    let shouldStop = false;

    for (const action of actions) {
      // Check for signal_task_complete
      if (action.name === Tool.SignalComplete) {
        if (allToolCalls.length === 0) {
          stepResults.push({ tool: action.name, args: action.args, result: 'Cannot signal complete without doing work.' });
          continue;
        }
        shouldStop = true;
        break;
      }

      // Enforce toolsFilter if set
      if (toolsFilter && !toolsFilter.includes(action.name)) {
        stepResults.push({ tool: action.name, args: action.args, result: `Tool "${action.name}" not allowed in this mode.` });
        continue;
      }

      const result = await executeTool(action.name, action.args);

      // Validate result via subagent (fixes format issues, detects errors)
      const validated = await validateToolResult(action.name, action.args, result);
      const finalResult = validated.output;

      stepResults.push({ tool: action.name, args: action.args, result: finalResult });

      // Track created files
      if (action.name === Tool.WriteFile && !finalResult.startsWith('Error') && !finalResult.startsWith('Ошибка')) {
        const filePath = (action.args as Record<string, unknown>)?.path as string;
        if (filePath && !filePath.startsWith('/')) {
          filesCreated.push(filePath);
        }
      }
    }

    // Record all tool calls
    for (const r of stepResults) {
      allToolCalls.push({
        step,
        tool: r.tool,
        args: r.args,
        result: r.result,
        durationMs: 0,
      });
    }

    callbacks?.onStep?.(step, response, stepResults);

    // Fire individual onToolCall for each tool
    for (const r of stepResults) {
      callbacks?.onToolCall?.(step, r.tool, r.args, r.result);
    }

    // Feed all results back as a single observation
    if (stepResults.length > 0) {
      const observations = stepResults
        .map((r, i) => `[${i + 1}] ${r.tool}: ${r.result.substring(0, RESULT_TRUNCATE_LENGTH)}`)
        .join('\n');
      history.push({
        role: 'user',
        content: `Results:\n${observations}\n\nIf the task is done, call signal_task_complete[].`,
      });
    }

    // ── LLM-based search loop detection ──
    // If the agent is stuck searching without writing files, force it to write.
    if (allToolCalls.length > 0 && filesCreated.length === 0 && step >= 5) {
      const isLooping = await classifySearchLoop(prompt, allToolCalls.map(c => ({ tool: c.tool, result: c.result })), filesCreated);
      if (isLooping) {
        history.push({
          role: 'user',
          content: `WARNING: You appear to be stuck in a search loop. You have made ${allToolCalls.length} tool calls without creating any output file. STOP searching immediately. Write your report NOW using write_file_content with whatever information you have gathered. If search results were empty, write the report based on your existing knowledge.`,
        });
        // Give it 2 more steps to write the file, then force-stop
        if (step >= maxSteps - 2) {
          callbacks?.onComplete?.(step);
          return { steps: step, toolCalls: allToolCalls };
        }
      }
    }

    if (shouldStop) {
      callbacks?.onComplete?.(step);
      return { steps: step, toolCalls: allToolCalls };
    }

    // Safety: too many files created
    if (filesCreated.length > 10) {
      callbacks?.onComplete?.(step);
      return { steps: step, toolCalls: allToolCalls };
    }
  }

  callbacks?.onComplete?.(maxSteps);
  return { steps: maxSteps, toolCalls: allToolCalls };
}

// ─── Plan mode: read-only + search only ──────────────────────
// Uses RLM with a toolsFilter to restrict to read/search tools.

export const PLAN_ALLOWED_TOOLS: string[] = [
  Tool.SearchWeb,
  Tool.FetchUrl,
  Tool.ListDir,
  Tool.ReadFile,
  Tool.SearchInFiles,
  Tool.SignalComplete,
];

export async function runPlanLoop(
  prompt: string,
  maxSteps: number = 10,
  callbacks?: RLMCallbacks,
): Promise<{ steps: number; toolCalls: ToolCallRecord[] }> {
  return runRLM(prompt, maxSteps, callbacks, 'plan', PLAN_ALLOWED_TOOLS);
}
