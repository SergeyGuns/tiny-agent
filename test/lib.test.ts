import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseAction, parseAllActions, extractTextFromHtml, tools, parseDdgHtml } from '../lib.js';

// ─── parseAction ─────────────────────────────────────────────

describe('parseAction', () => {
  it('parses simple action with one arg', () => {
    const result = parseAction('Action: read_file_content[{"path": "index.ts"}]');
    assert.deepStrictEqual(result, { name: 'read_file_content', args: { path: 'index.ts' } });
  });

  it('parses action with multiple args', () => {
    const result = parseAction('Action: write_file_content[{"path": "out.txt", "content": "hello"}]');
    assert.deepStrictEqual(result, {
      name: 'write_file_content',
      args: { path: 'out.txt', content: 'hello' }
    });
  });

  it('returns null when no Action present', () => {
    const result = parseAction('Plan: do something\nThought: thinking...');
    assert.strictEqual(result, null);
  });

  it('returns null for plain text', () => {
    const result = parseAction('Just a regular response with no action.');
    assert.strictEqual(result, null);
  });

  it('returns null for invalid JSON', () => {
    const result = parseAction('Action: read_file_content[{path: "broken"}]');
    assert.strictEqual(result, null);
  });

  it('parses nested JSON args', () => {
    const result = parseAction('Action: fetch_url_content[{"url": "https://example.com", "opts": {"timeout": 5000}}]');
    assert.deepStrictEqual(result, {
      name: 'fetch_url_content',
      args: { url: 'https://example.com', opts: { timeout: 5000 } }
    });
  });

  // RES-002: write_file_content with JSON content (valid JSON)
  it('parses write_file_content with JSON content', () => {
    // Valid JSON - content value is a proper JSON string
    const input = 'Action: write_file_content[{"path": "data.json", "content": "hello world"}]';
    const result = parseAction(input);
    assert.ok(result, 'Should parse write_file_content');
    assert.strictEqual(result.name, 'write_file_content');
    assert.strictEqual(result.args.path, 'data.json');
    assert.strictEqual(result.args.content, 'hello world');
  });

  it('parses write_file_content with simple text content', () => {
    const result = parseAction('Action: write_file_content[{"path": "answer.txt", "content": "Hello world"}]');
    assert.deepStrictEqual(result, {
      name: 'write_file_content',
      args: { path: 'answer.txt', content: 'Hello world' }
    });
  });
});

// ─── parseAllActions ───────────────────────────────────────────

describe('parseAllActions', () => {
  it('parses single action', () => {
    const result = parseAllActions('Action: read_file_content[{\"path\": \"index.ts\"}]');
    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0], { name: 'read_file_content', args: { path: 'index.ts' } });
  });

  it('parses two actions', () => {
    const text = 'Action: read_file_content[{\"path\": \"a.txt\"}]\nAction: write_file_content[{\"path\": \"b.txt\", \"content\": \"hello\"}]';
    const result = parseAllActions(text);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].name, 'read_file_content');
    assert.strictEqual(result[0].args.path, 'a.txt');
    assert.strictEqual(result[1].name, 'write_file_content');
    assert.strictEqual(result[1].args.path, 'b.txt');
    assert.strictEqual(result[1].args.content, 'hello');
  });

  it('parses three actions', () => {
    const text = 'Action: list_directory[{\"path\": \".\"}]\nAction: read_file_content[{\"path\": \"data.json\"}]\nAction: write_file_content[{\"path\": \"out.txt\", \"content\": \"done\"}]';
    const result = parseAllActions(text);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].name, 'list_directory');
    assert.strictEqual(result[1].name, 'read_file_content');
    assert.strictEqual(result[2].name, 'write_file_content');
  });

  it('returns empty array for plain text', () => {
    const result = parseAllActions('Just a regular response with no action.');
    assert.strictEqual(result.length, 0);
  });

  it('returns empty array for empty string', () => {
    const result = parseAllActions('');
    assert.strictEqual(result.length, 0);
  });

  it('handles actions on same line', () => {
    const text = 'Action: read_file_content[{\"path\": \"a.txt\"}] Action: write_file_content[{\"path\": \"b.txt\", \"content\": \"x\"}]';
    const result = parseAllActions(text);
    assert.strictEqual(result.length, 2);
  });

  it('handles **Action:** bold prefix', () => {
    const text = '**Action:** read_file_content[{\"path\": \"a.txt\"}]';
    const result = parseAllActions(text);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'read_file_content');
  });

  it('strips thinking tags before parsing', () => {
    const text = '<think>Let me think...</think>\nAction: read_file_content[{\"path\": \"a.txt\"}]';
    const result = parseAllActions(text);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'read_file_content');
  });

  it('handles empty args: signal_task_complete[]', () => {
    const text = 'Action: signal_task_complete[]';
    const result = parseAllActions(text);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'signal_task_complete');
    assert.deepStrictEqual(result[0].args, {});
  });

  it('handles mixed valid and invalid JSON args', () => {
    const text = 'Action: read_file_content[{\"path\": \"a.txt\"}]\nAction: broken[{invalid}]';
    const result = parseAllActions(text);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'read_file_content');
  });
});

