# Plan: npm global CLI для tiny-agent

## Цель
Сделать tiny-agent устанавливаемым через `npm install -g tiny-agent` и запускаемым из любой директории командой `tiny-agent` (или `ta`).

## Текущий контекст

- Точка входа: `agent.ts` (в корне), компилируется в `dist/agent.js`
- `package.json` — нет поля `bin`, нет `prepublish`/`prepare` скрипта
- `loadEnv()` в `src/config.ts` читает `.env` из `process.cwd()` — это правильно для CLI, т.к. пользователь запускает из рабочей директории
- `agent.ts` вызывает `loadEnv()` на уровне модуля (строка 850) — это корректно
- Зависимости: `cheerio`, `playwright` — тяжёлые, но нужны для тулов
- `dist/` не должен попадать в npm-пакет (только исходники + скомпилированный `dist/` при публикации)

## Проблемы, которые нужно решить

### 1. Поле `bin` в package.json
Нужно добавить:
```json
"bin": {
  "tiny-agent": "./dist/agent.js",
  "ta": ".//dist/agent.js"
}
```
Но `dist/agent.js` не существует до билда. Значит, нужен скрипт `prepare` или `prepublishOnly`, который запускает `tsc`.

### 2. Shebang
`dist/agent.js` должен начинаться с `#!/usr/bin/env node`. Сейчас `agent.ts` не содержит shebang. Нужно добавить `#!/usr/bin/env node` в начало `agent.ts` — tsc вырежет её при компиляции. Поэтому правильнее:
- Либо добавить shebang в начало `dist/agent.js` пост-билд скриптом
- Либо использовать обёртку-файл `bin/tiny-agent.js` без расширения `.ts`, который просто re-exportит `../dist/agent.js`

**Рекомендация**: создать `bin/tiny-agent.js` с shebang и `require('../dist/agent.js')` — это стандартный паттерн для TypeScript CLI.

### 3. Имена `tiny-agent` и `ta`
- `tiny-agent` — вероятно, занято на npm. Нужно проверить.
- `ta` — точно занято (это стандартная утилита GNU). Лучше использовать `tiny-agent` или `tinya`.

### 4. Что публиковать
Нужно добавить в `package.json`:
```json
"files": [
  "dist/",
  "src/",
  "lib.ts",
  "types.ts",
  "agent.ts",
  "strategies.ts",
  "bin/",
  "README.md"
]
```
И добавить `.npmignore` или использовать `files` whitelist.

### 5. Версионирование
Текущая версия `0.1.1` — ок для начала.

## Пошаговый план

### Шаг 1: Проверить доступность имени на npm
```bash
npm view tiny-agent
```
Если занято — использовать `@sergeyguns/tiny-agent` или `tiny-agent-cli`.

### Шаг 2: Создать `bin/tiny-agent.js`
Создать файл-обёртку с shebang, которая импортирует `dist/agent.js`.

### Шаг 3: Добавить `bin` в package.json
Добавить поле `bin` с путём к `bin/tiny-agent.js`.

### Шаг 4: Добавить `prepare` скрипт
```json
"prepare": "npm run build"
```
Это автоматически соберёт `dist/` при `npm publish` и при `npm install -g` из git.

### Шаг 5: Добавить `files` в package.json
Whitelist файлов для публикации.

### Шаг 6: Обновить `.gitignore` и добавить `.npmignore`
Убедиться, что `node_modules`, `.env`, `bench-report*.json`, `session.log` не попадут в пакет.

### Шаг 7: Проверить локально
```bash
npm pack
tar -tzf tiny-agent-0.1.1.tgz
```
Убедиться, что в архиве только нужное.

### Шаг 8: Локальное тестирование через `npm link`
```bash
npm link
cd /tmp/test-project
tiny-agent
```
Проверить, что:
- Команда запускается
- `.env` читается из текущей директории (не из пакета)
- TUI работает

### Шаг 9: Публикация
```bash
npm publish --access public
```

### Шаг 10: Проверить глобальную установку
```bash
npm install -g tiny-agent
cd /some/project
tiny-agent
```

## Файлы для изменения

1. `package.json` — добавить `bin`, `files`, `prepare`
2. `bin/tiny-agent.js` — новый файл, shebang + импорт
3. `.gitignore` — убедиться, что `dist/` не игнорируется для npm (но это сложно — лучше использовать `files` whitelist)
4. `.npmignore` — исключить ненужное из пакета

## Риски

- Имя `tiny-agent` может быть занято на npm → проверить заранее
- `playwright` как зависимость — очень тяжёлый, может замедлить установку. Но он нужен для `fetch_url_content`
- `prepare` скрипт запускает `tsc` при каждом `npm install -g` — это нормально, но требует чтобы `typescript` был в `dependencies` или `devDependencies`. При `npm install -g` `devDependencies` НЕ устанавливаются! → **Критическая проблема**.

### Решение проблемы devDependencies при global install

Вариант A: Публиковать уже скомпилированный `dist/` в npm, а `typescript` оставить в `devDependencies`. Тогда `prepare` не нужен — просто `npm run build` локально перед `npm publish`, и `dist/` попадает в пакет через `files`.

Вариант B: Перенести `typescript` в `dependencies` — плохо, т.к. это dev-зависимость.

**Рекомендация**: Вариант A — собирать локально, публиковать `dist/`, `prepare` не нужен. Просто добавить `prepublishOnly` скрипт для защиты:
```json
"prepublishOnly": "npm run build"
```

## Открытые вопросы

1. Какое имя использовать? `tiny-agent` или `@sergeyguns/tiny-agent`?
2. Нужен ли alias `ta`? (конфликтует с GNU `ta`)
3. Публиковать сейчас или сначала доработать функциональность?
