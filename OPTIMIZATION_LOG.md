# tiny-agent Optimization Log

## v9a (2026-06-13) — First REAL benchmark run (loadEnv fix)

### Critical Bug Found & Fixed
- **`loadEnv()` was NOT being called** in lib.ts — all prior runs (v1-v10) used `localhost:1234/v1` fallback
- Fixed by adding `loadEnv();` call after function definition
- **ALL previous benchmark results (v1-v10) are INVALID**

### Changes Applied
- Г1: truncation 800→2000 chars
- Г3: markdown checklist in BENCH_SYSTEM_PROMPT
- Fixed `loadEnv()` call
- Model: qwen2.5-coder-14b (qwen3-coder-next crashes)

### Results (18 tasks): 44/73 (60%), 6/18 passed

## v9b (2026-06-13) — Earlier read→write hint (Г2)

### Changes
- Changed read→write hint threshold from >=2 to >=1 steps
- Stronger hint text ("ВЫ ПРОЧИТАЛИ... НЕМЕДЛЕННО ЗАПИШИТЕ!")

### Results (18 tasks): 50/78 (64%), 6/18 passed

### Comparison v9a vs v9b
| Task | v9a | v9b | Delta |
|------|-----|-----|-------|
| TOOL-005 | 0/2 | 7/7 | ✅ +7 |
| RES-005 | 0/2 | 7/7 | ✅ +7 |
| PLAN-001 | 1/4 | 4/4 | ✅ +3 |
| PLAN-003 | 3/6 | 10/10 | ✅ +7 |
| TOOL-001 | 3/3 | 0/1 | ❌ -3 |
| TERM-008 | 0/2 | 0/2 | = (still fails) |
| RES-004 | 5/5 | 5/5 | = |
| RES-007 | 0/3 | 8/12 | ✅ +8 |

### Analysis
- Г2 helped: TOOL-005, RES-005, PLAN-001, PLAN-003, RES-007
- Г2 hurt: TOOL-001 (got stuck in search loop)
- Unchanged: TERM-008 (read-write gap persists)

## v9d (2026-06-14) — Full 27-task benchmark (Gemma 4 26B-A4B)

### Config
- Model: google/gemma-4-26b-a4b (70 tok/s on 4x V100)
- URL: 172.27.128.1:1234
- Г1+Г2+Г3 already applied from v9b
- All 27 tasks (not 18 as in v9a/v9b)

### Results (27 tasks): 97/124 (78%), 15/27 passed

#### By Category
| Category  | Score | Max | %   | Passed |
|-----------|-------|-----|-----|--------|
| terminal  | 25    | 29  | 86% | 7/9    |
| tool_use  | 33    | 35  | 94% | 5/7    |
| research  | 26    | 38  | 68% | 2/7    |
| planning  | 13    | 22  | 59% | 1/4    |

#### By Difficulty
| Difficulty | Score | Max | %   | Passed |
|------------|-------|-----|-----|--------|
| easy       | 18    | 19  | 95% | 7/8    |
| medium     | 25    | 36  | 69% | 3/8    |
| hard       | 27    | 35  | 77% | 3/7    |
| expert     | 27    | 34  | 79% | 2/4    |

