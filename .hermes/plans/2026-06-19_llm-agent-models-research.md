# Исследование: Малые LLM для агентских систем (2025-2026)

## Цель
Найти модели которые лучше всего подходят для агентской системы tiny-agent:
- Корректный tool calling (function calling)
- Понимание задач и следование инструкциям
- Достаточная скорость для интерактивной работы
- Разумный размер (до 14B параметров)

## Методология
- Анализ HuggingFace Models (сортировка по скачиваниям)
- Изучение репозиториев с бенчмарками (MCP-Bench, BFCL)
- Поиск моделей специально обученных для function calling

## Ключевые находки

### 1. Salesforce xLAM — специализированные модели для агентов

**Репозиторий:** https://github.com/SalesforceAIResearch/xLAM
**HuggingFace:** https://huggingface.co/collections/Salesforce/xlam-models

| Модель | Параметры | Context | Особенности |
|--------|-----------|---------|-------------|
| `Salesforce/Llama-xLAM-2-8b-fc-r` | 8B | 128k | **Top-1 на BFCL Leaderboard** (апрель 2025) |
| `Salesforce/xLAM-2-3b-fc-r` | 3B | 32k | Компактная, быстрая |
| `Salesforce/xLAM-2-1b-fc-r` | 1B | 32k | Минимальный размер |
| `Salesforce/xLAM-7b-fc-r` | 7B | 4k | Старая версия |

**Ключевые особенности:**
- Обучены на `xlam-function-calling-60k` и `APIGen-MT-5k` датасетах
- Специально оптимизированы для function calling
- Поддерживают multi-turn диалоги с инструментами
- Совместимы с vLLM, FastChat, Transformers
- **Llama-xLAM-2-8b-fc-r занял Top-1 на Berkeley Function Calling Leaderboard**

**Формат вызова инструментов:**
```python
tools = [{"name": "get_weather", "description": "...", "parameters": {...}}]
# Модель сама генерирует tool_calls в формате OpenAI
```

### 2. MCP-Bench Leaderboard (NeurIPS 2025)

**Репозиторий:** https://github.com/Accenture/mcp-bench
**Статья:** arXiv:2508.20453

Топ моделей по tool-use с MCP серверами:

| Rank | Model | Score |
|------|-------|-------|
| 1 | gpt-5 | 0.749 |
| 2 | o3 | 0.715 |
| 3 | gpt-oss-120b | 0.692 |
| 4 | gemini-2.5-pro | 0.690 |
| 5 | claude-sonnet-4 | 0.681 |
| 6 | qwen3-235b-a22b-2507 | 0.678 |
| 7 | glm-4.5 | 0.668 |
| 8 | gpt-oss-20b | 0.654 |
| 9 | kimi-k2 | 0.629 |
| 10 | qwen3-30b-a3b-instruct-2507 | 0.627 |
| 11 | gemini-2.5-flash-lite | 0.598 |
| 12 | gpt-4o | 0.595 |
| 13 | gemma-3-27b-it | 0.582 |
| 14 | llama-3-3-70b-instruct | 0.558 |
| 15 | gpt-4o-mini | 0.557 |
| 16 | mistral-small-2503 | 0.530 |
| 17 | llama-3-1-70b-instruct | 0.510 |
| 18 | nova-micro-v1 | 0.508 |
| 19 | llama-3-2-90b-vision-instruct | 0.495 |
| 20 | llama-3-1-8b-instruct | 0.428 |

**Вывод:** Среди малых моделей (<15B) лучшие результаты:
- `qwen3-30b-a3b-instruct-2507` — 0.627 (30B, но MoE — активно ~3B)
- `llama-3-1-8b-instruct` — 0.428
- `mistral-small-2503` — 0.530

### 3. Qwen2.5 — популярные instruct модели

| Модель | Параметры | Downloads | Особенности |
|--------|-----------|-----------|-------------|
| `Qwen/Qwen2.5-7B-Instruct` | 7B | 12.9M | Самая популярная, отличный tool calling |
| `Qwen/Qwen2.5-3B-Instruct` | 3B | 11.5M | Быстрая, хорошая для простых задач |
| `Qwen/Qwen2.5-14B-Instruct` | 14B | 2M | Мощная, но медленнее |
| `Qwen/Qwen2.5-Coder-7B-Instruct` | 7B | 2.2M | Оптимизирована для кода |

**Ключевые особенности:**
- Не thinking-модели (в отличие от Qwen3.5)
- Отличный tool calling из коробки
- Поддержка function calling в формате OpenAI
- 32K-128K context window
- Быстрые (5-15 сек/вызов на GPU)

### 4. Gemma 3 / Gemma 4 — модели Google

| Модель | Параметры | Особенности |
|--------|-----------|-------------|
| `google/gemma-3-12b-it` | 12B | Новая архитектура, 128K context |
| `google/gemma-3-4b-it` | 4B | Быстрая, компактная |
| `google/gemma-4-12b-qat` | 12B | Thinking-модель, требует `enable_thinking: false` |
| `google/gemma-4-e4b` | 4B | Экспериментальная, быстрая |

**Проблемы с Gemma 4:**
- Thinking-модели по умолчанию возвращают ответ в `reasoning_content`, а не в `content`
- Требуют `enable_thinking: false` для корректной работы с инструментами
- Медленнее Qwen2.5 на том же размере

### 5. Другие заслуживающие внимания модели

| Модель | Параметры | Особенности |
|--------|-----------|-------------|
| `microsoft/phi-4` | 14B | От Microsoft, отличное качество |
| `mistralai/Mistral-7B-Instruct-v0.3` | 7B | Быстрая, хорошая для агентов |
| `mistralai/Mistral-Nemo-Instruct-2407` | 12B | Улучшенная версия Mistral |
| `meta-llama/Llama-3.1-8B-Instruct` | 8B | Стандарт индустрии |

## Рекомендации для tiny-agent

### Лучший выбор: Salesforce xLAM

**`Salesforce/Llama-xLAM-2-8b-fc-r`** — оптимальный вариант:
- 8B параметров — разумный размер
- **Top-1 на BFCL Leaderboard** для function calling
- 128K context window
- Специально обучена для tool calling
- Быстрая (5-10 сек/вызов)
- GGUF версии доступны для LM Studio

### Альтернативы

1. **`Qwen/Qwen2.5-7B-Instruct`** — если xLAM недоступна
   - 12.9M скачиваний — самая популярная
   - Отличный tool calling
   - Не thinking-модель (проще в использовании)

2. **`Salesforce/xLAM-2-3b-fc-r`** — если нужна компактная модель
   - 3B параметра
   - Быстрая
   - Хороший tool calling

### Модели которые НЕ рекомендуются

- **Gemma 4 (e4b, 12b-qat)** — thinking-модели, требуют специальной обработки
- **Qwen3.5-9b** — медленная thinking-модель
- **Llama-3.1-8B-Instruct** — слабее в tool calling чем xLAM или Qwen2.5

## План действий

1. Загрузить `Salesforce/Llama-xLAM-2-8b-fc-r` в LM Studio
2. Протестировать на tiny-agent benchmark
3. Сравнить с текущей qwen3.5-9b
4. Если результат лучше — переключиться

## Источники

- MCP-Bench: https://github.com/Accenture/mcp-bench
- xLAM: https://github.com/SalesforceAIResearch/xLAM
- BFCL Leaderboard: https://gorilla.cs.berkeley.edu/leaderboard.html
- HuggingFace Models: https://huggingface.co/models
