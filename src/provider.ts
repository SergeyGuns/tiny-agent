import * as readline from 'readline/promises';
import { C } from '../agent.js';
import {
  loadProviders, saveProviders, setActiveProvider, getActiveProvider,
  type Provider
} from './config.js';

const FETCH_TIMEOUT_MS = 10000;

// ─── Fetch models from /v1/models endpoint ──────────────────

export async function fetchModels(url: string, apiKey?: string): Promise<string[]> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const modelsUrl = url.replace(/\/$/, '') + '/v1/models';
    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.log(`${C.dim}  Не удалось получить список моделей (HTTP ${response.status})${C.reset}`);
      return [];
    }

    const data = await response.json() as { data?: Array<{ id?: string }> };
    return (data.data ?? []).map(m => m.id).filter(Boolean) as string[];
  } catch (e) {
    console.log(`${C.dim}  Ошибка при получении моделей: ${e instanceof Error ? e.message : e}${C.reset}`);
    return [];
  }
}

// ─── Interactive add wizard ─────────────────────────────────

export async function providerAdd(rl: readline.Interface): Promise<void> {
  console.log(`\n${C.cyan}${C.bright}Добавление LLM Provider${C.reset}\n`);

  const name = (await rl.question(`${C.bright}Имя провайдера > ${C.reset}`)).trim();
  if (!name) { console.log(`${C.red}Отменено.${C.reset}`); return; }

  const url = (await rl.question(`${C.bright}URL (например http://localhost:1234/v1) > ${C.reset}`)).trim();
  if (!url) { console.log(`${C.red}Отменено.${C.reset}`); return; }

  const apiKeyInput = (await rl.question(`${C.bright}API Key (Enter — пропустить) > ${C.reset}`)).trim();
  const apiKey = apiKeyInput || undefined;

  console.log(`${C.dim}  Получение списка моделей...${C.reset}`);
  const models = await fetchModels(url, apiKey);

  let model: string;
  if (models.length > 0) {
    console.log(`\n${C.bright}Доступные модели:${C.reset}`);
    models.forEach((m, i) => console.log(`  ${C.cyan}${i + 1}${C.reset} ${m}`));
    console.log(`  ${C.cyan}0${C.reset} Ввести вручную\n`);

    const pick = (await rl.question(`${C.bright}Номер модели > ${C.reset}`)).trim();
    const num = parseInt(pick, 10);
    if (num >= 1 && num <= models.length) {
      model = models[num - 1];
    } else if (num === 0) {
      model = (await rl.question(`${C.bright}Имя модели > ${C.reset}`)).trim();
      if (!model) { console.log(`${C.red}Отменено.${C.reset}`); return; }
    } else {
      model = (await rl.question(`${C.bright}Имя модели > ${C.reset}`)).trim();
      if (!model) { console.log(`${C.red}Отменено.${C.reset}`); return; }
    }
  } else {
    model = (await rl.question(`${C.bright}Имя модели > ${C.reset}`)).trim();
    if (!model) { console.log(`${C.red}Отменено.${C.reset}`); return; }
  }

  const provider: Provider = { name, url, model, apiKey };
  const providers = loadProviders();
  const existing = providers.findIndex(p => p.name === name);
  if (existing >= 0) {
    const overwrite = (await rl.question(`${C.yellow}Провайдер "${name}" уже существует. Перезаписать? (y/N) > ${C.reset}`)).trim().toLowerCase();
    if (overwrite !== 'y') { console.log(`${C.red}Отменено.${C.reset}`); return; }
    providers[existing] = provider;
  } else {
    providers.push(provider);
  }

  saveProviders(providers);
  console.log(`\n${C.green}${C.bright}Провайдер "${name}" добавлен!${C.reset}`);
  console.log(`${C.dim}  URL: ${url}${C.reset}`);
  console.log(`${C.dim}  Model: ${model}${C.reset}`);
  console.log(`${C.dim}  Key: ${apiKey ? '***' : 'не задан'}${C.reset}\n`);
}

// ─── List providers ─────────────────────────────────────────

export function providerList(): void {
  const providers = loadProviders();
  const active = getActiveProvider();

  if (providers.length === 0) {
    console.log(`${C.dim}  Нет сохранённых провайдеров. Используйте \\provider add.${C.reset}`);
    return;
  }

  console.log(`\n${C.bright}LLM Провайдеры:${C.reset}\n`);
  providers.forEach((p, i) => {
    const isActive = active?.name === p.name;
    const marker = isActive ? ` ${C.green}*активный${C.reset}` : '';
    console.log(`  ${C.cyan}${i + 1}${C.reset} ${p.name}${marker}`);
    console.log(`    ${C.dim}URL: ${p.url}${C.reset}`);
    console.log(`    ${C.dim}Model: ${p.model}${C.reset}`);
    if (p.apiKey) console.log(`    ${C.dim}Key: ***${C.reset}`);
    console.log();
  });
}

// ─── Use provider ───────────────────────────────────────────

export function providerUse(name: string): void {
  const providers = loadProviders();
  const provider = providers.find(p => p.name === name);
  if (!provider) {
    console.log(`${C.red}Провайдер "${name}" не найден. Используйте \\provider list.${C.reset}`);
    return;
  }

  setActiveProvider(provider);
  console.log(`\n${C.green}${C.bright}Активный провайдер: ${name}${C.reset}`);
  console.log(`${C.dim}  URL: ${provider.url}${C.reset}`);
  console.log(`${C.dim}  Model: ${provider.model}${C.reset}\n`);
}

// ─── Remove provider ────────────────────────────────────────

export function providerRemove(name: string): void {
  const providers = loadProviders();
  const idx = providers.findIndex(p => p.name === name);
  if (idx === -1) {
    console.log(`${C.red}Провайдер "${name}" не найден.${C.reset}`);
    return;
  }

  const active = getActiveProvider();
  if (active?.name === name) {
    process.env.PROVIDER_URL = '';
    process.env.MODEL_NAME = '';
  }

  providers.splice(idx, 1);
  saveProviders(providers);
  console.log(`${C.green}Провайдер "${name}" удалён.${C.reset}`);
}
