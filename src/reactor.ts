import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Message, ToolCallRecord } from '../types.js';
import type { ToolFunction } from '../types.js';
import { tools } from './tools.js';
import { parseAction } from './parser.js';
import { queryLLM } from './llm.js';
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
): Promise<{ steps: number; toolCalls: ToolCallRecord[] }> {
  const history: Message[] = [
    { role: 'system', content: BENCH_SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];
  const toolCalls: ToolCallRecord[] = [];
  const filesCreated: string[] = [];
  let lastSummaryAt = 0;
  let lastReadStep = 0;
  let emptySteps = 0;
  let consecutiveCompletes = 0;

  for (let step = 1; step <= maxSteps; step++) {
    const userPrompt = history.length > 1 ? history[1].content || '' : '';
    const response = await queryLLM(history);
    history.push({ role: 'assistant', content: response });
    callbacks?.onStep?.(step, response);

    const action = parseAction(response);

    // v12: Detect STOP/done signals from thinking models
    const isStopSignal = /\b(STOP|DONE|COMPLETE|FINISHED|ЗАВЕРШЕНО|ГОТОВО)\b/i.test(response) ||
                         /task\s+(is\s+)?(done|complete|finished)/i.test(response) ||
                         /^Action:\s*(STOP|DONE|COMPLETE|FINISHED)/i.test(response.trim());
    if (isStopSignal && filesCreated.length > 0) {
      callbacks?.onComplete?.(step);
      return { steps: step, toolCalls };
    }

    // v10: Detect completion phrases
    if (filesCreated.length > 0) {
      const isCompleting = await classifyPrompt(response,
        'Is the agent signaling that the task is done or complete (e.g. saying "ready", "done", "completed", "finished")?');
      if (isCompleting) {
        consecutiveCompletes++;
        if (consecutiveCompletes >= 2) {
          callbacks?.onComplete?.(step);
          return { steps: step, toolCalls };
        }
      } else {
        consecutiveCompletes = 0;
      }
    }

    if (!action) {
      emptySteps++;

      // v10c-fix: Research task with NO Action on early steps — strong nudge with example
      if (step <= 2 && emptySteps >= 1) {
        const isResearchTask = await isResearchPrompt(userPrompt);
        if (isResearchTask) {
          history.push({ role: 'user',
            content: `ВНИМАНИЕ! Вы НЕ вызвали инструмент! НЕМЕДЛЕННО вызовите инструмент! Пример: Action: webSearch[{"query": "Docker vs Podman differences"}]  Используйте-webSearch!` });
          emptySteps = 0;
          continue;
        }
      }

      // 3+ empty steps → force writeFile
      if (emptySteps >= 3) {
        history.push({ role: 'user',
          content: `ВНИМАНИЕ: вы уже ${emptySteps} шага не вызываете инструмент! Немедленно выполните действие через Action: writeFile!` });
        emptySteps = 0;
        continue;
      }

      // Step 1 with no Action at all — push with concrete example
      if (step === 1) {
        history.push({ role: 'user',
          content: `Вы не вызвали инструмент! Пример: Action: webSearch[{"query": "Docker vs Podman differences"}]  Action: writeFile[{"path": "result.txt", "content": "..."}]  Вызовите инструмент!` });
      } else {
        const noActionPush = step <= 5
          ? `Вы не вызвали инструмент (шаг ${step})! Используйте формат: Action: [{"ключ": "значение"}].  Например writeFile!`
          : `Вы не вызвали инструмент (шаг ${step})!  Используйте writeFile!`;
        history.push({ role: 'user', content: noActionPush });
      }
      continue;
    }
    emptySteps = 0;

    // v10c: Research task detected — push for immediate webSearch on step 1
    if (step === 1 && filesCreated.length === 0) {
      if (await isResearchPrompt(userPrompt) && action.name !== 'webSearch' && action.name !== 'fetch') {
        const searchQuery = userPrompt.substring(0, 100).replace(/\n/g, ' ');
        history.push({ role: 'user',
          content: `ВНИМАНИЕ! Начните с поиска! Используйте: Action: webSearch[{"query": "${searchQuery}"}]  НЕ читайте файлы — сначала поиск!` });
      }
    }

    if (action.args.error) {
      history.push({ role: 'user', content: 'Observation: ошибка в аргументах.' });
      continue;
    }

    const toolFn = tools[action.name];
    if (!toolFn) {
      history.push({ role: 'user', content: `Observation: инструмент "${action.name}" не найден.` });
      continue;
    }
    // [A3b] Normalize field names → expected tool args
    if (action.name === 'writeFile') {
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
      // [A3a] Strip markdown code fences from rlm output
      if (action.name === 'rlm' && typeof result === 'string') {
        result = result.replace(/^```(?:python|javascript|js|ts|json|html|css|sh|bash|txt|md)?\s*/m, '')
                         .replace(/\s*```$/m, '')
                         .trim();
      }
      if (typeof result !== 'string') result = String(result);
    } catch (e: any) {
      result = `Ошибка: ${e.message?.substring(0, 200)}`;
    }
    const durationMs = Date.now() - start;

    const truncatedResult = result.length > RESULT_TRUNCATE_LENGTH
      ? result.substring(0, RESULT_TRUNCATE_LENGTH) + `\n... [обрезано, всего ${result.length} символов]`
      : result;

    toolCalls.push({ step, tool: action.name, args: action.args, result, durationMs });
    callbacks?.onToolCall?.(step, action.name, action.args, truncatedResult);
    // [A1] Force-stop on N consecutive identical-tool errors
    const CONSECUTIVE_ERROR_THRESHOLD = 3;
    if (result.startsWith('Ошибка') || result.includes(' error')) {
      const recentErrors = toolCalls.slice(-CONSECUTIVE_ERROR_THRESHOLD);
      if (recentErrors.length >= CONSECUTIVE_ERROR_THRESHOLD &&
          recentErrors.every(c => c.tool === action.name &&
            (c.result.startsWith('Ошибка') || c.result.includes(' error')))) {
        callbacks?.onComplete?.(step);
        return { steps: step, toolCalls };
      }
    }

    // Track created files
    if (action.name === 'writeFile' && !result.startsWith('Ошибка')) {
      const filePath = (action.args as any).path;
      if (filePath) filesCreated.push(filePath);
      // [A4] Guard against creating excess files
      if (filesCreated.length > 6) {
        callbacks?.onComplete?.(step);
        return { steps: step, toolCalls };
      }

      // v11b: Post-writeFile check for list/best-practices tasks
      if (filePath && filePath.endsWith('.md')) {
        const isListTask = await classifyPrompt(userPrompt,
          'Does the user ask for a list, best practices, or enumerated items (like "best practices", "список", "лучшие практики")?');
        if (isListTask) {
          try {
            const written = fs.readFileSync(filePath, 'utf-8');
            const hasNumbered = /^\s*\d+\./m.test(written) || /^\s*[-*]/m.test(written);
            if (!hasNumbered) {
              history.push({ role: 'user',
                content: `Файл "${filePath}" создан без списка!  Исправьте: best practices должны быть пронумерованы (1. 2. 3.), минимум 3 пункта!` });
            }
          } catch { /* file unreadable */ }
        }
      }
    }
    if (action.name === 'readDir' || action.name === 'readFile') {
      lastReadStep = step;
    }

    // v10a: Immediate nudge after ANY readFile with 0 writes
    const readFileCount = toolCalls.filter(c => c.tool === 'readFile').length;
    if (readFileCount >= 1 && filesCreated.length === 0 && action.name === 'readFile' && step >= 2) {
      const readPaths = toolCalls.filter(c => c.tool === 'readFile').map(c => c.args?.path).filter(Boolean);
      history.push({ role: 'user',
        content: `Вы прочитали (${readPaths.join(', ')}), но ничего не записали!  Используйте writeFile для сохранения результата!  НЕ читайте больше!` });
    }
    // v10b: Strong nudge after reading multiple data files (merge task)
    if (readFileCount >= 3 && filesCreated.length === 0 && action.name === 'readFile') {
      const readPaths = toolCalls.filter(c => c.tool === 'readFile').map(c => c.args?.path).filter(Boolean);
      history.push({ role: 'user',
        content: `Вы прочитали ${readFileCount} файлов (${readPaths.join(', ')}).  НЕМЕДЛЕННО объедините данные и запишите через writeFile! Пример: Action: writeFile[{"path": "all_users.json", "content": "[... объединённые данные ...]"}]` });
    }
    // v10c: JSON transform nudge
    if ((await classifyPrompt(userPrompt, 'Does the user ask to transform, convert, or reformat JSON data?')) && readFileCount >= 1 && filesCreated.length === 0) {
      history.push({ role: 'user', content: `Вы прочитали JSON.  НЕМЕДЛЕННО преобразуйте данные и запишите через writeFile!` });
    }

    history.push({ role: 'user', content: `Observation: ${truncatedResult}` });

    // v9: runCommand failure → suggest alternatives

    // v9b: read without subsequent write
    if (lastReadStep > 0 && step - lastReadStep >= 1 && filesCreated.length === 0) {
      const lastReadCall = toolCalls.filter(c => c.tool === 'readDir' || c.tool === 'readFile').pop();
      const readTarget = lastReadCall?.args?.path || '';
      history.push({ role: 'user',
        content: `Вы прочитали "${readTarget}" — результат получен!  ТЕПЕРЬ запишите результат через writeFile!  НЕ читайте больше!` });
      lastReadStep = 0;
    }

    // Step 3+ with reads but 0 writes
    if (step >= 3 && filesCreated.length === 0 && (action.name === 'readDir' || action.name === 'readFile')) {
      history.push({ role: 'user',
        content: `ВНИМАНИЕ: шаг ${step}, создано файлов: 0.  Вы только читаете но не записываете результат.  Немедленно используйте writeFile.` });
    }

    // v10d: Plan created → push with file enumeration
    if (action.name === 'createPlan' && step < maxSteps - 2) {
      const fileExtRe = /(\w+\.(?:html|css|js|ts|json|md|txt|csv|xml|yaml|yml|py|sh|rb|go|rs|java|c|cpp|h|hpp))/gi;
      const expectedFiles = [...new Set((userPrompt.match(fileExtRe) || []).map(f => f.toLowerCase()))];
      const fileList = expectedFiles.length > 0 ? expectedFiles.join(', ') : 'требуемые файлы';
      history.push({ role: 'user',
        content: `План создан!  ТЕПЕРЬ создайте файлы: ${fileList}.  Используйте writeFile для каждого файла.  Затем readDir для проверки!` });
    }

    // v10d: Only 1 file created but task requires more
    if (action.name === 'writeFile' && filesCreated.length === 1) {
      const needsMoreFiles = await classifyPrompt(userPrompt,
        'Does the user ask to create multiple files, a file structure, or a project with several files?');
      if (needsMoreFiles && step < maxSteps - 1) {
        history.push({ role: 'user',
          content: `Создан только 1 файл (${filesCreated[0]}), но задача требует нескольких!  Проверьте условие и создайте ОСТАЛЬНЫЕ файлы через writeFile!` });
      }
    }


    // Periodic summary every 7 steps
    if (step - lastSummaryAt >= 7 && step < maxSteps) {
      const filesList = filesCreated.length > 0
        ? filesCreated.slice(-3).join(', ')
        : 'нет';
      history.push({ role: 'user',
        content: `[Шаг ${step}/${maxSteps}] Файлы: ${filesList}.  Завершите задачу.` });
      lastSummaryAt = step;
    }

    // [B6] LLM-based loop detection
    if (await isLooping(toolCalls, step)) {
      history.push({ role: 'user',
        content: 'ВНИМАНИЕ: обнаружено зацикливание.  Вы вызываете одни и те же инструменты.  Попробуйте другой подход или завершите задачу.' });
    }


  }

  // v11: Post-loop — if files were read but nothing written, force one more step
  const totalReads = toolCalls.filter(c => c.tool === 'readFile' || c.tool === 'readDir').length;
  if (totalReads >= 2 && filesCreated.length === 0) {
    const readPaths = toolCalls.filter(c => c.tool === 'readFile').map(c => c.args?.path).filter(Boolean);
    history.push({ role: 'user',
      content: `ВНИМАНИЕ: вы прочитали ${totalReads} файлов (${readPaths.join(', ')}) но не записали результат!  Используйте writeFile прямо сейчас!  Это последний шаг!` });
    const finalResponse = await queryLLM(history);
    history.push({ role: 'assistant', content: finalResponse });
    const finalAction = parseAction(finalResponse);
    if (finalAction) {
      const toolFn = tools[finalAction.name];
      if (toolFn) {
        try {
          const finalResult = await toolFn(finalAction.args);
          toolCalls.push({ step: maxSteps + 1, tool: finalAction.name, args: finalAction.args, result: finalResult, durationMs: 0 });
          if (finalAction.name === 'writeFile' && !finalResult.startsWith('Ошибка')) {
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

// ─── Helper: detect research prompts ───────────────────────────

export async function isResearchPrompt(prompt: string): Promise<boolean> {
  return classifyPrompt(prompt,
    'Is this a research task that requires external search or factual verification?');
}

// ─── Generic LLM classifier ─────────────────────────────────────

const classificationCache = new Map<string, boolean>();

export async function classifyPrompt(prompt: string, question: string): Promise<boolean> {
  const cacheKey = question + '\n' + prompt;
  const cached = classificationCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const systemPrompt = `You are a binary classifier. Answer only YES or NO.\n\n${question}\n\nUser prompt: "${prompt}"`;
  try {
    const response = await queryLLM([{ role: 'user', content: systemPrompt }]);
    const result = response.trim().toUpperCase() === 'YES';
    classificationCache.set(cacheKey, result);
    return result;
  } catch {
    classificationCache.set(cacheKey, false);
    return false;
  }
}

function buildActionSummary(toolCalls: ToolCallRecord[], lastN: number = 8): string {
  const recent = toolCalls.slice(-lastN);
  return recent.map((c, i) => `${i + 1}. ${c.tool}(${JSON.stringify(c.args)})`).join('\n');
}

async function isLooping(toolCalls: ToolCallRecord[], step: number): Promise<boolean> {
  if (step < 3 || toolCalls.length < 3) return false;
  const summary = buildActionSummary(toolCalls);
  return classifyPrompt(
    `Recent actions (step ${step}):\n${summary}`,
    'Is the agent stuck in a loop or repeating the same actions without making progress? Answer YES if there is clear repetition or cycling, NO otherwise.'
  );
}
