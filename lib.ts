// ═══════════════════════════════════════════════════════════════
// lib.ts — barrel re-export for backwards compatibility
// All logic lives in src/ since the v12 refactor.
// ═══════════════════════════════════════════════════════════════

export { extractTextFromHtml, parseDdgHtml } from './src/html.js';
export { searchDuckDuckGo, translateRuToEn } from './src/search.js';
export { tools } from './src/tools.js';
export { BENCH_SYSTEM_PROMPT } from './src/prompt.js';
export { queryLLM, sleep } from './src/llm.js';
export { runAgentLoop, runReActLoop, runPlanLoop } from './src/reactor.js';
export type { ReActCallbacks } from './src/reactor.js';
export type { ToolCallRecord } from './types.js';
export type { DdgResult } from './src/html.js';
export { loadEnv, DEFAULT_MAX_STEPS, loadProviders, saveProviders, getActiveProvider, setActiveProvider } from './src/config.js';
export type { Provider } from './src/config.js';
export { providerAdd, providerList, providerUse, providerRemove, fetchModels } from './src/provider.js';

// Parser utilities (exported for tests)
export { parseAction, parseAllActions, parseWriteFileArgs } from './src/parser.js';

// RLM executor
export { runRLM } from './src/rlm.js';
