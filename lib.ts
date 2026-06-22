// ═══════════════════════════════════════════════════════════════
// lib.ts — barrel re-export for backwards compatibility
// All logic lives in src/ since the v13 refactor.
// ═══════════════════════════════════════════════════════════════

export { extractTextFromHtml, parseDdgHtml } from './src/html.js';
export { searchDuckDuckGo, translateRuToEn } from './src/search.js';
export { tools } from './src/tools.js';
export { BENCH_SYSTEM_PROMPT } from './src/prompt.js';
export { queryLLM, sleep, classifyIsReady } from './src/llm.js';
export { runRLM as runAgentLoop, runPlanLoop, INTERACTIVE_TOOLS } from './src/rlm.js';
export { initMcpTools } from './src/tools.js';
export type { RLMCallbacks as ReActCallbacks } from './src/rlm.js';
export type { ToolCallRecord } from './types.js';
export type { DdgResult } from './src/html.js';
export { loadEnv, DEFAULT_MAX_STEPS, loadProviders, saveProviders, getActiveProvider, setActiveProvider } from './src/config.js';
export type { Provider } from './src/config.js';
export { providerAdd, providerList, providerUse, providerRemove, fetchModels } from './src/provider.js';
export { checkAPIAvailability, type HealthCheckResult } from './src/llm.js';

// Parser utilities (exported for tests)
export { parseAction, parseAllActions, parseWriteFileArgs } from './src/parser.js';
