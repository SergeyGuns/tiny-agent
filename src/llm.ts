import { LLM_TIMEOUT_MS, DEFAULT_RETRIES, RETRY_BASE_DELAY_MS, UNLOADED_RETRY_DELAY_MS, DEFAULT_TEMPERATURE, FETCH_TIMEOUT_MS } from './config.js';
import type { Message } from '../types.js';
import { toolSchemas } from './tools.js';
import { stripThinkingTags } from './parser.js';

// ─── API Health Check ───────────────────────────────────────────

export interface HealthCheckResult {
  ok: boolean;
  status: 'ready' | 'no_models' | 'unreachable' | 'auth_error' | 'timeout' | 'error';
  message: string;
  hint: string;
  availableModels?: string[];
}

/**
 * Multi-level API availability check with useful hints.
 * 1. DNS/connection — is the host reachable?
 * 2. HTTP response — does it return valid status?
 * 3. /v1/models — does it expose models?
 * 4. Model validation — is the configured model in the list?
 */
export async function checkAPIAvailability(baseUrl: string, modelName: string, apiKey?: string): Promise<HealthCheckResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  // Level 1: TCP/HTTP connectivity
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(5000),
    });
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    if (errMsg.includes('timeout') || errMsg.includes('Timeout')) {
      return {
        ok: false,
        status: 'timeout',
        message: `Сервер ${baseUrl} не отвечает (таймаут 5с)`,
        hint: 'Проверьте:\n  1. Запущен ли провайдер (LM Studio / Ollama / OpenRouter)?\n  2. Правильный ли URL в PROVIDER_URL?\n  3. Не блокирует ли файрвол соединение?',
      };
    }
    if (errMsg.includes('ECONNREFUSED') || errMsg.includes('refused')) {
      return {
        ok: false,
        status: 'unreachable',
        message: `Сервер ${baseUrl} отклоняет соединение`,
        hint: 'Проверьте:\n  1. Запущен ли провайдер? Если LM Studio — нажмите "Start Server".\n  2. Правильный ли порт? LM Studio по умолчанию :1234, Ollama :11434.\n  3. Не занят ли порт другой программой?',
      };
    }
    if (errMsg.includes('ENOTFOUND') || errMsg.includes('getaddrinfo')) {
      return {
        ok: false,
        status: 'unreachable',
        message: `Хост ${baseUrl} не найден (DNS)`,
        hint: 'Проверьте:\n  1. Правильно ли указан hostname?\n  2. Доступен ли он из сети? Попробуйте curl в терминале.\n  3. Если туннель/VPN — активен ли он?',
      };
    }
    return {
      ok: false,
      status: 'error',
      message: `Ошибка соединения: ${errMsg}`,
      hint: 'Проверьте сетевое подключение и правильность URL.',
    };
  }

  // Level 2: HTTP status
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      status: 'auth_error',
      message: `Ошибка авторизации (HTTP ${res.status})`,
      hint: 'Проверьте:\n  1. Правильный ли API_KEY в .env или providers.json?\n  2. Если провайдер требует ключ — задан ли он?\n  3. Не истёк ли ключ?',
    };
  }

  if (res.status === 404) {
    return {
      ok: false,
      status: 'error',
      message: `Эндпоинт /v1/models не найден (HTTP 404)`,
      hint: 'Проверьте:\n  1. Поддерживает ли провайдер OpenAI-совместимый API?\n  2. Правильный ли URL? Должен заканчиваться на /v1.\n  3. Попробуйте: curl <URL>/v1/models',
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      ok: false,
      status: 'error',
      message: `Сервер вернул HTTP ${res.status}: ${text.substring(0, 100)}`,
      hint: 'Проверьте логи провайдера. Возможно, сервер перегружен или настроен неверно.',
    };
  }

  // Level 3: Parse models list
  let models: string[] = [];
  try {
    const data = await res.json() as { data?: Array<{ id?: string }> };
    models = (data.data ?? []).map(m => m.id).filter(Boolean) as string[];
  } catch {
    return {
      ok: false,
      status: 'error',
      message: 'Сервер ответил, но формат не соответствует OpenAI API',
      hint: 'Проверьте:\n  1. Поддерживает ли провайдер /v1/models в формате OpenAI?\n  2. Не проксируется ли запрос через несовместимый сервис?',
    };
  }

  if (models.length === 0) {
    // Some providers (Anthropic-compatible) don't expose /v1/models
    // Try a lightweight request to /chat/completions to verify the model works
    try {
      const testRes = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (testRes.ok || testRes.status === 400) {
        // 400 might mean "model exists but request is malformed" — still OK
        return {
          ok: true,
          status: 'ready',
          message: 'API доступен (список моделей скрыт, но запросы работают)',
          hint: '',
        }
      }
    } catch { /* fall through */ }

    return {
      ok: false,
      status: 'no_models',
      message: 'Сервер не вернул список моделей',
      hint: 'Проверьте:\n  1. Загружена ли модель в LM Studio? Нажмите на модель в баре → Load.\n  2. Если Ollama — выполните: ollama pull <model-name>\n  3. Если провайдер не поддерживает /v1/models — проверьте вручную через curl.',
    };
  }

  // Level 4: Model validation
  if (!models.includes(modelName)) {
    // Try fuzzy match (e.g. "qwen3.5-9b" might be listed as "qwen/qwen3.5-9b")
    const similar = models.filter(m =>
      m.toLowerCase().includes(modelName.toLowerCase().split('/').pop() || '') ||
      modelName.toLowerCase().includes(m.toLowerCase().split('/').pop() || '')
    );

    const hintBase = `Модель "${modelName}" не найдена в списке (${models.length} доступно).`;
    let hintAction: string;

    if (similar.length > 0) {
      hintAction = `\nПохожие модели:\n${similar.map(m => `  - ${m}`).join('\n')}\n\nПопробуйте:\n  \\provider use <name>  с правильной моделью\n  Или отредактируйте MODEL_NAME в .env`;
    } else {
      hintAction = `\nДоступные модели:\n${models.slice(0, 10).map(m => `  - ${m}`).join('\n')}${models.length > 10 ? `\n  ... и ещё ${models.length - 10}` : ''}\n\nПопробуйте:\n  \\provider use <name>  с правильной моделью\n  Или отредактируйте MODEL_NAME в .env`;
    }

    return {
      ok: false,
      status: 'error',
      message: hintBase,
      hint: hintAction,
      availableModels: models,
    };
  }

  return {
    ok: true,
    status: 'ready',
    message: 'API доступен, модель найдена',
    hint: '',
    availableModels: models,
  };
}

