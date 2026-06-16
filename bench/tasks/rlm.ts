// ═══════════════════════════════════════════════════════════════
// RLM: Recursive Language Model — рекурсивные вызовы LLM
// ═══════════════════════════════════════════════════════════════

import type { Task } from '../types.js';

export const rlmTasks: Task[] = [
  // ── EASY ───────────────────────────────────────────────────
  {
    id: 'RLM-001',
    category: 'rlm',
    difficulty: 'easy',
    title: 'Simple RLM invocation',
    description: 'Проверка работы инструмента rlm: запросить у него первые 3 простых числа.',
    prompt: 'Action: rlm[{"prompt": "List the first three prime numbers, each on a new line."}]',
    evaluate: async (ctx) => {
      const checks = [];
      const rlmCalls = ctx.toolCalls.filter(c => c.tool === 'rlm');
      checks.push({
        name: 'rlm_called',
        passed: rlmCalls.length > 0,
        weight: 1,
        message: rlmCalls.length > 0 ? `rlm вызван ${rlmCalls.length} раз` : 'rlm не вызван',
      });
      if (rlmCalls.length > 0) {
        const result = rlmCalls[0].result;
        const hasPrimes = /2/.test(result) && /3/.test(result) && /5/.test(result);
        checks.push({
          name: 'correct_primes',
          passed: hasPrimes,
          weight: 1,
          message: hasPrimes ? 'RLM вернул правильные простые числа' : `Ответ: "${result}"`,
        });
      }
      return scoreChecks(checks);
    },
  },

  // ── MEDIUM ─────────────────────────────────────────────────
  {
    id: 'RLM-002',
    category: 'rlm',
    difficulty: 'medium',
    title: 'RLM code generation + execution',
    description: 'Использовать rlm для генерации кода, затем записать и выполнить его.',
    prompt: 'Используй rlm для генерации Python-скрипта, который вычисляет факториал числа 5. Промпт для rlm: "Write a Python script that calculates factorial of 5 and prints the result. Output only the code, no explanations." Полученный код запиши в файл factorial.py через writeFile. Затем запиши в файл result.txt ожидаемый результат (120).',
    evaluate: async (ctx) => {
      const checks = [];
      const rlmCalls = ctx.toolCalls.filter(c => c.tool === 'rlm');
      const code = ctx.writtenFiles.get('factorial.py');
      const result = ctx.writtenFiles.get('result.txt');

      checks.push({
        name: 'rlm_called',
        passed: rlmCalls.length > 0,
        weight: 1,
        message: rlmCalls.length > 0 ? 'rlm вызван' : 'rlm не вызван',
      });
      checks.push({
        name: 'code_created',
        passed: code !== undefined && code.length > 10,
        weight: 2,
        message: code ? `factorial.py создан (${code.length} символов)` : 'factorial.py не создан',
      });
      if (code) {
        const hasFactorial = code.includes('factorial') || code.includes('def') || code.includes('for') || code.includes('while') || code.includes('math');
        checks.push({
          name: 'has_code_logic',
          passed: hasFactorial,
          weight: 1,
          message: hasFactorial ? 'Код содержит логику' : 'Код не содержит логику вычисления',
        });
      }
      checks.push({
        name: 'result_created',
        passed: result !== undefined,
        weight: 2,
        message: result ? `result.txt: "${result.trim()}"` : 'result.txt не создан',
      });
      if (result) {
        const correct = result.trim() === '120';
        checks.push({
          name: 'correct_result',
          passed: correct,
          weight: 1,
          message: correct ? 'Результат 120 верен' : `Результат: "${result.trim()}"`,
        });
      }
      return scoreChecks(checks);
    },
  },
  {
    id: 'RLM-003',
    category: 'rlm',
    difficulty: 'medium',
    title: 'RLM data analysis + writeFile',
    description: 'Использовать rlm для анализа данных из файла, записать результат.',
    prompt: 'Прочитай файл data.json (массив объектов с полями name, value). Используй rlm для анализа: передай ему содержимое data.json и попроси найти объект с максимальным значением value. Промпт: "Given this JSON array, find the object with the highest value field. Return only the name field value." Запиши ответ rlm в файл max_value.txt.',
    evaluate: async (ctx) => {
      const checks = [];
      const rlmCalls = ctx.toolCalls.filter(c => c.tool === 'rlm');
      const output = ctx.writtenFiles.get('max_value.txt');

      checks.push({
        name: 'rlm_called',
        passed: rlmCalls.length > 0,
        weight: 1,
        message: rlmCalls.length > 0 ? 'rlm вызван' : 'rlm не вызван',
      });
      if (rlmCalls.length > 0) {
        const prompt = JSON.stringify(rlmCalls[0].args);
        checks.push({
          name: 'rlm_prompt_has_data',
          passed: prompt.includes('value') || prompt.includes('max') || prompt.includes('highest'),
          weight: 1,
          message: 'Промпт rlm содержит задачу поиска максимума',
        });
      }
      checks.push({
        name: 'output_created',
        passed: output !== undefined,
        weight: 2,
        message: output ? `max_value.txt: "${output.trim()}"` : 'max_value.txt не создан',
      });
      if (output) {
        const correct = output.trim().toLowerCase().includes('bob') || output.trim() === 'Bob';
        checks.push({
          name: 'correct_answer',
          passed: correct,
          weight: 2,
          message: correct ? 'Правильно найден Bob (value=200)' : `Ответ: "${output.trim()}"`,
        });
      }
      return scoreChecks(checks);
    },
  },

  // ── HARD ───────────────────────────────────────────────────
  {
    id: 'RLM-004',
    category: 'rlm',
    difficulty: 'hard',
    title: 'RLM iterative refinement chain',
    description: 'Цепочка: rlm генерирует черновик → агент записывает → rlm улучшает → финальная запись.',
    prompt: 'Выполни итеративное улучшение текста:\n1. Прочитай файл notes.txt\n2. Используй rlm для создания краткого резюме (3-5 предложений). Промпт: "Summarize the following text in 3-5 sentences, keeping only the most important information. Text: [содержимое notes.txt]"\n3. Запиши резюме в файл summary_draft.txt\n4. Используй rlm для улучшения стиля резюме. Промпт: "Improve the writing style of this summary, make it more professional. Text: [содержимое summary_draft.txt]"\n5. Запиши улучшенную версию в файл summary_final.txt',
    evaluate: async (ctx) => {
      const checks = [];
      const rlmCalls = ctx.toolCalls.filter(c => c.tool === 'rlm');
      const draft = ctx.writtenFiles.get('summary_draft.txt');
      const final = ctx.writtenFiles.get('summary_final.txt');

      checks.push({
        name: 'rlm_called_twice',
        passed: rlmCalls.length >= 2,
        weight: 2,
        message: `rlm вызван ${rlmCalls.length} раз (нужно >= 2)`,
      });
      checks.push({
        name: 'draft_created',
        passed: draft !== undefined && draft.length > 20,
        weight: 2,
        message: draft ? `summary_draft.txt создан (${draft.length} символов)` : 'summary_draft.txt не создан',
      });
      checks.push({
        name: 'final_created',
        passed: final !== undefined && final.length > 20,
        weight: 2,
        message: final ? `summary_final.txt создан (${final.length} символов)` : 'summary_final.txt не создан',
      });
      if (draft && final) {
        const different = draft.trim() !== final.trim();
        checks.push({
          name: 'final_differs',
          passed: different,
          weight: 1,
          message: different ? 'Финальная версия отличается от черновика' : 'Версии идентичны',
        });
      }
      return scoreChecks(checks);
    },
  },
  {
    id: 'RLM-005',
    category: 'rlm',
    difficulty: 'hard',
    title: 'RLM code refactoring with validation',
    description: 'Использовать rlm для рефакторинга кода, записать результат и отчёт.',
    prompt: 'Выполни рефакторинг кода через rlm:\n1. Прочитай файл code.js\n2. Используй rlm для рефакторинга: "Refactor this JavaScript code: rename all variables \'temp\' to \'result\', add JSDoc comments to each function, and add \'// refactored\' comment at the top. Output only the refactored code."\n3. Запиши рефакторинг в файл code_refactored.js\n4. Запиши в файл refactor_report.txt количество изменений (минимум 3 пункта: переименование, комментарии, заголовок)',
    evaluate: async (ctx) => {
      const checks = [];
      const rlmCalls = ctx.toolCalls.filter(c => c.tool === 'rlm');
      const refactored = ctx.writtenFiles.get('code_refactored.js');
      const report = ctx.writtenFiles.get('refactor_report.txt');

      checks.push({
        name: 'rlm_called',
        passed: rlmCalls.length > 0,
        weight: 1,
        message: rlmCalls.length > 0 ? 'rlm вызван' : 'rlm не вызван',
      });
      checks.push({
        name: 'refactored_created',
        passed: refactored !== undefined,
        weight: 2,
        message: refactored ? 'code_refactored.js создан' : 'code_refactored.js не создан',
      });
      if (refactored) {
        checks.push({
          name: 'no_temp',
          passed: !refactored.includes(' temp '),
          weight: 1,
          message: !refactored.includes(' temp ') ? 'Переменная temp заменена' : 'temp всё ещё присутствует',
        });
        checks.push({
          name: 'has_refactored_comment',
          passed: refactored.includes('// refactored') || refactored.includes('refactored'),
          weight: 1,
          message: 'Есть комментарий о рефакторинге',
        });
        checks.push({
          name: 'has_jsdoc',
          passed: refactored.includes('/**') || refactored.includes('@param') || refactored.includes('@returns'),
          weight: 1,
          message: 'Есть JSDoc комментарии',
        });
      }
      checks.push({
        name: 'report_created',
        passed: report !== undefined,
        weight: 1,
        message: report ? 'refactor_report.txt создан' : 'refactor_report.txt не создан',
      });
      return scoreChecks(checks);
    },
  },

  // ── EXPERT ─────────────────────────────────────────────────
  {
    id: 'RLM-006',
    category: 'rlm',
    difficulty: 'expert',
    title: 'RLM multi-step synthesis pipeline',
    description: 'Многошаговый pipeline: rlm исследует тему → агент структурирует → rlm пишет финальный отчёт.',
    prompt: 'Проведи исследование через rlm и создай структурированный отчёт:\n1. Используй rlm для исследования: "List 5 key differences between Docker and Podman. For each difference, provide a one-sentence explanation."\n2. Запиши ответ в файл research_raw.txt\n3. Используй rlm для структурирования: "Convert this list into a structured markdown report with sections: Overview, Key Differences (as numbered list), Recommendation. Use the following data: [содержимое research_raw.txt]"\n4. Запиши финальный отчёт в файл docker_vs_podman_rlm.md\n5. Файл должен содержать заголовки ##, нумерованный список и раздел Recommendation',
    evaluate: async (ctx) => {
      const checks = [];
      const rlmCalls = ctx.toolCalls.filter(c => c.tool === 'rlm');
      const raw = ctx.writtenFiles.get('research_raw.txt');
      const final = ctx.writtenFiles.get('docker_vs_podman_rlm.md');

      checks.push({
        name: 'rlm_called_twice',
        passed: rlmCalls.length >= 2,
        weight: 2,
        message: `rlm вызван ${rlmCalls.length} раз (нужно >= 2)`,
      });
      checks.push({
        name: 'raw_created',
        passed: raw !== undefined && raw.length > 30,
        weight: 1,
        message: raw ? 'research_raw.txt создан' : 'research_raw.txt не создан',
      });
      checks.push({
        name: 'final_created',
        passed: final !== undefined,
        weight: 2,
        message: final ? 'docker_vs_podman_rlm.md создан' : 'docker_vs_podman_rlm.md не создан',
      });
      if (final) {
        const hasHeaders = final.includes('##');
        const hasList = /^\s*\d+\./m.test(final);
        const hasDocker = final.toLowerCase().includes('docker');
        const hasPodman = final.toLowerCase().includes('podman');
        const hasRec = final.toLowerCase().includes('recommendation') || final.toLowerCase().includes('рекомендац');

        checks.push({ name: 'has_headers', passed: hasHeaders, weight: 1, message: hasHeaders ? 'Есть ## заголовки' : 'Нет ## заголовков' });
        checks.push({ name: 'has_numbered_list', passed: hasList, weight: 1, message: hasList ? 'Есть нумерованный список' : 'Нет нумерованного списка' });
        checks.push({ name: 'has_docker', passed: hasDocker, weight: 1, message: hasDocker ? 'Упоминается Docker' : 'Нет Docker' });
        checks.push({ name: 'has_podman', passed: hasPodman, weight: 1, message: hasPodman ? 'Упоминается Podman' : 'Нет Podman' });
        checks.push({ name: 'has_recommendation', passed: hasRec, weight: 1, message: hasRec ? 'Есть Recommendation' : 'Нет Recommendation' });
      }
      return scoreChecks(checks);
    },
  },
  {
    id: 'RLM-007',
    category: 'rlm',
    difficulty: 'expert',
    title: 'RLM test generation + implementation',
    description: 'RLM генерирует тесты → агент пишет реализацию → RLM проверяет покрытие.',
    prompt: 'Реализуй модуль валидации email с тестами через rlm:\n1. Используй rlm для генерации тестов: "Write 5 test cases for an email validation function. For each test, provide: input email (string) and expected result (true/false). Cover: valid email, missing @, missing domain dot, empty string, spaces. Output as JSON array: [{input, expected}]"\n2. Запиши тесты в файл tests.json\n3. Используй rlm для генерации реализации: "Write a JavaScript function validateEmail(email) that returns true for valid emails and false otherwise. Valid email must contain @ and a dot after @. Output only the function code."\n4. Запиши реализацию в файл validator.js\n5. Запиши в файл test_summary.txt количество тест-кейсов и описание каждого',
    evaluate: async (ctx) => {
      const checks = [];
      const rlmCalls = ctx.toolCalls.filter(c => c.tool === 'rlm');
      const tests = ctx.writtenFiles.get('tests.json');
      const validator = ctx.writtenFiles.get('validator.js');
      const summary = ctx.writtenFiles.get('test_summary.txt');

      checks.push({
        name: 'rlm_called_twice',
        passed: rlmCalls.length >= 2,
        weight: 2,
        message: `rlm вызван ${rlmCalls.length} раз (нужно >= 2)`,
      });
      checks.push({
        name: 'tests_created',
        passed: tests !== undefined,
        weight: 2,
        message: tests ? 'tests.json создан' : 'tests.json не создан',
      });
      if (tests) {
        try {
          const data = JSON.parse(tests);
          const isArray = Array.isArray(data);
          const has5 = isArray && data.length >= 5;
          checks.push({ name: 'tests_is_array', passed: isArray, weight: 1, message: isArray ? `Массив из ${data.length} элементов` : 'Не массив' });
          checks.push({ name: 'has_5_tests', passed: has5, weight: 1, message: has5 ? '5+ тест-кейсов' : `Тестов: ${data.length} (нужно >= 5)` });
        } catch {
          checks.push({ name: 'tests_valid_json', passed: false, weight: 1, message: 'Невалидный JSON' });
        }
      }
      checks.push({
        name: 'validator_created',
        passed: validator !== undefined && validator.includes('function') && validator.includes('validateEmail'),
        weight: 2,
        message: validator?.includes('validateEmail') ? 'validator.js содержит validateEmail' : 'validator.js некорректен',
      });
      checks.push({
        name: 'summary_created',
        passed: summary !== undefined && summary.length > 20,
        weight: 1,
        message: summary ? 'test_summary.txt создан' : 'test_summary.txt не создан',
      });
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
