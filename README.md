# 🤖 tiny-agent — Autonomous AI Coding Agent

[![npm](https://img.shields.io/npm/v/@sergey-guns/tiny-agent?color=00ffff&label=npm&logo=npm&logoColor=white)](https://www.npmjs.com/package/@sergey-guns/tiny-agent)
[![License](https://img.shields.io/badge/license-ISC-ff00ff)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-SergeyGuns%2Ftiny--agent-0066ff?logo=github)](https://github.com/SergeyGuns/tiny-agent)

Автономный ИИ-агент с текстовым TUI. Работает в контексте любой директории — читает файлы, пишет код, выполняет команды, ищет в интернете. Архитектура построена на чистом протоколе **RLM** (Recursive Language Model) без тяжёлых абстракций (LangChain / LlamaIndex).

**[🌐 Сайт](https://sergeyguns.github.io/tiny-agent/) · [📦 npm](https://www.npmjs.com/package/@sergey-guns/tiny-agent) · [💻 GitHub](https://github.com/SergeyGuns/tiny-agent)**

---

## ✨ Ключевые возможности

- **RLM Architecture** — модель сама решает, сколько вызовов инструментов сделать за один шаг. Результаты агрегируются как батч.
- **Multi-Action** — параллельные независимые вызовы инструментов за один ответ.
- **Zero-Dependency Core** — только нативный `fetch` и стандартная библиотека Node.js.
- **Любой провайдер** — LM Studio, OpenRouter, Anthropic, OpenAI через единый интерфейс.
- **READ ≠ WRITE** — агент не записывает файлы, если его просто попросили прочитать или объяснить.
- **Защита от циклов** — детектор бесконечных циклов, защита от саморекурсии.
- **@filename TAB** — автодополнение имён файлов в TUI с прикреплением содержимого.
- **Cyberpunk TUI** — 256-цветный ANSI, прогресс-бары, статус-лог, история шагов.

---

## 📦 Установка

### Через npm (рекомендуется)

```bash
npm install -g @sergey-guns/tiny-agent
```

После установки доступны команды:

| Команда | Описание |
|---------|----------|
| `tia` | Интерактивный TUI (основная) |
| `ty` | Короткий alias |
| `ta` | Самый короткий alias |

### Из исходников

```bash
git clone https://github.com/SergeyGuns/tiny-agent.git
cd tiny-agent
npm install
npm run build
```

---

## 🚀 Быстрый старт

### 1. Настройте провайдер

Создайте `.env` в рабочей директории:

```bash
# LM Studio (локальная модель)
PROVIDER_URL=http://192.168.0.156:1234/v1
MODEL_NAME=qwen/qwen3.5-9b

# Или любой OpenAI-совместимый API
```

### 2. Запустите

```bash
# Интерактивный TUI
tia

# Автономный режим — одна задача
tia "Создай CLI утилиту на Node.js для подсчёта строк кода"
```

### 3. TUI Команды

| Команда | Описание |
|---------|----------|
| `\plan` | Режим планирования (только чтение/поиск) |
| `\write` | Режим записи (полный доступ) |
| `\steps` | История шагов текущей сессии |
| `\expand N` | Развернуть шаг N |
| `\provider` | Управление провайдерами/моделями |
| `\test` | Тестовый вывод (без LLM) |
| `\exit` | Выход |
| `@filename` | Прикрепить файл (TAB для автодополнения) |

---

## 🛠️ Инструменты

| Инструмент | Описание |
|------------|----------|
| `search_web` | Поиск в интернете (DuckDuckGo / Wikipedia) |
| `fetch_url_content` | Извлечение текста из URL |
| `list_directory` | Просмотр структуры файлов |
| `read_file_content` | Чтение исходного кода |
| `write_file_content` | Безопасная запись файлов |
| `create_directory` | Создание директорий |
| `search_in_files` | Поиск по содержимому файлов |
| `execute_shell_command` | Выполнение команд в терминале |
| `query_language_model` | Рекурсивный вызов LLM (классификация, анализ) |
| `signal_task_complete` | Сигнал о завершении задачи |
| `decompose_and_execute` | Декомпозиция и выполнение сложных задач |

---

## 🧪 Тестирование

```bash
# Юнит-тесты
npm test

# TUI-тесты
npm run test:tui

# Все тесты
npm run test:all
```

Структура тестов:
- `test/lib.test.ts` — юнит-тесты инструментов
- `test/rlm.test.ts` — тесты RLM-цикла (35 тестов)
- `test/tui.test.ts` — TUI интеграционные тесты (25 кейсов)

---

## 📊 Бенчмарк

```bash
# Полный бенчмарк
npm run bench

# По категории
npm run bench:category -- terminal
npm run bench:category -- research

# Отдельная задача
npm run bench:task -- T-001
```

| Версия | Модель | Результат |
|--------|--------|-----------|
| v21 | qwen3.5-9b | 87.5% (21/24) |

Категории: `terminal` · `tool_use` · `research` · `planning` · `rlm`

---

## 🏗️ Структура проекта

```
tiny-agent/
├── agent.ts              # Точка входа: TUI, @filename autocomplete
├── lib.ts                # Barrel re-export
├── types.ts              # Общие типы
├── bin/
│   └── tiny-agent.js     # CLI entry point (shebang)
├── src/
│   ├── rlm.ts            # RLM executor: multi-action, loop detection
│   ├── tools.ts          # Реализация всех инструментов
│   ├── llm.ts            # LLM клиент: queryLLM, классификаторы
│   ├── prompt.ts         # Системные промпты
│   ├── parser.ts         # Парсер Action: toolName[{...}]
│   ├── config.ts         # Конфигурация: .env, провайдеры
│   ├── provider.ts       # Управление провайдерами
│   ├── search.ts         # Поиск: Wikipedia, перевод RU→EN
│   ├── html.ts           # HTML → text extraction
│   ├── mcp-client.ts     # MCP (Model Context Protocol) клиент
│   ├── task-decomposer.ts # Декомпозиция задач
│   └── with-subagent.ts  # Валидация через субагента
├── bench/                # Бенчмарк
├── test/                 # Тесты
├── docs/                 # GitHub Pages
├── package.json
└── tsconfig.json
```

---

## 🔧 Конфигурация

### Переменные окружения (.env)

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| `PROVIDER_URL` | `http://localhost:1234/v1` | URL провайдера LLM |
| `MODEL_NAME` | `qwen/qwen3.5-9b` | Модель по умолчанию |
| `API_KEY` | — | API ключ (если требуется) |
| `MAX_STEPS` | `50` | Максимум шагов за задачу |
| `RETRIES` | `3` | Повторы при ошибке LLM |
| `TEMPERATURE` | `0.7` | Температура генерации |

### Провайдеры

Переключайте модели через TUI: `\provider`

---

## 📝 Пример сессии

```
╔══════════════════════════════════════════════════════════════════════════════╗
║   tiny-agent                                                                 ║
╚══════════════════════════════════════════════════════════════════════════════╝

┌─────────────────────────────────  COMMANDS  ─────────────────────────────────┐
│ \plan     — planning mode (read/search only)                                 │
│ \write    — write mode (full access)                                         │
│ \steps    — show step history                                                │
│ @file     — attach file content (TAB autocomplete)                           │
└──────────────────────────────────────────────────────────────────────────────┘

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  SYSTEM STATUS  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ MODEL: qwen/qwen3.5-9b   MODE: WRITE   DIR: /home/user/project              ┃
┃ GIT: main   CTX: 0/128k                                                      ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

│ [WRITE] │ > Прочитай src/lib.ts и расскажи о структуре

  ▸ 1/50  ████████░░░░░░░░░░░░ 25%
  1 ▸ File src/lib.ts read successfully (23 lines)

  🤖 ОТВЕТ АССИСТЕНТА
  ────────────────────────────────────────────────────────────────────────────
  src/lib.ts — это barrel re-export файл. Он реэкспортирует все основные
  модули из src/: rlm.ts, tools.ts, llm.ts, parser.ts, config.ts, и т.д.
  ────────────────────────────────────────────────────────────────────────────
```

---

## 📄 Лицензия

ISC · by [SergeyGuns](https://github.com/SergeyGuns)
