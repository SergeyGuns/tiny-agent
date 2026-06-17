import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Message, ToolCallRecord } from '../types.js';

import { parseAction } from './parser.js';
import { queryLLM } from './llm.js';
import { LLM_PROFILES, LLMProfileName } from './llm.js';
import { BENCH_SYSTEM_PROMPT } from './prompt.js';
import { RESULT_TRUNCATE_LENGTH } from './config.js';

// ─── ReAct loop callbacks ──────────────────────────────────────

export interface ReActCallbacks {
  onStep?: (step: number, response: string) => void;
  onToolCall?: (step: number, tool: string, args: Record<string, unknown>, result: string) => void;
  onComplete?: (steps: number) => void;
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
  const toolCalls: ToolCallRecord[] = [];
  const filesCreated: string[] = [];
  let lastReadStep = 0;
  let emptySteps = 0;

  for (let step = 1; step <= maxSteps; step++) {
    const response = await queryLLM(history, LLM_PROFILES[profile]);
    history.push({ role: 'assistant', content: response });
    callbacks?.onStep?.(step, response);

    const action = parseAction(response);

    // v12: Fast DONE detection
    if (action && action.name === 'signal_task_complete') {
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
      if (isResearch && action.name !== 'search_web' && action.name !== 'fetch_url_content') {
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
    if (action.name === 'write_file_content') {
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
      if (action.name === 'query_language_model' && typeof result === 'string') {
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
    const searchCount = toolCalls.filter(c => c.tool === 'search_web' || c.tool === 'fetch_url_content').length;
    if (searchCount >= 2 && filesCreated.length === 0 && (action.name === 'search_web' || action.name === 'fetch_url_content')) {
      history.push({ role: 'user',
        content: `CRITICAL: After ${searchCount} ${action.name === 'fetch_url_content' ? 'fetch' : 'search'} calls, you MUST immediately write_file_content() to save your results! Do NOT call more tools without writing!` });
    }
    // Force write after fetch (guaranteed to have content)
    if (action.name === 'fetch_url_content' && filesCreated.length === 0) {
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
    if (action.name === 'write_file_content' && !result.startsWith('Error') && !result.startsWith('Ошибка')) {
      const filePath = (action.args as any).path;
      if (filePath) filesCreated.push(filePath);
      if (filesCreated.length > 6) {
        callbacks?.onComplete?.(step);
        return { steps: step, toolCalls };
      }
      // v12: Refactoring check — if task mentions rename/replace, verify result
      const needsRefactor = /переимен|rename|refactor|replace|замени/i.test(prompt);
      if (needsRefactor && filePath.endsWith('.js')) {
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
      // v12: Research report check — if task asks for multiple sections, verify
      const needsMultipleSections = /##|раздел|section|сравн|анализ/i.test(prompt) && filePath.endsWith('.md');
      if (needsMultipleSections && step < maxSteps - 1) {
        try {
          const written = fs.readFileSync(path.resolve(filePath), 'utf-8');
          const sectionCount = (written.match(/^#{1,3}\s+/gm) || []).length;
          const expectedSections = (prompt.match(/##|раздел|section/gi) || []).length;
          if (sectionCount < Math.min(expectedSections, 3)) {
            history.push({ role: 'user',
              content: `File "${filePath}" has only ${sectionCount} sections! The task requires sections like: Основные различия, Преимущества, Вывод. Add MISSING sections!` });
          }
        } catch { /* skip */ }
      }
    }
    // v12: Detect writeFile loop — same path written 3+ times without success
    if (action.name === 'write_file_content' && result.startsWith('Error')) {
      const filePath = (action.args as any).path;
      const samePathErrors = toolCalls.filter(c => c.tool === 'write_file_content' && c.args?.path === filePath && c.result.startsWith('Error')).length;
      if (samePathErrors >= 2) {
        history.push({ role: 'user',
          content: `STOP! "${filePath}" failed ${samePathErrors} times! Use SHORTER content (under 300 chars) or write to a different file!` });
      }
    }
    if (action.name === 'list_directory' || action.name === 'read_file_content') {
      lastReadStep = step;
    }

    // v12: Read-without-write nudges (simplified, no LLM)
    const readFileCount = toolCalls.filter(c => c.tool === 'read_file_content').length;
    if (readFileCount >= 1 && filesCreated.length === 0 && action.name === 'read_file_content' && step >= 2) {
      const readPaths = toolCalls.filter(c => c.tool === 'read_file_content').map(c => c.args?.path).filter(Boolean);
      history.push({ role: 'user',
        content: `Read (${readPaths.join(', ')}) but NO write! Use write_file_content to save result! STOP reading!` });
    }
    if (readFileCount >= 3 && filesCreated.length === 0 && action.name === 'read_file_content') {
      history.push({ role: 'user',
        content: `Read ${readFileCount} files but NO write! MERGE data and write_file_content NOW!` });
    }
    // Read without subsequent write
    if (lastReadStep > 0 && step - lastReadStep >= 1 && filesCreated.length === 0) {
      const lastReadCall = toolCalls.filter(c => c.tool === 'list_directory' || c.tool === 'read_file_content').pop();
      const readTarget = lastReadCall?.args?.path || '';
      history.push({ role: 'user',
        content: `Read "${readTarget}" — NOW write result via write_file_content! STOP reading!` });
      lastReadStep = 0;
    }
    // Step 3+ with reads but 0 writes
    if (step >= 3 && filesCreated.length === 0 && (action.name === 'list_directory' || action.name === 'read_file_content')) {
      history.push({ role: 'user',
        content: `Step ${step}, files created: 0. You only read, never write. Use write_file_content NOW.` });
      lastReadStep = 0;
    }


    history.push({ role: 'user', content: `Observation: ${truncatedResult}` });
  }

  // v12: Post-loop — if files were read but nothing written, force one more step
  const totalReads = toolCalls.filter(c => c.tool === 'read_file_content' || c.tool === 'list_directory').length;
  if (totalReads >= 2 && filesCreated.length === 0) {
    const readPaths = toolCalls.filter(c => c.tool === 'read_file_content').map(c => c.args?.path).filter(Boolean);
    history.push({ role: 'user',
      content: `WARNING: read ${totalReads} files (${readPaths.join(', ')}) but NO write! Use write_file_content NOW! Last step!` });
    const finalResponse = await queryLLM(history, LLM_PROFILES[profile]);
    history.push({ role: 'assistant', content: finalResponse });
    const finalAction = parseAction(finalResponse);
    if (finalAction) {
      const toolFn = tools[finalAction.name];
      if (toolFn) {
        try {
          const finalResult = await toolFn(finalAction.args);
          toolCalls.push({ step: maxSteps + 1, tool: finalAction.name, args: finalAction.args, result: finalResult, durationMs: 0 });
          if (finalAction.name === 'write_file_content' && !finalResult.startsWith('Error') && !finalResult.startsWith('Ошибка')) {
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
