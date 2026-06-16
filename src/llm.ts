import { LLM_TIMEOUT_MS, DEFAULT_RETRIES, RETRY_BASE_DELAY_MS, UNLOADED_RETRY_DELAY_MS } from './config.js';
import type { Message } from '../types.js';

export async function queryLLM(messages: Message[], retries = DEFAULT_RETRIES): Promise<string> {
  const baseUrl = process.env.LM_STUDIO_URL || 'http://localhost:1234/v1';
  const modelName = process.env.LM_STUDIO_MODEL || 'local-model';

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, messages, temperature: 0.7 }),
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

      const data = await response.json() as any;
      if (!data.choices?.[0]?.message?.content) {
        if (attempt < retries) {
          await sleep(RETRY_BASE_DELAY_MS * attempt);
          continue;
        }
        throw new Error('Empty response from LLM');
      }
      return data.choices[0].message.content;
    } catch (e: any) {
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
