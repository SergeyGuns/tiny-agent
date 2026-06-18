// ─── Action parser ─────────────────────────────────────────────

/**
 * Extracts tool name and arguments from the LLM response text.
 * Supports:
 *   1. Action: toolName[{"key": "value"}]
 *   2. **Action:** toolName[{"key": "value"}]  (markdown bold)
 *   3. toolName[args]  (bare, no prefix)
 * Also handles empty args: toolName[]
 * Also strips thinking tags (<think>...</think>) before parsing
 */
export function stripThinkingTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export function parseAction(text: string): { name: string; args: Record<string, unknown> } | null {
  // Strip thinking tags first
  text = stripThinkingTags(text);

  const actionPatterns = [
    /Action:\s*(\w+)\[([\s\S]*)\](?:\s|$)/,
    /\*\*Action:\*\*\s*(\w+)\[([\s\S]*)\](?:\s|$)/,
    /^\s*(\w+)\[([\s\S]*)\]\s*$/,
  ];

  for (const pattern of actionPatterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        const argsStr = match[2].trim();
        const args = argsStr ? JSON.parse(argsStr) : {};
        return { name: match[1].trim(), args };
      } catch {
        // JSON parse failed — try lenient recovery for write_file_content with unescaped content
        const toolName = match[1].trim();
        const rawArgs = match[2].trim();
        if (toolName === 'write_file_content') {
          const recovered = parseWriteFileArgs(rawArgs);
          if (recovered) return { name: 'write_file_content', args: recovered };
        }
        return null;
      }
    }
  }

  // Fallback: look for any JSON object that looks like a tool call
  const jsonMatch = text.match(/({[\s\S]*})/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.path && typeof parsed.content === 'string') return { name: 'write_file_content', args: parsed };
        if (parsed.pattern && typeof parsed.files === 'string') return { name: 'search_in_files', args: parsed };
    } catch { /* not a tool call */ }
  }

  // v12: Fallback for write_file_content with multiline content (unescaped newlines break JSON.parse)
  // Find "content":" and extract everything until the first "}]
  const contentMarker = text.indexOf('"content"');
  if (contentMarker !== -1 && text.includes('write_file_content')) {
    const afterContent = text.substring(contentMarker + '"content"'.length);
    const colonIdx = afterContent.indexOf(':');
    if (colonIdx !== -1) {
      const afterColon = afterContent.substring(colonIdx + 1).trim();
      if (afterColon.startsWith('"')) {
        const contentStart = text.indexOf('"', contentMarker + '"content"'.length + colonIdx + 1) + 1;
        // Find closing "] — the last "} before the end of text
        const closeIdx = text.lastIndexOf('"}]');
        if (closeIdx !== -1) {
          let content = text.substring(contentStart, closeIdx);
          content = content.replace(/\\"/g, '"').replace(/\\n/g, '\n');
          // Extract path
          const pathMatch = text.match(/"path"\s*:\s*"([^"]+)"/);
          if (pathMatch) {
          return { name: 'write_file_content', args: { path: pathMatch[1], content } };
          }
        }
      }
    }
  }

  return null;
}

// ─── Multi-action parser ──────────────────────────────────────

/**
 * Parses ALL actions from a single LLM response.
 * Supports multiple Action: toolName[...] patterns in one text.
 * Also handles **Action:** (markdown bold) and bare toolName[...] (no prefix).
 * Strips thinking tags before parsing.
 */
export function parseAllActions(text: string): { name: string; args: Record<string, unknown> }[] {
  const actions: { name: string; args: Record<string, unknown> }[] = [];
  text = stripThinkingTags(text);

  // Try to find all Action: toolName[...] patterns (non-greedy match)
  const actionRegex = /(?:\*\*Action:\*\*|Action:)\s*(\w+)\[([\s\S]*?)\](?=\s*(?:\*\*Action:\*\*|Action:|$))/g;
  let match;
  while ((match = actionRegex.exec(text)) !== null) {
    try {
      const argsStr = match[2].trim();
      const args = argsStr ? JSON.parse(argsStr) : {};
      actions.push({ name: match[1].trim(), args });
    } catch {
      // Try lenient recovery for write_file_content with unescaped content
      if (match[1].trim() === 'write_file_content') {
        const recovered = parseWriteFileArgs(match[2].trim());
        if (recovered) actions.push({ name: 'write_file_content', args: recovered });
      }
    }
  }

  // If no Action: prefix found, try single action without prefix
  if (actions.length === 0) {
    const single = parseAction(text);
    if (single) actions.push(single);
  }

  return actions;
}

// ─── Lenient writeFile args parser ─────────────────────────────

/**
 * Handles: {"path": "file.json", "content": "{"key": "value"}"}  (unescaped inner quotes)
 * Strategy: extract "path" via simple regex, then grab everything after "content": as the content value.
 */
export function parseWriteFileArgs(raw: string): Record<string, unknown> | null {
  // Accept "path", "file", or "filename" as the file path key
  const pathKeys = ['"path"', '"file"', '"filename"'];
  let filePath: string | null = null;
  for (const key of pathKeys) {
    const m = raw.match(new RegExp(key + '\\s*:\\s*"([^"]+)"'));
    if (m) { filePath = m[1]; }
  }
  if (!filePath) return null;

  const contentKeyIdx = raw.indexOf('"content"');
  if (contentKeyIdx === -1) return null;

  const afterKey = raw.slice(contentKeyIdx + '"content"'.length);
  const colonIdx = afterKey.indexOf(':');
  if (colonIdx === -1) return null;
  const afterColon = afterKey.slice(colonIdx + 1).trim();
  if (!afterColon.startsWith('"')) return null;

  // Find opening quote
  const openingQuotePos = raw.indexOf('"', contentKeyIdx + '"content"'.length + colonIdx + 1);
  if (openingQuotePos === -1) return null;

  // Find closing quote: scan from end for last " before ]}
  const lastBracket = raw.lastIndexOf(']');
  const searchEnd = lastBracket > 0 ? lastBracket : raw.length;
  let endQuotePos = -1;
  for (let i = searchEnd - 1; i > openingQuotePos; i--) {
    if (raw[i] === '"') {
      endQuotePos = i;
      break;
    }
  }
  if (endQuotePos === -1) return null;

  let content = raw.slice(openingQuotePos + 1, endQuotePos);
  // Unescape: \" -> ", literal \n -> newline, \\ -> backslash
  content = content.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
  return { path: filePath, content };
}
