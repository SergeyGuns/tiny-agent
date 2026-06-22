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

export const DEFAULT_PROVIDER_URL = 'http://localhost:1234/v1';
export const DEFAULT_MODEL_NAME = 'qwen/qwen3.5-9b';
export const DEFAULT_MAX_STEPS = 50;
export const DEFAULT_RETRIES = 3;
export const DEFAULT_TEMPERATURE = 0.7;
export const RESULT_TRUNCATE_LENGTH = 2000;
export const FETCH_TIMEOUT_MS = 15000;
export const LLM_TIMEOUT_MS = 60000;
export const COMMAND_TIMEOUT_MS = 30000;
export const RETRY_BASE_DELAY_MS = 2000;
export const UNLOADED_RETRY_DELAY_MS = 10000;

// ─── Provider config ──────────────────────────────────────────

export interface Provider {
  name: string;
  url: string;
  model: string;
  apiKey?: string;
}

const PROVIDERS_PATH = 'providers.json';

export function loadProviders(): Provider[] {
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), PROVIDERS_PATH), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveProviders(providers: Provider[]): void {
  fs.writeFileSync(path.resolve(process.cwd(), PROVIDERS_PATH), JSON.stringify(providers, null, 2));
}

export function getActiveProvider(): Provider | null {
  const url = process.env.PROVIDER_URL;
  const model = process.env.MODEL_NAME;
  if (!url || !model) return null;
  const providers = loadProviders();
  return providers.find(p => p.url === url && p.model === model) ?? null;
}

export function setActiveProvider(provider: Provider): void {
  process.env.PROVIDER_URL = provider.url;
  process.env.MODEL_NAME = provider.model;
  if (provider.apiKey) process.env.API_KEY = provider.apiKey;
  else delete process.env.API_KEY;
  writeEnvFile(provider);
}

function writeEnvFile(provider: Provider): void {
  const envPath = path.resolve(process.cwd(), '.env');
  let content = '';
  try { content = fs.readFileSync(envPath, 'utf-8'); } catch { /* no .env yet */ }

  const lines = content.split('\n');
  const keys = ['PROVIDER_URL', 'MODEL_NAME', 'API_KEY'];
  const newLines: string[] = [];

  const existing = new Map<string, string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    existing.set(trimmed.slice(0, eqIdx).trim(), trimmed.slice(eqIdx + 1).trim());
  }

  existing.set('PROVIDER_URL', provider.url);
  existing.set('MODEL_NAME', provider.model);
  if (provider.apiKey) existing.set('API_KEY', provider.apiKey);
  else existing.delete('API_KEY');

  for (const key of keys) {
    const val = existing.get(key);
    if (val !== undefined) newLines.push(`${key}=${val}`);
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    if (!keys.includes(k)) newLines.push(line);
  }

  fs.writeFileSync(envPath, newLines.join('\n') + '\n');
}
