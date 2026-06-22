# План: Переход с ReAct loop на RLM (Recursive Language Model)

## Цель

Заменить основной цикл агента с ReAct (один tool call за turn) на RLM (множественные tool calls за turn), сохранив минимальность кода и совместимость с существующими бенчмарками.

## Текущий контекст

- **ReAct loop** (`src/reactor.ts:runReActLoop`): модель делает ОДИН tool call за шаг, результат возвращается на следующем шаге. 15-50 шагов на задачу.
- **RLM** (`src/rlm.ts:runRLM`): уже существует как отдельный модуль, но НЕ используется как основной цикл. Парсит несколько `Action:` из одного ответа, выполняет последовательно, возвращает batch результатов.
- **Бенчмарки**: 35 задач в 5 категориях (terminal, tool_use, research, planning, rlm). Раннер (`bench/runner.ts`) вызывает `runReActLoop`.
- **Модель**: `qwen/qwen3.5-9b` (thinking model, 30-90s на вызов).
- **Проблема ReAct**: много шагов → много LLM-вызовов → медленно, дорого, модель теряет контекст.

## Архитектура RLM (из референса https://github.com/alexzhang13/rlm)

Ключевая идея: модель сама решает, сколько tool calls сделать за один turn.

```
User Prompt → LLM → [Action1, Action2, Action3] → Execute all → [Result1, Result2, Result3] → LLM → ...
```

В отличие от ReAct:
- Один LLM вызов → несколько tool calls
- Все результаты возвращаются как batch в одном user message
- Меньше шагов → меньше LLM вызовов → быстрее

## Предлагаемый подход

### 1. Сделать RLM основным циклом (runRLM → runAgentLoop)

**Файл: `src/reactor.ts`**

- Переименовать `runRLM` в `runAgentLoop` (или создать новый экспорт)
- Добавить `toolsFilter` для plan-mode (как у `runPlanLoop`)
- Унифицировать интерфейс с `runReActLoop` (те же callbacks)

**Изменения:**
- `runAgentLoop(prompt, maxSteps, callbacks, profile, toolsFilter?)` — единый цикл
- Внутри: парсинг всех `Action:` из ответа → выполнение → batch observation
- Nudges остаются (search loop, fetch→write, read→write), но адаптируются для batch

### 2. Адаптировать парсер для множественных Actions

**Файл: `src/parser.ts`**

- `parseAllActions(text)` — уже есть в `src/rlm.ts` (локальная копия)
- Вынести в `parser.ts` как экспортируемую функцию
- Улучшить: поддержка `Action:` на отдельных строках, не только подряд

### 3. Адаптировать prompt для RLM

**Файл: `src/prompt.ts`**

- `BENCH_SYSTEM_PROMPT` — добавить примеры множественных Actions:
  ```
  Action: read_file_content[{"path": "data.json"}]
  Action: search_web[{"query": "latest TypeScript version"}]
  ```
- Явно указать: "You may call multiple tools in one response"
- Правило: "After fetch_url_content, you MUST call write_file_content in the same turn"

### 4. Обновить раннер бенчмарка

**Файл: `bench/runner.ts`**

- Заменить вызов `runReActLoop` на `runAgentLoop` (новый экспорт)
- Адаптивные шаги: уменьшить (т.к. больше tool calls на шаг): easy=10, hard=15, expert=20
- Таймауты: уменьшить (меньше LLM вызовов)

### 5. Обновить agent.ts и lib.ts

**Файл: `agent.ts`**
- `runAutonomous` → вызывает `runAgentLoop` вместо `runReActLoop`

**Файл: `lib.ts`**
- Экспорт `runAgentLoop` из `reactor.ts`

### 6. Обновить RLM-специфичные задачи бенчмарка

**Файл: `bench/tasks/rlm.ts`**

- RLM-задачи уже ожидают множественные вызовы — проверить что они работают
- Убедиться что `query_language_model` вызовы корректно обрабатываются

## Файлы для изменения