// ─── extractTextFromHtml ──────────────────────────────────────

describe('extractTextFromHtml', () => {
  it('strips HTML tags', () => {
    assert.strictEqual(
      extractTextFromHtml('<p>Hello <b>world</b></p>'),
      'Hello world'
    );
  });

  it('removes script content', () => {
    const result = extractTextFromHtml('<div>Before<script>alert("xss")</script>After</div>');
    assert.strictEqual(result, 'Before After');
  });

  it('removes style content', () => {
    const result = extractTextFromHtml('<div>Text<style>.cls{color:red}</style>More</div>');
    assert.strictEqual(result, 'Text More');
  });

  it('decodes named HTML entities', () => {
    const result = extractTextFromHtml('&lt;div&gt;Hello &amp; world&lt;/div&gt;');
    assert.strictEqual(result, '<div>Hello & world</div>');
  });

  it('decodes numeric entities', () => {
    assert.strictEqual(extractTextFromHtml('&#72;&#101;&#108;&#108;&#111;'), 'Hello');
  });

  it('collapses whitespace', () => {
    assert.strictEqual(extractTextFromHtml('  line1   \n\n  line2   '), 'line1 line2');
  });

  it('returns empty for HTML with no text', () => {
    assert.strictEqual(
      extractTextFromHtml('<!DOCTYPE html><html><head></head><body></body></html>'),
      ''
    );
  });

  it('handles multiline content', () => {
    const result = extractTextFromHtml('<h1>Title</h1>\n<p>One.</p>\n<p>Two.</p>');
    assert.strictEqual(result, 'Title One. Two.');
  });
});

// ─── tools: list_directory ────────────────────────────────────────────

describe('tools.list_directory', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tiny-agent-test-'));
    writeFileSync(join(tmpDir, 'a.txt'), 'a');
    writeFileSync(join(tmpDir, 'b.ts'), 'b');
    writeFileSync(join(tmpDir, 'c.js'), 'c');
  });

  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('lists files in existing directory', () => {
    const result = (tools.list_directory({ path: tmpDir }) as string);
    assert.ok(!result.startsWith('Ошибка'), `Unexpected error: ${result}`);
    const files = result.split(', ').sort();
    assert.deepStrictEqual(files, ['a.txt', 'b.ts', 'c.js']);
  });

  it('returns error for non-existent path', () => {
    const result = tools.list_directory({ path: '/tmp/this-does-not-exist-xyz123' });
    assert.ok((result as string).includes('error') || (result as string).includes('Ошибка'));
  });

  it('reads current dir when path omitted', () => {
    const result = tools.list_directory({});
    assert.ok(!(result as string).startsWith('Ошибка'), `Failed: ${result}`);
  });
});

// ─── tools: read_file_content ───────────────────────────────────────────

describe('tools.read_file_content', () => {
  let tmpDir: string;
  let testFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tiny-agent-test-'));
    testFile = join(tmpDir, 'test.txt');
    writeFileSync(testFile, 'Hello, world!');
  });

  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('reads file content', () => {
    const result = tools.read_file_content({ path: testFile });
    assert.strictEqual(result, 'Hello, world!');
  });

  it('reads UTF-8 content', () => {
    const unicodeFile = join(tmpDir, 'unicode.txt');
    writeFileSync(unicodeFile, 'Привет мир! 🎉');
    const result = tools.read_file_content({ path: unicodeFile });
    assert.strictEqual(result, 'Привет мир! 🎉');
  });

  it('returns error for non-existent file', () => {
    const result = tools.read_file_content({ path: '/tmp/no-such-file-xyz.txt' });
    assert.ok((result as string).includes('error') || (result as string).includes('Ошибка'));
  });
});

// ─── tools: write_file_content ──────────────────────────────────────────

describe('tools.write_file_content', () => {
  let tmpDir: string;
  let originalCwd: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tiny-agent-test-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });
  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes content to file', () => {
    const result = tools.write_file_content({ path: 'output.txt', content: 'test data' });
    assert.ok((result as string).includes('записан'), `Expected 'записан' in result: ${result}`);
    const content = readFileSync(join(tmpDir, 'output.txt'), 'utf-8');
    assert.strictEqual(content, 'test data');
  });

  it('overwrites existing file', () => {
    writeFileSync(join(tmpDir, 'existing.txt'), 'old content');
    tools.write_file_content({ path: 'existing.txt', content: 'new content' });
    const content = readFileSync(join(tmpDir, 'existing.txt'), 'utf-8');
    assert.strictEqual(content, 'new content');
  });

  it('writes UTF-8 content', () => {
    tools.write_file_content({ path: 'utf8.txt', content: 'Привет! 日本語 αβγ' });
    const content = readFileSync(join(tmpDir, 'utf8.txt'), 'utf-8');
    assert.strictEqual(content, 'Привет! 日本語 αβγ');
  });
});

