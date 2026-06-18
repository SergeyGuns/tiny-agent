// ═══════════════════════════════════════════════════════════════
// TERM: Terminal-Bench Style — файловые операции
// ═══════════════════════════════════════════════════════════════

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Task } from '../types.js';

export const terminalTasks: Task[] = [
  // ── EASY ───────────────────────────────────────────────────
  {
    id: 'TERM-001',
    category: 'terminal',
    difficulty: 'easy',
    title: 'Создание файла',
    description: 'Создать файл с заданным содержимым',
    prompt: 'Создай файл hello.txt с содержимым "Hello, World!"',
    evaluate: async (ctx) => {
      const checks = [];
      const content = ctx.writtenFiles.get('hello.txt');
      checks.push({
        name: 'file_exists',
        passed: content !== undefined,
        weight: 1,
        message: content !== undefined ? 'Файл hello.txt создан' : 'Файл hello.txt не найден',
      });
      checks.push({
        name: 'content_correct',
        passed: content?.trim() === 'Hello, World!',
        weight: 1,
        message: content?.trim() === 'Hello, World!' ? 'Содержимое верно' : `Содержимое: "${content}"`,
      });
      return scoreChecks(checks);
    },
  },
  {
    id: 'TERM-002',
    category: 'terminal',
    difficulty: 'easy',
    title: 'Чтение и копирование',
    description: 'Прочитать файл и создать его копию',
    prompt: 'Прочитай файл source.txt и создай его копию как backup.txt',
    setup: async () => { /* workDir создаётся раннером */ },
    evaluate: async (ctx) => {
      const checks = [];
      const source = ctx.writtenFiles.get('source.txt');
      const backup = ctx.writtenFiles.get('backup.txt');
      // source.txt должен быть создан setup-ом или агент должен его найти
      // В данном случае setup создаёт source.txt
      checks.push({
        name: 'backup_exists',
        passed: backup !== undefined,
        weight: 1,
        message: backup !== undefined ? 'backup.txt создан' : 'backup.txt не найден',
      });
      return scoreChecks(checks);
    },
  },
  {
    id: 'TERM-003',
    category: 'terminal',
    difficulty: 'easy',
    title: 'Просмотр директории',
    description: 'Просмотреть содержимое директории и записать список файлов',
    prompt: 'Use list_directory tool to see files in current directory. Then use write_file_content tool to write the list to listing.txt (one file per line). You MUST create listing.txt before calling signal_task_complete.',
    evaluate: async (ctx) => {
      const checks = [];
      const listing = ctx.writtenFiles.get('listing.txt');
      checks.push({
        name: 'listing_exists',
        passed: listing !== undefined,
        weight: 1,
        message: listing !== undefined ? 'listing.txt создан' : 'listing.txt не найден',
      });
      if (listing) {
        const lines = listing.trim().split('\n').filter(l => l.trim());
        checks.push({
          name: 'has_entries',
          passed: lines.length >= 1,
          weight: 1,
          message: `Найдено ${lines.length} записей`,
        });
      }
      return scoreChecks(checks);
    },
  },

  // ── MEDIUM ─────────────────────────────────────────────────
  {
    id: 'TERM-004',
    category: 'terminal',
    difficulty: 'medium',
    title: 'Трансформация данных',
    description: 'Прочитать JSON, трансформировать, записать результат',
    prompt: 'Прочитай файл data.json, добавь к каждому объекту поле "processed": true и сохрани результат в data_processed.json',
    evaluate: async (ctx) => {
      const checks = [];
      const output = ctx.writtenFiles.get('data_processed.json');
      checks.push({
        name: 'output_exists',
        passed: output !== undefined,
        weight: 2,
        message: output !== undefined ? 'data_processed.json создан' : 'data_processed.json не найден',
      });
      if (output) {
        try {
          const data = JSON.parse(output);
          const isArray = Array.isArray(data);
          const allProcessed = isArray && data.every((item: any) => item.processed === true);
          checks.push({
                  name: 'valid_json',
                  passed: output !== undefined && output !== undefined ? true : false,
                  weight: 0,
                  message: output !== undefined ? 'JSON валиден' : 'JSON не валиден',
                });
          checks.push({
            name: 'all_processed',
            passed: allProcessed,
            weight: 2,
            message: allProcessed ? 'Все объекты имеют processed: true' : 'Не все объекты обработаны',
          });
        } catch {
          checks.push({
            name: 'valid_json',
            passed: false,
            weight: 1,
            message: 'Невалидный JSON',
          });
        }
      }
      return scoreChecks(checks);
    },
  },
  {
    id: 'TERM-005',
    category: 'terminal',
    difficulty: 'medium',
    title: 'Поиск и фильтрация',
    description: 'Найти файлы по паттерну и записать результаты',
    prompt: 'Найди все файлы с расширением .txt в текущей директории, прочитай каждый и запиши в файл summary.txt только те строки, которые содержат слово "important" (каждая строка с новой строки)',
    evaluate: async (ctx) => {
      const checks = [];
      const summary = ctx.writtenFiles.get('summary.txt');
      checks.push({
        name: 'summary_exists',
        passed: summary !== undefined,
        weight: 2,
        message: summary !== undefined ? 'summary.txt создан' : 'summary.txt не найден',
      });
      if (summary) {
        const lines = summary.trim().split('\n').filter(l => l.trim());
        const allImportant = lines.every(l => l.toLowerCase().includes('important'));
        checks.push({
          name: 'all_important',
          passed: allImportant && lines.length > 0,
          weight: 2,
          message: allImportant ? `Все ${lines.length} строк содержат "important"` : 'Не все строки содержат "important"',
        });
      }
      return scoreChecks(checks);
    },
  },
  {
    id: 'TERM-006',
    category: 'terminal',
    difficulty: 'medium',
    title: 'Создание структуры директорий',
    description: 'Создать вложенную структуру файлов',
    prompt: 'Создай следующую структуру файлов в текущей директории:\n- config/settings.json с содержимым {"debug": true, "port": 3000}\n- src/index.ts с содержимым "export const main = () => { console.log(\'hello\') }"\n- README.md с содержимым "# My Project"',
    evaluate: async (ctx) => {
      const checks = [];
      const settings = ctx.writtenFiles.get('config/settings.json');
      const index = ctx.writtenFiles.get('src/index.ts');
      const readme = ctx.writtenFiles.get('README.md');

      checks.push({
        name: 'settings_json',
        passed: settings !== undefined,
        weight: 1,
        message: settings !== undefined ? 'config/settings.json создан' : 'config/settings.json не найден',
      });
      if (settings) {
        try {
          const data = JSON.parse(settings);
          checks.push({
            name: 'settings_content',
            passed: data.debug === true && data.port === 3000,
            weight: 1,
            message: (data.debug === true && data.port === 3000) ? 'settings.json корректен' : `settings.json: ${settings}`,
          });
        } catch {
          checks.push({ name: 'settings_content', passed: false, weight: 1, message: 'Невалидный JSON' });
        }
      }

      checks.push({
        name: 'index_ts',
        passed: index !== undefined && index.includes('export'),
        weight: 1,
        message: index !== undefined ? 'src/index.ts создан' : 'src/index.ts не найден',
      });
      checks.push({
        name: 'readme',
        passed: readme !== undefined && readme.includes('My Project'),
        weight: 1,
        message: readme !== undefined ? 'README.md создан' : 'README.md не найден',
      });

      return scoreChecks(checks);
    },
  },

  // ── HARD ───────────────────────────────────────────────────
  {
    id: 'TERM-007',
    category: 'terminal',
    difficulty: 'hard',
    title: 'Рефакторинг кода',
    description: 'Прочитать файл, переименовать переменные, записать результат',
    prompt: 'Прочитай файл code.js. Переименуй все вхождения переменной "temp" в "result" и сохрани результат в code_refactored.js. Также добавь комментарий "// refactored" в начало файла.',
    evaluate: async (ctx) => {
      const checks = [];
      const refactored = ctx.writtenFiles.get('code_refactored.js');
      checks.push({
        name: 'output_exists',
        passed: refactored !== undefined,
        weight: 2,
        message: refactored !== undefined ? 'code_refactored.js создан' : 'code_refactored.js не найден',
      });
      if (refactored) {
        checks.push({
          name: 'no_temp',
          passed: !/\btemp\b/.test(refactored),
          weight: 2,
          message: !/\btemp\b/.test(refactored) ? 'Переменная temp заменена' : 'Переменная temp всё ещё присутствует',
        });
        checks.push({
          name: 'has_result',
          passed: refactored.includes('result'),
          weight: 1,
          message: refactored.includes('result') ? 'Переменная result присутствует' : 'Переменная result не найдена',
        });
        checks.push({
          name: 'has_comment',
          passed: refactored.startsWith('// refactored'),
          weight: 1,
          message: refactored.startsWith('// refactored') ? 'Комментарий добавлен' : 'Комментарий отсутствует',
        });
      }
      return scoreChecks(checks);
    },
  },
  {
    id: 'TERM-008',
    category: 'terminal',
    difficulty: 'hard',
    title: 'Слияние данных из нескольких файлов',
    description: 'Прочитать несколько JSON файлов, объединить, отсортировать',
    prompt: 'Прочитай все JSON файлы в директории (users_*.json), объедини все массивы пользователей в один, отсортируй по полю "name" (по алфавиту) и сохрани в all_users.json',
    evaluate: async (ctx) => {
      const checks = [];
      const output = ctx.writtenFiles.get('all_users.json');
      checks.push({
        name: 'output_exists',
        passed: output !== undefined,
        weight: 2,
        message: output !== undefined ? 'all_users.json создан' : 'all_users.json не найден',
      });
      if (output) {
        try {
          const data = JSON.parse(output);
          const isArray = Array.isArray(data);
          checks.push({
            name: 'is_array',
            passed: isArray,
            weight: 1,
            message: isArray ? `Массив из ${data.length} элементов` : 'Не массив',
          });
          if (isArray && data.length > 1) {
            const names = data.map((u: any) => u.name);
            const sorted = [...names].sort();
            const isSorted = names.every((n: string, i: number) => n === sorted[i]);
            checks.push({
              name: 'sorted',
              passed: isSorted,
              weight: 2,
              message: isSorted ? 'Отсортировано по name' : 'Не отсортировано',
            });
          }
        } catch {
          checks.push({ name: 'valid_json', passed: false, weight: 1, message: 'Невалидный JSON' });
        }
      }
      return scoreChecks(checks);
    },
  },

  // ── EXPERT ─────────────────────────────────────────────────
  {
    id: 'TERM-009',
    category: 'terminal',
    difficulty: 'expert',
    title: 'Пайплайн обработки данных',
    description: 'Многошаговая обработка: чтение → фильтрация → агрегация → вывод',
    prompt: 'Выполни пайплайн обработки:\n1. Прочитай orders.csv\n2. Отфильтруй заказы со статусом "completed"\n3. Посчитай общую сумму по полю amount\n4. Запиши в report.txt: количество заказов и общую сумму в формате:\n   Total completed orders: N\n   Total amount: X',
    evaluate: async (ctx) => {
      const checks = [];
      const report = ctx.writtenFiles.get('report.txt');
      checks.push({
        name: 'report_exists',
        passed: report !== undefined,
        weight: 3,
        message: report !== undefined ? 'report.txt создан' : 'report.txt не найден',
      });
      if (report) {
        const hasOrders = report.includes('Total completed orders:');
        const hasAmount = report.includes('Total amount:');
        checks.push({
          name: 'has_order_count',
          passed: hasOrders,
          weight: 2,
          message: hasOrders ? 'Есть количество заказов' : 'Нет количества заказов',
        });
        checks.push({
          name: 'has_total',
          passed: hasAmount,
          weight: 2,
          message: hasAmount ? 'Есть общая сумма' : 'Нет общей суммы',
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
