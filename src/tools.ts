import { queryLLM, LLM_PROFILES } from './llm.js';
import { executeDelegated } from './task-decomposer.js';

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolFunction } from '../types.js';
import { searchDuckDuckGo } from './search.js';
import { extractTextFromHtml } from './html.js';
import { getMcpClient, createMcpToolFunction, mcpToolToSchema } from './mcp-client.js';
import { FETCH_TIMEOUT_MS, COMMAND_TIMEOUT_MS } from './config.js';

// ─── Tool names (enum) ─────────────────────────────────────────
// Single source of truth for all tool identifiers.

export enum Tool {
  SearchWeb = 'search_web',
  FetchUrl = 'fetch_url_content',
  ListDir = 'list_directory',
  ReadFile = 'read_file_content',
  WriteFile = 'write_file_content',
  CreateDir = 'create_directory',
  WritePlan = 'write_plan_file',
  SearchInFiles = 'search_in_files',
  ExecShell = 'execute_shell_command',
  QueryLLM = 'query_language_model',
  SignalComplete = 'signal_task_complete',
  DecomposeAndExecute = 'decompose_and_execute',
}

export const ALL_TOOLS: Tool[] = Object.values(Tool);

export const PLAN_ALLOWED_TOOLS: Tool[] = [
  Tool.SearchWeb,
  Tool.FetchUrl,
  Tool.ListDir,
  Tool.ReadFile,
  Tool.SearchInFiles,
  Tool.SignalComplete,
];

// ─── Tool definitions ──────────────────────────────────────────

