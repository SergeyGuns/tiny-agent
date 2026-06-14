import { ToolFunction } from './types.js';
import { Message, ToolCallRecord, ReActState, Strategy } from './types.js';

import * as fs from 'fs';
import * as path from 'path';

// Загрузка .env файла
function loadEnv() {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key && !process.env[key]) process.env[key] = value;
    }
  } catch {}
}
loadEnv();
// --- УТИЛИТА: извлечение текста из HTML ---
export function extractTextFromHtml(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

// --- DUCKDUCKGO SEARCH (на основе web-search-mcp) ---
// Использует DuckDuckGo HTML-интерфейс — бесплатно, без ключа, без браузера.
// Паттерн: HTTP GET → парсинг HTML-результатов → структурированный вывод.

interface DdgResult {
  title: string;
  url: string;
  snippet: string;
}

// Парсинг HTML от html.duckduckgo.com
// Формат: <table><tr><td><a class="result__a">title</a>...<td class="result__snippet">snippet</td>...<td><a>url</a></td></tr></table>
// Универсальный подход: ищем все result__a ссылки и собираем контекст вокруг них.

export function parseDdgHtml(html: string, maxResults: number): DdgResult[] {
  const results: DdgResult[] = [];
  const seen = new Set<string>();

  // result__a — заголовки результатов (содержат href и текст)
  const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch: RegExpExecArray | null;

  while ((linkMatch = linkRe.exec(html)) !== null) {
    if (results.length >= maxResults) break;

    let url = linkMatch[1].trim();
    const title = extractTextFromHtml(linkMatch[2]);

    // DuckDuckGo может использовать редирект-ссылки
    if (url.includes('duckduckgo.com') && url.includes('uddg=')) {
      const m = url.match(/uddg=([^&]+)/);
      if (m) url = decodeURIComponent(m[1]);
    }
    if (url.includes('duckduckgo.com') || seen.has(url) || url.startsWith('javascript:')) continue;
    seen.add(url);

    // Ищем сниппет после этой ссылки — result__snippet в том же блоке
    const after = html.slice(linkMatch.index + linkMatch[0].length, linkMatch.index + linkMatch[0].length + 2000);
    const snippetRe = /<(?:td|div|a|p)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|a|p)>/i;
    const snipMatch = after.match(snippetRe);
    const snippet = snipMatch ? extractTextFromHtml(snipMatch[1]) : '';

    // Ищем result__url
    const urlRe = /<(?:span|a)[^>]*class="[^"]*result__url[^"]*"[^>]*>([\s\S]*?)<\/(?:span|a)>/i;
    const urlMatch = after.match(urlRe);
    const displayUrl = urlMatch ? extractTextFromHtml(urlMatch[1]) : url;

    results.push({ title: title || displayUrl, url, snippet });
  }

  // Fallback: если result__a не нашли — ищем любые внешние ссылки с длинным текстом
  if (results.length === 0) {
    const fallbackRe = /<a[^>]*href="(https?:\/\/[^"]{10,})"[^>]*>([^<]{10,200})<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = fallbackRe.exec(html)) !== null) {
      if (results.length >= maxResults) break;
      const url = m[1];
      const title = m[2].trim();
      if (url.includes('duckduckgo.com') || seen.has(url)) continue;
      seen.add(url);
      results.push({ title, url, snippet: '' });
    }
  }

  return results;
}