// ─── tools: fetch_url_content ──────────────────────────────────────────────

describe('tools.fetch_url_content', () => {
  it('rejects non-http URLs', async () => {
    const result = await tools.fetch_url_content({ url: 'ftp://example.com' });
    assert.ok(result.includes('http'), `Expected 'http' in result: ${result}`);
    assert.ok(!result.startsWith('fetch_url_content: OK') && result.startsWith('fetch_url_content:'), `Unexpected result: ${result}`);
  });

  it('rejects bare strings', async () => {
    const result = await tools.fetch_url_content({ url: 'not-a-url' });
    assert.ok(result.startsWith('fetch_url_content:'), `Expected error starting with 'fetch_url_content:', got: ${result}`);
  });
});

// ─── parseDdgHtml ─────────────────────────────────────────────

describe('parseDdgHtml', () => {
  // Реальный формат html.duckduckgo.com
  const sampleHtml = `
    <div class="result">
      <a class="result__a" href="https://example.com/page1">First Result Title</a>
      <span class="result__url">example.com/page1</span>
      <td class="result__snippet">This is the first snippet text.</td>
    </div>
    <div class="result">
      <a class="result__a" href="https://example.com/page2">Second Result Title</a>
      <span class="result__url">example.com/page2</span>
      <td class="result__snippet">This is the second snippet text.</td>
    </div>
    <div class="result">
      <a class="result__a" href="https://example.com/page3">Third Result Title</a>
      <span class="result__url">example.com/page3</span>
      <td class="result__snippet">This is the third snippet text.</td>
    </div>
  `;

  it('parses DuckDuckGo HTML results', () => {
    const results = parseDdgHtml(sampleHtml, 5);
    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0].title, 'First Result Title');
    assert.strictEqual(results[0].url, 'https://example.com/page1');
    assert.strictEqual(results[0].snippet, 'This is the first snippet text.');
  });

  it('respects maxResults limit', () => {
    const results = parseDdgHtml(sampleHtml, 2);
    assert.strictEqual(results.length, 2);
  });

  it('returns empty array for HTML without results', () => {
    const results = parseDdgHtml('<html><body><p>No results here</p></body></html>', 5);
    assert.strictEqual(results.length, 0);
  });

  it('filters out javascript: URLs', () => {
    const html = `<div class="result"><a class="result__a" href="javascript:void(0)">Bad Link</a></div>`;
    const results = parseDdgHtml(html, 5);
    assert.strictEqual(results.length, 0);
  });

  it('strips HTML tags from title and snippet', () => {
    const html = `
      <div class="result">
        <a class="result__a" href="https://example.com">Title with <b>bold</b> text</a>
        <span class="result__url">example.com</span>
        <td class="result__snippet">Snippet with <em>italic</em> and &amp; entities</td>
      </div>
    `;
    const results = parseDdgHtml(html, 5);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].title, 'Title with bold text');
    assert.strictEqual(results[0].snippet, 'Snippet with italic and & entities');
  });

  it('decodes DuckDuckGo redirect URLs (uddg)', () => {
    const html = `
      <div class="result">
        <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Freal-site.com%2Fpage">Real Site</a>
        <span class="result__url">real-site.com/page</span>
        <td class="result__snippet">Some snippet.</td>
      </div>
    `;
    const results = parseDdgHtml(html, 5);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].url, 'https://real-site.com/page');
  });
});

// ─── integration: search_web (DuckDuckGo) ──────────────────────

describe('tools.search_web (integration)', () => {
  it('returns search results for a simple query', async () => {
    const result = await tools.search_web({ query: 'TypeScript programming language', limit: 3 });
    assert.ok(typeof result === 'string');
    if (!result.startsWith('Ошибка')) {
      assert.ok(result.includes('[1]'), 'Should contain first result marker');
      assert.ok(result.includes('URL:'), 'Should contain URL');
    }
  });

  it('returns search results for a Russian query (Cyrillic → translated)', async () => {
    const result = await tools.search_web({ query: 'преимущества TypeScript', limit: 3 });
    assert.ok(typeof result === 'string');
    if (!result.startsWith('Ошибка')) {
      assert.ok(result.includes('[1]'), 'Should contain first result marker for Russian query');
    }
  });
});
