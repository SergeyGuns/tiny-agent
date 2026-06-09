// ═══════════════════════════════════════════════════════════════
// RES: GAIA Style — многошаговое исследование и планирование
// ═══════════════════════════════════════════════════════════════

import type { Task } from '../types.js';

export const researchTasks: Task[] = [
  // ── EASY ───────────────────────────────────────────────────
  {
    id: 'RES-001',
    category: 'research',
    difficulty: 'easy',
    title: 'Факт-чекинг',
    description: 'Найти и проверить факт',
    prompt: 'Найди в интернете столицу Австралии и запиши ответ в файл answer.txt в формате: Столица Австралии: [название]',
    evaluate: async (ctx) => {
      const checks = [];
      const content = ctx.writtenFiles.get('answer.txt');
      checks.push({
        name: 'file_exists',
        passed: content !== undefined,
        weight: 1,
        message: content !== undefined ? 'answer.txt создан' : 'answer.txt не найден',
      });
      if (content) {
        const correct = content.toLowerCase().includes('canberra') || content.toLowerCase().includes('канберра');
        checks.push({
          name: 'correct_answer',
          passed: correct,
          weight: 2,
          message: correct ? 'Ответ верный' : `Ответ: "${content}"`,
        });
      }
      return scoreChecks(checks);
    },
  },
  {
    id: 'RES-002',
    category: 'research',
    difficulty: 'easy',
    title: 'Извлечение данных со страницы',
    description: 'Получить страницу и извлечь конкретные данные',
    prompt: 'Получи содержимое страницы https://httpbin.org/json и запиши в файл data.json только содержимое поля "slideshow" из JSON-ответа',
    evaluate: async (ctx) => {
      const checks = [];
      const content = ctx.writtenFiles.get('data.json');
      checks.push({
        name: 'file_exists',
        passed: content !== undefined,
        weight: 1,
        message: content !== undefined ? 'data.json создан' : 'data.json не найден',
      });
      if (content) {
        try {
          const data = JSON.parse(content);
          const hasSlideshow = data.slideshow !== undefined;
          checks.push({
            name: 'has_slideshow',
            passed: hasSlideshow,
            weight: 2,
            message: hasSlideshow ? 'Поле slideshow извлечено' : 'Поле slideshow не найдено',
          });
        } catch {
          checks.push({ name: 'valid_json', passed: false, weight: 1, message: 'Невалидный JSON' });
        }
      }
      return scoreChecks(checks);
    },
  },

  // ── MEDIUM ─────────────────────────────────────────────────
  {
    id: 'RES-003',
    category: 'research',
    difficulty: 'medium',
    title: 'Сравнительный анализ',
    description: 'Найти информацию о двух технологиях и сравнить',
    prompt: 'Проведи сравнительный анализ TypeScript и JavaScript:\n1. Найди основные различия\n2. Найди преимущества каждого\n3. Запиши в файл comparison.md в формате Markdown с заголовками:\n   # TypeScript vs JavaScript\n   ## Основные различия\n   ## Преимущества TypeScript\n   ## Преимущества JavaScript\n   ## Вывод',
    evaluate: async (ctx) => {
      const checks = [];
      const content = ctx.writtenFiles.get('comparison.md');
      checks.push({
        name: 'file_exists',
        passed: content !== undefined,
        weight: 2,
        message: content !== undefined ? 'comparison.md создан' : 'comparison.md не найден',
      });
      if (content) {
        const hasDifferences = content.includes('различия') || content.includes('differences');
        const hasAdvantages = content.includes('преимущест') || content.includes('advantages');
        const hasConclusion = content.includes('вывод') || content.includes('conclusion');
        const searchCount = ctx.toolCalls.filter(c => c.tool === 'webSearch').length;

        checks.push({
          name: 'has_differences',
          passed: hasDifferences,
          weight: 1,
          message: hasDifferences ? 'Есть раздел различий' : 'Нет раздела различий',
        });
        checks.push({
          name: 'has_advantages',
          passed: hasAdvantages,
          weight: 1,
          message: hasAdvantages ? 'Есть раздел преимуществ' : 'Нет раздела преимуществ',
        });
        checks.push({
          name: 'has_conclusion',
          passed: hasConclusion,
          weight: 1,
          message: hasConclusion ? 'Есть вывод' : 'Нет вывода',
        });
        checks.push({
          name: 'used_search',
          passed: searchCount >= 1,
          weight: 1,
          message: `Поисков: ${searchCount}`,
        });
      }
      return scoreChecks(checks);
    },
  },
  {
    id: 'RES-004',
    category: 'research',
    difficulty: 'medium',
    title: 'Сбор информации из нескольких источников',
    description: 'Найти информацию из разных источников и агрегировать',
    prompt: 'Собери информацию о трёх лучших практиках (best practices) для работы с Git:\n1. Найди информацию в интернете\n2. Выбери 3 наиболее важные практики\n3. Запиши в файл git_best_practices.md:\n   - Название практики\n   - Краткое описание\n   - Пример команды (если применимо)',
    evaluate: async (ctx) => {
      const checks = [];
      const content = ctx.writtenFiles.get('git_best_practices.md');
      checks.push({
        name: 'file_exists',
        passed: content !== undefined,
        weight: 2,
        message: content !== undefined ? 'git_best_practices.md создан' : 'git_best_practices.md не найден',
      });
      if (content) {
        // Считаем упоминания практик (цифры, маркеры списков)
        const practiceMarkers = (content.match(/^\s*[\d\-\*]\s+/gm) || []).length;
        checks.push({
          name: 'has_practices',
          passed: practiceMarkers >= 3,
          weight: 2,
          message: `Найдено ${practiceMarkers} практик`,
        });
        const hasGit = content.toLowerCase().includes('git');
        checks.push({
          name: 'about_git',
          passed: hasGit,
          weight: 1,
          message: hasGit ? 'Тема — Git' : 'Тема не Git',
        });
      }
      return scoreChecks(checks);
    },
  },

  // ── HARD ───────────────────────────────────────────────────
  {
    id: 'RES-005',
    category: 'research',
    difficulty: 'hard',
    title: 'Исследование с синтезом',
    description: 'Исследовать тему и создать структурированный документ',
    prompt: 'Проведи исследование темы "Docker vs Podman":\n1. Найди что такое Docker и Podman\n2. Найди ключевые различия\n3. Найди преимущества и недостатки каждого\n4. Создай файл docker_vs_podman.md с полным отчётом:\n   # Docker vs Podman\n   ## Обзор\n   ## Архитектурные различия\n   ## Безопасность\n   ## Совместимость\n   ## Рекомендации по выбору',
    evaluate: async (ctx) => {
      const checks = [];
      const content = ctx.writtenFiles.get('docker_vs_podman.md');
      checks.push({
        name: 'file_exists',
        passed: content !== undefined,
        weight: 2,
        message: content !== undefined ? 'docker_vs_podman.md создан' : 'docker_vs_podman.md не найден',
      });
      if (content) {
        const sections = ['docker', 'podman', 'различия', 'безопасность', 'рекомендации'];
        const foundSections = sections.filter(s => content.toLowerCase().includes(s));
        checks.push({
          name: 'has_sections',
          passed: foundSections.length >= 3,
          weight: 3,
          message: `Разделов найдено: ${foundSections.length}/${sections.length}`,
        });
        const searchCount = ctx.toolCalls.filter(c => c.tool === 'webSearch').length;
        checks.push({
          name: 'multiple_searches',
          passed: searchCount >= 2,
          weight: 2,
          message: `Поисков: ${searchCount}`,
        });
      }
      return scoreChecks(checks);
    },
  },
  {
    id: 'RES-006',
    category: 'research',
    difficulty: 'hard',
    title: 'Отслеживание зависимостей',
    description: 'Найти зависимости проекта и проверить актуальность',
    prompt: 'Проанализируй зависимости проекта:\n1. Найди последнюю версию пакета "express" на npm\n2. Найди последнюю версию пакета "react" на npm\n3. Найди последнюю версию пакета "typescript" на npm\n4. Запиши в файл dependencies.md таблицу:\n   | Пакет | Последняя версия | Дата релиза |\n   |-------|-----------------|-------------|\n   | express | ... | ... |\n   | react | ... | ... |\n   | typescript | ... | ... |',
    evaluate: async (ctx) => {
      const checks = [];
      const content = ctx.writtenFiles.get('dependencies.md');
      checks.push({
        name: 'file_exists',
        passed: content !== undefined,
        weight: 2,
        message: content !== undefined ? 'dependencies.md создан' : 'dependencies.md не найден',
      });
      if (content) {
        const hasExpress = content.toLowerCase().includes('express');
        const hasReact = content.toLowerCase().includes('react');
        const hasTS = content.toLowerCase().includes('typescript');
        const hasTable = content.includes('|');
        const searchCount = ctx.toolCalls.filter(c => c.tool === 'webSearch').length;

        checks.push({
          name: 'has_express',
          passed: hasExpress,
          weight: 1,
          message: hasExpress ? 'Есть express' : 'Нет express',
        });
        checks.push({
          name: 'has_react',
          passed: hasReact,
          weight: 1,
          message: hasReact ? 'Есть react' : 'Нет react',
        });
        checks.push({
          name: 'has_typescript',
          passed: hasTS,
          weight: 1,
          message: hasTS ? 'Есть typescript' : 'Нет typescript',
        });
        checks.push({
          name: 'has_table',
          passed: hasTable,
          weight: 1,
          message: hasTable ? 'Есть таблица' : 'Нет таблицы',
        });
        checks.push({
          name: 'searches',
          passed: searchCount >= 3,
          weight: 2,
          message: `Поисков: ${searchCount}`,
        });
      }
      return scoreChecks(checks);
    },
  },

  // ── EXPERT ─────────────────────────────────────────────────
  {
    id: 'RES-007',
    category: 'research',
    difficulty: 'expert',
    title: 'Комплексное исследование с рекомендациями',
    description: 'Провести полное исследование и дать рекомендации',
    prompt: 'Проведи комплексное исследование для выбора базы данных для нового проекта:\n1. Сравни PostgreSQL, MongoDB и Redis по критериям:\n   - Тип данных (реляционная/документная/key-value)\n   - Производительность\n   - Масштабируемость\n   - Сложность настройки\n   - Сообщество и документация\n2. Для каждого найди актуальную версию\n3. Создай файл database_recommendation.md:\n   # Сравнение баз данных\n   ## PostgreSQL\n   ## MongoDB\n   ## Redis\n   ## Сравнительная таблица\n   ## Рекомендация (для какого проекта что лучше)',
    evaluate: async (ctx) => {
      const checks = [];
      const content = ctx.writtenFiles.get('database_recommendation.md');
      checks.push({
        name: 'file_exists',
        passed: content !== undefined,
        weight: 3,
        message: content !== undefined ? 'database_recommendation.md создан' : 'database_recommendation.md не найден',
      });
      if (content) {
        const hasPostgres = content.toLowerCase().includes('postgresql') || content.toLowerCase().includes('postgres');
        const hasMongo = content.toLowerCase().includes('mongodb') || content.toLowerCase().includes('mongo');
        const hasRedis = content.toLowerCase().includes('redis');
        const hasComparison = content.includes('|') || content.includes('сравнени');
        const hasRecommendation = content.includes('рекомендац') || content.includes('recommend');
        const searchCount = ctx.toolCalls.filter(c => c.tool === 'webSearch').length;

        checks.push({
          name: 'has_postgres',
          passed: hasPostgres,
          weight: 1,
          message: hasPostgres ? 'Есть PostgreSQL' : 'Нет PostgreSQL',
        });
        checks.push({
          name: 'has_mongodb',
          passed: hasMongo,
          weight: 1,
          message: hasMongo ? 'Есть MongoDB' : 'Нет MongoDB',
        });
        checks.push({
          name: 'has_redis',
          passed: hasRedis,
          weight: 1,
          message: hasRedis ? 'Есть Redis' : 'Нет Redis',
        });
        checks.push({
          name: 'has_comparison',
          passed: hasComparison,
          weight: 2,
          message: hasComparison ? 'Есть сравнение' : 'Нет сравнения',
        });
        checks.push({
          name: 'has_recommendation',
          passed: hasRecommendation,
          weight: 2,
          message: hasRecommendation ? 'Есть рекомендация' : 'Нет рекомендации',
        });
        checks.push({
          name: 'searches',
          passed: searchCount >= 3,
          weight: 2,
          message: `Поисков: ${searchCount}`,
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