// ─── Query LLM ─────────────────────────────────────────────────

export interface LLMOptions {
  temperature?: number;
  enable_thinking?: boolean;
  max_tokens?: number;
  tools?: object[];
  tool_choice?: string | object;
  toolsFilter?: string[];
}

export const LLM_PROFILES = {
  toolCall:  { temperature: 0.7, enable_thinking: false, max_tokens: 1500 },
  rlm:       { temperature: 0.7, enable_thinking: false, max_tokens: 1500 },
  subAgent:  { temperature: 0.5, enable_thinking: false, max_tokens: 2000 },
  research:  { temperature: 0.6, enable_thinking: false, max_tokens: 1500 },
  planning:  { temperature: 0.4, enable_thinking: false, max_tokens: 2000 },
  terminal:  { temperature: 0.3, enable_thinking: false, max_tokens: 1000 },
  tool_use:  { temperature: 0.7, enable_thinking: false, max_tokens: 1500 },
  plan:      { temperature: 0.4, enable_thinking: false, max_tokens: 2000 },
  classifier: { temperature: 0.3, enable_thinking: false, max_tokens: 500 },
} as const;

export type LLMProfileName = keyof typeof LLM_PROFILES;

export async function queryLLM(messages: Message[], options?: LLMOptions, retries = DEFAULT_RETRIES): Promise<string> {
  const baseUrl = process.env.PROVIDER_URL;
  const modelName = process.env.MODEL_NAME;

  if (!baseUrl || !modelName) {
    throw new Error(
      'LLM не настроен.\n' +
      '  Создайте .env или используйте \\provider add:\n\n' +
      '  PROVIDER_URL=http://localhost:1234/v1\n' +
      '  MODEL_NAME=qwen/qwen3.5-9b\n\n' +
      '  Или в TUI: \\provider add'
    );
  }

  // Validate API availability on first call (no tools in classifier calls)
  const apiKey = process.env.API_KEY;
  const health = await checkAPIAvailability(baseUrl, modelName, apiKey);
  if (!health.ok) {
    throw new Error(`${health.message}\n\n${health.hint}`);
  }

  const temperature = options?.temperature ?? DEFAULT_TEMPERATURE;
  const max_tokens = options?.max_tokens ?? 800;
  const enable_thinking = options?.enable_thinking ?? false;
  const tools = options?.tools !== undefined
    ? { tools: options.tools }
    : {
        tools: Object.values(toolSchemas)
          .filter(s => {
            if (!options?.toolsFilter) return true;
            return options.toolsFilter.includes((s as any).name);
          })
          .map(s => ({ type: 'function', function: s }))
      };
  const tool_choice = options?.tool_choice !== undefined
    ? { tool_choice: options.tool_choice }
    : { tool_choice: 'auto' };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages,
          temperature,
          max_tokens,
          enable_thinking,
          ...tools,
          ...tool_choice,
        }),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        if (text.includes('Model is unloaded') || text.includes('Failed to load model') || text.includes('No models loaded')) {
          if (attempt < retries) {
            await sleep(UNLOADED_RETRY_DELAY_MS * attempt);
            continue;
          }
        }
        throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
      }

      const data = await response.json() as Record<string, unknown>;
      const choices = data.choices as Record<string, unknown>[] | undefined;
      const msg = choices?.[0]?.message as Record<string, unknown> | undefined;
      const rawContent = (msg?.content as string | undefined) || '';
      const content = stripThinkingTags(rawContent);
      const toolCalls = (msg?.tool_calls as any[]) || [];

      // If model returned tool calls (even without content), convert ALL to Action lines
      if (toolCalls.length > 0) {
        const actionLines = toolCalls.map((tc: any) => {
          const name = tc.function?.name || 'unknown';
          const args = tc.function?.arguments || '{}';
          // If we have content too, prepend it before action lines
          return `Action: ${name}[${args}]`;
        });
        const result = content ? content + '\n' + actionLines.join('\n') : actionLines.join('\n');
        return result;
      }

      // Handle case where content is a JSON array (some FC models do this)
      if (content && content.trim().startsWith('[')) {
        try {
          const arr = JSON.parse(content);
          if (Array.isArray(arr)) {
            const actionLines = arr.map((item: any) => {
              const name = item.name || item.function?.name || 'unknown';
              const args = item.arguments || item.function?.arguments || '{}';
              const argsStr = typeof args === 'string' ? args : JSON.stringify(args);
              return `Action: ${name}[${argsStr}]`;
            });
            return actionLines.join('\n');
          }
        } catch { /* not valid JSON, return as-is */ }
      }

      if (!content || content.length === 0) {
        if (attempt < retries) {
          await sleep(RETRY_BASE_DELAY_MS * attempt);
          continue;
        }
        throw new Error('Empty response from LLM');
      }
      return content;
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (attempt < retries) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      throw e;
    }
  }
  throw new Error('queryLLM: all retries exhausted');
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Action Classifier ─────────────────────────────────────────
// When the model returns a "thinking" response without Actions,
// this classifier analyzes the intent and suggests tool calls.

