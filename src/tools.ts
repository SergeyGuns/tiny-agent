import { queryLLM, LLM_PROFILES } from './llm.js';

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolFunction } from '../types.js';
import { searchDuckDuckGo } from './search.js';
import { extractTextFromHtml } from './html.js';
import { FETCH_TIMEOUT_MS, COMMAND_TIMEOUT_MS } from './config.js';

// ─── Tool definitions ──────────────────────────────────────────

export const tools: Record<string, ToolFunction> = {
  search_web: async (args: Record<string, unknown>) => {
    try {
      const query = args.query as string;
      const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10);

      const results = await searchDuckDuckGo(query, limit);

      if (results.length === 0) {
        return 'Ничего не найдено.';
      }

      return results.map((r, i) => {
        let line = `[${i + 1}] ${r.title}\n    URL: ${r.url}`;
        if (r.snippet) line += `\n    ${r.snippet}`;
        return line;
      }).join('\n\n');
    } catch (e: unknown) { return `search_web error: ${e instanceof Error ? e.message : String(e)}`; }
  },

  fetch_url_content: async (args: Record<string, unknown>) => {
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
      if (contentType.includes('application/json')) {
        return body.substring(0, 5000);
      }
      return extractTextFromHtml(body).substring(0, 5000);
    } catch (e: unknown) { return `fetch_url_content: ${e instanceof Error ? e.message : String(e)}`; }
  },

  list_directory: (args: Record<string, unknown>) => {
    try { return fs.readdirSync(path.resolve((args.path as string) || '.')).join(', '); }
    catch (e: unknown) { return `list_directory error: ${e instanceof Error ? e.message : String(e)}`; }
  },

  read_file_content: (args: Record<string, unknown>) => {
    try { return fs.readFileSync(path.resolve(args.path as string), 'utf-8'); }
    catch (e: unknown) { return `read_file_content error: ${e instanceof Error ? e.message : String(e)}`; }
  },

  write_plan_file: (args: Record<string, unknown>) => {
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

  create_directory: (args: Record<string, unknown>) => {
    try {
      const p = path.resolve((args.path as string) || '.');
      fs.mkdirSync(p, { recursive: true });
      return `Директория создана: ${p}`;
    } catch (e: unknown) { return `create_directory error: ${e instanceof Error ? e.message : String(e)}`; }
  },

  write_file_content: (args: Record<string, unknown>) => {
    try {
      // Accept "path", "file", "filename", or "file_name" as the file path key
      const rawPath = (args.path ?? args.file ?? args.filename ?? args.file_name) as string;
      if (!rawPath || typeof rawPath !== 'string') return 'write_file_content: нужен path';
      // v12: Reject absolute paths — model sometimes sends /tmp/... paths
      if (rawPath.startsWith('/') || rawPath.startsWith('C:\\') || rawPath.startsWith('D:\\')) {
        return `write_file_content: absolute path "${rawPath}" rejected. Use relative path like "file.txt" or "dir/file.txt".`;
      }
      const p = path.resolve(rawPath);
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let content: string = typeof args.content === 'object' ? JSON.stringify(args.content, null, 2) : String(args.content);
      // v10e: Fix double-escaped JSON content
      if (content.startsWith('[') || content.startsWith('{')) {
        try {
          JSON.parse(content);
        } catch {
          try {
            const unescaped = content.replace(/\\"/g, '"');
            JSON.parse(unescaped);
            content = unescaped;
          } catch {
            try {
              const fixed = content.replace(/\\\\"/g, '"');
              JSON.parse(fixed);
              content = fixed;
            } catch { /* keep original */ }
          }
        }
      }
      fs.writeFileSync(p, content, 'utf-8');
      if (!fs.existsSync(p)) {
        return `write_file_content error: файл ${p} не создан`;
      }
      return `Файл записан: ${p}`;
    }
    catch (e: unknown) { console.error(`[write_file_content] ERROR: ${e instanceof Error ? e.message : String(e)}`); return `write_file_content error: ${e instanceof Error ? e.message : String(e)}`; }
  },

  execute_npm_script: async (_args: Record<string, unknown>) => { return 'Скрипт не настроен'; },

  search_in_files: async (args: Record<string, unknown>) => {
    try {
      const pattern = args.pattern as string;
      const filesGlob = (args.files as string) || '.';
      if (!pattern) return 'search_in_files: нужен pattern';
      const { execSync } = await import('node:child_process');
      const grepCmd = filesGlob === '.'
        ? `grep -r -n -H "${pattern}" . --include="*" --exclude-dir=".git" --exclude-dir="node_modules" 2>/dev/null | head -50`
        : `grep -n -H "${pattern}" ${filesGlob} 2>/dev/null | head -50`;
      const output = execSync(grepCmd, {
        cwd: process.cwd(),
        timeout: 10000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output || 'Ничего не найдено';
    } catch (e: unknown) {
      if (e instanceof Error && e.message?.includes('ENOENT')) return 'search_in_files не найден в системе';
      return `search_in_files: ${e instanceof Error ? e.message?.substring(0, 200) : String(e)}`;
    }
  },

  execute_shell_command: async (args: Record<string, unknown>) => {
    try {
      const cmd = (args.command || args.cmd) as string;
      if (!cmd || typeof cmd !== 'string') return 'execute_shell_command: нужна команда';
      const blocked = ['rm -rf /', 'sudo', 'chmod 777', 'mkfs', 'dd ', 'shutdown', 'reboot', '> /dev'];
      if (blocked.some(b => cmd.includes(b))) return `execute_shell_command: команда "${cmd}" заблокирована`;
      const { execSync } = await import('node:child_process');
      const output = execSync(cmd, {
        cwd: (args.cwd as string) || process.cwd(),
        timeout: COMMAND_TIMEOUT_MS,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.substring(0, 2000) || '(команда выполнена)';
    } catch (e: unknown) {
      if (e instanceof Error && e.message?.includes('ENOENT')) return `execute_shell_command: команда не найдена: ${e.message}`;
      if (e instanceof Error && e.message?.includes('timeout')) return 'execute_shell_command: таймаут 30с';
      return `execute_shell_command: ${e instanceof Error ? e.message?.substring(0, 200) : String(e)}`;
    }
  },

  // RLM tool — direct LM Studio call (no Python dependency)
  // RLM tool — uses queryLLM with subAgent profile for better reasoning
  query_language_model: async (args: Record<string, unknown>) => {
    try {
      const prompt = args.prompt as string;
      if (!prompt || typeof prompt !== 'string') return 'query_language_model: нужен prompt';
      const content = await queryLLM(
        [{ role: 'user', content: prompt }],
        LLM_PROFILES.subAgent,
      );
      return content;
    } catch (e: unknown) {
      return `query_language_model: ${e instanceof Error ? e.message?.substring(0, 200) : String(e)}`;
    }
  },
  // signal_task_complete — explicit stop signal
  signal_task_complete: (_args: Record<string, unknown>) => {
    return 'DONE';
  },
};

// ─── Tool schemas for LLM function calling ─────────────────────

export const toolSchemas: Record<string, object> = {
  search_web: {
    name: "search_web",
    description: "Search the web using DuckDuckGo and return a list of results with titles, URLs, and snippets. Use this tool ONLY when the user asks to search the internet, find information online, or look up a topic. Do NOT use this tool for reading local files, accessing previously fetched URLs, or retrieving historical data.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query in English or Russian. Use specific keywords, not full sentences."
        },
        limit: {
          type: "integer",
          description: "Number of results to return (1-10). Default is 5.",
          minimum: 1,
          maximum: 10,
          default: 5
        }
      },
      required: ["query"]
    }
  },

  fetch_url_content: {
    name: "fetch_url_content",
    description: "Fetch the content of a single URL and return extracted text (for HTML) or raw JSON. Use this tool ONLY after using search_web to retrieve a specific page the user wants to read. Do NOT use this tool for local file paths, API endpoints requiring authentication, or URLs not returned by search_web.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Full URL starting with http:// or https://",
          pattern: "^https?://.+"
        }
      },
      required: ["url"]
    }
  },

  list_directory: {
    name: "list_directory",
    description: "List all files and subdirectories inside a given directory path. Use this tool ONLY when the user asks to see folder contents, list files, or explore directory structure. Do NOT use this tool to read file contents (use read_file_content) or to search for files by name (use search_in_files).",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative directory path (e.g., 'src', '.', 'test/utils'). Defaults to '.' if omitted.",
          default: "."
        }
      },
      required: []
    }
  },

  read_file_content: {
    name: "read_file_content",
    description: "Read and return the entire content of a single file as text. Use this tool ONLY when the user asks to read, view, or show a file. Do NOT use this tool for listing directory contents (use list_directory) or for searching within files (use search_in_files).",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path (e.g., 'src/tools.ts', 'README.md'). Must be a file, not a directory."
        }
      },
      required: ["path"]
    }
  },

  write_plan_file: {
    name: "write_plan_file",
    description: "Create a PLAN.md file with a numbered list of steps. Use this tool ONLY when the user explicitly asks to create a plan, outline steps, or break down a task into actionable items. Do NOT use this tool for writing arbitrary files (use write_file_content) or for executing plans.",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: { type: "string" },
          description: "Array of step descriptions, each a single actionable item (e.g., ['Read config', 'Update tests', 'Run build'])"
        }
      },
      required: ["steps"]
    }
  },

  create_directory: {
    name: "create_directory",
    description: "Create a new directory (including nested directories) at the specified path. Use this tool ONLY when the user asks to create a folder or directory. Do NOT use this tool to create files (use write_file_content) or to list existing directories (use list_directory).",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative directory path to create (e.g., 'src/utils', 'test/fixtures'). Parent directories are created automatically."
        }
      },
      required: ["path"]
    }
  },

  write_file_content: {
    name: "write_file_content",
    description: "Write or overwrite a file with the specified content. Use this tool ONLY when the user asks to create, write, save, or update a file. Do NOT use this tool for reading files (use read_file_content), creating directories (use create_directory), or appending to files (this tool overwrites).",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path (e.g., 'output.txt', 'src/config.json'). Absolute paths (starting with /) are rejected."
        },
        content: {
          type: "string",
          description: "Full file content as a string. For JSON, pass a JSON string, not an object."
        }
      },
      required: ["path", "content"]
    }
  },

  execute_npm_script: {
    name: "execute_npm_script",
    description: "Execute a named script from package.json using npm run. Use this tool ONLY when the user asks to run a specific npm script (e.g., 'run the build', 'execute test script'). This tool is currently a stub and returns an error. Do NOT use this tool for arbitrary shell commands (use execute_shell_command) or for installing packages.",
    parameters: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description: "Name of the script in package.json (e.g., 'build', 'test', 'start')."
        }
      },
      required: ["script"]
    }
  },

  search_in_files: {
    name: "search_in_files",
    description: "Search for a regex pattern inside files and return matching lines with file paths and line numbers. Use this tool ONLY when the user asks to search within files, find text in code, or locate a pattern. Do NOT use this tool for web searches (use search_web), listing files (use list_directory), or reading full files (use read_file_content).",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regex pattern to search for (e.g., 'function.*tool', 'TODO'). Uses grep -E syntax."
        },
        files: {
          type: "string",
          description: "Glob pattern for files to search (e.g., '*.ts', 'src/**/*.js'). Defaults to all files in current directory.",
          default: "."
        }
      },
      required: ["pattern"]
    }
  },

  execute_shell_command: {
    name: "execute_shell_command",
    description: "Execute a single shell command and return its output. Use this tool ONLY when the user explicitly asks to run a command, execute a script, or perform a system operation. Blocked commands: rm -rf /, sudo, chmod 777, mkfs, dd, shutdown, reboot. Do NOT use this tool for reading files (use read_file_content), searching files (use search_in_files), or running npm scripts (use execute_npm_script).",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute (e.g., 'ls -la', 'git status', 'node --version'). Avoid destructive commands."
        },
        cwd: {
          type: "string",
          description: "Working directory for the command (default: current working directory).",
          default: "."
        }
      },
      required: ["command"]
    }
  },

  query_language_model: {
    name: "query_language_model",
    description: "Send a prompt directly to the local LM Studio language model and return its response. Use this tool ONLY when the user asks to query the model directly, get an LLM opinion, or when the agent needs additional reasoning. Do NOT use this tool for web searches (use search_web), file operations, or as a replacement for the agent's own reasoning.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Prompt to send to the language model. Be specific and include context."
        }
      },
      required: ["prompt"]
    }
  },

  signal_task_complete: {
    name: "signal_task_complete",
    description: "Signal to the orchestrator that the current task is fully complete. Use this tool ONLY when ALL requested work is done, all files are written, and no further tool calls are needed. Do NOT use this tool prematurely or when there are still pending steps.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
};
