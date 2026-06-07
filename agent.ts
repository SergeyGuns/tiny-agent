import * as fs from 'fs';
import * as cp from 'child_process';
import * as path from 'path';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

// --- НАСТРОЙКИ ЦВЕТА TERMINAL (ANSI) ---
const C = {
  reset: "\x1b[0m", bright: "\x1b[1m", dim: "\x1b[2m",
  blue: "\x1b[34m", yellow: "\x1b[33m", cyan: "\x1b[36m",
  magenta: "\x1b[35m", green: "\x1b[32m", red: "\x1b[31m"
};

interface Message { role: 'system' | 'user' | 'assistant'; content: string; }
type ToolFunction = (args: any) => Promise<string> | string;

// Внедрение явного шага "Plan" перед размышлениями
const SYSTEM_PROMPT = `Вы — автономный AI-агент с модулем планирования. 
На каждом шаге вы обязаны генерировать текст строго в следующем формате:

Plan: Текущий пошаговый план (обновляйте его при изменении ситуации).
Thought: Текущее рассуждение о выполняемом шаге.
Action: имя_инструмента[{"ключ": "значение"}]

Важно: Аргументы внутри [] ДОЛЖНЫ быть валидным JSON.
Если задача решена, не пишите Action, выдайте финальный ответ.`;

// --- ИНСТРУМЕНТЫ (Без изменений) ---
const tools: Record<string, ToolFunction> = {
  webSearch: async (args: { query: string }) => {
    try {
      const apiKey = process.env.SERPER_API_KEY;
      if (!apiKey) return 'Ошибка: Не задан SERPER_API_KEY.';
      const res = await fetch('https://serper.dev', {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: args.query })
      });
      const data = await res.json() as any;
      return data.organic?.map((i: any) => `${i.title}: ${i.snippet}`).join('\n') || 'Ничего не найдено';
    } catch (e: any) { return `Ошибка поиска: ${e.message}`; }
  },
  readDir: (args: { path: string }) => {
    try { return fs.readdirSync(path.resolve(args.path || '.')).join(', '); } 
    catch (e: any) { return `Ошибка: ${e.message}`; }
  },
  readFile: (args: { path: string }) => {
    try { return fs.readFileSync(path.resolve(args.path), 'utf-8'); } 
    catch (e: any) { return `Ошибка: ${e.message}`; }
  },
  writeFile: (args: { path: string; content: string }) => {
    try { fs.writeFileSync(path.resolve(args.path), args.content, 'utf-8'); return 'Файл успешно записан'; } 
    catch (e: any) { return `Ошибка: ${e.message}`; }
  },
  runPackageScript: async (args: { script: string }) => {
    try {
      if (!fs.existsSync('package.json')) return 'Ошибка: package.json не найден.';
      return new Promise((res) => {
        cp.exec(`npm run ${args.script}`, (err, stdout, stderr) => {
          res([stdout, stderr].filter(Boolean).join('\n') || 'Выполнено.');
        });
      });
    } catch (e: any) { return `Ошибка: ${e.message}`; }
  }
};

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
function parseAction(text: string): { name: string; args: any } | null {
  const match = text.match(/Action:\s*(\w+)\[([\s\S]*?)\]/);
  if (!match) return null;
  try { return { name: match[1].trim(), args: JSON.parse(match[2].trim()) }; } 
  catch { return { name: match[1].trim(), args: { error: 'Невалидный JSON' } }; }
}

async function queryLLM(messages: Message[]): Promise<string> {
      // LM Studio по умолчанию слушает порт 1234
  const baseUrl = process.env.LM_STUDIO_URL || 'http://localhost:1234/v1';
  
  // Укажите точное имя модели из LM Studio или оставьте пустую строку
  const modelName = process.env.LM_STUDIO_MODEL || 'local-model';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName, messages, temperature: 1 })
  });
  const data = await response.json() as any;
  return data.choices[0].message.content;
}

// Красивое форматирование вывода в терминал
function renderTUIOutput(text: string) {
  const formatted = text
    .replace(/^Plan:/gm, `${C.blue}${C.bright}📋 ПЛАН:${C.reset}`)
    .replace(/^Thought:/gm, `${C.yellow}${C.bright}🤔 МЫСЛЬ:${C.reset}`)
    .replace(/^Action:/gm, `${C.cyan}${C.bright}🛠️ ДЕЙСТВИЕ:${C.reset}`);
  console.log(formatted);
}

// --- СТРУКТУРА АГЕНТА И ИНТЕРФЕЙСА ---
export class TuiAgent {
  private history: Message[] = [];
  constructor(private maxSteps = 10) {
    this.history.push({ role: 'system', content: SYSTEM_PROMPT });
  }

  async execute(userQuery: string): Promise<void> {
    this.history.push({ role: 'user', content: userQuery });

    for (let step = 1; step <= this.maxSteps; step++) {
      console.log(`${C.dim}─`.repeat(50) + ` [Шаг ${step}]` + C.reset);
      
      const response = await queryLLM(this.history);
      this.history.push({ role: 'assistant', content: response });
      
      renderTUIOutput(response);

      const action = parseAction(response);
      if (!action) {
        console.log(`\n${C.green}${C.bright}🏁 РЕЗУЛЬТАТ:${C.reset} Задача выполнена успешно.\n`);
        return;
      }

      if (action.args.error) {
        console.log(`${C.red}❌ ОШИБКА ПАРСИНГА JSON${C.reset}`);
        this.history.push({ role: 'user', content: `Observation: Ошибка аргументов.` });
        continue;
      }

      console.log(`${C.cyan}⚙️ Выполняю инструментальный вызов...${C.reset}`);
      const observation = await tools[action.name]?.(action.args) || 'Инструмент не найден';
      
      console.log(`${C.magenta}${C.bright}👁️ НАБЛЮДЕНИЕ:${C.reset}\n${observation}\n`);
      this.history.push({ role: 'user', content: `Observation: ${observation}` });
    }
    console.log(`${C.red}🛑 Превышен лимит шагов выполнения.${C.reset}`);
  }
}

// --- ИНТЕРАКТИВНЫЙ TUI ЦИКЛ ---
async function startTUI() {


  const rl = readline.createInterface({ input, output });
  console.clear();
  console.log(`${C.green}${C.bright}🤖 МИНИМАЛИСТИЧНЫЙ TUI LLM-АГЕНТ ЗАПУЩЕН${C.reset}`);
  console.log(`${C.dim}Введите команду для выполнения (или 'exit' для выхода)${C.reset}\n`);

  while (true) {
    const query = await rl.question(`${C.bright}👤 Вы > ${C.reset}`);
    if (query.toLowerCase() === 'exit') break;
    if (!query.trim()) continue;

    const agent = new TuiAgent();
    await agent.execute(query);
  }
  rl.close();
}

// Запуск интерфейса
startTUI();