const CLASSIFIER_SYSTEM_PROMPT = `You are an action classifier. Given a task and a model's reasoning response (which lacks tool calls), determine what tool calls should be made next.

Available tools:
- search_web[{"query": "..."}] — search the internet
- fetch_url_content[{"url": "..."}] — fetch a specific URL
- list_directory[{"path": "..."}] — list files in a directory (default ".")
- read_file_content[{"path": "..."}] — read a file
- write_file_content[{"path": "...", "content": "..."}] — write a file
- search_in_files[{"pattern": "...", "files": "..."}] — search text in files
- execute_shell_command[{"command": "..."}] — run a shell command
- signal_task_complete[] — signal task completion

Analyze the reasoning text and output the EXACT tool calls that should be made next, one per line.
Output ONLY Action: lines, nothing else.

Example 1:
Task: "Read data.json and write output.txt"
Reasoning: "I need to read the data.json file first to understand its structure"
Output:
Action: read_file_content[{"path": "data.json"}]

Example 2:
Task: "Find all .txt files and search for 'important'"
Reasoning: "I need to find all .txt files in the current directory first"
Output:
Action: list_directory[{"path": "."}]

Example 3:
Task: "Search for latest TypeScript version"
Reasoning: "I should search the web for the latest TypeScript version"
Output:
Action: search_web[{"query": "latest TypeScript version"}]`;

export interface ClassifierResult {
  actions: { name: string; args: Record<string, unknown> }[];
  raw: string;
}

