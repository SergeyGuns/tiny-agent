import * as fs from 'fs';
import * as cp from 'child_process';
import * as path from 'path';

// --- НАСТРОЙКИ ANSI ЦВЕТОВ ---
const C = {
  reset: "\x1b[0m", bright: "\x1b[1m", dim: "\x1b[2m",
  blue: "\x1b[34m", yellow: "\x1b[33m", cyan: "\x1b[36m",
  magenta: "\x1b[35m", green: "\x1b[32m", red: "\x1b[31m"
};

interface Message { role: 'system' | 'user' | 'assistant'; content: string; }

// --- МОДУЛЬ ЛОГИРОВАНИЯ ---
class AgentLogger {
  private logPath = path.resolve('session.log');
  
  clear() {
    if (fs.existsSync(this.logPath)) fs.unlinkSync(this.logPath);
  }

  log(step: number, role: string, text: string) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [Шаг ${step}] [${role.toUpperCase()}]\n${text}\n${'─'.repeat(40)}\n`;
    fs.appendFileSync(this.logPath, logEntry, 'utf-8');
  }

  readFullLog(): string {
    return fs.existsSync(this.logPath) ? fs.readFileSync(this.logPath, 'utf-8') : '';
  }
}

// --- СИСТЕМА ОТКАТА (GIT-BACKUP) ---
class WorkspaceManager {
  static makeSnapshot() {
    try {
      cp.execSync('git init && git add . && git commit -m "pre-agent snapshot"', { stdio: 'ignore' });
    } catch {
      // Если git уже инициализирован, просто создаем временную точку
      try { cp.execSync('git add . && git stash', { stdio: 'ignore' }); cp.execSync('git stash apply', { stdio: 'ignore' }); } catch {}
    }
  }

  static rollback() {
    try {
      cp.execSync('git reset --hard HEAD && git clean -fd', { stdio: 'inherit' });
      return "Изменения успешно откачены к исходному состоянию Git.";
    } catch (e: any) {
      return `Ошибка отката: ${e.message}`;
    }
  }

  static commit(message: string) {
    try {
      cp.execSync(`git add . && git commit -m "Agent: ${message}"`, { stdio: 'inherit' });
      return "Изменения успешно зафиксированы в Git.";
    } catch (e: any) {
      return `Ошибка фиксации: ${e.message}`;
    }
  }
}

// --- ОБЩИЙ КЛИЕНТ LLM ---
async function queryLLM(messages: Message[]): Promise<string> {
  // LM Studio по умолчанию слушает порт 1234
  const baseUrl = process.env.LM_STUDIO_URL || 'http://localhost:1234/v1';
  
  // Укажите точное имя модели из LM Studio или оставьте пустую строку
  const modelName = process.env.LM_STUDIO_MODEL || 'local-model';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': 'Bearer lm-studio' // Фиктивный токен для совместимости
    },
    body: JSON.stringify({
      model: modelName, 
      messages: messages,
      temperature: 1, // Важно для стабильности паттерна ReAct
    }),
  });

  if (!response.ok) {
    throw new Error(`LM Studio Error: ${response.statusText}`);
  }

  const data = await response.json() as any;
  return data.choices[0].message.content; // Исправлен путь к контенту в массиве choices
}

// --- 1. АГЕНТ-РАЗРАБОТЧИК (DEVELOPER AGENT) ---
export class DeveloperAgent {
  private history: Message[] = [];
  private logger = new AgentLogger();

  constructor(private maxSteps = 5) {
    this.history.push({
      role: 'system',
      content: `Вы — инженер-разработчик. Выполняйте задачу строго по шагам.
Формат:
Plan: План действий.
Thought: Рассуждение.
Action: имя_инструмента[{"ключ": "значение"}]

Доступные инструменты:
1. readFile[{"path": "путь"}]
2. writeFile[{"path": "путь", "content": "текст"}]
3. runPackageScript[{"script": "имя"}]`
    });
  }

  async run(userQuery: string, feedback: string = ''): Promise<boolean> {
    const task = feedback ? `Предыдущая попытка не удалась. Ошибка: ${feedback}. Исправь код.` : userQuery;
    this.history.push({ role: 'user', content: task });
    
    for (let step = 1; step <= this.maxSteps; step++) {
      const response = await queryLLM(this.history);
      this.history.push({ role: 'assistant', content: response });
      this.logger.log(step, 'developer', response);

      const match = response.match(/Action:\s*(\w+)\[([\s\S]*?)\]/);
      if (!match) return true; // Финал работы разработчика

      // Выполнение базовых инструментов (заглушка для краткости примера)
      let obs = "Выполнено успешно"; 
      this.history.push({ role: 'user', content: `Observation: ${obs}` });
      this.logger.log(step, 'observation', obs);
    }
    return true;
  }
}

// --- 2. АГЕНТ-СУПЕРВИЗОР (SUPERVISOR AGENT) ---
export class SupervisorAgent {
  private logger = new AgentLogger();

  constructor() {}

  async evaluateSession(originalQuery: string): Promise<{ decision: 'commit' | 'rollback' | 'retry'; reason: string }> {
    const sessionLogs = this.logger.readFullLog();
    
    const supervisorPrompt = `Вы — Агент-Супервизор качества кода и валидации сессий.
Перед вами лог работы Агента-Разработчика, который выполнял задачу: "${originalQuery}".

Изучите лог выполнения и финальный результат. Примите одно из трех решений:
1. Фиксация изменений. Если задача решена корректно, тесты прошли, ошибок нет.
Формат ответа: Decision: commit[{"message": "описание сделанного"}]

2. Полный откат. Если агент критически сломал структуру, стер файлы или пошел по ложному пути.
Формат ответа: Decision: rollback[{"reason": "почему всё плохо"}]

3. Повторная попытка (Улучшение). Если агент был близок, но совершил мелкую ошибку, синтаксический баг или не дописал логику.
Формат ответа: Decision: retry[{"feedback": "четкие инструкции, что исправить"}]

Вот лог сессии:
${sessionLogs}`;

    console.log(`\n${C.magenta}${C.bright}👁️ СУПЕРВИЗОР: Анализирую результаты сессии...${C.reset}`);
    
    const response = await queryLLM([{ role: 'system', content: supervisorPrompt }]);
    console.log(`${C.dim}${response}${C.reset}`);

    const match = response.match(/Decision:\s*(\w+)\[([\s\S]*?)\]/);
    if (!match) return { decision: 'rollback', reason: 'Супервизор не смог принять форматное решение.' };

    const type = match[1] as 'commit' | 'rollback' | 'retry';
    const args = JSON.parse(match[2]);

    return { decision: type, reason: args.message || args.reason || args.feedback };
  }
}

// --- 3. ОРКЕСТРАТОР СИСТЕМЫ (MAIN RUNNER) ---
async function startPipeline(userTask: string) {
  const baseUrl = process.env.LM_STUDIO_URL || 'http://localhost:1234/v1';
  const modelName = process.env.LM_STUDIO_MODEL || 'local-model';
  const logger = new AgentLogger();
  logger.clear();

  console.log(`${C.green}${C.bright}🚀 Старт сессии разработки. Создаем снимок рабочей зоны...${C.reset}`);
  WorkspaceManager.makeSnapshot();

  let feedback = '';
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`\n${C.blue}${C.bright}📦 Попытка Разработчика #${attempt}${C.reset}`);
    
    const dev = new DeveloperAgent();
    await dev.run(userTask, feedback);

    const supervisor = new SupervisorAgent();
    const evaluation = await supervisor.evaluateSession(userTask);

    if (evaluation.decision === 'commit') {
      console.log(`\n${C.green}${C.bright}✅ СУПЕРВИЗОР ОДОБРИЛ: ${evaluation.reason}${C.reset}`);
      WorkspaceManager.commit(evaluation.reason);
      break;
    } 
    
    if (evaluation.decision === 'rollback') {
      console.log(`\n${C.red}${C.bright}❌ СУПЕРВИЗОР ОТКЛОНИЛ ИЗМЕНЕНИЯ: ${evaluation.reason}${C.reset}`);
      WorkspaceManager.rollback();
      break;
    }

    if (evaluation.decision === 'retry') {
      console.log(`\n${C.yellow}${C.bright}🔄 СУПЕРВИЗОР ОТПРАВИЛ НА ДОРАБОТКУ: ${evaluation.reason}${C.reset}`);
      feedback = evaluation.reason; // Передаем инструкции на следующую итерацию
    }
  }
}
