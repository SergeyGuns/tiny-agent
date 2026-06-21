// ═══════════════════════════════════════════════════════════════
// TUI Test Cases — набор кейсов для ручного тестирования интерфейса
// ═══════════════════════════════════════════════════════════════
//
// Запуск: echo '<промпт>' | node dist/agent.js
// Или интерактивно: node dist/agent.js, затем ввести промпт
//
// Категории:
//   [CHAT]  — простой разговор, без инструментов
//   [READ]  — чтение файлов, без записи
//   [WRITE] — запись файлов
//   [MULTI] — многошаговые задачи
//   [EDGE]  — граничные случаи и ошибки
// ─────────────────────────────────────────────────────────────

export interface TuiTestCase {
  id: string;
  category: 'CHAT' | 'READ' | 'WRITE' | 'MULTI' | 'EDGE';
  difficulty: 'easy' | 'medium' | 'hard';
  title: string;
  prompt: string;
  expect: {
    toolsUsed: string[];      // какие инструменты должны быть вызваны
    filesWritten: number;     // сколько файлов должно быть создано
    filesRead: number;        // сколько файлов должно быть прочитанo
    maxSteps: number;         // максимум шагов
    shouldContain?: string[]; // строки, которые должны быть в выводе
  };
}

// ═══════════════════════════════════════════════════════════════
// CHAT — простой разговор (0 инструментов, 0 файлов)
// ═══════════════════════════════════════════════════════════════