export async function classifyActions(
  task: string,
  reasoning: string,
  step: number,
): Promise<ClassifierResult> {
  const messages: Message[] = [
    { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Task: "${task}"\n\nModel's reasoning (step ${step}):\n"${reasoning.substring(0, 500)}"\n\nOutput the Action: lines:`,
    },
  ];

  try {
    const response = await queryLLM(messages, LLM_PROFILES.classifier, 2);
    const { parseAllActions } = await import('./parser.js');
    const actions = parseAllActions(response);
    return { actions, raw: response };
  } catch {
    return { actions: [], raw: '' };
  }
}

// ─── Task Type Classifier ──────────────────────────────────────
// Classifies the task to determine what kind of work it involves.

const TASK_TYPE_PROMPT = `You are a task classifier. Given a task description, classify it into one or more of these categories:
- "research" — requires web search, finding information online
- "file_read" — requires reading existing files
- "file_write" — requires creating/writing files
- "file_transform" — requires reading, processing, and writing files
- "refactor" — requires renaming/replacing content in files
- "multi_section" — requires creating a document with multiple sections/charts
- "validation" — requires checking/validating data
- "shell" — requires running shell commands

Output ONLY a JSON array of matching categories, e.g. ["research", "file_write"]`;

export interface TaskTypeResult {
  isResearch: boolean;
  isFileRead: boolean;
  isFileWrite: boolean;
  isFileTransform: boolean;
  isRefactor: boolean;
  isMultiSection: boolean;
  isValidation: boolean;
  isShell: boolean;
}

export async function classifyTaskType(prompt: string): Promise<TaskTypeResult> {
  const defaultResult: TaskTypeResult = {
    isResearch: false, isFileRead: false, isFileWrite: false,
    isFileTransform: false, isRefactor: false, isMultiSection: false,
    isValidation: false, isShell: false,
  };
  try {
    const messages: Message[] = [
      { role: 'system', content: TASK_TYPE_PROMPT },
      { role: 'user', content: `Task: "${prompt.substring(0, 300)}"\n\nCategories:` },
    ];
    const response = await queryLLM(messages, LLM_PROFILES.classifier, 2);
    const match = response.match(/\[([^\]]+)\]/);
    if (match) {
      const cats = match[1].toLowerCase();
      return {
        isResearch: cats.includes('research'),
        isFileRead: cats.includes('file_read'),
        isFileWrite: cats.includes('file_write'),
        isFileTransform: cats.includes('file_transform'),
        isRefactor: cats.includes('refactor'),
        isMultiSection: cats.includes('multi_section'),
        isValidation: cats.includes('validation'),
        isShell: cats.includes('shell'),
      };
    }
  } catch { /* fall through */ }
  return defaultResult;
}

// ─── Search Loop Classifier ────────────────────────────────────
// Determines if the agent is stuck in a search loop.
// Returns true if the agent is looping (searching/fetching/asking without writing).

const SEARCH_LOOP_PROMPT = `You are a search loop detector. Given the task and recent tool call history, determine if the agent is stuck in a search loop (repeatedly searching/fetching/asking without making progress toward the goal).

Signs of a loop:
- Multiple search_web calls with similar queries and empty/irrelevant results
- Multiple fetch_url_content calls without subsequent write_file_content
- Multiple query_language_model calls asking about the same topic
- Agent keeps asking for clarification instead of doing the work
- No files created after many search/fetch/query calls

Respond with ONLY "LOOP" or "OK".`;

export async function classifySearchLoop(
  prompt: string,
  toolCalls: { tool: string; result: string }[],
  filesCreated: string[],
): Promise<boolean> {
  // No files created and many search-like calls → likely looping
  const searchCalls = toolCalls.filter(c =>
    c.tool === 'search_web' || c.tool === 'fetch_url_content' || c.tool === 'query_language_model'
  );
  if (searchCalls.length < 3) return false;
  if (filesCreated.length > 0) return false;

  try {
    const recentSearches = searchCalls.slice(-5).map((c, i) =>
      `[${i + 1}] ${c.tool}: ${c.result.substring(0, 80)}`
    ).join('\n');
    const messages: Message[] = [
      { role: 'system', content: SEARCH_LOOP_PROMPT },
      { role: 'user', content: `Task: "${prompt.substring(0, 200)}"\n\nRecent tool calls (last 5):\n${recentSearches}\n\nFiles created: ${filesCreated.length}\n\nLOOP or OK?` },
    ];
    const response = await queryLLM(messages, LLM_PROFILES.classifier, 2);
    return /LOOP/i.test(response);
  } catch {
    return false;
  }
}

