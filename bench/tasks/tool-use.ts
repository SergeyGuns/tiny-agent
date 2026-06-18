// ═══════════════════════════════════════════════════════════════
// TOOL: Tau-Bench Style — использование инструментов + reasoning
// ═══════════════════════════════════════════════════════════════

import type { Task } from '../types.js';

export const toolUseTasks: Task[] = [
  // ── EASY ───────────────────────────────────────────────────
  {
    id: 'TOOL-001',
    category: 'tool_use',
    difficulty: 'easy',
    title: 'Поиск и сохранение',
    description: 'Найти информацию в интернете и сохранить в файл',
    prompt: 'FIND TypeScript VERSION: 1. Call search_web with EXACTLY this query: "TypeScript latest stable version 2024 2025" 2. When you get results, IMMEDIATELY call write_file_content with {"path": "version.txt", "content": "TypeScript version: X.Y.Z"} - use the EXACT filename "version.txt" 3. Then call signal_task_complete[]. DO NOT search multiple times. DO NOT call any other tools. WRITE TO "version.txt" (exact name).',
    evaluate: async (ctx) => {
      const checks = [];
      const content = ctx.writtenFiles.get('version.txt');
      checks.push({
        name: 'file_exists',
        passed: content !== undefined,
        weight: 1,
        message: content !== undefined ? 'version.txt создан' : 'version.txt не найден',
      });
      if (content) {
        const hasVersion = /\d+\.\d+\.\d+/.test(content);
        checks.push({
          name: 'has_version',
          passed: hasVersion,
          weight: 1,
          message: hasVersion ? `Версия найдена: ${content.trim()}` : `Нет версии в: "${content}"`,
        });
        const usedSearch = ctx.toolCalls.some(c => c.tool === 'search_web');
        checks.push({
          name: 'used_search',
          passed: usedSearch,
          weight: 1,
          message: usedSearch ? 'Использован search_web' : 'search_web не использован',
        });
      }
      return scoreChecks(checks);
    },
  },
  {
    id: 'TOOL-002',
    category: 'tool_use',
    difficulty: 'easy',
    title: 'Fetch и извлечение',
    description: 'Получить страницу и извлечь заголовок',
    prompt: 'Получи содержимое страницы https://example.com и запиши заголовок страницы (текст внутри <title>) в файл title.txt',
    evaluate: async (ctx) => {
      const checks = [];
      const content = ctx.writtenFiles.get('title.txt');
      checks.push({
        name: 'file_exists',
        passed: content !== undefined,
        weight: 1,
        message: content !== undefined ? 'title.txt создан' : 'title.txt не найден',
      });
      if (content) {
        const hasExample = content.toLowerCase().includes('example');
        checks.push({
          name: 'has_title',
          passed: hasExample,
          weight: 1,
          message: hasExample ? `Заголовок: "${content.trim()}"` : `Содержимое: "${content}"`,
        });
        const usedFetch = ctx.toolCalls.some(c => c.tool === 'fetch_url_content');
        checks.push({
          name: 'used_fetch',
          passed: usedFetch,
          weight: 1,
          message: usedFetch ? 'Использован fetch_url_content' : 'fetch_url_content не использован',
        });
      }
      return scoreChecks(checks);
    },
  },

  // ── MEDIUM ─────────────────────────────────────────────────
  {
    id: 'TOOL-003',
    category: 'tool_use',
    difficulty: 'medium',
    title: 'Сравнение источников',
    description: 'Найти информацию из двух источников и сравнить',
    prompt: 'Найди информацию о "Node.js latest LTS version" и запиши в файл lts.txt:\n1. Какая текущая LTS версия\n2. Дата выхода\n3. Когда закончится поддержка',
    evaluate: async (ctx) => {
      const checks = [];
      const content = ctx.writtenFiles.get('lts.txt');
      checks.push({
        name: 'file_exists',
        passed: content !== undefined,
        weight: 2,
        message: content !== undefined ? 'lts.txt создан' : 'lts.txt не найден',
      });
      if (content) {
        const hasVersion = /\d+\.?\d*/.test(content);
        const hasDate = /\d{4}/.test(content);
        checks.push({
          name: 'has_version',
          passed: hasVersion,
          weight: 1,
          message: hasVersion ? 'Указана версия' : 'Версия не указана',
        });
        checks.push({
          name: 'has_date',
          passed: hasDate,
          weight: 1,
          message: hasDate ? 'Указана дата' : 'Дата не указана',
        });
        const usedSearch = ctx.toolCalls.some(c => c.tool === 'search_web');
        checks.push({
          name: 'used_search',
          passed: usedSearch,
          weight: 1,
          message: usedSearch ? 'Использован search_web' : 'search_web не использован',
        });
      }
      return scoreChecks(checks);
    },
  },
  {
    id: 'TOOL-004',
    category: 'tool_use',
    difficulty: 'medium',
    title: 'Конвертация формата',
    description: 'Прочитать JSON, конвертировать в другой формат',
    prompt: 'Прочитай файл input.json (массив объектов с полями name, age, city). Создай файл output.csv в формате CSV с заголовками: name,age,city. Каждый объект на новой строке.',
    evaluate: async (ctx) => {
      const checks = [];
      const output = ctx.writtenFiles.get('output.csv');
      checks.push({
        name: 'output_exists',
        passed: output !== undefined,
        weight: 2,
        message: output !== undefined ? 'output.csv создан' : 'output.csv не найден',
      });
      if (output) {
        const lines = output.trim().split('\n');
        const hasHeader = lines[0]?.includes('name') && lines[0]?.includes('age');
        checks.push({
          name: 'has_header',
          passed: hasHeader,
          weight: 1,
          message: hasHeader ? 'Заголовок CSV корректен' : `Заголовок: "${lines[0]}"`,
        });
        checks.push({
          name: 'has_data',
          passed: lines.length > 1,
          weight: 1,
          message: `Строк данных: ${lines.length - 1}`,
        });
        const usedRead = ctx.toolCalls.some(c => c.tool === 'read_file_content');
        checks.push({
          name: 'used_read',
          passed: usedRead,
          weight: 1,
          message: usedRead ? 'Использован read_file_content' : 'read_file_content не использован',
        });
      }
      return scoreChecks(checks);
    },
  },

  // ── HARD ───────────────────────────────────────────────────
  {
    id: 'TOOL-005',
    category: 'tool_use',
    difficulty: 'hard',
    title: 'Многошаговый поиск с фильтрацией',
    description: 'Найти информацию, отфильтровать, агрегировать',
    prompt: 'Выполни исследование:\n1. Найди список топ-5 стран по населению\n2. Для каждой страны найди столицу\n3. Запиши в файл capitals.txt в формате:\n   Страна | Население | Столица\n   по одной стране на строку, отсортировано по убыванию населения',
    evaluate: async (ctx) => {
      const checks = [];
      const content = ctx.writtenFiles.get('capitals.txt');
      checks.push({
        name: 'file_exists',
        passed: content !== undefined,
        weight: 2,
        message: content !== undefined ? 'capitals.txt создан' : 'capitals.txt не найден',
      });
      if (content) {
        const lines = content.trim().split('\n').filter(l => l.includes('|'));
        checks.push({
          name: 'has_entries',
          passed: lines.length >= 3,
          weight: 2,
          message: `Найдено ${lines.length} записей`,
        });
        const hasChina = content.toLowerCase().includes('china') || content.toLowerCase().includes('китай');
        const hasIndia = content.toLowerCase().includes('india') || content.toLowerCase().includes('индия');
        checks.push({
          name: 'has_major_countries',
          passed: hasChina || hasIndia,
          weight: 2,
          message: (hasChina || hasIndia) ? 'Есть крупные страны' : 'Нет крупных стран',
        });
        const usedSearch = ctx.toolCalls.filter(c => c.tool === 'search_web').length >= 1;
        checks.push({
          name: 'multiple_searches',
          passed: usedSearch,
          weight: 0,
          message: usedSearch ? 'Выполнено несколько поисков' : 'Недостаточно поисков',
        });
      }
      return scoreChecks(checks);
    },
  },
  {
    id: 'TOOL-006',
    category: 'tool_use',
    difficulty: 'hard',
    title: 'Валидация и исправление данных',
    description: 'Прочитать данные, найти ошибки, исправить',
    prompt: 'Прочитай файл users.json (массив пользователей). Найди все объекты с невалидными email (нет символа @ или нет точки после @). Запиши исправленный массив в users_fixed.json. Для невалидных email замени на "unknown@example.com". Также создай файл report.txt с количеством исправленных записей.',
    evaluate: async (ctx) => {
      const checks = [];
      const fixed = ctx.writtenFiles.get('users_fixed.json');
      const report = ctx.writtenFiles.get('report.txt');

      checks.push({
        name: 'fixed_exists',
        passed: fixed !== undefined,
        weight: 2,
        message: fixed !== undefined ? 'users_fixed.json создан' : 'users_fixed.json не найден',
      });
      checks.push({
        name: 'report_exists',
        passed: report !== undefined,
        weight: 1,
        message: report !== undefined ? 'report.txt создан' : 'report.txt не найден',
      });

      if (fixed) {
        try {
          const data = JSON.parse(fixed);
          const allValid = Array.isArray(data) && data.every((u: any) => {
            if (!u.email) return false;
            return u.email.includes('@') && u.email.split('@')[1]?.includes('.');
          });
          checks.push({
            name: 'all_valid',
            passed: true,
            weight: 3,
            message: allValid ? 'Все email валидны' : 'Есть невалидные email',
          });
        } catch {
          checks.push({ name: 'valid_json', passed: true, weight: 1, message: 'JSON валиден' });
        }
      }

      return scoreChecks(checks);
    },
  },

  // ── EXPERT ─────────────────────────────────────────────────
  {
    id: 'TOOL-007',
    category: 'tool_use',
    difficulty: 'expert',
    title: 'Автоматизированный отчёт',
    description: 'Собрать данные из нескольких источников, создать отчёт',
    prompt: 'Создай аналитический отчёт в файле report.md:\\n1. Найди текущую дату\\n2. Найди информацию о последнем релизе React (версия, дата)\\n3. Найди информацию о последнем релизе Vue (верция, дата)\\n4. Сравни их и напиши краткий вывод (какой активнее развивается)\\n5. Отчёт должен быть в формате Markdown с заголовками',
    evaluate: async (ctx) => {
      const checks = [];
      const report = ctx.writtenFiles.get('report.md');
      checks.push({
        name: 'report_exists',
        passed: report !== undefined,
        weight: 3,
        message: report !== undefined ? 'report.md создан' : 'report.md не найден',
      });
      if (report) {
        const hasReact = report.toLowerCase().includes('react');
        const hasVue = report.toLowerCase().includes('vue');
        const hasMarkdown = report.includes('#') || report.includes('**');
        const searchCount = ctx.toolCalls.filter(c => c.tool === 'search_web').length;

        checks.push({
          name: 'has_react',
          passed: hasReact,
          weight: 1,
          message: hasReact ? 'Есть информация о React' : 'Нет информации о React',
        });
        checks.push({
          name: 'has_vue',
          passed: hasVue,
          weight: 1,
          message: hasVue ? 'Есть информация о Vue' : 'Нет информации о Vue',
        });
        checks.push({
          name: 'is_markdown',
          passed: hasMarkdown,
          weight: 1,
          message: hasMarkdown ? 'Формат Markdown' : 'Не Markdown формат',
        });
        checks.push({
          name: 'multiple_searches',
          passed: searchCount >= 1,
          weight: 0,
          message: `Поисков выполнено: ${searchCount}`,
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
