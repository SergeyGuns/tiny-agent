# План: Адаптация промпт-инжиниринга из hermes-agent

## Цель
Повысить процент прохождения бенчмарков (сейчас ~79%), внедрив в `tiny-agent` ключевые практики формирования промптов из проекта `hermes-agent` (NousResearch).

## Актуальное состояние
- `BENCH_SYSTEM_PROMPT` в `src/prompt.ts` содержит базовые инструкции, но не имеет жестких требований по обязательному использованию инструментов и завершению задачи.
- RLM цикл использует `classifyIsReady` для определения готовности ответа, но модель может «лениться» (выдавать план вместо выполнения) или галлюцинировать при нехватке данных.

## Предлагаемые изменения

### 1. Добавить блок «Finish the job» (TASK_COMPLETION_GUIDANCE)
**Суть:** Модель должна предоставить реальный артефакт (код, файл, результат проверки), а не описание того, что она собиралась сделать. Запрещено подделывать результаты.

**Текст для вставки в промпт:**
```
# Finish the job
When the user asks you to build, run, or verify something, the deliverable is a working artifact backed by real tool output — not a description of one. Do not stop after writing a stub, a plan, or a single command. Keep working until you have actually exercised the code or produced the requested result, then report what real execution returned.
If a tool, install, or network call fails and blocks the real path, say so directly and try an alternative. NEVER substitute plausible-looking fabricated output for results you couldn't actually produce.
```

### 2. Добавить блок «Parallel tool calls» (PARALLEL_TOOL_CALL_GUIDANCE)
**Суть:** Если нужно несколько независимых кусков информации, запрашивать их в одном ответе (через несколько `Action:`). Это сокращает количество раундов.

**Текст:**
```
# Parallel tool calls
When you need several pieces of information that don't depend on each other, request them together in a single response instead of one tool call per turn. Independent reads, searches, web fetches, and read-only commands should be batched into the same assistant turn — the runtime executes independent calls concurrently, and batching avoids resending the whole conversation on every extra round-trip.
Only serialize calls when a later call genuinely depends on an earlier call's result.
```

### 3. Добавить блок «Tool-use enforcement» (TOOL_USE_ENFORCEMENT_GUIDANCE)
**Суть:** Модель ОБЯЗАНА использовать инструменты для действий, а не просто описывать их.

**Текст:**
```
# Tool-use enforcement
You MUST use your tools to take action — do not describe what you would do or plan to do without actually doing it. When you say you will perform an action (e.g. 'I will run the tests', 'Let me check the file'), you MUST immediately make the corresponding tool call in the same response. Never end your turn with a promise of future action — execute it now.
Every response should either (a) contain tool calls that make progress, or (b) deliver a final result to the user. Responses that only describe intentions without acting are not acceptable.
```

### 4. Добавить блок «Verification» и «Missing context»
**Суть:** Перед финализацией проверять корректность, а при нехватке данных — использовать инструменты поиска, а не гадать.

**Текст:**
```
# Verification
Before finalizing your response:
- Check correctness: does the output satisfy every stated requirement?
- Grounding: are factual claims backed by tool outputs or provided context?
- Formatting: does the output match the requested format?
- Safety: if the next step has side effects (file writes, commands, API calls), confirm scope before executing.

# Missing context
- If required context is missing, do NOT guess or hallucinate an answer.
- Use the appropriate lookup tool when missing information is retrievable (search_files, web_search, read_file, etc.).
- Ask a clarifying question only when the information cannot be retrieved by tools.
```

### 5. Модель-специфичные гайдлайны для qwen
Поскольку мы используем `qwen/qwen3.5-9b`, который склонен к «легкому» поведению, имеет смысл добавить жесткие инструкции.

**Текст (аналог OPENAI_MODEL_EXECUTION_GUIDANCE, адаптированный для qwen):**
```
# Execution discipline for qwen
- Use tools whenever they improve correctness, completeness, or grounding.
- Do not stop early when another tool call would materially improve the result.
- If a tool returns empty or partial results, retry with a different query or strategy before giving up.
- Keep calling tools until: (1) the task is complete, AND (2) you have verified the result.
- NEVER answer from memory or mental computation — ALWAYS use a tool for: arithmetic, hashes, current time/date, system state, file contents, git history, current facts.
```

## Файлы для изменения
1. `src/prompt.ts` — добавить вышеуказанные блоки в `BENCH_SYSTEM_PROMPT` (или создать отдельную переменную и включить её в итоговый промпт).
2. Возможно, `src/rlm.ts` — если потребуется добавить верификацию после выполнения инструментов (но это второстепенно).

## Тестирование
1. Сохранить текущий результат бенчмарка (контрольная точка): `cp bench-report.json bench-report-before-prompt-adoption.json`.
2. Внедрить изменения в промпт.
3. Запустить полный бенчмарк (или по категориям) и сравнить pass rate.
4. При необходимости скорректировать формулировки (если модель «перегревается» от длинного промпта).

## Риски
- Увеличение длины промпта может привести к росту потребления токенов и замедлению работы.
- Слишком жесткие инструкции могут вызвать у модели чрезмерную «осторожность» ( she будет делать лишние проверки).
- Необходимо протестировать на разных категориях задач (terminal, tool_use, research, planning, rlm).

## Открытые вопросы
- Стоит ли разделять промпты для разных моделей (qwen vs другие)?
- Нужно ли добавлять поддержку «mid-turn steering» (как в hermes-agent)?
- Имеет ли смысл добавить «iteration budget» с возвратом бюджета за дешевые вызовы (как в hermes-agent)?

## Следующие шаги
1. Обновить `src/prompt.ts`.
2. Протестировать на одной задаче (например, TERM-001).
3. Если результат положительный — запустить весь бенчмарк и сравнить.
4. Итеративно улучшать.
