// ═══════════════════════════════════════════════════════════════
// lib.ts — barrel re-export for backwards compatibility
// All logic lives in src/ since the v12 refactor.
// ═══════════════════════════════════════════════════════════════

export { extractTextFromHtml, parseDdgHtml } from './src/html.js';
export { searchDuckDuckGo, translateRuToEn } from './src/search.js';
export { tools } from './src/tools.js';
export { parseAction, parseWriteFileArgs } from './src/parser.js';
export { BENCH_SYSTEM_PROMPT } from './src/prompt.js';
export { queryLLM, sleep } from './src/llm.js';
export { runReActLoop } from './src/reactor.js';
export type { ReActCallbacks } from './src/reactor.js';
export type { ToolCallRecord } from './types.js';
export type { DdgResult } from './src/html.js';

// Re-export loadEnv for direct usage if needed
export { loadEnv } from './src/config.js';
