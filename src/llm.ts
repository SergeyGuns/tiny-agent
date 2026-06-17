import { LLM_TIMEOUT_MS, DEFAULT_RETRIES, RETRY_BASE_DELAY_MS, UNLOADED_RETRY_DELAY_MS, DEFAULT_TEMPERATURE } from './config.js';
import type { Message } from '../types.js';
import { toolSchemas } from './tools.js';
import { stripThinkingTags } from './parser.js';

export interface LLMOptions {
  temperature?: number;
  enable_thinking?: boolean;
  max_tokens?: number;
  tools?: object[];
  tool_choice?: string | object;
  toolsFilter?: string[];
}

export const LLM_PROFILES = {
  toolCall:  { temperature: 0.7, enable_thinking: false, max_tokens: 800 },
  rlm:       { temperature: 0.7, enable_thinking: false, max_tokens: 1000 },
  subAgent:  { temperature: 0.5, enable_thinking: true,  max_tokens: 2000 },
  research:  { temperature: 0.6, enable_thinking: true,  max_tokens: 1500 },
  planning:  { temperature: 0.4, enable_thinking: true,  max_tokens: 2000 },
  terminal:  { temperature: 0.3, enable_thinking: false, max_tokens: 600 },
  tool_use:  { temperature: 0.7, enable_thinking: false, max_tokens: 800 },
  plan:      { temperature: 0.4, enable_thinking: true,  max_tokens: 2000 },
} as const;

export type LLMProfileName = keyof typeof LLM_PROFILES;

export async function queryLLM(messages: Message[], options?: LLMOptions, retries = DEFAULT_RETRIES): Promise<string> {
  const baseUrl = process.env.LM_STUDIO_URL || 'http://localhost:1234/v1';
  const modelName = process.env.LM_STUDIO_MODEL || 'local-model';

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
      const rawContent = (msg?.content as string | undefined) || (msg?.reasoning_content as string | undefined) || '';
      const content = stripThinkingTags(rawContent);

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