#### Full Results
| # | ID | Diff | Cat | Title | Score | % | Time |
|---|-----|------|-----|-------|-------|---|------|
| 1 | TERM-001 | easy | terminal | Создание файла | 2/2 | 100% | 5.6s |
| 2 | TERM-002 | easy | terminal | Чтение и копирование | 1/1 | 100% | 5.9s |
| 3 | TERM-003 | easy | terminal | Просмотр директории | 1/1 | 100% | 5.6s |
| 4 | TERM-004 | medium | terminal | Трансформация данных | 0/2 | 0% | 12.8s |
| 5 | TERM-005 | medium | terminal | Поиск и фильтрация | 4/4 | 100% | 14.7s |
| 6 | TERM-006 | medium | terminal | Создание структуры директорий | 4/4 | 100% | 51.3s |
| 7 | TERM-007 | hard | terminal | Рефакторинг кода | 6/6 | 100% | 10.4s |
| 8 | TERM-008 | hard | terminal | Слияние данных из нескольких файлов | 0/2 | 0% | 13.2s |
| 9 | TERM-009 | expert | terminal | Пайплайн обработки данных | 7/7 | 100% | 51.6s |
| 10 | TOOL-001 | easy | tool_use | Поиск и сохранение | 3/3 | 100% | 27.8s |
| 11 | TOOL-002 | easy | tool_use | Fetch и извлечение | 3/3 | 100% | 9.1s |
| 12 | TOOL-003 | medium | tool_use | Сравнение источников | 4/5 | 80% | 25.3s |
| 13 | TOOL-004 | medium | tool_use | Конвертация формата | 5/5 | 100% | 7.0s |
| 14 | TOOL-005 | hard | tool_use | Многошаговый поиск с фильтрацией | 7/7 | 100% | 130.1s |
| 15 | TOOL-006 | hard | tool_use | Валидация и исправление данных | 3/4 | 75% | 40.2s |
| 16 | TOOL-007 | expert | tool_use | Автоматизированный отчёт | 8/8 | 100% | 349.4s |
| 17 | RES-001 | easy | research | Факт-чекинг | 3/3 | 100% | 12.8s |
| 18 | RES-002 | easy | research | Извлечение данных со страницы | 1/2 | 50% | 8.2s |
| 19 | RES-003 | medium | research | Сравнительный анализ | 3/6 | 50% | 14.4s |
| 20 | RES-004 | medium | research | Сбор информации из нескольких источников | 3/5 | 60% | 17.9s |
| 21 | RES-005 | hard | research | Исследование с синтезом | 0/2 | 0% | 9.6s |
| 22 | RES-006 | hard | research | Отслеживание зависимостей | 8/8 | 100% | 43.8s |
| 23 | RES-007 | expert | research | Комплексное исследование с рекомендациями | 8/12 | 67% | 20.3s |
| 24 | PLAN-001 | easy | planning | Простой план | 4/4 | 100% | 16.3s |
| 25 | PLAN-002 | medium | planning | Декомпозиция проекта | 2/5 | 40% | 87.3s |
| 26 | PLAN-003 | hard | planning | Многофайловый проект с зависимостями | 3/6 | 50% | 74.5s |
| 27 | PLAN-004 | expert | planning | Полная декомпозиция с тестами | 4/7 | 57% | 45.5s |

### Comparison: v9a → v9b → v9d
| Metric | v9a (18 tasks) | v9b (18 tasks) | v9d (27 tasks) |
|--------|----------------|----------------|----------------|
| Score  | 44/73 (60%)    | 50/78 (64%)    | 97/124 (78%)   |
| Passed | 6/18           | 6/18           | 15/27          |

### Key Findings
- **78% total score** — within the expected 75-80% range
- Terminal: 86% (strong), Tool Use: 94% (excellent)
- Research: 68% (improved from ~60% in v9a/v9b)
- Planning: 59% (weakest area — needs structural improvements)
- Easy: 95% — near perfect on simple tasks
- Main remaining failures: JSON escaping in writeFile, read-write gap (TERM-008), incomplete markdown sections, RES-005 search loop (0% — no tool calls!)

### Remaining Issues
1. TERM-008: multi-file merge still fails (reads but doesn't write)
2. TOOL-006: JSON escaping in content — files created but JSON malformed (report.txt missing)
3. RES-002: writeFile content escaping for JSON responses (file exists but invalid JSON)
4. RES-005: search loop / timeout on complex research (0% — no tool calls at all!)
5. PLAN tasks: plan→execute gap persists (creates plan but not all files)
6. Expert research tasks: missing recommendation/conclusion sections
