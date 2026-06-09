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
  } catch { /* .env не найден — используем process.env */ }
}
loadEnv();

export interface Message { role: 'system' | 'user' | 'assistant'; content: string; }
export type ToolFunction = (args: Record<string, unknown>) => Promise<string> | string;

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

async function searchDuckDuckGo(query: string, numResults: number): Promise<DdgResult[]> {
  // Wikipedia Search API — надёжный, без CAPTCHA, работает с любыми языками
  // Wikipedia автоматически находит статьи на разных языках
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${numResults}&origin=*`;

  const res = await fetch(searchUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TinyAgent/1.0)' },
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    throw new Error(`Wikipedia search returned ${res.status}`);
  }

  const data = await res.json() as any;
  const results: DdgResult[] = [];

  const searchResults = data?.query?.search || [];
  for (const r of searchResults) {
    const title = (r.title as string).replace(/<[^>]+>/g, '');
    const snippet = (r.snippet as string).replace(/<[^>]+>/g, '').substring(0, 200);
    results.push({
      title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      snippet,
    });
  }

  // Fallback: если результатов нет — пробуем английский перевод ключевых слов
  if (results.length === 0) {
    const enQuery = query
      .replace(/основные различия/gi, 'differences between')
      .replace(/преимущества/gi, 'advantages')
      .replace(/недостатки/gi, 'disadvantages')
      .replace(/сравнительный анализ/gi, 'comparison')
      .replace(/столица/gi, 'capital')
      .replace(/население/gi, 'population')
      .replace(/страны/gi, 'countries')
      .replace(/практики/gi, 'best practices')
      .replace(/работы с/gi, 'working with')
      .replace(/последний релиз/gi, 'latest release')
      .replace(/версия/gi, 'version')
      .replace(/дата/gi, 'date')
      .replace(/текущая/gi, 'current')
      .replace(/информация/gi, 'information')
      .replace(/найди/gi, 'find')
      .replace(/список/gi, 'list')
      .replace(/топ/gi, 'top');

    if (enQuery !== query) {
      const searchUrl2 = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(enQuery)}&format=json&srlimit=${numResults}&origin=*`;
      const res2 = await fetch(searchUrl2, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TinyAgent/1.0)' },
        signal: AbortSignal.timeout(15000)
      });
      if (res2.ok) {
        const data2 = await res2.json() as any;
        for (const r of (data2?.query?.search || [])) {
          const title = (r.title as string).replace(/<[^>]+>/g, '');
          const snippet = (r.snippet as string).replace(/<[^>]+>/g, '').substring(0, 200);
          results.push({
            title,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
            snippet,
          });
        }
      }
    }
  }

  return results;
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
      return 'Файл успешно записан';
    }
    catch (e: any) { return `Ошибка: ${e.message}`; }
  },
  runPackageScript: async (args: Record<string, unknown>) => { return 'Не поддерживается в тестах'; },
  grep: (args: Record<string, unknown>) => {
    try {
      const pattern = args.pattern as string;
      const filesGlob = (args.files as string) || '.';
      if (!pattern) return 'Ошибка: pattern не указан';
      const { execSync } = require('node:child_process');
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
  // Основной формат: Action: toolName[{"key": "value"}]
  const match = text.match(/Action:\s*(\w+)\[([\s\S]*?)\]/);
  if (!match) return null;
  try { return { name: match[1].trim(), args: JSON.parse(match[2].trim()) }; }
  catch { return { name: match[1].trim(), args: { error: 'Невалидный JSON' } };}
}

// ─── REACT LOOP (для бенчмарка и TUI) ───────────────────────

export const BENCH_SYSTEM_PROMPT = `Вы — автономный AI-агент. Формат:
Plan: текущий план
Thought: рассуждение
Action: инструмент[{\"ключ\": \"значение\"}]

Инструменты: webSearch, fetch, readDir, readFile, writeFile (авто-создаёт директории!), mkdir, createPlan(steps[]), grep(pattern), runCommand, runPackageScript

ПРАВИЛА:
1. Аргументы внутри [] — валидный JSON
2. Результат задачи — файлы на диске. Используйте writeFile для КАЖДОГО создаваемого файла
3. НЕ завершайте задачу пока не создали ВСЕ требуемые файлы
4. Перед финальным ответом убедитесь: все файлы существуют, все требования выполнены
5. Для задач с созданием структуры (3+ файлов): создавайте файлы ОДИН ЗА ДРУГИМ, после каждого writeFile проверяйте — какие файлы ещё нужны

МУЛЬТИФАЙЛОВЫЙ ШАБЛОН (ВАЖНО!):
Когда задача требует создать несколько файлов, ВСЕГДА действуйте так:
Шаг 1: Создайте первый файл
Шаг 2: В Thought напишите чеклист: "[Чеклист: file1 ✓ | file2 ✗ | file3 ✗]"
Шаг 3: Создайте второй файл
Шаг 4: В Thought обновите: "[Чеклист: file1 ✓ | file2 ✓ | file3 ✗]"
Шаг 5: Создайте третий файл
Шаг 6: В Thought: "[Чеклист: file1 ✓ | file2 ✓ | file3 ✓] Все файлы созданы ✓"

ПЛАНИРОВАНИЕ:
Если задача требует создания плана И файлов — сначала createPlan или writeFile для плана, потом сразу начинайте создавать файлы. Не останавливайтесь только на плане!

РЕФАКТОРИНГ КОДА:
При замене переменных (например temp → result) используйте ГЛОБАЛЬНУЮ замену ВСХ вхождений. Убедитесь что старое имя не осталось ни в одном месте. Используйте grep(pattern) для проверки.

ЧЕКЛИСТ ПОСЛЕ КАЖДОГО ШАГА:
- Какие файлы уже созданы?
- Какие файлы ещё нужно создать?
- Все ли требования задачи выполнены?

Пример 1 — создание файла в директории:
Задача: Создай config/settings.json с {"debug": true, "port": 3000}
Action: writeFile[{"path": "config/settings.json", "content": "{\"debug\": true, \"port\": 3000}"}]
Observation: Файл успешно записан
config/settings.json создан ✓

Пример 2 — чтение, обработка, запись:
Задача: Прочитай data.json, добавь "processed": true, сохрани
Action: readFile[{"path": "data.json"}]
Observation: [{"id": 1, "name": "Alice"}]
Action: writeFile[{"path": "data.json", "content": "[{\"id\": 1, \"name\": \"Alice\", \"processed\": true}]"}]
Observation: Файл успешно записан
data.json обновлён ✓

Пример 3 — чтение директории и запись списка:
Задача: Просмотри директорию и запиши список файлов в listing.txt
Action: readDir[{}]
Observation: file1.txt, file2.ts, readme.md
Action: writeFile[{"path": "listing.txt", "content": "file1.txt\nfile2.ts\nreadme.md"}]
Observation: Файл успешно записан
listing.txt создан ✓

Пример 4 — создание нескольких файлов (КРИТИЧЕСКИ ВАЖНО):
Задача: Создай структуру: config/settings.json, src/index.ts, README.md
Action: writeFile[{"path": "config/settings.json", "content": "{\"debug\": true, \"port\": 3000}"}]
Observation: Файл успешно записан
[Чеклист: config/settings.json ✓ | src/index.ts — нужно создать | README.md — нужно создать]
Action: writeFile[{"path": "src/index.ts", "content": "export const main = () => { console.log('hello') }"}]
Observation: Файл успешно записан
[Чеклист: config/settings.json ✓ | src/index.ts ✓ | README.md — нужно создать]
Action: writeFile[{"path": "README.md", "content": "# My Project"}]
Observation: Файл успешно записан
[Чеклист: config/settings.json ✓ | src/index.ts ✓ | README.md ✓]
Все 3 файла создано ✓ Задача завершена.

Пример 5 — чтение нескольких файлов и объединение:
Задача: Прочитай все users_*.json файлы, объедини в один, сохрани в all_users.json
Action: readDir[{}]
Observation: users_1.json, users_2.json, users_3.json
Action: readFile[{"path": "users_1.json"}]
Observation: [{"name": "Alice", "age": 25}]
Action: readFile[{"path": "users_2.json"}]
Observation: [{"name": "Bob", "age": 30}]
Action: readFile[{"path": "users_3.json"}]
Observation: [{"name": "Eve", "age": 22}]
[Прочитано 3 файла. Все данные получены. ТЕПЕРЬ запишите объединённый результат!]
Action: writeFile[{"path": "all_users.json", "content": "[{\"name\": \"Alice\", \"age\": 25}, {\"name\": \"Bob\", \"age\": 30}, {\"name\": \"Eve\", \"age\": 22}]"}]
Observation: Файл успешно записан
all_users.json создан ✓ Задача завершена.

Пример 6 — поиск строки в файле:
Задача: Найди все строки с "error" в log.txt
Action: grep[{"pattern": "error", "files": "log.txt"}]
Observation: line 3: error: connection failed
line 7: error: timeout

Пример 7 — создание структуры файлов (ТИПИЧНЫЙ ПАТТЕРН):
Задача: Создай структуру: config/settings.json, src/index.ts, README.md
Action: writeFile[{"path": "config/settings.json", "content": "{\"debug\": true, \"port\": 3000}"}]
Observation: Файл успешно записан
[Чеклист: config/settings.json ✓ | src/index.ts ✗ | README.md ✗]
Action: writeFile[{"path": "src/index.ts", "content": "export const main = () => { console.log('hello') }"}]
Observation: Файл успешно записан
[Чеклист: config/settings.json ✓ | src/index.ts ✓ | README.md ✗]
Action: writeFile[{"path": "README.md", "content": "# My Project"}]
Observation: Файл успешно записан
[Чеклист: config/settings.json ✓ | src/index.ts ✓ | README.md ✓]
Все файлы созданы ✓ Задача завершена.

Пример 8 — план + выполнение (НЕ ОСТАНАВЛИВАЙТЕСЬ НА ПЛАНЕ!):
Задача: Создай план и файлы для todo-приложения
Action: writeFile[{"path": "PLAN.md", "content": "# Todo App\n## Структура\n- index.html\n- style.css\n- app.js"}]
Observation: Файл успешно записан
[План создан ✓ | index.html ✗ | style.css ✗ | app.js ✗]
Action: writeFile[{"path": "index.html", "<!DOCTYPE html><html><head><link rel=\"stylesheet\" href=\"style.css\"></head><body><div id=\"app\"></div><script src=\"app.js\"></script></body></html>"}]
Observation: Файл успешно записан
[План ✓ | index.html ✓ | style.css ✗ | app.js ✗]
Action: writeFile[{"path": "style.css", "content": "body { font-family: sans-serif; }"}]
Observation: Файл успешно записан
[План ✓ | index.html ✓ | style.css ✓ | app.js ✗]
Action: writeFile[{"path": "app.js", "content": "const tasks = []; function addTask(t) { tasks.push(t); }"}]
Observation: Файл успешно записан
[План ✓ | index.html ✓ | style.css ✓ | app.js ✓]
Все файлы созданы ✓ Задача завершена.`;

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
      // Если модель 3+ шага не вызывает инструмент — подталкиваем
      if (emptySteps >= 3) {
        history.push({ role: 'user',
          content: `ВНИМАНИЕ: вы уже ${emptySteps} шага не вызываете инструмент! Немедленно выполните действие через Action: имя[{"ключ": "значение"}]. Если вы завершили задачу — запишите результат в файл через writeFile.` });
        emptySteps = 0;
        continue;
      }
      if (step <= 3) {
        history.push({ role: 'user',
          content: `ВЫ НЕ ВЫЗВАЛИ ИНСТРУМЕНТ! Это шаг ${step}. Вызовите инструмент прямо сейчас в формате: Action: имя[{"ключ": "значение"}]. Например: Action: writeFile[{"path": "output.txt", "content": "hello"}]` });
        continue;
      }
      callbacks?.onComplete?.(step);
      return { steps: step, toolCalls };
    }
    emptySteps = 0; // сбрасываем счётчик при успешном Action

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

    const truncatedResult = result.length > 800
      ? result.substring(0, 800) + `\n... [обрезано, всего ${result.length} символов]`
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

    history.push({ role: 'user', content: `Observation: ${truncatedResult}` });

    // Если модель прочитала данные 2 шага назад но не записала — подталкиваем
    if (lastReadStep > 0 && step - lastReadStep >= 2 && filesCreated.length === 0) {
      // v7: Более конкретная подсказка с именем файла (Гипотеза 4)
      const lastReadCall = toolCalls.filter(c => c.tool === 'readDir' || c.tool === 'readFile').pop();
      const readTarget = lastReadCall?.args?.path || 'файл';
      history.push({ role: 'user',
        content: `Вы прочитали "${readTarget}" ${step - lastReadStep} шага назад. Результат получен. ТЕПЕРЬ запишите обработанный результат в требуемый выходной файл через writeFile. Не читайте больше — записывайте!` });
      lastReadStep = 0; // сбрасываем чтобы не спамить
    }

    // Если модель сделала 3+ шага но не записала ни одного файла — подталкиваем
    if (step >= 3 && filesCreated.length === 0 && (action.name === 'readDir' || action.name === 'readFile')) {
      history.push({ role: 'user',
        content: `ВНИМАНИЕ: шаг ${step}, создано файлов: 0. Вы только читаете но не записываете результат. Немедленно используйте writeFile для сохранения результата задачи.` });
    }

    // v8: Если агент создал план но не создал файлы — подталкиваем к выполнению
    if (action.name === 'createPlan' && step < maxSteps - 2) {
      history.push({ role: 'user',
        content: 'План создан. ТЕПЕРЬ немедленно начинайте создавать файлы из плана. Используйте writeFile для каждого файла.' });
    }

    // v8: Если агент создал только 1 файл а задача требует больше — подталкиваем
    if (action.name === 'writeFile' && filesCreated.length === 1) {
      const userPrompt = history.length > 1 ? history[1].content || '' : '';
      const multiFileKeywords = ['структуру', 'файлы:', 'следующую', 'структура файлов', 'создай:', ' - '];
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

  callbacks?.onComplete?.(maxSteps);
  return { steps: maxSteps, toolCalls };
}

export interface ToolCallRecord {
  step: number;
  tool: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
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
