# Цикл оптимизации tiny-agent

## Цель
Итеративно улучшать результаты бенчмарка tiny-agent через цикл: запуск → анализ → гипотеза → изменение → проверка.

## Правила
1. Запускать бенчи ТОЛЬКО по одному за раз: `node dist/bench/runner.js --task TASK-ID`
2. НЕ подгонять промты под конкретные задачи — улучшать общую архитектуру
3. Каждое изменение — одна конкретная гипотеза
4. После каждого изменения — проверка на 1-2 задачах перед полным бенчем
5. Вести лог гипотез и результатов

## Файлы проекта
- `/home/serg/tiny-agent/src/reactor.ts` — основной цикл (runAgentLoop, runReActLoop, runPlanLoop)
- `/home/serg/tiny-agent/src/llm.ts` — LLM запросы, классификаторы, профили
- `/home/serg/tiny-agent/src/prompt.ts` — системные промпты
- `/home/serg/tiny-agent/src/tools.ts` — инструменты, enum Tool
- `/home/serg/tiny-agent/src/parser.ts` — парсер действий
- `/home/serg/tiny-agent/src/rlm.ts` — RLM executor
- `/home/serg/tiny-agent/bench/tasks/` — задачи бенчмарка
- `/home/serg/tiny-agent/bench/runner.ts` — раннер

## Текущие результаты (baseline)
Сохранить текущий отчёт: `cp bench-report.json bench-report-baseline.json`

## Цикл итерации

### Шаг 1: Запуск одного бенча
```bash
cd /home/serg/tiny-agent
npx tsc 2>&1 | tail -3
timeout 120 node dist/bench/runner.js --task TASK-ID 2>&1 | tail -20
```

### Шаг 2: Анализ результата
Для FAIL задач:
- Прочитать лог: что модель делала на каждом шаге
- Определить паттерн ошибки: пустые ответы? зацикливание? неправильные инструменты?
- Классифицировать ошибку: reasoning_without_actions / search_loop / empty_write / wrong_tool / timeout

### Шаг 3: Формулировка гипотезы
Примеры хороших гипотез:
- "Модель генерирует рассуждения без Actions → добавить явное требование в промпт"
- "Модель зацикливается на поиске → добавить счётчик поисков с принудительной записью"
- "Модель пишет пустой content → добавить проверку на пустые записи"

Примеры ПЛОХИХ гипотез (не делать):
- "Добавить пример для TERM-008 в промпт" — подгонка под задачу
- "Изменить evaluator для RES-003" — подгонка под задачу

### Шаг 4: Реализация
- Внести изменение в код
- Собрать: `npx tsc`
- Проверить тесты: `npm run test`

### Шаг 5: Верификация
- Запустить проблемную задачу: `node dist/bench/runner.js --task TASK-ID`
- Если PASS → запустить 3-5 других задач для проверки регрессий
- Если FAIL → вернуться к Шагу 2

### Шаг 6: Полный бенчмарк (после накопления 3-5 улучшений)
```bash
timeout 580 node dist/bench/runner.js 2>&1 | tee /tmp/bench-rlm-vN.log
```

## Лог гипотез (вести в памяти)

| # | Гипотеза | Изменение | Результат | Статус |
|---|----------|-----------|-----------|--------|
| 1 | Модель генерирует рассуждения без Actions | Добавлен LLM-классификатор classifyActions | TERM-008 PASS | ✅ |
| 2 | webSearch vs search_web в evaluator'ах | Исправлено 5 мест на search_web | RES-003 PASS | ✅ |
| 3 | Пустые write_file_content | Добавлена проверка на empty content | — | 🔄 |

## Приоритеты для следующих итераций

1. **Пустые ответы модели** — самая частая причина FAIL
   - Задачи: TERM-005 (иногда), TOOL-006
   - Возможные решения: усилить промпт, добавить более агрессивный nudge

2. **Запись пустого content** — модель создаёт файлы с ""
   - Задачи: TOOL-005 (capitals.txt с пустым content)
   - Решение: проверка после write, nudge если content пустой

3. **Медленные задачи** — некоторые задачи занимают 100+ секунд
   - Причина: много шагов с рассуждениями
   - Решение: ограничить количество "пустых" шагов перед принудительным действием

## Команды для быстрой проверки

```bash
# Сборка
cd /home/serg/tiny-agent && npx tsc 2>&1 | tail -3

# Одна задача
timeout 120 node dist/bench/runner.js --task TERM-001 2>&1 | tail -5

# Несколько задач по очереди
for task in TERM-001 TERM-008 TERM-009 TOOL-005 TOOL-006 RES-003; do
  echo "=== $task ==="
  timeout 120 node dist/bench/runner.js --task $task 2>&1 | grep -E 'PASS|FAIL'
done

# Полный бенчмарк
timeout 580 node dist/bench/runner.js 2>&1 | tee /tmp/bench-rlm-vN.log
```