| Файл | Тип изменения | Описание |
|------|---------------|----------|
| `src/reactor.ts` | Модификация | Добавить `runAgentLoop` (на базе RLM), экспорт |
| `src/parser.ts` | Модификация | Вынести `parseAllActions` из rlm.ts, улучшить |
| `src/prompt.ts` | Модификация | Обновить `BENCH_SYSTEM_PROMPT` для multi-action |
| `src/rlm.ts` | Рефактор | Убрать дублирование `parseAllActions`, импортировать из parser.ts |
| `bench/runner.ts` | Модификация | Использовать `runAgentLoop`, уменьшить maxSteps |
| `agent.ts` | Модификация | Использовать `runAgentLoop` |
| `lib.ts` | Модификация | Экспорт `runAgentLoop` |
| `bench/tasks/*.ts` | Проверка | Убедиться что все evaluate работают с RLM |

## Нюансы и риски

### Риск 1: Модель не понимает multi-action формат
**Митигация**: Добавить явные примеры в prompt. Если модель не справляется — fallback на single-action (как сейчас в ReAct).

### Риск 2: Потеря nudges (search loop, read→write)
**Митигация**: Nudges адаптировать для batch: проверять не последний action, а все actions в шаге. Например, если batch содержит `fetch_url_content` но НЕ `write_file_content` — добавить nudge.

### Риск 3: Thinking model генерирует `<think>` теги между Actions
**Митигация**: `stripThinkingTags` уже есть в parser.ts. Убедиться что `parseAllActions` вызывает его ДНР парсинга.

### Риск 4: RLM-задачи ожидают 2+ `query_language_model` вызовов
**Митигация**: RLM делает несколько tool calls за turn, но `query_language_model` — это tool, который вызывает LLM рекурсивно. Нужно убедиться что модель понимает разницу между "вызови rlm дважды" и "вызови rlm один раз".

### Риск 5: Бенчмарк-раннер использует `runReActLoop` напрямую
**Митигация**: Заменить на `runAgentLoop`, сохранить обратную совместимость (runReActLoop остаётся как deprecated).

## Верификация

### Шаг 1: Билд
```bash
cd /home/serg/tiny-agent && npx tsc
```
Ожидание: BUILD_OK, 0 errors.

### Шаг 2: Unit-тесты
```bash
npm run test
```
Ожидание: все тесты pass.

### Шаг 3: Одна задача бенчмарка (sanity check)
```bash
node dist/bench/runner.js --task TERM-001
```
Ожидание: PASS, < 30s.

### Шаг 4: Полный бенчмарк (baseline)
```bash
node dist/bench/runner.js 2>&1 | tee /tmp/bench-rlm-v1.log
```
Ожидание: score >= текущего baseline (70%+), меньше времени выполнения.

### Шаг 5: Сравнение ReAct vs RLM
Сохранить отчёт как `bench-report-rlm-v1.json`, сравнить с предыдущим.

## Порядок выполнения

1. **Парсер**: Вынести `parseAllActions` в `parser.ts`, добавить тесты
2. **Reactor**: Создать `runAgentLoop` в `reactor.ts` (на базе RLM + toolsFilter)
3. **Prompt**: Обновить `BENCH_SYSTEM_PROMPT` для multi-action
4. **RLM**: Рефактор — убрать дублирование, импортировать `parseAllActions`
5. **Раннер**: Заменить `runReActLoop` → `runAgentLoop`, уменьшить maxSteps
6. **Agent + Lib**: Обновить экспорты и вызовы
7. **Бенчмарк**: Запустить, собрать метрики, сравнить

## Критерии успеха

- [ ] Билд проходит без ошибок
- [ ] Unit-тесты pass
- [ ] Полный бенчмарк: score >= 70% (не хуже ReAct baseline)
- [ ] Время выполнения полного бенчмарка: меньше чем у ReAct (меньше LLM вызовов)
- [ ] RLM-специфичные задачи (RLM-001..007) работают корректно
- [ ] Код остаётся минимальным (нет новых зависимостей, < 500 новых строк)
