// ═══════════════════════════════════════════════════════════════
// PLAN: Планирование и декомпозиция задач
// ═══════════════════════════════════════════════════════════════

import type { Task } from '../types.js';

export const planningTasks: Task[] = [
  // ── EASY ───────────────────────────────────────────────────
  {
    id: 'PLAN-001',
    category: 'planning',
    difficulty: 'easy',
    title: 'Простой план',
    description: 'Создать план и выполнить его',
    prompt: 'Use write_file_content tool (NOT write_plan_file) to create plan.txt with a step-by-step plan for creating a simple static HTML website. The plan must have at least 4 steps. Then use write_file_content tool to create index.html according to the plan. Put index.html in the current directory, not in a subdirectory.',
    evaluate: async (ctx) => {
      const checks = [];
      const plan = ctx.writtenFiles.get('plan.txt');
      const html = ctx.writtenFiles.get('index.html');

      checks.push({
        name: 'plan_exists',
        passed: plan !== undefined,
        weight: 1,
        message: plan !== undefined ? 'plan.txt создан' : 'plan.txt не найден',
      });
      if (plan) {
        const steps = plan.split('\n').filter(l => /\d\.|-|\*/.test(l.trim()) || l.trim().length > 10);
        checks.push({
          name: 'has_steps',
          passed: steps.length >= 2,
          weight: 1,
          message: `Шагов в плане: ${steps.length}`,
        });
      }
      checks.push({
        name: 'html_exists',
        passed: html !== undefined && html.includes('<html'),
        weight: 2,
        message: (html?.includes('<html')) ? 'index.html корректен' : 'index.html отсутствует или некорректен',
      });

      return scoreChecks(checks);
    },
  },

  // ── MEDIUM ─────────────────────────────────────────────────
  {
    id: 'PLAN-002',
    category: 'planning',
    difficulty: 'medium',
    title: 'Декомпозиция проекта',
    description: 'Разбить задачу на подзадачи и создать файлы',
    prompt: 'Спланируй и создай структуру для todo-приложения:\n1. Создай файл PLAN.md с описанием архитектуры (компоненты, структура файлов)\n2. Создай структуру файлов:\n   - index.html (разметка)\n   - style.css (стили)\n   - app.js (логика: добавление/удаление/отметка задач)\n3. Каждый файл должен быть рабочим (валидный HTML/CSS/JS)',
    evaluate: async (ctx) => {
      const checks = [];
      const plan = ctx.writtenFiles.get('PLAN.md');
      const html = ctx.writtenFiles.get('index.html');
      const css = ctx.writtenFiles.get('style.css');
      const js = ctx.writtenFiles.get('app.js');

      checks.push({
        name: 'plan_exists',
        passed: plan !== undefined,
        weight: 1,
        message: plan !== undefined ? 'PLAN.md создан' : 'PLAN.md не найден',
      });
      checks.push({
        name: 'html_exists',
        passed: html !== undefined && (html.includes('<!DOCTYPE') || html.includes('<html')),
        weight: 1,
        message: html ? 'index.html есть' : 'index.html отсутствует',
      });
      checks.push({
        name: 'css_exists',
        passed: css !== undefined && css.length > 10,
        weight: 1,
        message: css ? 'style.css есть' : 'style.css отсутствует',
      });
      checks.push({
        name: 'js_exists',
        passed: js !== undefined && js.length > 20,
        weight: 2,
        message: js ? 'app.js есть' : 'app.js отсутствует',
      });
      if (js) {
        const hasTodoLogic = js.includes('todo') || js.includes('task') || js.includes('add') || js.includes('delete');
        checks.push({
          name: 'has_logic',
          passed: hasTodoLogic,
          weight: 1,
          message: hasTodoLogic ? 'Есть логика для задач' : 'Нет логики для задач',
        });
      }

      return scoreChecks(checks);
    },
  },

  // ── HARD ───────────────────────────────────────────────────
  {
    id: 'PLAN-003',
    category: 'planning',
    difficulty: 'hard',
    title: 'Многофайловый проект с зависимостями',
    description: 'Спроектировать и создать многофайловый проект',
    prompt: 'Спланируй и создай проект API клиента:\n1. Создай ARCHITECTURE.md с описанием компонентов\n2. Создай:\n   - src/api.ts (класс ApiClient с методами get, post, put, delete)\n   - src/types.ts (типы: ApiResponse, ApiError, RequestConfig)\n   - src/index.ts (экспорты)\n   - package.json с name и version\n3. Каждый модуль должен быть связан с другими (импорты/экспорты)',
    evaluate: async (ctx) => {
      const checks = [];
      const arch = ctx.writtenFiles.get('ARCHITECTURE.md');
      const api = ctx.writtenFiles.get('src/api.ts');
      const types = ctx.writtenFiles.get('src/types.ts');
      const index = ctx.writtenFiles.get('src/index.ts');
      const pkg = ctx.writtenFiles.get('package.json');

      checks.push({
        name: 'architecture',
        passed: arch !== undefined,
        weight: 1,
        message: arch !== undefined ? 'ARCHITECTURE.md есть' : 'Нет ARCHITECTURE.md',
      });
      checks.push({
        name: 'api_ts',
        passed: api !== undefined && (api.includes('ApiClient') || api.includes('export') || api.includes('class')),
        weight: 1,
        message: api ? 'src/api.ts есть' : 'Нет src/api.ts',
      });
      checks.push({
        name: 'types_ts',
        passed: types !== undefined && types.includes('export'),
        weight: 1,
        message: types ? 'src/types.ts есть' : 'Нет src/types.ts',
      });
      checks.push({
        name: 'index_ts',
        passed: index !== undefined && index.includes('export'),
        weight: 1,
        message: index ? 'src/index.ts есть' : 'Нет src/index.ts',
      });
      checks.push({
        name: 'package_json',
        passed: pkg !== undefined,
        weight: 1,
        message: pkg ? 'package.json есть' : 'Нет package.json',
      });

      return scoreChecks(checks);
    },
  },

  // ── EXPERT ─────────────────────────────────────────────────
  {
    id: 'PLAN-004',
    category: 'planning',
    difficulty: 'expert',
    title: 'Полная декомпозиция с тестами',
    description: 'Спроектировать модуль с тестами и документацией',
    prompt: 'Спланируй и реализуй модуль для валидации email:\n1. Создай README.md с описанием модуля и инструкцией по запуску\n2. Создай src/validator.ts — функцию validateEmail(email: string): boolean\n3. Создай файл VALIDATION_RULES.md с описанием правил валидации (минимум 5 правил)\n4. Модуль должен экспортировать функцию через export',
    evaluate: async (ctx) => {
      const checks = [];
      const readme = ctx.writtenFiles.get('README.md');
      const validator = ctx.writtenFiles.get('src/validator.ts');
      const rules = ctx.writtenFiles.get('VALIDATION_RULES.md');

      checks.push({
        name: 'readme',
        passed: readme !== undefined && readme.includes('#'),
        weight: 1,
        message: readme ? 'README.md есть' : 'Нет README.md',
      });
      checks.push({
        name: 'validator',
        passed: validator !== undefined && validator.includes('export') && validator.includes('validateEmail'),
        weight: 3,
        message: (validator?.includes('validateEmail')) ? 'validator.ts корректен' : 'validator.ts некорректен',
      });
      checks.push({
        name: 'rules',
        passed: rules !== undefined,
        weight: 1,
        message: rules ? 'VALIDATION_RULES.md есть' : 'Нет VALIDATION_RULES.md',
      });
      if (rules) {
        const ruleLines = rules.split('\n').filter(l => /^\s*[\d\-\*]/.test(l.trim()));
        checks.push({
          name: 'min_rules',
          passed: ruleLines.length >= 5,
          weight: 2,
          message: `Правил: ${ruleLines.length} (нужно >= 5)`,
        });
      }
      if (validator) {
        const hasRegex = validator.includes('match') || validator.includes('test') || validator.includes('RegExp') || validator.includes('/[^');
        checks.push({
          name: 'has_validation',
          passed: hasRegex,
          weight: 2,
          message: hasRegex ? 'Есть логика валидации' : 'Нет логики валидации',
        });
      }

      return scoreChecks(checks);
    },
  },
];

function scoreChecks(checks: { name: string; passed: boolean; weight: number; message: string }[]) {
  const maxScore = checks.reduce((s, c) => s + c.weight, 0);
  const score = checks.filter(c => c.passed).reduce((s, c) => s + c.weight, 0);
  return {
    passed: score === maxScore,
    score,
    maxScore,
    details: checks,
  };
}
