// ─── with-subagent.ts — validate tool results via subagent ──
// After each tool execution, the result is validated/fixed by a subagent.
// The subagent receives: tool name, args, raw result, format spec
// Returns: validated/fixed result or error

import { queryLLM, LLM_PROFILES } from './llm.js';
import { getFileSpec, formatSpecHint } from './format-specs.js';
import type { ToolFunction } from '../types.js';

interface ValidationResult {
  output: string;
  wasFixed: boolean;
}

/**
 * Quick heuristic check if a tool result looks valid
 */
function isResultValid(toolName: string, result: string): boolean {
  if (!result || result.length < 2) return false;

  const errorPrefixes = ['Error:', 'Ошибка:', 'error:', 'Tool "', 'Cannot', 'ENOENT', 'EISDIR'];
  if (errorPrefixes.some(p => result.startsWith(p))) return false;

  switch (toolName) {
    case 'search_web':
      return result.includes('URL:') || result.includes('http') || result.includes('Search completed');
    case 'fetch_url_content':
      return result.length > 50 && !result.startsWith('Error');
    case 'write_file_content':
      return result.includes('записан') || result.includes('created') || result.includes('written');
    case 'read_file_content':
      return result.length > 0;
    case 'execute_shell_command':
      return !result.includes('command not found') && !result.includes('не найдена');
    default:
      return true;
  }
}

/**
 * Validate a tool result via subagent.
 */
export async function validateToolResult(
  toolName: string,
  args: Record<string, unknown>,
  rawResult: string,
): Promise<ValidationResult> {
  // Fast path: result looks valid
  if (isResultValid(toolName, rawResult)) {
    return { output: rawResult, wasFixed: false };
  }

  // Result looks suspicious — delegate to subagent
  const filePath = (args.path as string) || (args.file as string) || (args.filename as string);
  let specHint = '';
  if (filePath) {
    try {
      const spec = await getFileSpec(filePath, async (q: string) => {
        const { getMcpClient } = await import('./mcp-client.js');
        const client = await getMcpClient();
        if (!client) return '';
        return client.callTool('get-web-search-summaries', { query: q, limit: 3 });
      });
      specHint = formatSpecHint(spec);
    } catch { /* no MCP */ }
  }

  const prompt = `You are a tool result validator. Check and fix the result of a tool execution.

TOOL: ${toolName}
ARGS: ${JSON.stringify(args, null, 2)}

RAW RESULT:
\`\`\`
${rawResult.substring(0, 3000)}
\`\`\`

${specHint}

TASK:
1. Check if the result is valid (not an error, not empty, correct format)
2. If valid, output: VALID: [the result]
3. If invalid, explain the issue and provide a fix

OUTPUT:
VALID: [result]
or
INVALID: [explanation]
FIX: [corrected result]`;

  try {
    const response = await queryLLM(
      [{ role: 'user', content: prompt }],
      LLM_PROFILES.classifier,
    );

    if (response.startsWith('VALID:')) {
      return { output: response.slice(6).trim(), wasFixed: false };
    }

    if (response.startsWith('FIX:')) {
      return { output: response.slice(4).trim(), wasFixed: true };
    }

    return { output: rawResult, wasFixed: false };
  } catch {
    return { output: rawResult, wasFixed: false };
  }
}
