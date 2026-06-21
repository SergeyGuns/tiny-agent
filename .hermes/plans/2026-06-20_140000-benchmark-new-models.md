# План: Бенчмарк новых моделей

## Цель
Протестировать 3 новые модели в tiny-agent-bench и сравнить с предыдущими результатами.

## Модели для тестирования
| # | Модель | Params | Статус |
|---|--------|--------|--------|
| 1 | `liquid/lfm2.5-1.2b` | 1.2B | Новая |
| 2 | `essentialai/rnj-1` | 8.3B (gemma3, reasoning) | Новая |
| 3 | `mistralai/mistral-nemo-instruct-2407` | 12B | Новая |

## Референсные результаты (предыдущие бенчи)
| Модель | Результат |
|--------|-----------|
| `qwen/qwen3.5-9b` | 79% (26/33) |
| `google/gemma-4-12b-qat` | 58% (19/33) |

## API для управления моделями

LM Studio поддерживает `/api/v1/` эндпоинты (НЕ `/v1/`):

```bash
# Список моделей (с loaded_instances)
curl -s http://192.168.0.156:1234/api/v1/models

# Загрузить модель
curl -s -X POST http://192.168.0.156:1234/api/v1/models/load \
  -H "Content-Type: application/json" \
  -d '{"model":"liquid/lfm2.5-1.2b"}'

# Выгрузить модель (требует instance_id из loaded_instances)
curl -s -X POST http://192.168.0.156:1234/api/v1/models/unload \
  -H "Content-Type: application/json" \
  -d '{"instance_id":"liquid/lfm2.5-1.2b"}'
```

## Автоматизация выгрузки

Перед бенчем на модели X:
1. `GET /api/v1/models` → получить `loaded_instances` для всех моделей
2. `POST /api/v1/models/unload` для каждого instance_id кроме X
3. Запустить `npm run bench`
4. Сохранить отчёт

## Процесс тестирования

Для каждой модели:
1. Выгрузить все остальные модели через API
2. Загрузить целевую модель через API
3. Запустить `npm run bench` (полный бенчмарк, все 33 задачи)
4. Сохранить отчёт как `bench-report-<model-short>.json`
5. Зафиксировать результат в таблице

### Порядок запуска
1. `liquid/lfm2.5-1.2b` — маленькая и быстрая, ожидаем низкий результат
2. `essentialai/rnj-1` — reasoning модель, потенциально хороший
3. `mistralai/mistral-nemo-instruct-2407` — 12B, стабильная

## Ожидаемые проблемы
- **lfm2.5-1.2b** — очень маленькая модель (1.2B), может не справляться с инструментами
- **rnj-1** — reasoning/thinking модель, может иметь проблемы с форматом Action строк
- **mistral-nemo** — 12B параметров, должна быть стабильной

## Файлы для проверки
- `bench/runner.ts` — запускает все 33 задачи
- `bench-report.json` — результат (перезаписывается каждый раз)
- Каждый отчёт копировать в `bench-report-<model>.json`

## Валидация
После каждого бенча:
- Проверить `totalTasks`, `passedTasks`, `passRate`
- Зафиксировать `avgToolCalls` и `avgSteps`
- Сравнить с референсом qwen3.5-9b (79%)