export const chatCases: TuiTestCase[] = [
  {
    id: 'CHAT-001',
    category: 'CHAT',
    difficulty: 'easy',
    title: 'Приветствие',
    prompt: 'Привет',
    expect: {
      toolsUsed: [],
      filesWritten: 0,
      filesRead: 0,
      maxSteps: 1,
      shouldContain: ['ASSISTANT'],
    },
  },
  {
    id: 'CHAT-002',
    category: 'CHAT',
    difficulty: 'easy',
    title: 'Вопрос о возможностях',
    prompt: 'Что ты умеешь?',
    expect: {
      toolsUsed: [],
      filesWritten: 0,
      filesRead: 0,
      maxSteps: 1,
      shouldContain: ['ASSISTANT'],
    },
  },
  {
    id: 'CHAT-003',
    category: 'CHAT',
    difficulty: 'easy',
    title: 'Простой вопрос',
    prompt: 'Как дела?',
    expect: {
      toolsUsed: [],
      filesWritten: 0,
      filesRead: 0,
      maxSteps: 1,
    },
  },
  {
    id: 'CHAT-004',
    category: 'CHAT',
    difficulty: 'medium',
    title: 'Вопрос на русском с контекстом',
    prompt: 'Расскажи мне о себе — кто ты, что умеешь?',
    expect: {
      toolsUsed: [],
      filesWritten: 0,
      filesRead: 0,
      maxSteps: 1,
    },
  },
  {
    id: 'CHAT-005',
    category: 'CHAT',
    difficulty: 'easy',
    title: 'Пустой ввод',
    prompt: '',
    expect: {
      toolsUsed: [],
      filesWritten: 0,
      filesRead: 0,
      maxSteps: 1,
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// READ — чтение файлов (read_file_content, list_directory)
// ═══════════════════════════════════════════════════════════════

export const readCases: TuiTestCase[] = [
  {
    id: 'READ-001',
    category: 'READ',
    difficulty: 'easy',
    title: 'Посмотреть содержимое директории',
    prompt: 'Посмотри что в текущей директории',
    expect: {
      toolsUsed: ['list_directory'],
      filesWritten: 0,
      filesRead: 0,
      maxSteps: 3,
    },
  },
  {
    id: 'READ-002',
    category: 'READ',
    difficulty: 'easy',
    title: 'Прочитать package.json',
    prompt: 'Прочитай package.json и скажи какие скрипты есть',
    expect: {
      toolsUsed: ['read_file_content'],
      filesWritten: 0,
      filesRead: 1,
      maxSteps: 3,
    },
  },
  {
    id: 'READ-003',
    category: 'READ',
    difficulty: 'medium',
    title: 'Посмотреть как запускается проект',
    prompt: 'Посмотри как запускается проект',
    expect: {
      toolsUsed: ['list_directory', 'read_file_content'],
      filesWritten: 0,
      filesRead: 2,
      maxSteps: 4,
    },
  },
  {
    id: 'READ-004',
    category: 'READ',
    difficulty: 'medium',
    title: 'Найти все TypeScript файлы',
    prompt: 'Найди все .ts файлы в проекте',
    expect: {
      toolsUsed: ['list_directory', 'search_in_files'],
      filesWritten: 0,
      filesRead: 0,
      maxSteps: 4,
    },
  },
  {
    id: 'READ-005',
    category: 'READ',
    difficulty: 'hard',
    title: 'Проанализировать структуру проекта',
    prompt: 'Проанализируй структуру проекта — какие основные файлы есть, что они делают',
    expect: {
      toolsUsed: ['list_directory', 'read_file_content'],
      filesWritten: 0,
      filesRead: 3,
      maxSteps: 6,
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// WRITE — запись файлов (write_file_content)
// ═══════════════════════════════════════════════════════════════

export const writeCases: TuiTestCase[] = [
  {
    id: 'WRITE-001',
    category: 'WRITE',
    difficulty: 'easy',
    title: 'Создать простой файл',
    prompt: 'Создай файл hello.txt с текстом Hello World',
    expect: {
      toolsUsed: ['write_file_content'],
      filesWritten: 1,
      filesRead: 0,
      maxSteps: 3,
    },
  },
  {
    id: 'WRITE-002',
    category: 'WRITE',
    difficulty: 'easy',
    title: 'Создать JSON файл',
    prompt: 'Создай файл config.json с содержимым {"name": "test", "version": "1.0"}',
    expect: {
      toolsUsed: ['write_file_content'],
      filesWritten: 1,
      filesRead: 0,
      maxSteps: 3,
    },
  },
  {
    id: 'WRITE-003',
    category: 'WRITE',
    difficulty: 'medium',
    title: 'Создать файл на основе прочитанного',
    prompt: 'Прочитай package.json и создай файл summary.md с описанием проекта',
    expect: {
      toolsUsed: ['read_file_content', 'write_file_content'],
      filesWritten: 1,
      filesRead: 1,
      maxSteps: 4,
    },
  },
  {
    id: 'WRITE-004',
    category: 'WRITE',
    difficulty: 'medium',
    title: 'Создать несколько файлов',
    prompt: 'Создай два файла: a.txt с текстом "File A" и b.txt с текстом "File B"',
    expect: {
      toolsUsed: ['write_file_content'],
      filesWritten: 2,
      filesRead: 0,
      maxSteps: 4,
    },
  },
  {
    id: 'WRITE-005',
    category: 'WRITE',
    difficulty: 'hard',
    title: 'Создать файл с кодом',
    prompt: 'Создай файл fibonacci.py с функцией вычисления чисел Фибоначчи до N',
    expect: {
      toolsUsed: ['write_file_content'],
      filesWritten: 1,
      filesRead: 0,
      maxSteps: 3,
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// MULTI — многошаговые задачи
// ═══════════════════════════════════════════════════════════════

export const multiCases: TuiTestCase[] = [
  {
    id: 'MULTI-001',
    category: 'MULTI',
    difficulty: 'medium',
    title: 'Прочитать и переформатировать',
    prompt: 'Прочитай README.md, извлеки все заголовки и сохрани их в файл headings.txt, каждый с новой строки',
    expect: {
      toolsUsed: ['read_file_content', 'write_file_content'],
      filesWritten: 1,
      filesRead: 1,
      maxSteps: 5,
    },
  },
  {
    id: 'MULTI-002',
    category: 'MULTI',
    difficulty: 'medium',
    title: 'Поиск и запись результата',
    prompt: 'Найди в проекте все файлы с экспортом функций (export function) и сохрани список в exports.txt',
    expect: {
      toolsUsed: ['search_in_files', 'write_file_content'],
      filesWritten: 1,
      filesRead: 0,
      maxSteps: 5,
    },
  },
  {
    id: 'MULTI-003',
    category: 'MULTI',
    difficulty: 'hard',
    title: 'Анализ и отчёт',
    prompt: 'Посмотри все .ts файлы в src/, подсчитай сколько строк кода в каждом и создай отчёт report.md с таблицей: файл | строки',
    expect: {
      toolsUsed: ['list_directory', 'read_file_content', 'write_file_content'],
      filesWritten: 1,
      filesRead: 3,
      maxSteps: 8,
    },
  },
  {
    id: 'MULTI-004',
    category: 'MULTI',
    difficulty: 'hard',
    title: 'Создать структуру проекта',
    prompt: 'Создай структуру для нового проекта: src/index.ts, src/utils.ts, src/types.ts, README.md — каждый с минимальным содержимым',
    expect: {
      toolsUsed: ['write_file_content'],
      filesWritten: 4,
      filesRead: 0,
      maxSteps: 6,
    },
  },
  {
    id: 'MULTI-005',
    category: 'MULTI',
    difficulty: 'hard',
    title: 'Выполнить shell команду и сохранить результат',
    prompt: 'Выполни команду ls -la и сохрани вывод в файл listing.txt',
    expect: {
      toolsUsed: ['execute_shell_command', 'write_file_content'],
      filesWritten: 1,
      filesRead: 0,
      maxSteps: 4,
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// EDGE — граничные случаи
// ═══════════════════════════════════════════════════════════════

export const edgeCases: TuiTestCase[] = [
  {
    id: 'EDGE-001',
    category: 'EDGE',
    difficulty: 'easy',
    title: 'Очень длинный промпт',
    prompt: 'Привет. ' + 'Как дела? '.repeat(50),
    expect: {
      toolsUsed: [],
      filesWritten: 0,
      filesRead: 0,
      maxSteps: 1,
    },
  },
  {
    id: 'EDGE-002',
    category: 'EDGE',
    difficulty: 'medium',
    title: 'Запрос на несуществующий файл',
    prompt: 'Прочитай файл nonexistent.txt',
    expect: {
      toolsUsed: ['read_file_content'],
      filesWritten: 0,
      filesRead: 1,
      maxSteps: 3,
    },
  },
  {
    id: 'EDGE-003',
    category: 'EDGE',
    difficulty: 'medium',
    title: 'Запрос с спецсимволами',
    prompt: 'Создай файл test.txt с текстом: "Привет! @#$%^&*() 日本語 中文"',
    expect: {
      toolsUsed: ['write_file_content'],
      filesWritten: 1,
      filesRead: 0,
      maxSteps: 3,
    },
  },
  {
    id: 'EDGE-004',
    category: 'EDGE',
    difficulty: 'hard',
    title: 'Противоречивый запрос',
    prompt: 'Создай файл output.txt но не создавай никаких файлов',
    expect: {
      toolsUsed: [],
      filesWritten: 0,
      filesRead: 0,
      maxSteps: 2,
    },
  },
  {
    id: 'EDGE-005',
    category: 'EDGE',
    difficulty: 'easy',
    title: 'Только пробелы',
    prompt: '   ',
    expect: {
      toolsUsed: [],
      filesWritten: 0,
      filesRead: 0,
      maxSteps: 1,
    },
  },
  {
    id: 'EDGE-006',
    category: 'EDGE',
    difficulty: 'medium',
    title: 'Запрос на удаление файла',
    prompt: 'Удали файл package.json',
    expect: {
      toolsUsed: [],
      filesWritten: 0,
      filesRead: 0,
      maxSteps: 2,
    },
  },
  {
    id: 'EDGE-007',
    category: 'EDGE',
    difficulty: 'hard',
    title: 'Рекурсивный запрос',
    prompt: 'Прочитай свой собственный код (agent.ts) и скажи что он делает',
    expect: {
      toolsUsed: ['read_file_content'],
      filesWritten: 0,
      filesRead: 1,
      maxSteps: 4,
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// Все кейсы
// ═══════════════════════════════════════════════════════════════

export const allTuiTestCases: TuiTestCase[] = [
  ...chatCases,
  ...readCases,
  ...writeCases,
  ...multiCases,
  ...edgeCases,
];

export const tuiTestCaseCount = allTuiTestCases.length;

// ═══════════════════════════════════════════════════════════════
// Утилиты для фильтрации
// ═══════════════════════════════════════════════════════════════

export function getCasesByCategory(category: TuiTestCase['category']): TuiTestCase[] {
  return allTuiTestCases.filter(c => c.category === category);
}

export function getCasesByDifficulty(difficulty: TuiTestCase['difficulty']): TuiTestCase[] {
  return allTuiTestCases.filter(c => c.difficulty === difficulty);
}

export function getCaseById(id: string): TuiTestCase | undefined {
  return allTuiTestCases.find(c => c.id === id);
}
