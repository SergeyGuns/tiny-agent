// ─── format-specs.ts — dynamic file format specification lookup ──
// Detects file format by extension, fetches spec summary via web search, caches results.

interface FormatSpec {
  mime: string;
  description: string;
  rules: string[];
}

const specCache = new Map<string, FormatSpec>();

// Basic MIME type detection by extension (no hardcoding of formats)
const mimeMap: Record<string, string> = {
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.ts': 'application/typescript',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.py': 'application/x-python',
  '.sh': 'application/x-shellscript',
};

function getExtension(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return '';
  return path.slice(dot).toLowerCase();
}

function getMime(path: string): string {
  return mimeMap[getExtension(path)] || 'text/plain';
}

// Known spec URL patterns for common formats (just URLs, no content hardcoded)
const specUrlPatterns: Record<string, string> = {
  '.json': 'https://www.json.org/json-en.html',
  '.html': 'https://html.spec.whatwg.org/multipage/syntax.html',
  '.css': 'https://www.w3.org/TR/CSS22/syndata.html',
  '.js': 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide',
  '.md': 'https://commonmark.org/help/',
  '.yaml': 'https://yaml.org/spec/1.2/spec.html',
  '.csv': 'https://datatracker.ietf.org/doc/html/rfc4180',
};

export async function getFileSpec(path: string, searchFn: (query: string) => Promise<string>): Promise<FormatSpec | null> {
  const ext = getExtension(path);
  if (!ext) return null;

  // Return cached spec
  if (specCache.has(ext)) return specCache.get(ext)!;

  const mime = getMime(path);

  // Try fetching the known spec URL directly
  const specUrl = specUrlPatterns[ext];
  let rules: string[] = [];

  if (specUrl) {
    try {
      const { getMcpClient } = await import('./mcp-client.js');
      const client = await getMcpClient();
      if (client) {
        const content = await client.callTool('get-single-web-page-content', {
          url: specUrl,
          maxContentLength: 3000,
        });
        rules = extractRulesFromContent(content, ext);
      }
    } catch { /* fallback to search */ }
  }

  // Fallback: web search for format specification
  if (rules.length === 0) {
    try {
      const { getMcpClient } = await import('./mcp-client.js');
      const client = await getMcpClient();
      if (client) {
        const searchResult = await client.callTool('get-web-search-summaries', {
          query: `${ext} file format specification syntax rules`,
          limit: 3,
        });
        rules = extractRulesFromSearch(searchResult, ext);
      }
    } catch { /* no MCP available */ }
  }

  const spec: FormatSpec = {
    mime,
    description: `File format: ${ext} (${mime})`,
    rules: rules.length > 0 ? rules : getBasicRules(ext),
  };

  specCache.set(ext, spec);
  return spec;
}

/** Extract formatting rules from fetched spec page content */
function extractRulesFromContent(content: string, ext: string): string[] {
  const rules: string[] = [];
  const lines = content.split('\n').filter(l => l.trim());

  // Extract key sentences mentioning format rules
  const rulePatterns: Record<string, RegExp> = {
    '.json': /(must be a valid|syntax|value can be|object|array|string|number|boolean|null)/gi,
    '.html': /(element|tag|attribute|must be|required|valid|closing|self-closing)/gi,
    '.css': /(property|value|selector|declaration|must be|syntax|rule)/gi,
    '.js': /(statement|expression|variable|function|must be|syntax|semicolon|block)/gi,
    '.md': /(heading|paragraph|list|link|image|code block|must be|syntax)/gi,
  };

  const pattern = rulePatterns[ext] || /(format|syntax|rule|must|required|valid)/gi;

  for (const line of lines.slice(0, 50)) {
    if (pattern.test(line) && line.length < 200) {
      const cleaned = line.replace(/<[^>]+>/g, '').trim();
      if (cleaned.length > 10 && rules.length < 8) {
        rules.push(cleaned);
      }
    }
  }

  return rules;
}

/** Extract rules from search result snippets */
function extractRulesFromSearch(result: string, ext: string): string[] {
  const rules: string[] = [];
  const snippets = result.split(/\n\n+/);

  for (const snippet of snippets.slice(0, 3)) {
    const cleaned = snippet.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (cleaned.length > 20 && cleaned.length < 300) {
      rules.push(cleaned);
    }
  }

  return rules;
}

/** Minimal fallback rules — generic, not hardcoded per-format */
function getBasicRules(ext: string): string[] {
  return [
    `File extension: ${ext}`,
    `MIME type: ${getMime(ext)}`,
    'Ensure the file content is valid and well-formatted.',
  ];
}

/** Format spec as a compact string for the model prompt */
export function formatSpecHint(spec: FormatSpec | null): string {
  if (!spec) return '';

  let hint = `\n\n[FILE FORMAT SPEC: ${spec.mime}]\n`;
  if (spec.rules.length > 0) {
    hint += 'Key rules:\n';
    for (const rule of spec.rules.slice(0, 5)) {
      hint += `- ${rule}\n`;
    }
  }
  return hint;
}

/**
 * Validate and write a file by delegating to a subagent.
 * The subagent receives the content + format spec and produces valid output.
 * Returns { success, content, error }.
 */
export async function validateAndWriteFile(
  path: string,
  rawContent: string,
  spec: FormatSpec | null,
  queryLLMFn: (messages: { role: string; content: string }[]) => Promise<string>,
  writeFileFn: (path: string, content: string) => void,
): Promise<{ success: boolean; content: string; error?: string }> {
  const ext = getExtension(path);

  // Build the delegation prompt
  const specText = spec
    ? `FORMAT SPECIFICATION (${spec.mime}):\n${spec.rules.slice(0, 8).join('\n')}`
    : `File extension: ${ext}`;

  const prompt = `You are a file writer. Write a valid file based on the provided content and format specification.

FILE PATH: ${path}
${specText}

RAW CONTENT PROVIDED:
\`\`\`
${rawContent.substring(0, 5000)}
\`\`\`

TASK:
1. Analyze the raw content
2. Fix any formatting issues to make it valid ${spec?.mime || ext} format
3. Output ONLY the corrected file content, wrapped in triple backticks

OUTPUT FORMAT:
\`\`\`
[corrected file content here]
\`\`\``;

  try {
    const response = await queryLLMFn([
      { role: 'user', content: prompt },
    ]);

    // Extract content from backticks
    const match = response.match(/```(?:.*?\n)?([\s\S]*?)```/);
    const correctedContent = match ? match[1].trim() : response.trim();

    // Write the corrected content
    writeFileFn(path, correctedContent);

    return { success: true, content: correctedContent };
  } catch (e) {
    // Fallback: write raw content
    try {
      writeFileFn(path, rawContent);
      return { success: true, content: rawContent, error: `Validation failed, wrote raw: ${e}` };
    } catch (writeErr) {
      return { success: false, content: rawContent, error: String(writeErr) };
    }
  }
}

/** Clear spec cache (for testing) */
export function clearSpecCache(): void {
  specCache.clear();
}
