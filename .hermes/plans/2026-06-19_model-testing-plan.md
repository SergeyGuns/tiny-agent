# План: Тестирование моделей tiny-agent

## Цель
Протестировать все доступные модели в LM Studio на tiny-agent benchmark и сравнить результаты.

## Доступные модели в LM Studio (2026-06-19)

| # | Модель | Параметры | Тип | Thinking | Ожидаемый результат |
|---|--------|-----------|-----|----------|---------------------|
| 1 | `salesforce/llama-xlam-2-8b-fc-r` | 8B | Function calling | Нет | Лучший (специализированная) |
| 2 | `essentialai/rnj-1` | ~1B | Instruct | Нет | Быстрая, слабая |
| 3 | `mistralai/mistral-nemo-instruct-2407` | 12B | Instruct | Нет | Хорошая |
| 4 | `google/gemma-4-12b-qat` | 12B | Instruct | Да (нужен фикс) | Хорошая |
| 5 | `qwen/qwen3.5-9b` | 9B | Instruct | Да (нужен фикс) | Базовая |
| 6 | `google/gemma-4-e4b` | 4B | Instruct | Да (нужен фикс) | Средняя |

## Требования к моделям для tiny-agent

Для корректной работы модель должна:
1. **Отвечать в `content`**, а не только в `reasoning_content` — иначе нужен фикс в llm.ts
2. **Корректно вызывать инструменты** через `tool_calls` — иначе агент не работает
3. **Быть достаточно быстрой** — таймаут задач 900-1800с, при медленной модели не укладывается

## Протокол тестирования

### Шаг 0: Подготовка
1. Убедиться что tiny-agent скомпилирован (`npx tsc`)
2. Сохранить текущий `.env` (модель по умолчанию)
3. Создать директорию для результатов: `bench-results/`

### Шаг 1: Тест каждой модели

Для каждой модели:
1. **Выгрузить все остальные модели** из LM Studio
2. **Загрузить целевую модель**
3. **Прогреть модель** — 1-2 тестовых запроса
4. **Запустить полный бенчмарк** через `node dist/bench/runner.js --quiet`
5. **Сохранить результат** как `bench-results/<model-name>.json`
6. **Записать наблюдения** — скорость, ошибки, особенности

### Шаг 2: Сохранение результатов

Формат именования файлов:
- `bench-results/salesforce_llama-xlam-2-8b-fc-r.json`
- `bench-results/essentialai_rnj-1.json`
- `bench-results/mistralai_mistral-nemo-instruct-2407.json`
- `bench-results/google_gemma-4-12b-qat.json`
- `bench-results/qwen_qwen3.5-9b.json`
- `bench-results/google_gemma-4-e4b.json`

### Шаг 3: Создание сравнительной таблицы

После тестирования всех моделей создать таблицу:

| Модель | Passed/Total | Score | Avg Steps | Avg Duration | Примечания |
|--------|-------------|-------|-----------|--------------|------------|
| qwen/qwen3.5-9b (базовая) | 19/33 | 77/91 (85%) | ... | ... | Текущая |
| итд | | | | | |

## Ожидаемые результаты

### Высокий приоритет (ожидаем лучшие результаты)

**`salesforce/llama-xlam-2-8b-fc-r`** — Главный кандидат
- Специально обучена на function calling (60K+ примеров)
- Top-1 на BFCL Leaderboard
- 8B — разумный размер
- Не thinking-модель
- **Ожидание:** 90-95%+

**`mistralai/mistral-nemo-instruct-2407`** — Сильный кандидат
- 12B параметров, 128K context
- Хороший tool calling
- Быстрая
- **Ожидание:** 85-90%

### Средний приоритет

**`google/gemma-4-12b-qat`** — Уже тестировалась
- Thinking-модель, требует `enable_thinking: false`
- **Ожидание:** 80-85% (если не таймаутит)

**`google/gemma-4-e4b`** — Быстрая
- 4B, быстрая
- Но слабее в reasoning
- **Ожидание:** 70-80%

### Низкий приоритет

**`essentialai/rnj-1`** — Маленькая
- ~1B параметров
- Слабая для сложных задач
- **Ожидание:** 40-60%

## Особенности некоторых моделей

### Модели с thinking (Gemma 4, Qwen3.5-9b)
Требуют:
1. `enable_thinking: false` в профилях LLM (уже настроено)
2. Fallback: если `content` пустой но есть `tool_calls` — конвертируем в Action line (уже реализовано)
3. `stripThinkingTags()` для `<think>...</think>` блоков (уже реализовано)

### Salesforce xLAM
- Использует формат function calling из коробки
- Может требовать специальный chat template
- GGUF версия может работать немного иначе чем оригинал

### Mistral Nemo
- Стандартный формат function calling
- Хорошо работает с llama.cpp
- Может быть чувствительна к формату промпта

## Риски

1. **Модель не отвечает** — возможно не загружена, нужен retry
2. **Модель отвечает но не вызывает инструменты** — проблема с форматом function calling
3. **Таймауты** — модель слишком медленная для сложных задач
4. **Пустые ответы** — thinking-модель без `enable_thinking: false`
5. **LM Studio выгружает модель** — нужно выгружать остальные перед тестом

## Чек-лист перед каждым тестом

- [ ] Выгрузить все остальные модели из LM Studio
- [ ] Загрузить целевую модель
- [ ] Прогреть модель: `curl ... '{"messages":[{"role":"user","content":"hi"}],"max_tokens":5}'`
- [ ] Проверить что tiny-agent скомпилирован: `npx tsc`
- [ ] Запустить бенчмарк: `node dist/bench/runner.js --quiet`
- [ ] Сохранить результат в `bench-results/`
- [ ] Записать наблюдения

## Результаты (заполняется по ходу тестирования)

| Модель | Passed | Failed | Score | % | Avg Steps | Avg Duration | Статус |
|--------|--------|--------|-------|---|-----------|--------------|--------|
| qwen/qwen3.5-9b | 19 | 14 | 77/91 | 85% | 2 | 593s | ✅ Протестирована |
| salesforce/llama-xlam-2-8b-fc-r | - | - | - | - | - | - | ⏳ Ожидает |
| essentialai/rnj-1 | - | - | - | - | - | - | ⏳ Ожидает |
| mistralai/mistral-nemo-instruct-2407 | - | - | - | - | - | - | ⏳ Ожидает |
| google/gemma-4-12b-qat | - | - | - | - | - | - | ⏳ Ожидает |
| google/gemma-4-e4b | - | - | - | - | - | - | ⏳ Ожидает |

## Источники

- Предыдущее исследование: `.hermes/plans/2026-06-19_llm-agent-models-research.md`
- xLAM: https://github.com/SalesforceAIResearch/xLAM
- MCP-Bench Leaderboard: https://github.com/Accenture/mcp-bench
- BFCL: https://gorilla.cs.berkeley.edu/leaderboard.html
