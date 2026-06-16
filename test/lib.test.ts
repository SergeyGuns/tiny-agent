import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseAction, extractTextFromHtml, tools, parseDdgHtml } from '../lib.js';

// ─── parseAction ─────────────────────────────────────────────

describe('parseAction', () => {
  it('parses simple action with one arg', () => {
    const result = parseAction('Action: readFile[{"path": "index.ts"}]');
    assert.deepStrictEqual(result, { name: 'readFile', args: { path: 'index.ts' } });
  });

  it('parses action with multiple args', () => {
    const result = parseAction('Action: writeFile[{"path": "out.txt", "content": "hello"}]');
    assert.deepStrictEqual(result, {
      name: 'writeFile',
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
    const result = parseAction('Action: readFile[{path: "broken"}]');
    assert.strictEqual(result, null);
  });

  it('parses nested JSON args', () => {
    const result = parseAction('Action: fetch[{"url": "https://example.com", "opts": {"timeout": 5000}}]');
    assert.deepStrictEqual(result, {
      name: 'fetch',
      args: { url: 'https://example.com', opts: { timeout: 5000 } }
    });
  });

  // RES-002: writeFile with unescaped JSON content (LLM copies JSON from fetch response)
  it('parses writeFile with unescaped JSON content (RES-002)', () => {
    const result = parseAction('Action: writeFile[{"path": "data.json", "content": "{"slideshow": {"title": "Sample Slide Show", "date": "2024-01-01"}}"}]');
    assert.ok(result, 'Should parse writeFile with unescaped JSON content');
    assert.strictEqual(result.name, 'writeFile');
    assert.strictEqual(result.args.path, 'data.json');
    assert.ok((result.args.content as string).includes('slideshow'), 'Content should contain slideshow field');
    // Verify the extracted content is valid JSON
    const parsed = JSON.parse(result.args.content as string);
    assert.ok(parsed.slideshow, 'Parsed content should have slideshow field');
  });

  it('parses writeFile with simple text content', () => {
    const result = parseAction('Action: writeFile[{"path": "answer.txt", "content": "Hello world"}]');
    assert.deepStrictEqual(result, {
      name: 'writeFile',
      args: { path: 'answer.txt', content: 'Hello world' }
    });
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

// ─── tools: readDir ────────────────────────────────────────────

describe('tools.readDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tiny-agent-test-'));
    writeFileSync(join(tmpDir, 'a.txt'), 'a');
    writeFileSync(join(tmpDir, 'b.ts'), 'b');
    writeFileSync(join(tmpDir, 'c.js'), 'c');
  });

  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('lists files in existing directory', () => {
    const result = (tools.readDir({ path: tmpDir }) as string);
    assert.ok(!result.startsWith('Ошибка'), `Unexpected error: ${result}`);
    const files = result.split(', ').sort();
    assert.deepStrictEqual(files, ['a.txt', 'b.ts', 'c.js']);
  });

  it('returns error for non-existent path', () => {
    const result = tools.readDir({ path: '/tmp/this-does-not-exist-xyz123' });
    assert.ok((result as string).includes('error') || (result as string).includes('Ошибка'));
  });

  it('reads current dir when path omitted', () => {
    const result = tools.readDir({});
    assert.ok(!(result as string).startsWith('Ошибка'), `Failed: ${result}`);
  });
});

// ─── tools: readFile ───────────────────────────────────────────

describe('tools.readFile', () => {
  let tmpDir: string;
  let testFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tiny-agent-test-'));
    testFile = join(tmpDir, 'test.txt');
    writeFileSync(testFile, 'Hello, world!');
  });

  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('reads file content', () => {
    const result = tools.readFile({ path: testFile });
    assert.strictEqual(result, 'Hello, world!');
  });

  it('reads UTF-8 content', () => {
    const unicodeFile = join(tmpDir, 'unicode.txt');
    writeFileSync(unicodeFile, 'Привет мир! 🎉');
    const result = tools.readFile({ path: unicodeFile });
    assert.strictEqual(result, 'Привет мир! 🎉');
  });

  it('returns error for non-existent file', () => {
    const result = tools.readFile({ path: '/tmp/no-such-file-xyz.txt' });
    assert.ok((result as string).includes('error') || (result as string).includes('Ошибка'));
  });
});

// ─── tools: writeFile ──────────────────────────────────────────

describe('tools.writeFile', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'tiny-agent-test-')); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('writes content to file', () => {
    const filePath = join(tmpDir, 'output.txt');
    const result = tools.writeFile({ path: filePath, content: 'test data' });
    assert.ok((result as string).includes('записан'));
    const content = readFileSync(filePath, 'utf-8');
    assert.strictEqual(content, 'test data');
  });

  it('overwrites existing file', () => {
    const filePath = join(tmpDir, 'existing.txt');
    writeFileSync(filePath, 'old content');
    tools.writeFile({ path: filePath, content: 'new content' });
    const content = readFileSync(filePath, 'utf-8');
    assert.strictEqual(content, 'new content');
  });

  it('writes UTF-8 content', () => {
    const filePath = join(tmpDir, 'utf8.txt');
    tools.writeFile({ path: filePath, content: 'Привет! 日本語 αβγ' });
    const content = readFileSync(filePath, 'utf-8');
    assert.strictEqual(content, 'Привет! 日本語 αβγ');
  });
});

// ─── tools: fetch ──────────────────────────────────────────────

describe('tools.fetch', () => {
  it('rejects non-http URLs', async () => {
    const result = await tools.fetch({ url: 'ftp://example.com' });
    assert.ok(result.includes('http'));
    assert.ok(!result.startsWith('fetch: OK') && result.startsWith('fetch:'));
  });

  it('rejects bare strings', async () => {
    const result = await tools.fetch({ url: 'not-a-url' });
    assert.ok(result.startsWith('fetch:'));
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

// ─── integration: webSearch (DuckDuckGo) ──────────────────────

describe('tools.webSearch (integration)', () => {
  it('returns search results for a simple query', async () => {
    const result = await tools.webSearch({ query: 'TypeScript programming language', limit: 3 });
    assert.ok(typeof result === 'string');
    if (!result.startsWith('Ошибка')) {
      assert.ok(result.includes('[1]'), 'Should contain first result marker');
      assert.ok(result.includes('URL:'), 'Should contain URL');
    }
  });

  it('returns search results for a Russian query (Cyrillic → translated)', async () => {
    const result = await tools.webSearch({ query: 'преимущества TypeScript', limit: 3 });
    assert.ok(typeof result === 'string');
    if (!result.startsWith('Ошибка')) {
      assert.ok(result.includes('[1]'), 'Should contain first result marker for Russian query');
    }
  });
});