// ─── Refactor Check Classifier ─────────────────────────────────
// Determines if a file write task involves refactoring (rename/replace).

const REFACTOR_PROMPT = `You are a refactoring detector. Given a task and a file path, determine if the task involves refactoring (renaming variables, replacing content).

Respond with ONLY "REFACTOR" or "NORMAL".`;

export async function classifyRefactor(prompt: string, filePath: string): Promise<boolean> {
  try {
    const messages: Message[] = [
      { role: 'system', content: REFACTOR_PROMPT },
      { role: 'user', content: `Task: "${prompt.substring(0, 200)}"\nFile: ${filePath}\n\nREFACTOR or NORMAL?` },
    ];
    const response = await queryLLM(messages, LLM_PROFILES.classifier, 2);
    return /REFACTOR/i.test(response);
  } catch {
    return false;
  }
}

// ─── Readiness Classifier ───────────────────────────────────────
// Determines whether the model's response is a final answer or
// whether it needs to continue exploring/calling tools.

const READINESS_PROMPT = `You are a response classifier. Given:
1. The original user task
2. The model's current response (which has NO tool calls)
3. What tools were called so far

Determine if the model's response is a FINAL ANSWER that completes the task, or if it needs MORE WORK (continue exploring, searching, reading files).

Respond with ONLY "READY" or "MORE_WORK".

Examples:
- Task: "Describe the project", Response: "This project is a multi-agent framework...", Tools: [list_dir, read_file x5] → READY
- Task: "Find all TODO comments", Response: "I need to search more files...", Tools: [search_in_files] → MORE_WORK
- Task: "What files exist?", Response: "The project has src/, test/, package.json", Tools: [list_dir] → READY
- Task: "Refactor variable X to Y", Response: "I found the file but haven't changed it yet", Tools: [read_file] → MORE_WORK
- Task: "Describe the project", Response: "Let me check more files to understand the structure", Tools: [list_dir, read_file x2] → MORE_WORK`;

export interface ReadinessResult {
  isReady: boolean;
  raw: string;
}

export async function classifyIsReady(
  task: string,
  response: string,
  toolCalls: { tool: string; args: Record<string, unknown> }[],
): Promise<ReadinessResult> {
  const defaultResult: ReadinessResult = { isReady: false, raw: '' };

  // If response is very short (< 20 chars), it's not a meaningful answer
  if (response.trim().length < 20) return defaultResult;

  // If response contains explicit "Action:" prefix, it's not a final answer
  if (/Action:\s*\w+\[/.test(response)) return defaultResult;

  // Build tool summary — just tool names and paths, not full results
  const toolSummary = toolCalls.slice(-10).map(c => {
    const path = (c.args as any)?.path || (c.args as any)?.query || (c.args as any)?.url || '';
    return `${c.tool}(${path})`;
  }).join(', ');

  try {
    const messages: Message[] = [
      { role: 'system', content: READINESS_PROMPT },
      {
        role: 'user',
        content: `Task: "${task.substring(0, 200)}"

Model's response (no tool calls):
"${response.substring(0, 400)}"

Tools called so far (${toolCalls.length} total, last 10):
${toolSummary || '(none)'}

READY or MORE_WORK?`,
      },
    ];
    const classifierResponse = await queryLLM(messages, LLM_PROFILES.classifier, 2);
    const isReady = /READY/i.test(classifierResponse) && !/MORE_WORK/i.test(classifierResponse);
    return { isReady, raw: classifierResponse };
  } catch {
    return defaultResult;
  }
}

// ─── Multi-Section Check Classifier ────────────────────────────
// Determines if a markdown file should have multiple sections.

const MULTI_SECTION_PROMPT = `You are a document structure classifier. Given a task and a file path, determine if the output file should have multiple sections (## headings).

Respond with ONLY "MULTI" or "SINGLE".`;

export async function classifyNeedsSections(prompt: string, filePath: string): Promise<boolean> {
  if (!filePath.endsWith('.md')) return false;
  try {
    const messages: Message[] = [
      { role: 'system', content: MULTI_SECTION_PROMPT },
      { role: 'user', content: `Task: "${prompt.substring(0, 200)}"\nFile: ${filePath}\n\nMULTI or SINGLE?` },
    ];
    const response = await queryLLM(messages, LLM_PROFILES.classifier, 2);
    return /MULTI/i.test(response);
  } catch {
    return false;
  }
}