export const tools: Record<string, ToolFunction> = {
  [Tool.SearchWeb]: async (args: Record<string, unknown>) => {
    // Use MCP web-search if available, fallback to Wikipedia API
    const mcpClient = await getMcpClient().catch(() => null);
    if (mcpClient) {
      try {
        return await mcpClient.callTool('full-web-search', {
          query: args.query as string,
          limit: Math.min(Math.max(Number(args.limit) || 5, 1), 10),
          includeContent: true,
        });
      } catch (e) {
        // Fallback to Wikipedia API on MCP error
      }
    }
    // Fallback: Wikipedia API
    try {
      const query = args.query as string;
      const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10);
      const results = await searchDuckDuckGo(query, limit);
      if (results.length === 0) return 'Ничего не найдено.';
      return results.map((r, i) => {
        let line = `[${i + 1}] ${r.title}\n    URL: ${r.url}`;
        if (r.snippet) line += `\n    ${r.snippet}`;
        return line;
      }).join('\n\n');
    } catch (e: unknown) { return `search_web error: ${e instanceof Error ? e.message : String(e)}`; }
  },

  [Tool.FetchUrl]: async (args: Record<string, unknown>) => {
    // Use MCP web-search if available, fallback to direct fetch
    const mcpClient = await getMcpClient().catch(() => null);
    if (mcpClient) {
      try {
        return await mcpClient.callTool('get-single-web-page-content', {
          url: args.url as string,
        });
      } catch (e) {
        // Fallback to direct fetch on MCP error
      }
    }
    // Fallback: direct fetch
    try {
      const url = args.url as string;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return 'fetch_url_content: URL должен начинаться с http:// или https://';
      }
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TinyAgent/1.0)',
          'Accept': 'text/html,application/json,*/*',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const contentType = res.headers.get('content-type') || '';
      const body = await res.text();
      if (contentType.includes('application/json')) return body.substring(0, 5000);
      return extractTextFromHtml(body).substring(0, 5000);
    } catch (e: unknown) { return `fetch_url_content: ${e instanceof Error ? e.message : String(e)}`; }
  },

  [Tool.ListDir]: (args: Record<string, unknown>) => {
    try { return fs.readdirSync(path.resolve((args.path as string) || '.')).join(', '); }
    catch (e: unknown) { return `list_directory error: ${e instanceof Error ? e.message : String(e)}`; }
  },

  [Tool.ReadFile]: (args: Record<string, unknown>) => {
    try { return fs.readFileSync(path.resolve(args.path as string), 'utf-8'); }
    catch (e: unknown) { return `read_file_content error: ${e instanceof Error ? e.message : String(e)}`; }
  },

  [Tool.WritePlan]: (args: Record<string, unknown>) => {
    try {
      const steps = args.steps as string[];
      if (!steps || !Array.isArray(steps)) return 'write_plan_file: нужен массив steps';
      const plan = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
      const content = `# План\n\n${plan}\n`;
      const p = path.resolve('PLAN.md');
      fs.writeFileSync(p, content, 'utf-8');
      return `План из ${steps.length} шагов записан в PLAN.md`;
    } catch (e: unknown) { return `write_plan_file error: ${e instanceof Error ? e.message : String(e)}`; }
  },

  [Tool.CreateDir]: (args: Record<string, unknown>) => {
    try {
      const p = path.resolve((args.path as string) || '.');
      fs.mkdirSync(p, { recursive: true });
      return `Директория создана: ${p}`;
    } catch (e: unknown) { return `create_directory error: ${e instanceof Error ? e.message : String(e)}`; }
  },

  [Tool.WriteFile]: async (args: Record<string, unknown>) => {
    try {
      const rawPath = (args.path ?? args.file ?? args.filename ?? args.file_name) as string;
      if (!rawPath || typeof rawPath !== 'string') return 'write_file_content: нужен path';
      if (rawPath.startsWith('/') || rawPath.startsWith('C:\\') || rawPath.startsWith('D:\\')) {
        return `write_file_content: absolute path "${rawPath}" rejected. Use relative path like "file.txt" or "dir/file.txt".`;
      }
      const p = path.resolve(rawPath);
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const rawContent: string = typeof args.content === 'object'
        ? JSON.stringify(args.content, null, 2)
        : String(args.content);

      // Check if file already exists — warn but still write
      const fileExists = fs.existsSync(p);

      // Direct file write — no subagent validation (faster, no data loss)
      fs.writeFileSync(p, rawContent, 'utf-8');
      if (fileExists) {
        return `⚠️ Файл перезаписан: ${p}`;
      }
      return `Файл записан: ${p}`;
    } catch (e: unknown) { console.error(`[write_file_content] ERROR: ${e instanceof Error ? e.message : String(e)}`); return `write_file_content error: ${e instanceof Error ? e.message : String(e)}`; }
  },

  // ── Delegated task execution ──
  // Breaks complex task into subtasks, executes each via subagent, reflects on progress
  'decompose_and_execute': async (args: Record<string, unknown>) => {
    try {
      const task = args.task as string;
      if (!task) return 'decompose_and_execute: нужен task';
      const result = await executeDelegated(task);
      if (result.success) {
        return `Task completed. Results:\n${result.results.join('\n---\n')}`;
      }
      return `Task failed: ${result.error}`;
    } catch (e: unknown) { return `decompose_and_execute error: ${e instanceof Error ? e.message : String(e)}`; }
  },

  [Tool.SearchInFiles]: async (args: Record<string, unknown>) => {
    try {
      const pattern = args.pattern as string;
      const filesGlob = (args.files as string) || '.';
      if (!pattern) return 'search_in_files: нужен pattern';
      const { execSync } = await import('node:child_process');
      const grepCmd = filesGlob === '.'
        ? `grep -r -n -H "${pattern}" . --include="*" --exclude-dir=".git" --exclude-dir="node_modules" 2>/dev/null | head -50`
        : `grep -n -H "${pattern}" ${filesGlob} 2>/dev/null | head -50`;
      const output = execSync(grepCmd, { cwd: process.cwd(), timeout: 10000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      return output || 'Ничего не найдено';
    } catch (e: unknown) {
      if (e instanceof Error && e.message?.includes('ENOENT')) return 'search_in_files не найден в системе';
      return `search_in_files: ${e instanceof Error ? e.message?.substring(0, 200) : String(e)}`;
    }
  },

  [Tool.ExecShell]: async (args: Record<string, unknown>) => {
    try {
      const cmd = (args.command || args.cmd) as string;
      if (!cmd || typeof cmd !== 'string') return 'execute_shell_command: нужна команда';
      const blocked = ['rm -rf /', 'sudo', 'chmod 777', 'mkfs', 'dd ', 'shutdown', 'reboot', '> /dev'];
      if (blocked.some(b => cmd.includes(b))) return `execute_shell_command: команда "${cmd}" заблокирована`;
      const { execSync } = await import('node:child_process');
      const output = execSync(cmd, { cwd: (args.cwd as string) || process.cwd(), timeout: COMMAND_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      return output.substring(0, 2000) || '(команда выполнена)';
    } catch (e: unknown) {
      if (e instanceof Error && e.message?.includes('ENOENT')) return `execute_shell_command: команда не найдена: ${e.message}`;
      if (e instanceof Error && e.message?.includes('timeout')) return 'execute_shell_command: таймаут 30с';
      return `execute_shell_command: ${e instanceof Error ? e.message?.substring(0, 200) : String(e)}`;
    }
  },

  [Tool.QueryLLM]: async (args: Record<string, unknown>) => {
    try {
      const prompt = args.prompt as string;
      if (!prompt || typeof prompt !== 'string') return 'query_language_model: нужен prompt';
      const content = await queryLLM([{ role: 'user', content: prompt }], LLM_PROFILES.subAgent);
      return content;
    } catch (e: unknown) { return `query_language_model: ${e instanceof Error ? e.message?.substring(0, 200) : String(e)}`; }
  },

  [Tool.SignalComplete]: (_args: Record<string, unknown>) => {
    return 'DONE';
  },
};

// ─── MCP Web Search tools (loaded at runtime) ───────────────────
// These are populated by initMcpTools() at startup and merged into `tools` above.

export const mcpToolSchemas: Record<string, object> = {};

/** Initialize MCP tools from web-search-mcp server and merge into main tools */
export async function initMcpTools(): Promise<void> {
  const client = await getMcpClient();
  if (!client) {
    console.error('[MCP] Web search MCP not available, using fallback');
    return;
  }

  const mcpToolList = client.getTools();
  for (const mcpTool of mcpToolList) {
    const fn = createMcpToolFunction(client, mcpTool);
    (tools as any)[mcpTool.name] = fn;
    mcpToolSchemas[mcpTool.name] = mcpToolToSchema(mcpTool);
    console.log(`[MCP] Registered tool: ${mcpTool.name}`);
  }
}

// ─── Tool schemas for LLM function calling ─────────────────────

export const toolSchemas: Record<string, object> = {
  [Tool.SearchWeb]: {
    name: Tool.SearchWeb,
    description: "Search the web using DuckDuckGo and return a list of results with titles, URLs, and snippets. Use this tool ONLY when the user asks to search the internet, find information online, or look up a topic.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query in English or Russian. Use specific keywords, not full sentences." },
        limit: { type: "integer", description: "Number of results to return (1-10). Default is 5.", minimum: 1, maximum: 10, default: 5 },
      },
      required: ["query"],
    },
  },

  [Tool.FetchUrl]: {
    name: Tool.FetchUrl,
    description: "Fetch the content of a single URL and return extracted text (for HTML) or raw JSON. Use this tool ONLY after using search_web to retrieve a specific page.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full URL starting with http:// or https://", pattern: "^https?://.+" },
      },
      required: ["url"],
    },
  },

  [Tool.ListDir]: {
    name: Tool.ListDir,
    description: "List all files and subdirectories inside a given directory path. Use this tool ONLY when the user asks to see folder contents or explore directory structure.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative directory path (e.g., 'src', '.', 'test/utils'). Defaults to '.' if omitted.", default: "." },
      },
      required: [],
    },
  },

  [Tool.ReadFile]: {
    name: Tool.ReadFile,
    description: "Read and return the entire content of a single file as text. Use this tool ONLY when the user asks to read, view, or show a file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path (e.g., 'src/tools.ts', 'README.md'). Must be a file, not a directory." },
      },
      required: ["path"],
    },
  },

  [Tool.WritePlan]: {
    name: Tool.WritePlan,
    description: "Create a PLAN.md file with a numbered list of steps. Use this tool ONLY when the user explicitly asks to create a plan or outline steps.",
    parameters: {
      type: "object",
      properties: {
        steps: { type: "array", items: { type: "string" }, description: "Array of step descriptions, each a single actionable item." },
      },
      required: ["steps"],
    },
  },

  [Tool.CreateDir]: {
    name: Tool.CreateDir,
    description: "Create a new directory (including nested directories) at the specified path. Use this tool ONLY when the user asks to create a folder or directory.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative directory path to create (e.g., 'src/utils', 'test/fixtures')." },
      },
      required: ["path"],
    },
  },

  [Tool.WriteFile]: {
    name: Tool.WriteFile,
    description: "Write or overwrite a file with the specified content. Use this tool ONLY when the user asks to create, write, save, or update a file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path (e.g., 'output.txt', 'src/config.json'). Absolute paths are rejected." },
        content: { type: "string", description: "Full file content as a string. For JSON, pass a JSON string, not an object." },
      },
      required: ["path", "content"],
    },
  },

  [Tool.SearchInFiles]: {
    name: Tool.SearchInFiles,
    description: "Search for a regex pattern inside files and return matching lines with file paths and line numbers. Use this tool ONLY when the user asks to search within files or find text in code.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for (e.g., 'function.*tool', 'TODO'). Uses grep -E syntax." },
        files: { type: "string", description: "Glob pattern for files to search (e.g., '*.ts', 'src/**/*.js'). Defaults to all files.", default: "." },
      },
      required: ["pattern"],
    },
  },

  [Tool.ExecShell]: {
    name: Tool.ExecShell,
    description: "Execute a single shell command and return its output. Blocked commands: rm -rf /, sudo, chmod 777, mkfs, dd, shutdown, reboot.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute (e.g., 'ls -la', 'git status', 'node --version')." },
        cwd: { type: "string", description: "Working directory for the command (default: current working directory).", default: "." },
      },
      required: ["command"],
    },
  },

  [Tool.QueryLLM]: {
    name: Tool.QueryLLM,
    description: "Send a prompt directly to the local LM Studio language model and return its response. Use this tool ONLY when the user asks to query the model directly.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Prompt to send to the language model. Be specific and include context." },
      },
      required: ["prompt"],
    },
  },

  [Tool.SignalComplete]: {
    name: Tool.SignalComplete,
    description: "Signal to the orchestrator that the current task is fully complete. Use this tool ONLY when ALL requested work is done.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  [Tool.DecomposeAndExecute]: {
    name: Tool.DecomposeAndExecute,
    description: "Break a complex task into subtasks and execute them via subagents. Use this tool when the task is complex and requires multiple steps. The tool will: 1) decompose the task, 2) execute each subtask via subagent, 3) validate results, 4) reflect on progress.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "The full task description to decompose and execute." },
      },
      required: ["task"],
    },
  },
};
