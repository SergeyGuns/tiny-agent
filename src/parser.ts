// ─── Action parser ─────────────────────────────────────────────

/**
 * Extracts tool name and arguments from the LLM response text.
 * Supports:
 *   1. Action: toolName[{"key": "value"}]
 *   2. **Action:** toolName[{"key": "value"}]  (markdown bold)
 *   3. toolName[args]  (bare, no prefix)
 */
export function parseAction(text: string): { name: string; args: Record<string, unknown> } | null {
  const actionPatterns = [
    /Action:\s*(\w+)\[([\s\S]*?)\]/,
    /\*\*Action:\*\*\s*(\w+)\[([\s\S]*?)\]/,
    /^\s*(\w+)\[\s*([^\\]]*)\s*\]\s*$/,
  ];

  for (const pattern of actionPatterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        return { name: match[1].trim(), args: JSON.parse(match[2].trim()) };
      } catch {
        // JSON parse failed — try lenient recovery for writeFile with unescaped content
        const toolName = match[1].trim();
        const rawArgs = match[2].trim();
        if (toolName === 'writeFile') {
          const recovered = parseWriteFileArgs(rawArgs);
          if (recovered) return { name: 'writeFile', args: recovered };
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
      if (parsed.path && typeof parsed.content === 'string') return { name: 'writeFile', args: parsed };
      if (parsed.pattern && typeof parsed.files === 'string') return { name: 'grep', args: parsed };
    } catch { /* not a tool call */ }
  }
  return null;
}

// ─── Lenient writeFile args parser ─────────────────────────────

/**
 * Handles: {"path": "file.json", "content": "{"key": "value"}"}  (unescaped inner quotes)
 * Strategy: extract "path" via simple regex, then grab everything after "content": as the content value.
 */
export function parseWriteFileArgs(raw: string): Record<string, unknown> | null {
  // Accept "path", "file", or "filename" as the file path key
  const pathKeys = ['"path"', '"file"', '"filename"'];
  let path: string | null = null;
  for (const key of pathKeys) {
    const m = raw.match(new RegExp(key + '\\s*:\\s*"([^"]+)"'));
    if (m) { path = m[1]; }
  }
  if (!path) return null;

  const contentKeyIdx = raw.indexOf('"content"');
  if (contentKeyIdx === -1) return null;

  const afterKey = raw.slice(contentKeyIdx + '"content"'.length);
  const colonIdx = afterKey.indexOf(':');
  if (colonIdx === -1) return null;
  const afterColon = afterKey.slice(colonIdx + 1).trim();
  if (!afterColon.startsWith('"')) return null;

  const openingQuotePos = raw.indexOf('"', contentKeyIdx + '"content"'.length + colonIdx + 1);
  if (openingQuotePos === -1) return null;

  // Find the end of the content value: the last "}  (quote+brace) that closes the JSON object.
  // Scans backwards from the end to find the last } preceded by " (with possible whitespace).
  // This correctly handles content that contains } characters (e.g., nested JSON arrays/objects).
  let endQuotePos = -1;
  for (let i = raw.length - 1; i >= openingQuotePos + 1; i--) {
    if (raw[i] === '}') {
      let j = i - 1;
      while (j > openingQuotePos && (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\n')) j--;
      if (raw[j] === '"') {
        endQuotePos = j;
        break;
      }
    }
  }
  if (endQuotePos === -1) return null;

  const content = raw.slice(openingQuotePos + 1, endQuotePos);
  return { path, content };
}
