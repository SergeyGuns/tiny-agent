import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── .env loader ───────────────────────────────────────────────

export function loadEnv(): void {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key && !process.env[key]) process.env[key] = value;
    }
  } catch { /* .env missing — OK */ }
}

// ─── LLM defaults ──────────────────────────────────────────────

export const DEFAULT_LM_STUDIO_URL = 'http://localhost:1234/v1';
export const DEFAULT_LM_STUDIO_MODEL = 'qwen/qwen3.5-9b';
export const DEFAULT_MAX_STEPS = 15;
export const DEFAULT_RETRIES = 3;
export const DEFAULT_TEMPERATURE = 0.7;
export const RESULT_TRUNCATE_LENGTH = 2000;
export const FETCH_TIMEOUT_MS = 15000;
export const LLM_TIMEOUT_MS = 60000;
export const COMMAND_TIMEOUT_MS = 30000;
export const RETRY_BASE_DELAY_MS = 2000;
export const UNLOADED_RETRY_DELAY_MS = 10000;
