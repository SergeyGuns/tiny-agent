import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Message, ToolCallRecord } from '../types.js';

import { parseAction, parseAllActions } from './parser.js';
import { queryLLM, classifyActions, classifyTaskType, classifySearchLoop, classifyRefactor, classifyNeedsSections } from './llm.js';
import { LLM_PROFILES, LLMProfileName } from './llm.js';
import { BENCH_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT } from './prompt.js';
import { RESULT_TRUNCATE_LENGTH } from './config.js';
import { tools, Tool, PLAN_ALLOWED_TOOLS } from './tools.js';

// ─── ReAct loop callbacks ──────────────────────────────────────

export interface ReActCallbacks {
  onStep?: (step: number, response: string) => void;
  onToolCall?: (step: number, tool: string, args: Record<string, unknown>, result: string) => void;
  onComplete?: (steps: number) => void;
  onContextUpdate?: (messages: Message[]) => void;
}

// ─── ReAct loop ────────────────────────────────────────────────
export async function runReActLoop(
  prompt: string,
  maxSteps: number = 15,
  callbacks?: ReActCallbacks,
  profile: LLMProfileName = 'toolCall',
): Promise<{ steps: number; toolCalls: ToolCallRecord[] }> {
  const history: Message[] = [
    { role: 'system', content: BENCH_SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];
    callbacks?.onContextUpdate?.(history);
  const toolCalls: ToolCallRecord[] = [];
  const filesCreated: string[] = [];
  let lastReadStep = 0;
  let emptySteps = 0;
  let signalCompleteAttempts = 0;

  for (let step = 1; step <= maxSteps; step++) {
    callbacks?.onContextUpdate?.(history);
    let response: string;
    try {
      response = await queryLLM(history, LLM_PROFILES[profile]);
    } catch (e) {
      if (step < maxSteps) {
        history.push({ role: 'user', content: 'LLM returned empty response. Try again.' });
        continue;
      }
      callbacks?.onComplete?.(step);
      return { steps: step, toolCalls };
    }
    history.push({ role: 'assistant', content: response });
    callbacks?.onStep?.(step, response);

    const action = parseAction(response);

    if (action && action.name === Tool.SignalComplete) {
      signalCompleteAttempts++;
      // Don't allow completion without real tool calls — model is skipping work
      if (toolCalls.length === 0 && signalCompleteAttempts < 2) {
        history.push({ role: 'user',
          content: 'You called signal_task_complete without doing any work first. Call a tool to complete the task, or just reply directly if no tools are needed.' });
        continue;
      }
      callbacks?.onComplete?.(step);
      return { steps: step, toolCalls };
    }
    // v12: Natural language completion detection (no LLM call)
    if (!action && filesCreated.length > 0) {
      const r = response.trim();
      if (/^(ЗАДАЧА ВЫПОЛНЕНА|ГОТОВО|ВСЁ СДЕЛАНО|ЗАВЕРШЕНО|COMPLETE|DONE|FINISHED|THAT IS ALL|THAT'S ALL)/i.test(r)
          || /задача (выполнена|сделана|завершена)|task (complete|done|finished)/i.test(r)) {
        callbacks?.onComplete?.(step);
        return { steps: step, toolCalls };
      }
    }

    // If model returned plain text without Action: and no tools were called,
    // treat it as a direct answer (e.g. "Привет!" or simple factual response)
    if (!action && toolCalls.length === 0 && response.trim().length > 0) {
      callbacks?.onComplete?.(step);
      return { steps: step, toolCalls };
    }

    if (!action) {
      emptySteps++;
      // v12: Simple regex-based research detection (no LLM call)
      const isResearch = /найди|поиск|исследу|информац|search|find|look up|research/i.test(prompt);
      if (step <= 2 && emptySteps >= 1 && isResearch) {
        history.push({ role: 'user',
          content: `NO TOOL CALLED! Use: Action: search_web[{"query": "..."}]` });
        emptySteps = 0;
        continue;
      }
      // 3+ empty steps → force writeFile
      if (emptySteps >= 3) {
        history.push({ role: 'user',
          content: `NO TOOL ${emptySteps} steps! Use Action: write_file_content[{"path":"result.txt","content":"..."}]` });
        emptySteps = 0;
        continue;
      }
      // Step 1 no action
      if (step === 1) {
        history.push({ role: 'user',
          content: `NO TOOL! Example: Action: write_file_content[{"path":"result.txt","content":"..."}] Call a tool!` });
      } else {
        history.push({ role: 'user',
          content: `NO TOOL (step ${step})! Use Action: toolName[{"key":"value"}]` });
      }
      continue;
    }
    emptySteps = 0;

    // v12: Research task — push for webSearch on step 1 (regex, no LLM)
    if (step === 1 && filesCreated.length === 0) {
      const isResearch = /найди|поиск|исследу|информац|search|find|look up|research/i.test(prompt);
      if (isResearch && action.name !== Tool.SearchWeb && action.name !== Tool.FetchUrl) {
        const q = prompt.substring(0, 80).replace(/\n/g, ' ');
        history.push({ role: 'user',
          content: `START WITH SEARCH! Action: search_web[{"query": "${q}"}]` });
      }
    }

    if (action.args.error) {
      history.push({ role: 'user', content: 'Observation: argument error.' });
      continue;
    }

    const toolFn = tools[action.name];
    if (!toolFn) {
      history.push({ role: 'user', content: `Observation: tool "${action.name}" not found.` });
      continue;
    }
    // Normalize field names
    if (action.name === Tool.WriteFile) {
      if (!action.args.path && action.args.file) {
        action.args = { ...action.args, path: action.args.file };
        delete action.args.file;
      }
      if (!action.args.path && action.args.filename) {
        action.args = { ...action.args, path: action.args.filename };
        delete action.args.filename;
      }
    }

    const start = Date.now();
    let result: string;
    try {
      result = await toolFn(action.args);
      if (action.name === Tool.QueryLLM && typeof result === 'string') {
        result = result.replace(/^```(?:python|javascript|js|ts|json|html|css|sh|bash|txt|md)?\s*/m, '')
                         .replace(/\s*```$/m, '')
                         .trim();
      }
      if (typeof result !== 'string') result = String(result);
    } catch (e: any) {
      result = `Error: ${e.message?.substring(0, 200)}`;
    }
    const durationMs = Date.now() - start;

    const truncatedResult = result.length > RESULT_TRUNCATE_LENGTH
      ? result.substring(0, RESULT_TRUNCATE_LENGTH) + `\n... [truncated, total ${result.length} chars]`
      : result;

    toolCalls.push({ step, tool: action.name, args: action.args, result, durationMs });
    callbacks?.onToolCall?.(step, action.name, action.args, truncatedResult);

    // v12: Too many searches without write → force write
    const searchCount = toolCalls.filter(c => c.tool === Tool.SearchWeb || c.tool === Tool.FetchUrl).length;
    if (searchCount >= 2 && filesCreated.length === 0 && (action.name === Tool.SearchWeb || action.name === Tool.FetchUrl)) {
      history.push({ role: 'user',
        content: `CRITICAL: After ${searchCount} ${action.name === Tool.FetchUrl ? 'fetch' : 'search'} calls, you MUST immediately write_file_content() to save your results! Do NOT call more tools without writing!` });
    }
    // Force write after fetch (guaranteed to have content)
    if (action.name === Tool.FetchUrl && filesCreated.length === 0) {
      history.push({ role: 'user',
        content: `CRITICAL: fetch_url_content() completed! You MUST NOW write_file_content() to save this content. Do NOT continue searching!` });
    }
    // Long delay without action → force tool
    if (step >= 3 && filesCreated.length === 0 && toolCalls.length === 0) {
      history.push({ role: 'user',
        content: `CRITICAL: Step ${step} with no tool calls! You MUST use a tool NOW! Example: write_file_content or search_web!` });
    }

    // Consecutive error stop
    if (result.startsWith('Error') || result.startsWith('Ошибка') || result.includes(' error')) {
      const recentErrors = toolCalls.slice(-3);
      if (recentErrors.length >= 3 &&
          recentErrors.every(c => c.tool === action.name &&
            (c.result.startsWith('Error') || c.result.startsWith('Ошибка') || c.result.includes(' error')))) {
        callbacks?.onComplete?.(step);
        return { steps: step, toolCalls };
      }
    }

    // Track created files
    if (action.name === Tool.WriteFile && !result.startsWith('Error') && !result.startsWith('Ошибка')) {
      const filePath = (action.args as any).path;
      if (filePath) filesCreated.push(filePath);
      if (filesCreated.length > 6) {
        callbacks?.onComplete?.(step);
        return { steps: step, toolCalls };
      }
      // Refactoring check — detected by LLM classifier
      if (filePath.endsWith('.js')) {
        const isRefactor = await classifyRefactor(prompt, filePath);
        if (isRefactor) {
          try {
            const written = fs.readFileSync(path.resolve(filePath), 'utf-8');
            const oldVar = prompt.match(/"(\w+)"\s*(→|to|в|->)\s*"(\w+)"/);
            if (oldVar && oldVar[1] !== oldVar[3]) {
              const re = new RegExp(`\\b${oldVar[1]}\\b`);
              if (re.test(written)) {
                history.push({ role: 'user',
                  content: `File "${filePath}" still contains "${oldVar[1]}"! Replace ALL "${oldVar[1]}" with "${oldVar[3]}" and write_file_content again!` });
              }
            }
          } catch { /* skip */ }
        }
      }
      // Research report check — detected by LLM classifier
      if (filePath.endsWith('.md') && step < maxSteps - 1) {
        const needsMulti = await classifyNeedsSections(prompt, filePath);
        if (needsMulti) {
          try {
            const written = fs.readFileSync(path.resolve(filePath), 'utf-8');
            const sectionCount = (written.match(/^#{1,3}\s+/gm) || []).length;
            if (sectionCount < 3) {
              history.push({ role: 'user',
                content: `File "${filePath}" has only ${sectionCount} sections! The task requires multiple sections. Add MISSING sections!` });
            }
          } catch { /* skip */ }
        }
      }
    }
    // v12: Detect writeFile loop — same path written 3+ times without success
    if (action.name === Tool.WriteFile && result.startsWith('Error')) {
      const filePath = (action.args as any).path;
      const samePathErrors = toolCalls.filter(c => c.tool === Tool.WriteFile && c.args?.path === filePath && c.result.startsWith('Error')).length;
      if (samePathErrors >= 2) {
        history.push({ role: 'user',
          content: `STOP! "${filePath}" failed ${samePathErrors} times! Use SHORTER content (under 300 chars) or write to a different file!` });
      }
    }
    if (action.name === Tool.ListDir || action.name === Tool.ReadFile) {
      lastReadStep = step;
    }

    // v12: Read-without-write nudges (simplified, no LLM)
    const readFileCount = toolCalls.filter(c => c.tool === Tool.ReadFile).length;
    if (readFileCount >= 1 && filesCreated.length === 0 && action.name === Tool.ReadFile && step >= 2) {
      const readPaths = toolCalls.filter(c => c.tool === Tool.ReadFile).map(c => c.args?.path).filter(Boolean);
      history.push({ role: 'user',
        content: `Read (${readPaths.join(', ')}) but NO write! Use write_file_content to save result! STOP reading!` });
    }
    if (readFileCount >= 3 && filesCreated.length === 0 && action.name === Tool.ReadFile) {
      history.push({ role: 'user',
        content: `Read ${readFileCount} files but NO write! MERGE data and write_file_content NOW!` });
    }
    // Read without subsequent write
    if (lastReadStep > 0 && step - lastReadStep >= 1 && filesCreated.length === 0) {
      const lastReadCall = toolCalls.filter(c => c.tool === Tool.ListDir || c.tool === Tool.ReadFile).pop();
      const readTarget = lastReadCall?.args?.path || '';
      history.push({ role: 'user',
        content: `Read "${readTarget}" — NOW write result via write_file_content! STOP reading!` });
      lastReadStep = 0;
    }
    // Step 3+ with reads but 0 writes
    if (step >= 3 && filesCreated.length === 0 && (action.name === Tool.ListDir || action.name === Tool.ReadFile)) {
      history.push({ role: 'user',
        content: `Step ${step}, files created: 0. You only read, never write. Use write_file_content NOW.` });
      lastReadStep = 0;
    }


    history.push({ role: 'user', content: `Observation: ${truncatedResult}` });
  }

  // v12: Post-loop — if files were read but nothing written, force one more step
  const totalReads = toolCalls.filter(c => c.tool === Tool.ReadFile || c.tool === Tool.ListDir).length;
  if (totalReads >= 2 && filesCreated.length === 0) {
    const readPaths = toolCalls.filter(c => c.tool === Tool.ReadFile).map(c => c.args?.path).filter(Boolean);
    history.push({ role: 'user',
      content: `WARNING: read ${totalReads} files (${readPaths.join(', ')}) but NO write! Use write_file_content NOW! Last step!` });
    callbacks?.onContextUpdate?.(history);
    let finalResponse: string;
    try {
      finalResponse = await queryLLM(history, LLM_PROFILES[profile]);
    } catch (e) {
      callbacks?.onComplete?.(maxSteps);
      return { steps: maxSteps, toolCalls };
    }
    history.push({ role: 'assistant', content: finalResponse });
    const finalAction = parseAction(finalResponse);
    if (finalAction) {
      const toolFn = tools[finalAction.name];
      if (toolFn) {
        try {
          const finalResult = await toolFn(finalAction.args);
          toolCalls.push({ step: maxSteps + 1, tool: finalAction.name, args: finalAction.args, result: finalResult, durationMs: 0 });
          if (finalAction.name === Tool.WriteFile && !finalResult.startsWith('Error') && !finalResult.startsWith('Ошибка')) {
            const filePath = (finalAction.args as any).path;
            if (filePath) filesCreated.push(filePath);
          }
        } catch { /* failed */ }
      }
    }
  }

  callbacks?.onComplete?.(maxSteps);
  return { steps: maxSteps, toolCalls };
}

// ─── Plan mode: read-only + search only ──────────────────────

export async function runPlanLoop(
  prompt: string,
  maxSteps: number = 10,
  callbacks?: ReActCallbacks,
): Promise<{ steps: number; toolCalls: ToolCallRecord[] }> {
  const history: Message[] = [
    { role: 'system', content: PLAN_SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];
  callbacks?.onContextUpdate?.(history);
  const toolCalls: ToolCallRecord[] = [];
  let emptySteps = 0;

  for (let step = 1; step <= maxSteps; step++) {
    callbacks?.onContextUpdate?.(history);
    let response: string;
    try {
      response = await queryLLM(history, {
        ...LLM_PROFILES.plan,
        toolsFilter: PLAN_ALLOWED_TOOLS,
      });
    } catch (e) {
      if (step < maxSteps) {
        history.push({ role: 'user', content: 'LLM returned empty response. Try again.' });
        continue;
      }
      callbacks?.onComplete?.(step);
      return { steps: step, toolCalls };
    }
    history.push({ role: 'assistant', content: response });
    callbacks?.onStep?.(step, response);

    const action = parseAction(response);

    if (action && action.name === Tool.SignalComplete) {
      callbacks?.onComplete?.(step);
      return { steps: step, toolCalls };
    }

    // Natural language completion detection
    if (!action) {
      const r = response.trim();
      if (/^(ЗАДАЧА ВЫПОЛНЕНА|ГОТОВО|ВСЁ СДЕЛАНО|ЗАВЕРШЕНО|COMPLETE|DONE|FINISHED|THAT IS ALL|THAT'S ALL)/i.test(r)
          || /задача (выполнена|сделана|завершена)|task (complete|done|finished)/i.test(r)) {
        callbacks?.onComplete?.(step);
        return { steps: step, toolCalls };
      }
      // Plain text response — treat as direct answer
      if (toolCalls.length === 0 && r.length > 0) {
        callbacks?.onComplete?.(step);
        return { steps: step, toolCalls };
      }
    }

    if (!action) {
      emptySteps++;
      if (emptySteps >= 3) {
        history.push({ role: 'user',
          content: `NO TOOL ${emptySteps} steps! Use Action: search_web[{"query":"..."}] or signal_task_complete[]` });
        emptySteps = 0;
        continue;
      }
      if (step === 1) {
        history.push({ role: 'user',
          content: `NO TOOL! Use: Action: search_web[{"query":"..."}] or read_file_content[{"path":"..."}]` });
      } else {
        history.push({ role: 'user',
          content: `NO TOOL (step ${step})! Use a read/search tool or signal_task_complete[]` });
      }
      continue;
    }
    emptySteps = 0;

    // Enforce allowed tools — block write/execute
    if (!PLAN_ALLOWED_TOOLS.includes(action.name as Tool)) {
      history.push({ role: 'user',
        content: `FORBIDDEN in plan mode: "${action.name}". Allowed: ${PLAN_ALLOWED_TOOLS.join(', ')}` });
      continue;
    }

    const toolFn = tools[action.name];
    if (!toolFn) {
      history.push({ role: 'user', content: `Tool "${action.name}" not found.` });
      continue;
    }

    const start = Date.now();
    let result: string;
    try {
      result = await toolFn(action.args);
      if (typeof result !== 'string') result = String(result);
    } catch (e: any) {
      result = `Error: ${e.message?.substring(0, 200)}`;
    }
    const durationMs = Date.now() - start;

    toolCalls.push({ step, tool: action.name, args: action.args, result, durationMs });
    callbacks?.onToolCall?.(step, action.name, action.args, result);

    history.push({ role: 'user', content: `Observation: ${result}` });
  }

  callbacks?.onComplete?.(maxSteps);
  return { steps: maxSteps, toolCalls };
}

// ─── RLM Agent Loop ───────────────────────────────────────────
// Multi-action: model can call multiple tools per turn.
// All results are fed back as a single batch observation.

export async function runAgentLoop(
  prompt: string,
  maxSteps: number = 15,
  callbacks?: ReActCallbacks,
  profile: LLMProfileName = 'toolCall',
  toolsFilter?: string[],
): Promise<{ steps: number; toolCalls: ToolCallRecord[] }> {
  const history: Message[] = [
    { role: 'system', content: BENCH_SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];
  callbacks?.onContextUpdate?.(history);
  const toolCalls: ToolCallRecord[] = [];
  const filesCreated: string[] = [];
  let emptySteps = 0;

  // Classifier cache — populated lazily on first use
  let taskTypeCache: Awaited<ReturnType<typeof classifyTaskType>> | null = null;
  const taskTypePromise = classifyTaskType(prompt).then(r => { taskTypeCache = r; return r; });

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
      return { steps: step, toolCalls };
    }
    history.push({ role: 'assistant', content: response });
    callbacks?.onStep?.(step, response);

    // Parse ALL actions from the response
    const actions = parseAllActions(response);

    // Check for signal_task_complete in any action
    const hasSignalComplete = actions.some(a => a.name === Tool.SignalComplete);

    // Natural language completion detection (no action, but files created)
    if (actions.length === 0 && filesCreated.length > 0) {
      const r = response.trim();
      if (/^(ЗАДАЧА ВЫПОЛНЕНА|ГОТОВО|ВСЁ СДЕЛАНО|ЗАВЕРШЕНО|COMPLETE|DONE|FINISHED|THAT IS ALL|THAT'S ALL)/i.test(r)
          || /задача (выполнена|сделана|завершена)|task (complete|done|finished)/i.test(r)) {
        callbacks?.onComplete?.(step);
        return { steps: step, toolCalls };
      }
    }

    // Plain text response without actions and no tools called → direct answer
    if (actions.length === 0 && toolCalls.length === 0 && response.trim().length > 0) {
      callbacks?.onComplete?.(step);
      return { steps: step, toolCalls };
    }

    // No actions parsed → try classifier to recover
    if (actions.length === 0) {
      emptySteps++;

      // Try classifier on 2nd+ empty step (give model one chance to self-correct)
      if (emptySteps >= 2 && response.trim().length > 20) {
        const classified = await classifyActions(prompt, response, step);
        if (classified.actions.length > 0) {
          // Use classifier's suggested actions as nudged actions
          console.log(`    [classifier] recovered ${classified.actions.length} action(s) from reasoning`);
          // Execute classified actions directly
          const stepResults: { tool: string; args: Record<string, unknown>; result: string }[] = [];
          for (const action of classified.actions) {
            if (toolsFilter && !toolsFilter.includes(action.name)) {
              stepResults.push({ tool: action.name, args: action.args, result: `FORBIDDEN: tool "${action.name}" not allowed.` });
              continue;
            }
            if (action.name === Tool.SignalComplete) {
              if (toolCalls.length === 0) {
                stepResults.push({ tool: action.name, args: action.args, result: 'Cannot signal complete without work.' });
                continue;
              }
              // Execute all step results then stop
              for (const r of stepResults) {
                toolCalls.push({ step, tool: r.tool, args: r.args, result: r.result, durationMs: 0 });
                callbacks?.onToolCall?.(step, r.tool, r.args, r.result);
              }
              callbacks?.onComplete?.(step);
              return { steps: step, toolCalls };
            }
            const toolFn = tools[action.name];
            if (!toolFn) {
              stepResults.push({ tool: action.name, args: action.args, result: `Tool "${action.name}" not found.` });
              continue;
            }
            const start = Date.now();
            let result: string;
            try {
              result = await toolFn(action.args);
              if (typeof result !== 'string') result = String(result);
            } catch (e: any) {
              result = `Error: ${e.message?.substring(0, 200)}`;
            }
            const durationMs = Date.now() - start;
            const truncatedResult = result.length > RESULT_TRUNCATE_LENGTH
              ? result.substring(0, RESULT_TRUNCATE_LENGTH) + `\n... [truncated, total ${result.length} chars]`
              : result;
            toolCalls.push({ step, tool: action.name, args: action.args, result, durationMs });
            stepResults.push({ tool: action.name, args: action.args, result: truncatedResult });
            callbacks?.onToolCall?.(step, action.name, action.args, truncatedResult);
            if (action.name === Tool.WriteFile && !result.startsWith('Error')) {
              const filePath = (action.args as any).path;
              if (filePath) filesCreated.push(filePath);
            }
          }
          // Feed results back
          if (stepResults.length > 0) {
            const observations = stepResults.map((r, i) => `[${i + 1}] ${r.tool}: ${r.result}`).join('\n');
            history.push({ role: 'user', content: `Results:\n${observations}\n\nContinue or call signal_task_complete[].` });
          }
          emptySteps = 0;
          continue;
        }
      }

      // Fallback: standard nudge
      const taskType = taskTypeCache ?? await taskTypePromise;
      if (step <= 2 && emptySteps >= 1 && taskType.isResearch) {
        history.push({ role: 'user',
          content: `NO TOOL CALLED! Use: Action: search_web[{"query": "..."}]` });
        emptySteps = 0;
        continue;
      }
      if (emptySteps >= 4) {
        history.push({ role: 'user',
          content: `NO TOOL ${emptySteps} steps! Use Action: write_file_content[{"path":"result.txt","content":"..."}]` });
        emptySteps = 0;
        continue;
      }
      if (step === 1) {
        history.push({ role: 'user',
          content: `NO TOOL! Example: Action: write_file_content[{"path":"result.txt","content":"..."}] Call a tool!` });
      } else {
        history.push({ role: 'user',
          content: `NO TOOL (step ${step})! Use Action: toolName[{"key":"value"}]` });
      }
      continue;
    }
    emptySteps = 0;

    // Execute all actions in sequence, collect results
    const stepResults: { tool: string; args: Record<string, unknown>; result: string }[] = [];
    let shouldStop = false;

    for (const action of actions) {
      // Enforce toolsFilter
      if (toolsFilter && !toolsFilter.includes(action.name)) {
        stepResults.push({ tool: action.name, args: action.args, result: `FORBIDDEN: tool "${action.name}" not allowed in this mode.` });
        continue;
      }

      // Normalize field names for write_file_content
      if (action.name === Tool.WriteFile) {
        if (!action.args.path && action.args.file) {
          action.args = { ...action.args, path: action.args.file };
          delete action.args.file;
        }
        if (!action.args.path && action.args.filename) {
          action.args = { ...action.args, path: action.args.filename };
          delete action.args.filename;
        }
      }

      if (action.name === Tool.SignalComplete) {
        // Don't allow completion without real work
        if (toolCalls.length === 0) {
          stepResults.push({ tool: action.name, args: action.args, result: 'Cannot signal complete without doing work first.' });
          continue;
        }
        shouldStop = true;
        break;
      }

      if (action.args.error) {
        stepResults.push({ tool: action.name, args: action.args, result: 'Observation: argument error.' });
        continue;
      }

      const toolFn = tools[action.name];
      if (!toolFn) {
        stepResults.push({ tool: action.name, args: action.args, result: `Tool "${action.name}" not found.` });
        continue;
      }

      const start = Date.now();
      let result: string;
      try {
        result = await toolFn(action.args);
        if (action.name === Tool.QueryLLM && typeof result === 'string') {
          result = result.replace(/^```(?:python|javascript|js|ts|json|html|css|sh|bash|txt|md)?\s*/m, '')
                         .replace(/\s*```$/m, '')
                         .trim();
        }
        if (typeof result !== 'string') result = String(result);
      } catch (e: any) {
        result = `Error: ${e.message?.substring(0, 200)}`;
      }
      const durationMs = Date.now() - start;

      const truncatedResult = result.length > RESULT_TRUNCATE_LENGTH
        ? result.substring(0, RESULT_TRUNCATE_LENGTH) + `\n... [truncated, total ${result.length} chars]`
        : result;

      toolCalls.push({ step, tool: action.name, args: action.args, result, durationMs });
      stepResults.push({ tool: action.name, args: action.args, result: truncatedResult });
      callbacks?.onToolCall?.(step, action.name, action.args, truncatedResult);

      // Track created files
      if (action.name === Tool.WriteFile && !result.startsWith('Error') && !result.startsWith('Ошибка')) {
        const filePath = (action.args as any).path;
        if (filePath) filesCreated.push(filePath);
      }
    }

    // Feed all results back as a single batch observation
    if (stepResults.length > 0) {
      const observations = stepResults
        .map((r, i) => `[${i + 1}] ${r.tool}: ${r.result}`)
        .join('\n');
      history.push({
        role: 'user',
        content: `Results:\n${observations}\n\nIf the task is complete, call signal_task_complete[]. Otherwise continue with the next actions.`,
      });
    }

    if (shouldStop) {
      callbacks?.onComplete?.(step);
      return { steps: step, toolCalls };
    }

    // ─── Nudges (adapted for multi-action) ───────────────────

    // Search loop: detected by LLM classifier
    if (filesCreated.length === 0 && toolCalls.filter(c => c.tool === Tool.SearchWeb || c.tool === Tool.FetchUrl).length >= 2) {
      const hasWriteInStep = stepResults.some(r => r.tool === Tool.WriteFile);
      if (!hasWriteInStep) {
        const isLoop = await classifySearchLoop(prompt, toolCalls, filesCreated);
        if (isLoop) {
          history.push({ role: 'user',
            content: `CRITICAL: You are stuck in a search loop! You MUST write_file_content() to save results! Do NOT search more!` });
        }
      }
    }

    // Fetch without write in same step
    const hasFetch = stepResults.some(r => r.tool === Tool.FetchUrl);
    const hasWrite = stepResults.some(r => r.tool === Tool.WriteFile);
    if (hasFetch && !hasWrite && filesCreated.length === 0) {
      history.push({ role: 'user',
        content: `CRITICAL: fetch_url_content() completed! You MUST NOW write_file_content() to save this content. Do NOT continue searching!` });
    }

    // Read without write
    const readCount = toolCalls.filter(c => c.tool === Tool.ReadFile).length;
    if (readCount >= 2 && filesCreated.length === 0) {
      const hasWriteInStep2 = stepResults.some(r => r.tool === Tool.WriteFile);
      if (!hasWriteInStep2) {
        history.push({ role: 'user',
          content: `CRITICAL: Read ${readCount} files but NO write! MERGE data and write_file_content NOW!` });
      }
    }

    // Detect empty writes — model wrote empty content
    for (const r of stepResults) {
      if (r.tool === Tool.WriteFile && (r.args as any).content === '') {
        history.push({ role: 'user',
          content: `WARNING: You wrote empty content to "${(r.args as any).path}". Fill it with actual data!` });
      }
    }

    // Too many files → stop
    if (filesCreated.length > 6) {
      callbacks?.onComplete?.(step);
      return { steps: step, toolCalls };
    }

    // Consecutive error stop
    const recentErrors = toolCalls.slice(-3);
    if (recentErrors.length >= 3 && recentErrors.every(c =>
      c.result.startsWith('Error') || c.result.startsWith('Ошибка') || c.result.includes(' error'))) {
      callbacks?.onComplete?.(step);
      return { steps: step, toolCalls };
    }
  }

  callbacks?.onComplete?.(maxSteps);
  return { steps: maxSteps, toolCalls };
}
