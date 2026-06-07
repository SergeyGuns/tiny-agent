"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TuiAgent = void 0;
const fs = __importStar(require("fs"));
const cp = __importStar(require("child_process"));
const path = __importStar(require("path"));
const readline = __importStar(require("readline/promises"));
const process_1 = require("process");
// --- НАСТРОЙКИ ЦВЕТА TERMINAL (ANSI) ---
const C = {
    reset: "\x1b[0m", bright: "\x1b[1m", dim: "\x1b[2m",
    blue: "\x1b[34m", yellow: "\x1b[33m", cyan: "\x1b[36m",
    magenta: "\x1b[35m", green: "\x1b[32m", red: "\x1b[31m"
};
// Внедрение явного шага "Plan" перед размышлениями
const SYSTEM_PROMPT = `Вы — автономный AI-агент с модулем планирования. 
На каждом шаге вы обязаны генерировать текст строго в следующем формате:

Plan: Текущий пошаговый план (обновляйте его при изменении ситуации).
Thought: Текущее рассуждение о выполняемом шаге.
Action: имя_инструмента[{"ключ": "значение"}]

Важно: Аргументы внутри [] ДОЛЖНЫ быть валидным JSON.
Если задача решена, не пишите Action, выдайте финальный ответ.`;
// --- ИНСТРУМЕНТЫ (Без изменений) ---
const tools = {
    webSearch: async (args) => {
        try {
            const apiKey = process.env.SERPER_API_KEY;
            if (!apiKey)
                return 'Ошибка: Не задан SERPER_API_KEY.';
            const res = await fetch('https://serper.dev', {
                method: 'POST',
                headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ q: args.query })
            });
            const data = await res.json();
            return data.organic?.map((i) => `${i.title}: ${i.snippet}`).join('\n') || 'Ничего не найдено';
        }
        catch (e) {
            return `Ошибка поиска: ${e.message}`;
        }
    },
    readDir: (args) => {
        try {
            return fs.readdirSync(path.resolve(args.path || '.')).join(', ');
        }
        catch (e) {
            return `Ошибка: ${e.message}`;
        }
    },
    readFile: (args) => {
        try {
            return fs.readFileSync(path.resolve(args.path), 'utf-8');
        }
        catch (e) {
            return `Ошибка: ${e.message}`;
        }
    },
    writeFile: (args) => {
        try {
            fs.writeFileSync(path.resolve(args.path), args.content, 'utf-8');
            return 'Файл успешно записан';
        }
        catch (e) {
            return `Ошибка: ${e.message}`;
        }
    },
    runPackageScript: async (args) => {
        try {
            if (!fs.existsSync('package.json'))
                return 'Ошибка: package.json не найден.';
            return new Promise((res) => {
                cp.exec(`npm run ${args.script}`, (err, stdout, stderr) => {
                    res([stdout, stderr].filter(Boolean).join('\n') || 'Выполнено.');
                });
            });
        }
        catch (e) {
            return `Ошибка: ${e.message}`;
        }
    }
};
// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
function parseAction(text) {
    const match = text.match(/Action:\s*(\w+)\[([\s\S]*?)\]/);
    if (!match)
        return null;
    try {
        return { name: match[1].trim(), args: JSON.parse(match[2].trim()) };
    }
    catch {
        return { name: match[1].trim(), args: { error: 'Невалидный JSON' } };
    }
}
async function queryLLM(messages) {
    // LM Studio по умолчанию слушает порт 1234
    const baseUrl = process.env.LM_STUDIO_URL || 'http://localhost:1234/v1';
    // Укажите точное имя модели из LM Studio или оставьте пустую строку
    const modelName = process.env.LM_STUDIO_MODEL || 'local-model';
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, messages, temperature: 1 })
    });
    const data = await response.json();
    return data.choices[0].message.content;
}
// Красивое форматирование вывода в терминал
function renderTUIOutput(text) {
    const formatted = text
        .replace(/^Plan:/gm, `${C.blue}${C.bright}📋 ПЛАН:${C.reset}`)
        .replace(/^Thought:/gm, `${C.yellow}${C.bright}🤔 МЫСЛЬ:${C.reset}`)
        .replace(/^Action:/gm, `${C.cyan}${C.bright}🛠️ ДЕЙСТВИЕ:${C.reset}`);
    console.log(formatted);
}
// --- СТРУКТУРА АГЕНТА И ИНТЕРФЕЙСА ---
class TuiAgent {
    maxSteps;
    history = [];
    constructor(maxSteps = 10) {
        this.maxSteps = maxSteps;
        this.history.push({ role: 'system', content: SYSTEM_PROMPT });
    }
    async execute(userQuery) {
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
exports.TuiAgent = TuiAgent;
// --- ИНТЕРАКТИВНЫЙ TUI ЦИКЛ ---
async function startTUI() {
    const rl = readline.createInterface({ input: process_1.stdin, output: process_1.stdout });
    console.clear();
    console.log(`${C.green}${C.bright}🤖 МИНИМАЛИСТИЧНЫЙ TUI LLM-АГЕНТ ЗАПУЩЕН${C.reset}`);
    console.log(`${C.dim}Введите команду для выполнения (или 'exit' для выхода)${C.reset}\n`);
    while (true) {
        const query = await rl.question(`${C.bright}👤 Вы > ${C.reset}`);
        if (query.toLowerCase() === 'exit')
            break;
        if (!query.trim())
            continue;
        const agent = new TuiAgent();
        await agent.execute(query);
    }
    rl.close();
}
// Запуск интерфейса
startTUI();
