// ─── rlm.ts — Recursive Language Model executor ──────────
// Based on https://alexzhang13.github.io/blog/2025/rlm/
// Key idea: model decides how many tool calls to make per turn.
// We aggregate all results and feed them back as a batch.
// ─────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Message, ToolCallRecord } from '../types.js';
import { tools } from './tools.js';
import { parseAction } from './parser.js';
import { queryLLM } from './llm.js';
import { LLM_PROFILES, LLMProfileName } from './llm.js';
import { BENCH_SYSTEM_PROMPT } from './prompt.js';
import { RESULT_TRUNCATE_LENGTH } from './config.js';

// ─── Callbacks ───────────────────────────────────────────
export interface RLMCallbacks {
  onStep?: (step: number, calls: { tool: string; args: Record<string, unknown>; result: string }[]) => void;
  onComplete?: (steps: number) => void;
}

// ─── Parse multiple actions from a single response ────────
function parseAllActions(text: string): { name: string; args: Record<string, unknown> }[] {
  const actions: { name: string; args: Record<string, unknown> }[] = [];

  // Try to find all Action: toolName[...] patterns
  const actionRegex = /Action:\s*(\w+)\[([\s\S]*?)\](?=\s*Action:|$)/g;
  let match;
  while ((match = actionRegex.exec(text)) !== null) {
    try {
      const argsStr = match[2].trim();
      const args = argsStr ? JSON.parse(argsStr) : {};
      actions.push({ name: match[1].trim(), args });
    } catch {
      // Try lenient recovery for write_file_content with unescaped content
      if (match[1].trim() === 'write_file_content') {
        const recovered = parseWriteFileArgs(match[2].trim());
        if (recovered) actions.push({ name: 'write_file_content', args: recovered });
      }
    }
  }

  // If no Action: prefix found, try single action without prefix
  if (actions.length === 0) {
    const single = parseAction(text);
    if (single) actions.push(single);
  }

  return actions;
}

// ─── Lenient writeFile args parser (reused from parser.ts) ───
function parseWriteFileArgs(raw: string): Record<string, unknown> | null {
  const pathKeys = ['"path"', '"file"', '"filename"'];
  let filePath: string | null = null;
  for (const key of pathKeys) {
    const m = raw.match(new RegExp(key + '\\s*:\\s*"([^"]+)"'));
    if (m) { filePath = m[1]; }
  }
  if (!filePath) return null;

  const contentKeyIdx = raw.indexOf('"content"');
  if (contentKeyIdx === -1) return null;

  const afterKey = raw.slice(contentKeyIdx + '"content"'.length);
  const colonIdx = afterKey.indexOf(':');
  if (colonIdx === -1) return null;
  const afterColon = afterKey.slice(colonIdx + 1).trim();
  if (!afterColon.startsWith('"')) return null;

  const openingQuotePos = raw.indexOf('"', contentKeyIdx + '"content"'.length + colonIdx + 1);
  if (openingQuotePos === -1) return null;

  const lastBracket = raw.lastIndexOf(']');
  const searchEnd = lastBracket > 0 ? lastBracket : raw.length;
  let endQuotePos = -1;
  for (let i = searchEnd - 1; i > openingQuotePos; i--) {
    if (raw[i] === '"') { endQuotePos = i; break; }
  }
  if (endQuotePos === -1) return null;

  let content = raw.slice(openingQuotePos + 1, endQuotePos);
  content = content.replace(/\\"/g, '"').replace(/\\n/g, '\n');
  return { path: filePath, content };
}

// ─── Execute a single tool call ─────────────────────────────
async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  // Reject absolute paths for write_file_content
  if (toolName === 'write_file_content') {
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
  maxSteps: number = 10,
  callbacks?: RLMCallbacks,
  profile: LLMProfileName = 'rlm',
): Promise<{ steps: number; toolCalls: ToolCallRecord[] }> {
  const history: Message[] = [
    { role: 'system', content: BENCH_SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];
  const allToolCalls: ToolCallRecord[] = [];
  const filesCreated: string[] = [];

  for (let step = 1; step <= maxSteps; step++) {
    const response = await queryLLM(history, LLM_PROFILES[profile]);
    history.push({ role: 'assistant', content: response });

    // Parse ALL actions from the response
    const actions = parseAllActions(response);

    if (actions.length === 0) {
      // No action — nudge the model
      history.push({
        role: 'user',
        content: 'NO TOOL CALLED! Use: Action: toolName[{"key":"value"}]',
      });
      continue;
    }

    // Execute all actions in sequence, collect results
    const stepResults: { tool: string; args: Record<string, unknown>; result: string }[] = [];
    let shouldStop = false;

    for (const action of actions) {
      // Check for signal_task_complete
      if (action.name === 'signal_task_complete') {
        shouldStop = true;
        break;
      }

      const result = await executeTool(action.name, action.args);
      stepResults.push({ tool: action.name, args: action.args, result });

      // Track created files
      if (action.name === 'write_file_content' && !result.startsWith('Error')) {
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

    callbacks?.onStep?.(step, stepResults);

    // Feed all results back as a single observation
    if (stepResults.length > 0) {
      const observations = stepResults
        .map((r, i) => `[${i + 1}] ${r.tool}: ${r.result.substring(0, RESULT_TRUNCATE_LENGTH)}`)
        .join('\n');
      history.push({
        role: 'user',
        content: `Results:\n${observations}\n\nCRITICAL: If you performed fetch_url_content(), you MUST immediately write_file_content() after. Task complete? Then signal_task_complete[].`,
      });
    }

    if (shouldStop) {
      callbacks?.onComplete?.(step);
      return { steps: step, toolCalls: allToolCalls };
    }

    // Nudge: if too many files created, stop
    if (filesCreated.length > 10) {
      callbacks?.onComplete?.(step);
      return { steps: step, toolCalls: allToolCalls };
    }

    // Nudge: if no action in step, force model to call tool
    if (allToolCalls.length === 0) {
      history.push({
        role: 'user',
        content: 'CRITICAL: No tool calls in this step! You MUST make at least one tool call. Use search_web, fetch_url_content, read_file_content, write_file_content, or signal_task_complete[].',
      });
    }

    // Nudge: if fetch_url_content called but no write_file_content, force it
    if (stepResults.some(r => r.tool === 'fetch_url_content') && !stepResults.some(r => r.tool === 'write_file_content')) {
      history.push({
        role: 'user',
        content: 'CRITICAL: You called fetch_url_content() but no write_file_content! You MUST write the content to a file after fetch_url_content().',
      });
    }

    // Nudge: if validation done but no report, force report file
    if (stepResults.some(r => r.tool === 'write_file_content' && r.result.includes('JSON')) && !stepResults.some(r => r.result.includes('report.txt'))) {
      history.push({
        role: 'user',
        content: 'CRITICAL: You validated/processed JSON but no report file! Create report.txt with summary and signal_task_complete[].',
      });
    }
  }

  callbacks?.onComplete?.(maxSteps);
  return { steps: maxSteps, toolCalls: allToolCalls };
}
