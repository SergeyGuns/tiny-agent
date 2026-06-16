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
  const recentCalls: string[] = [];
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

    // v10: Detect completion phrases
    if (filesCreated.length > 0) {
      const completionPhrases = [
        'Готово!', 'Задача выполнена!', 'Задача завершена!',
        'Работа завершена!', 'Отчёт создан!'
      ];
      if (completionPhrases.some(p => response.includes(p))) {
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

    const start = Date.now();
    let result: string;
    try {
      result = await toolFn(action.args);
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

    // Track created files
    if (action.name === 'writeFile' && !result.startsWith('Ошибка')) {
      const filePath = (action.args as any).path;
      if (filePath) filesCreated.push(filePath);
      // v11b: Post-writeFile check for list/best-practices tasks
      if (filePath && filePath.endsWith('.md')) {
        const isListTask = userPrompt.includes('список') || userPrompt.includes('Список') ||
          userPrompt.includes('best practices') || userPrompt.includes('Best Practices') ||
          userPrompt.includes('лучшие практики');
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
    const isJsonTransform = (p: string) => p.includes('преобразуй') || p.includes('transform') || p.includes('трансформируй');
    if (isJsonTransform(userPrompt) && readFileCount >= 1 && filesCreated.length === 0) {
      history.push({ role: 'user', content: `Вы прочитали JSON.  НЕМЕДЛЕННО преобразуйте данные и запишите через writeFile!` });
    }

    history.push({ role: 'user', content: `Observation: ${truncatedResult}` });

    // v9: runCommand failure → suggest alternatives
    const lastTool = toolCalls[toolCalls.length - 1];
    if (lastTool && lastTool.tool === 'runCommand' && lastTool.result.includes('Command failed')) {
      const commandFailures = toolCalls.filter(c => c.tool === 'runCommand' && c.result.includes('Command failed'));
      if (commandFailures.length >= 2) {
        const cmd = lastTool.args.command as string;
        history.push({ role: 'user',
          content: `ВНИМАНИЕ: команда "${cmd?.substring(0, 50)}" не сработала.  Используйте встроенные инструменты (writeFile, fetch, etc.), а не runCommand.` });
      }
    }

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
      const multiFileKeywords = ['структуру', 'файлы:', 'следующую', 'структура файлов', 'создай:', ' - ', 'report', 'отчёт', 'fixed', 'report.txt', 'отчёт.txt', 'README', '', ''];
      const needsMoreFiles = multiFileKeywords.some(k => userPrompt.includes(k));
      if (needsMoreFiles && step < maxSteps - 1) {
        history.push({ role: 'user',
          content: `Создан только 1 файл (${filesCreated[0]}), но задача требует нескольких!  Проверьте условие и создайте ОСТАЛЬНЫЕ файлы через writeFile!` });
      }
    }

    // v8: 3+ identical writes → stop repetition
    if (step >= 5 && filesCreated.length > 0) {
      const lastThree = toolCalls.slice(-3);
      const allWriteSame = lastThree.length >= 3 &&
        lastThree.every(c => c.tool === 'writeFile') &&
        lastThree.every(c => JSON.stringify(c.args) === JSON.stringify(lastThree[0].args));
      if (allWriteSame) {
        history.push({ role: 'user',
          content: 'Вы повторяете запись того же файла.  Задача либо завершена либо нужно создать ДРУГИЕ файлы.  Проверьте требования.' });
      }
    }

    // v10: Repeated writeFile to same path
    if (step >= 3 && action.name === 'writeFile') {
      const recentWrites = toolCalls.filter(c => c.tool === 'writeFile' && c.args?.path === action.args?.path);
      if (recentWrites.length >= 2) {
        history.push({ role: 'user',
          content: `Вы записали "${action.args?.path}" ${recentWrites.length} раза!  Задача выполнена?  Если нет — используйте readDir для проверки.` });
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

    // Loop detection: 3+ repeated call pairs
    const callSig = `${action.name}:${JSON.stringify(action.args)}`;
    recentCalls.push(callSig);
    if (recentCalls.length > 6) recentCalls.shift();
    if (recentCalls.length >= 6 &&
        recentCalls[0] === recentCalls[2] && recentCalls[2] === recentCalls[4] &&
        recentCalls[1] === recentCalls[3] && recentCalls[3] === recentCalls[5]) {
      history.push({ role: 'user',
        content: 'ВНИМАНИЕ: обнаружено зацикливание.  Вы вызываете одни и те же инструменты.  Попробуйте другой подход или завершите задачу.' });
    }

    // v7: 4+ reads with 0 writes
    const readCount = toolCalls.filter(c => c.tool === 'readFile' || c.tool === 'readDir').length;
    if (readCount >= 4 && filesCreated.length === 0) {
      history.push({ role: 'user',
        content: `ВНИМАНИЕ: вы прочитали ${readCount} файлов/директорий но не создали ни одного выходного файла.  Объедините данные и запишите через writeFile!  НЕ читайте больше!` });
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
  const systemPrompt = "You are a classifier. Determine if the following user prompt is a research task that requires external search or factual verification. Answer only YES or NO.";
  const response = await queryLLM([{ role: "user", content: systemPrompt + "\n\nPrompt: " + prompt }]);
  return response.trim().toUpperCase() === "YES";
}