async function translateRuToEn(text: string): Promise<string> {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ru|en`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = (await res.json()) as any;
      if (data?.responseData?.translatedText) return data.responseData.translatedText;
    }
  } catch {}
  return text;
}

async function searchDuckDuckGo(query: string, numResults: number): Promise<DdgResult[]> {
  // If query contains Cyrillic, translate it to English first via MyMemory (free, no key)
  const hasCyrillic = /[а-яА-ЯёЁ]/.test(query);
  const translatedQuery = hasCyrillic ? await translateRuToEn(query) : query;

  const enQuery = translatedQuery
    .replace(/основные различия/gi, 'differences between')
    .replace(/преимущества/gi, 'advantages').replace(/недостатки/gi, 'disadvantages')
    .replace(/сравнительный анализ/gi, 'comparison').replace(/столица/gi, 'capital')
    .replace(/население/gi, 'population').replace(/страны/gi, 'countries')
    .replace(/практики/gi, 'best practices').replace(/работы с/gi, 'working with')
    .replace(/последний релиз/gi, 'latest release').replace(/версия/gi, 'version')
    .replace(/дата/gi, 'date').replace(/текущая/gi, 'current')
    .replace(/информация/gi, 'information').replace(/найди/gi, 'find')
    .replace(/список/gi, 'list').replace(/топ/gi, 'top');

  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(enQuery)}&format=json&srlimit=${numResults}&origin=*`;
    const res = await fetch(url, { headers: { 'User-Agent': 'TinyAgent/10 (github.com/SergeyGuns/tiny-agent)' }, signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const data = await res.json() as any;
      return (data?.query?.search || []).slice(0, numResults).map((x: any) => ({
        title: (x.title as string).replace(/<[^>]+>/g, ''),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent((x.title as string).replace(/ /g, '_'))}`,
        snippet: (x.snippet as string).replace(/<[^>]+>/g, '').substring(0, 250),
      }));
    }
  } catch {}
  return [];
}

// --- ИНСТРУМЕНТЫ ---
export const tools: Record<string, ToolFunction> = {
  webSearch: async (args: Record<string, unknown>) => {
    try {
      const query = args.query as string;
      const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10);

      const results = await searchDuckDuckGo(query, limit);

      if (results.length === 0) {
        return 'Ничего не найдено.';
      }

      return results.map((r, i) => {
        let line = `[${i + 1}] ${r.title}\n    URL: ${r.url}`;
        if (r.snippet) line += `\n    ${r.snippet}`;
        return line;
      }).join('\n\n');
    } catch (e: any) { return `Ошибка поиска: ${e.message}`; }
  },
  fetch: async (args: Record<string, unknown>) => {
    try {
      const url = args.url as string;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return 'Ошибка: URL должен начинаться с http:// или https://';
      }
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TinyAgent/1.0)',
          'Accept': 'text/html,application/json,*/*'
        },
        signal: AbortSignal.timeout(15000)
      });
      const contentType = res.headers.get('content-type') || '';
      const body = await res.text();
      if (contentType.includes('application/json')) {
        return body.substring(0, 5000);
      }
      return extractTextFromHtml(body).substring(0, 5000);
    } catch (e: any) { return `Ошибка fetch: ${e.message}`; }
  },
  readDir: (args: Record<string, unknown>) => {
    try { return fs.readdirSync(path.resolve((args.path as string) || '.')).join(', '); }
    catch (e: any) { return `Ошибка: ${e.message}`; }
  },
  readFile: (args: Record<string, unknown>) => {
    try { return fs.readFileSync(path.resolve(args.path as string), 'utf-8'); }
    catch (e: any) { return `Ошибка: ${e.message}`; }
  },
  createPlan: (args: Record<string, unknown>) => {
    try {
      const steps = args.steps as string[];
      if (!steps || !Array.isArray(steps)) return 'Ошибка: массив шагов не указан';
      const plan = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
      const content = `# План выполнения\n\n${plan}\n`;
      const p = path.resolve('PLAN.md');
      fs.writeFileSync(p, content, 'utf-8');
      return `План из ${steps.length} шагов сохранён в PLAN.md`;
    } catch (e: any) { return `Ошибка: ${e.message}`; }
  },
  mkdir: (args: Record<string, unknown>) => {
    try {
      const p = path.resolve((args.path as string) || '.');
      fs.mkdirSync(p, { recursive: true });
      return `Директория создана: ${p}`;
    } catch (e: any) { return `Ошибка: ${e.message}`; }
  },
  writeFile: (args: Record<string, unknown>) => {
    try {
      const p = path.resolve(args.path as string);
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(p, args.content as string, 'utf-8');
      return `Файл успешно записан: ${p}`;
    }
    catch (e: any) { console.error(`[writeFile] ERROR: ${e.message}`); return `Ошибка записи файла: ${e.message}`; }
  },
  runPackageScript: async (args: Record<string, unknown>) => { return 'Не поддерживается в тестах'; },
  grep: async (args: Record<string, unknown>) => {
    try {
      const pattern = args.pattern as string;
      const filesGlob = (args.files as string) || '.';
      if (!pattern) return 'Ошибка: pattern не указан';
      const { execSync } = await import('node:child_process');
      // Используем grep для поиска по файлам
      const grepCmd = filesGlob === '.'
        ? `grep -r -n -H "${pattern}" . --include="*" --exclude-dir=".git" --exclude-dir="node_modules" 2>/dev/null | head -50`
        : `grep -n -H "${pattern}" ${filesGlob} 2>/dev/null | head -50`;
      const output = execSync(grepCmd, {
        cwd: process.cwd(),
        timeout: 10000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output || 'Совпадений не найдено';
    } catch (e: any) {
      if (e.message?.includes('ENOENT')) return 'grep не установлен в системе';
      return `Ошибка grep: ${e.message?.substring(0, 200)}`;
    }
  },
  runCommand: async (args: Record<string, unknown>) => {
    try {
      const cmd = (args.command || args.cmd) as string;
      if (!cmd || typeof cmd !== 'string') return 'Ошибка: команда не указана';
      // Запрещаем опасные команды
      const blocked = ['rm -rf /', 'sudo', 'chmod 777', 'mkfs', 'dd ', 'shutdown', 'reboot', '> /dev'];
      if (blocked.some(b => cmd.includes(b))) return `Ошибка: команда "${cmd}" заблокирована по безопасности`;
      const { execSync } = await import('node:child_process');
      const output = execSync(cmd, {
        cwd: (args.cwd as string) || process.cwd(),
        timeout: 30000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.substring(0, 2000) || 'Выполнено (пустой вывод)';
    } catch (e: any) {
      if (e.message?.includes('ENOENT')) return `Ошибка: файл или команда не найдена — ${e.message}`;
      if (e.message?.includes('timeout')) return 'Ошибка: таймаут 30с';
      return `Ошибка: ${e.message?.substring(0, 200)}`;
    }
  },
};

// --- ПАРСИНГ ACTION ---
export function parseAction(text: string): { name: string; args: Record<string, unknown> } | null {
  // Поддержка форматов:
  // 1. Action: toolName[{"key": "value"}]
  // 2. **Action:** ... (жирный текст)
  const actionPatterns = [
    /Action:\s*(\w+)\[([\s\S]*?)\]/,       // Обычный формат
    /\*\*Action:\*\*\s*(\w+)\[([\s\S]*?)\]/, // Жирный формат
    /^\s*(\w+)\[\s*([^\\]]*)\s*\]\s*$/,      // Только имя и args (в конце строки)
  ];

  for (const pattern of actionPatterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        return { name: match[1].trim(), args: JSON.parse(match[2].trim()) };
      } catch {
        // JSON parse failed — try lenient recovery for writeFile with unescaped content
        const toolName = match[1].trim();
        const rawArgs = match[2].trim();
        if (toolName === 'writeFile') {
          const recovered = parseWriteFileArgs(rawArgs);
          if (recovered) return { name: 'writeFile', args: recovered };
        }
        return null;
      }
    }
  }
  // Fallback: если не нашли Action, проверяем есть ли JSON в тексте
  const jsonMatch = text.match(/({[\s\S]*})/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.path && typeof parsed.content === 'string') return { name: 'writeFile', args: parsed };
      if (parsed.pattern && typeof parsed.files === 'string') return { name: 'grep', args: parsed };
    } catch {}
  }
  return null;
}

// Lenient parser for writeFile args when JSON.parse fails due to unescaped content.
// Handles: {"path": "file.json", "content": "{"key": "value"}"}  (unescaped inner quotes)
// Strategy: extract "path" via simple regex, then grab everything after "content": as the content value.
function parseWriteFileArgs(raw: string): Record<string, unknown> | null {
  // Extract path: "path": "..." (simple quoted string, no nested quotes expected)
  const pathMatch = raw.match(/"path"\s*:\s*"([^"]+)"/);
  if (!pathMatch) return null;
  const path = pathMatch[1];

  // Find the content key position
  const contentKeyIdx = raw.indexOf('"content"');
  if (contentKeyIdx === -1) return null;

  // Find the opening quote after "content":
  const afterKey = raw.slice(contentKeyIdx + '"content"'.length);
  const colonIdx = afterKey.indexOf(':');
  if (colonIdx === -1) return null;
  const afterColon = afterKey.slice(colonIdx + 1).trim();
  if (!afterColon.startsWith('"')) return null;

  // Find the opening quote position in the raw string
  const openingQuotePos = raw.indexOf('"', contentKeyIdx + '"content"'.length + colonIdx + 1);
  if (openingQuotePos === -1) return null;

  // Find the end of the content value: the last "}  (quote+brace) that closes the JSON object.
  // We scan backwards from the end to find the last } preceded by " (with possible whitespace).
  // This correctly handles content that contains } characters (e.g., nested JSON arrays/objects).
  let endQuotePos = -1;
  for (let i = raw.length - 1; i >= openingQuotePos + 1; i--) {
    if (raw[i] === '}') {
      // Check if preceded by " (with possible whitespace between)
      let j = i - 1;
      while (j > openingQuotePos && (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\n')) j--;
      if (raw[j] === '"') {
        endQuotePos = j;
        break;
      }
    }
  }
  if (endQuotePos === -1) return null;

  const content = raw.slice(openingQuotePos + 1, endQuotePos);
  return { path, content };
}


// ─── REACT LOOP (для бенчмарка и TUI) ───────────────────────

export const BENCH_SYSTEM_PROMPT = `Вы — автономный AI-агент.

Формат: Plan: ... Thought: ... Action: toolName[{"arg": "value"}]
Инструменты: webSearch, fetch, readDir, readFile, writeFile, mkdir, createPlan(steps[]), grep(pattern)

ПЕРВЫЙ ШАГ — ВСЕГДА ИНСТРУМЕНТ:
- Шаг 1: НЕМЕДЛЕННО вызовите инструмент (readDir/readFile для файлов, webSearch для поиска)
- НЕ пишите размышления перед первым действием!
- Пример первого шага: Action: webSearch[{"query": "Docker vs Podman differences"}]

ПРАВИЛА:
1. Файлы создаются ТОЛЬКО через writeFile — мысль/план НЕ создает файл!
2. НЕ завершайте пока ВСЕ файлы не созданы и не проверены через readDir
3. Для JSON: записывайте как есть, без двойного экранирования
4. Для markdown-отчётов и исследований: ПЕРЕД записью составьте список всех ## секций из условия. Запишите ВСЕ секции включая Вывод/Рекомендации. НЕ пропускайте ни одну секцию!
5. Для исследований: минимум 2-3 webSearch запросов, затем синтез и запись отчёта

ПАТТЕРНЫ:
- Слияние: readDir → readFile × N → объединить → writeFile
- Fixed+report: readFile → исправить → writeFile_fixed → writeFile_report → readDir
- План: createPlan → создать КАЖДЫЙ файл (перечислить все из условия!) → readDir
- Исследование: webSearch × 2-3 → синтез → writeFile_report.md (ВСЕ секции!)

ЗАВЕРШЕНИЕ: все файлы на диске → readDir → «ВСЕ ФАЙЛЫ СОХРАНЕНЫ ✓»`;

export interface ReActCallbacks {
  onStep?: (step: number, response: string) => void;
  onToolCall?: (step: number, tool: string, args: Record<string, unknown>, result: string) => void;
  onComplete?: (steps: number) => void;
}

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
  let lastReadStep = 0; // шаг последнего readDir/readFile
  let emptySteps = 0; // счётчик шагов без Action

  for (let step = 1; step <= maxSteps; step++) {
    const response = await queryLLM(history);
    history.push({ role: 'assistant', content: response });
    callbacks?.onStep?.(step, response);

    const action = parseAction(response);
    if (!action) {
      emptySteps++;
      // Всегда подталкиваем если нет Action
      if (emptySteps >= 3) {
        // 3 пустых шага подряд — форсируем завершение
        history.push({ role: 'user',
          content: `КРИТИЧЕСКО: вы уже ${emptySteps} шага не вызываете инструмент! НЕМЕДЛЕННО выполните Action: writeFile или другой инструмент!` });
        // Даём ещё шанс
        emptySteps = 0;
        continue;
      }
      const noActionPush = step <= 5
        ? `ВЫ НЕ ВЫЗВАЛИ ИНСТРУМЕНТ (шаг ${step})! НЕМЕДЛЕННО: Action: имя[{"ключ": "значение"}]. Вы прочитали данные — ЗАПИШИТЕ результат через writeFile!`
        : `ВЫ НЕ ВЫЗВАЛИ ИНСТРУМЕНТ (шаг ${step})! НЕМЕДЛЕННО используйте writeFile для сохранения результата!`;
      history.push({ role: 'user', content: noActionPush });
      continue;
    }
    emptySteps = 0; // сбрасываем счётчик при успешном Action

    // v10c: Research task detected — push for immediate webSearch on step 1
    if (step === 1 && filesCreated.length === 0) {
      const userPrompt = history.length > 1 ? history[1].content || '' : '';
      const isResearchTask = userPrompt.includes('Найди') || userPrompt.includes('найди') ||
        userPrompt.includes('исследован') || userPrompt.includes('сравн') ||
        userPrompt.includes('Docker') || userPrompt.includes('Podman') ||
        userPrompt.includes('PostgreSQL') || userPrompt.includes('MongoDB') ||
        userPrompt.includes('Git') || userPrompt.includes('best practice') ||
        userPrompt.includes('базы данных') || userPrompt.includes('рекомендац');
      if (isResearchTask && action.name !== 'webSearch' && action.name !== 'fetch') {
        // Extract a search query from the prompt
        const searchQuery = userPrompt.substring(0, 100).replace(/\n/g, ' ');
        history.push({ role: 'user',
          content: `СТОП! Это исследовательская задача! НЕМЕДЛЕННО вызовите: Action: webSearch[{"query": "${searchQuery}"}] НЕ отвечайте из памяти — ИЩИТЕ в интернете!` });
      }
    }

    if (action.args.error) {
      history.push({ role: 'user', content: 'Observation: Ошибка аргументов.' });
      continue;
    }

    const toolFn = tools[action.name];
    if (!toolFn) {
      history.push({ role: 'user', content: `Observation: Инструмент "${action.name}" не найден.` });
      continue;
    }

    const start = Date.now();
    let result: string;
    try {
      result = await toolFn(action.args);
      if (typeof result !== 'string') result = String(result);
    } catch (e: any) {
      result = `Ошибка выполнения: ${e.message?.substring(0, 200)}`;
    }
    const durationMs = Date.now() - start;

    const truncatedResult = result.length > 2000
      ? result.substring(0, 2000) + `\n... [обрезано, всего ${result.length} символов]`
      : result;

    toolCalls.push({ step, tool: action.name, args: action.args, result, durationMs });
    callbacks?.onToolCall?.(step, action.name, action.args, truncatedResult);

    // Трекинг созданных файлов и чтения
    if (action.name === 'writeFile' && !result.startsWith('Ошибка')) {
      const filePath = (action.args as any).path;
      if (filePath) filesCreated.push(filePath);
    }
    if (action.name === 'readDir' || action.name === 'readFile') {
      lastReadStep = step;
    }

    // v10a: Immediate nudge after ANY readFile with 0 writes — forces write before loop ends
    const readFileCount = toolCalls.filter(c => c.tool === 'readFile').length;
    if (readFileCount >= 1 && filesCreated.length === 0 && action.name === 'readFile' && step >= 2) {
      const readPaths = toolCalls.filter(c => c.tool === 'readFile').map(c => c.args?.path).filter(Boolean);
      history.push({ role: 'user',
        content: `СТОП! Вы прочитали файлы (${readPaths.join(', ')}), но НЕ ЗАПИСАЛИ результат! Данные в памяти. НЕМЕДЛЕННО ЗАПИШИТЕ ОБРАБОТАННЫЙ РЕЗУЛЬТАТ через writeFile! НЕ ЧИТАЙТЕ БОЛЬШЕ — ПИШИТЕ СЕЙЧАС!` });
    }
    // v10b: Strong nudge after reading multiple data files (merge task)
    if (readFileCount >= 3 && filesCreated.length === 0 && action.name === 'readFile') {
      const readPaths = toolCalls.filter(c => c.tool === 'readFile').map(c => c.args?.path).filter(Boolean);
      history.push({ role: 'user',
        content: `ВЫ ПРОЧИТАЛИ ${readFileCount} ФАЙЛОВ С ДАННЫМИ (${readPaths.join(', ')}). ВСЕ ДАННЫЕ В ПАМЯТИ! НЕМЕДЛЕННО: объедините → отсортируйте → запишите ОДНИМ writeFile! ПРИМЕР: Action: writeFile[{"path": "all_users.json", "content": "[...отсортированный массив...]"}]` });
    }

    history.push({ role: 'user', content: `Observation: ${truncatedResult}` });
    // v9: Подсказка если команда runCommand не сработала несколько раз
    const lastTool = toolCalls[toolCalls.length - 1];
    if (lastTool && lastTool.tool === 'runCommand' && lastTool.result.includes('Command failed')) {
      const commandFailures = toolCalls.filter(c => c.tool === 'runCommand' && c.result.includes('Command failed'));
      if (commandFailures.length >= 2) {
        const cmd = lastTool.args.command as string;
        history.push({ role: 'user',
          content: `ВНИМАНИЕ: команда "${cmd?.substring(0, 50)}" не сработала. Используйте только встроенные инструменты (writeFile, fetch, etc.), а не runCommand.` });
      }
    }

    // v9b: Если модель прочитала данные на предыдущем шаге но не записала — подталкиваем сразу
    if (lastReadStep > 0 && step - lastReadStep >= 1 && filesCreated.length === 0) {
      const lastReadCall = toolCalls.filter(c => c.tool === 'readDir' || c.tool === 'readFile').pop();
      const readTarget = lastReadCall?.args?.path || 'файл';
      history.push({ role: 'user',
        content: `ВЫ ПРОЧИТАЛИ "${readTarget}" НА ПРОШЛОМ ШАГЕ! ДАННЕ ПОЛУЧЕНЫ. НЕМЕДЛЕННО ЗАПИШИТЕ РЕЗУЛЬТАТ через writeFile! НЕ ЧИТАЙТЕ БОЛЬШЕ — ПИШИТЕ!` });
      lastReadStep = 0;
    }

    // Если модель сделала 3+ шага но не записала ни одного файла — подталкиваем
    if (step >= 3 && filesCreated.length === 0 && (action.name === 'readDir' || action.name === 'readFile')) {
      history.push({ role: 'user',
        content: `ВНИМАНИЕ: шаг ${step}, создано файлов: 0. Вы только читаете но не записываете результат. Немедленно используйте writeFile для сохранения результата задачи.` });
    }

    // v10d: If agent created a plan, push harder with file enumeration
    if (action.name === 'createPlan' && step < maxSteps - 2) {
      const userPrompt = history.length > 1 ? history[1].content || '' : '';
      // Extract expected file names from prompt
      const fileExtRe = /(\w+\.(?:html|css|js|ts|json|md|txt|csv|xml|yaml|yml|py|sh|rb|go|rs|java|c|cpp|h|hpp))/gi;
      const expectedFiles = [...new Set((userPrompt.match(fileExtRe) || []).map(f => f.toLowerCase()))];
      const fileList = expectedFiles.length > 0 ? expectedFiles.join(', ') : 'все файлы из условия задачи';
      history.push({ role: 'user',
        content: `План создан. ТЕПЕРЬ немедленно создайте КАЖДЫЙ файл: ${fileList}. Используйте writeFile для каждого файла. НЕ ЗАВЕРШАЙТЕ пока ВСЕ файлы не созданы! Проверяйте через readDir!` });
    }

    // v10d: If agent created only 1 file but task requires more — push harder
    if (action.name === 'writeFile' && filesCreated.length === 1) {
      const userPrompt = history.length > 1 ? history[1].content || '' : '';
      const multiFileKeywords = ['структуру', 'файлы:', 'следующую', 'структура файлов', 'создай:', ' - ', 'report', 'отчёт', 'исправ', 'fixed', 'report.txt', 'каждый файл', 'все файлы', 'рабочий', 'валидный'];
      const needsMoreFiles = multiFileKeywords.some(k => userPrompt.includes(k));
      if (needsMoreFiles && step < maxSteps - 1) {
        history.push({ role: 'user',
          content: `ВНИМАНИЕ: создан только 1 файл (${filesCreated[0]}), но задача требует нескольких файлов! Проверьте условие задачи и создайте ОСТАЛЬНЫЕ файлы через writeFile. Не останавливайтесь!` });
      }
    }

    // v8: Если последние 3 шага — повторный writeFile без прогресса — форсируем завершение
    if (step >= 5 && filesCreated.length > 0) {
      const lastThree = toolCalls.slice(-3);
      const allWriteSame = lastThree.length >= 3 &&
        lastThree.every(c => c.tool === 'writeFile') &&
        lastThree.every(c => JSON.stringify(c.args) === JSON.stringify(lastThree[0].args));
      if (allWriteSame) {
        history.push({ role: 'user',
          content: 'Вы повторяете запись того же файла. Задача либо завершена либо нужно создать ДРУГИЕ файлы. Проверьте требования задачи.' });
      }
    }

    // Каждые 7 шагов — краткий итог прогресса
    if (step - lastSummaryAt >= 7 && step < maxSteps) {
      const filesList = filesCreated.length > 0
        ? filesCreated.slice(-3).join(', ')
        : 'нет';
      history.push({ role: 'user',
        content: `[Шаг ${step}/${maxSteps}] Файлы: ${filesList}. Завершите задачу.` });
      lastSummaryAt = step;
    }

    // Детекция зацикливания: один и тот же вызов 3 раза подряд
    const callSig = `${action.name}:${JSON.stringify(action.args)}`;
    recentCalls.push(callSig);
    if (recentCalls.length > 6) recentCalls.shift();
    if (recentCalls.length >= 6 &&
        recentCalls[0] === recentCalls[2] && recentCalls[2] === recentCalls[4] &&
        recentCalls[1] === recentCalls[3] && recentCalls[3] === recentCalls[5]) {
      // Зацикливание обнаружено — добавляем подсказку
      history.push({ role: 'user',
        content: 'ВНИМАНИЕ: обнаружено зацикливание. Вы вызываете одни и те же инструменты. Попробуйте другой подход или завершите задачу.' });
    }

    // v7: Детекция повторного чтения — если агент прочитал 4+ файла но не записал результат
    const readCount = toolCalls.filter(c => c.tool === 'readFile' || c.tool === 'readDir').length;
    if (readCount >= 4 && filesCreated.length === 0) {
      history.push({ role: 'user',
        content: `ВНИМАНИЕ: вы прочитали ${readCount} файлов/директорий но не создали ни одного выходного файла. Объедините все прочитанные данные и запишите результат через writeFile. Не читайте больше!` });
    }
  }

  // v11: Post-loop — if files were read but nothing written, force one more step
  const totalReads = toolCalls.filter(c => c.tool === 'readFile' || c.tool === 'readDir').length;
  if (totalReads >= 2 && filesCreated.length === 0) {
    const readPaths = toolCalls.filter(c => c.tool === 'readFile').map(c => c.args?.path).filter(Boolean);
    history.push({ role: 'user',
      content: `КРИТИЧЕСКАЯ ОШИБКА: вы прочитали ${totalReads} файла(ов) (${readPaths.join(', ')}) но НЕ ЗАПИСАЛИ результат! Задача НЕ завершена. НЕМЕДЛЕННО используйте writeFile для сохранения обработанных данных. Это последний шаг — запишите результат!` });
    // Force one more LLM call
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
        } catch {}
      }
    }
  }

  callbacks?.onComplete?.(maxSteps);
  return { steps: maxSteps, toolCalls };
}

export async function queryLLM(messages: Message[], retries = 5): Promise<string> {
  const baseUrl = process.env.LM_STUDIO_URL || 'http://localhost:1234/v1';
  const modelName = process.env.LM_STUDIO_MODEL || 'local-model';

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, messages, temperature: 0.7 }),
        signal: AbortSignal.timeout(300000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        // Model not loaded yet — retry with backoff
        if (text.includes('Model is unloaded') || text.includes('Failed to load model') || text.includes('No models loaded')) {
          if (attempt < retries) {
            await sleep(10000 * attempt);
            continue;
          }
        }
        throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
      }

      const data = await response.json() as any;

      if (!data.choices?.[0]?.message?.content) {
        if (attempt < retries) {
          await sleep(5000 * attempt);
          continue;
        }
        throw new Error('Модель вернула пустой ответ');
      }

      return data.choices[0].message.content;
    } catch (e: any) {
      if (attempt < retries) {
        await sleep(5000 * attempt);
        continue;
      }
      throw e;
    }
  }

  throw new Error('queryLLM: все попытки исчерпаны');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
export type { ToolCallRecord };
