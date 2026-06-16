import * as fs from 'node:fs';
import * as path from 'node:path';
import { ToolFunction } from '../types.js';
import { searchDuckDuckGo } from './search.js';
import { extractTextFromHtml } from './html.js';
import { FETCH_TIMEOUT_MS, COMMAND_TIMEOUT_MS } from './config.js';

// ─── Tool definitions ──────────────────────────────────────────

export const tools: Record<string, ToolFunction> = {
  webSearch: async (args: Record<string, unknown>) => {
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
    } catch (e: any) { return `webSearch error: ${e.message}`; }
  },

  fetch: async (args: Record<string, unknown>) => {
    try {
      const url = args.url as string;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return 'fetch: URL должен начинаться с http:// или https://';
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
    } catch (e: any) { return `fetch: ${e.message}`; }
  },

  readDir: (args: Record<string, unknown>) => {
    try { return fs.readdirSync(path.resolve((args.path as string) || '.')).join(', '); }
    catch (e: any) { return `readDir error: ${e.message}`; }
  },

  readFile: (args: Record<string, unknown>) => {
    try { return fs.readFileSync(path.resolve(args.path as string), 'utf-8'); }
    catch (e: any) { return `readFile error: ${e.message}`; }
  },

  createPlan: (args: Record<string, unknown>) => {
    try {
      const steps = args.steps as string[];
      if (!steps || !Array.isArray(steps)) return 'createPlan: нужен массив steps';
      const plan = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
      const content = `# План\n\n${plan}\n`;
      const p = path.resolve('PLAN.md');
      fs.writeFileSync(p, content, 'utf-8');
      return `План из ${steps.length} шагов записан в PLAN.md`;
    } catch (e: any) { return `createPlan error: ${e.message}`; }
  },

  mkdir: (args: Record<string, unknown>) => {
    try {
      const p = path.resolve((args.path as string) || '.');
      fs.mkdirSync(p, { recursive: true });
      return `Директория создана: ${p}`;
    } catch (e: any) { return `mkdir error: ${e.message}`; }
  },

  writeFile: (args: Record<string, unknown>) => {
    try {
      // Accept "path", "file", "filename", or "file_name" as the file path key
      const rawPath = (args.path ?? args.file ?? args.filename ?? args.file_name) as string;
      if (!rawPath || typeof rawPath !== 'string') return 'writeFile: нужен path';
      const p = path.resolve(rawPath);
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let content = args.content as string;
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
        return `writeFile error: файл ${p} не создан (writeFileSync returned but file missing)`;
      }
      const written = fs.readFileSync(p, 'utf-8');
      if (written !== content) {
        return `writeFile error: содержимое ${p} не совпадает`;
      }
      return `Файл записан: ${p}`;
    }
    catch (e: any) { console.error(`[writeFile] ERROR: ${e.message}`); return `writeFile error: ${e.message}`; }
  },

  runPackageScript: async (_args: Record<string, unknown>) => { return 'Скрипт не настроен'; },

  grep: async (args: Record<string, unknown>) => {
    try {
      const pattern = args.pattern as string;
      const filesGlob = (args.files as string) || '.';
      if (!pattern) return 'grep: нужен pattern';
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
    } catch (e: any) {
      if (e.message?.includes('ENOENT')) return 'grep не найден в системе';
      return `grep: ${e.message?.substring(0, 200)}`;
    }
  },

  runCommand: async (args: Record<string, unknown>) => {
    try {
      const cmd = (args.command || args.cmd) as string;
      if (!cmd || typeof cmd !== 'string') return 'runCommand: нужна команда';
      const blocked = ['rm -rf /', 'sudo', 'chmod 777', 'mkfs', 'dd ', 'shutdown', 'reboot', '> /dev'];
      if (blocked.some(b => cmd.includes(b))) return `runCommand: команда "${cmd}" заблокирована`;
      const { execSync } = await import('node:child_process');
      const output = execSync(cmd, {
        cwd: (args.cwd as string) || process.cwd(),
        timeout: COMMAND_TIMEOUT_MS,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.substring(0, 2000) || '(команда выполнена)';
    } catch (e: any) {
      if (e.message?.includes('ENOENT')) return `runCommand: команда не найдена: ${e.message}`;
      if (e.message?.includes('timeout')) return 'runCommand: таймаут 30с';
      return `runCommand: ${e.message?.substring(0, 200)}`;
    }
  },

  // RLM tool — direct LM Studio call (no Python dependency)
  rlm: async (args: Record<string, unknown>) => {
    try {
      const prompt = args.prompt as string;
      if (!prompt || typeof prompt !== 'string') return 'rlm: нужен prompt';
      const baseUrl = process.env.LM_STUDIO_URL || 'http://localhost:1234/v1';
      const modelName = process.env.LM_STUDIO_MODEL || 'local-model';
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 500,
        }),
        signal: AbortSignal.timeout(300000),
      });
      if (!res.ok) return `rlm: HTTP ${res.status}`;
      const data = await res.json() as any;
      const msg = data.choices?.[0]?.message;
      const content = msg?.content || msg?.reasoning_content || 'rlm: empty response';
      // Log reasoning for analysis (append to single file)
      const reasoning = msg?.reasoning_content || '';
      if (reasoning) {
        const fs = await import('node:fs');
        const logLine = [new Date().toISOString(), modelName, JSON.stringify(prompt), JSON.stringify(reasoning)].join('\t') + '\n';
        fs.appendFileSync('/tmp/rlm-reasoning.log', logLine);
      }
      return content;
    } catch (e: any) {
      return `rlm: ${e.message?.substring(0, 200)}`;
    }
  },
};
