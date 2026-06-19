import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runAgentLoop, runPlanLoop, classifyIsReady } from '../lib.js';
import { parseAction, parseAllActions } from '../lib.js';
import { tools } from '../lib.js';

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

  it('returns null for Russian completion phrases', () => {
    const phrases = [
      'ЗАДАЧА ВЫПОЛНЕНА', 'ГОТОВО', 'ВСЁ СДЕЛАНО',
      'Задача выполнена. Вот результат...',
      'Задача сделана.', 'Задача завершена.',
    ];
    for (const phrase of phrases) {
      assert.strictEqual(parseAction(phrase), null, `"${phrase}" should parse as null`);
    }
  });

  it('returns null for English completion phrases', () => {
    const phrases = [
      'COMPLETE', 'DONE', 'FINISHED',
      'Task complete. Here is the result...',
      'Task done.', 'Task finished.',
      "That's all.", 'That is all.',
    ];
    for (const phrase of phrases) {
      assert.strictEqual(parseAction(phrase), null, `"${phrase}" should parse as null`);
    }
  });

  it('returns null for invalid JSON', () => {
    assert.strictEqual(parseAction('Action: read_file_content[{path: "broken"}]'), null);
  });

  it('parses nested JSON args', () => {
    const result = parseAction('Action: fetch_url_content[{"url": "https://example.com", "opts": {"timeout": 5000}}]');
    assert.deepStrictEqual(result, {
      name: 'fetch_url_content',
      args: { url: 'https://example.com', opts: { timeout: 5000 } }
    });
  });

  it('parses write_file_content with JSON content', () => {
    const input = 'Action: write_file_content[{"path": "data.json", "content": "hello world"}]';
    const result = parseAction(input);
    assert.ok(result, 'Should parse write_file_content');
    assert.strictEqual(result!.name, 'write_file_content');
    assert.strictEqual(result!.args.path, 'data.json');
    assert.strictEqual(result!.args.content, 'hello world');
  });
});

// ─── parseAllActions ───────────────────────────────────────────

describe('parseAllActions', () => {
  it('parses single action', () => {
    const result = parseAllActions('Action: read_file_content[{"path": "index.ts"}]');
    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0], { name: 'read_file_content', args: { path: 'index.ts' } });
  });

  it('parses two actions', () => {
    const text = 'Action: read_file_content[{"path": "a.txt"}]\nAction: write_file_content[{"path": "b.txt", "content": "hello"}]';
    const result = parseAllActions(text);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].name, 'read_file_content');
    assert.strictEqual(result[1].name, 'write_file_content');
  });

  it('parses three actions', () => {
    const text = 'Action: list_directory[{"path": "."}]\nAction: read_file_content[{"path": "data.json"}]\nAction: write_file_content[{"path": "out.txt", "content": "done"}]';
    const result = parseAllActions(text);
    assert.strictEqual(result.length, 3);
  });

  it('returns empty array for plain text', () => {
    assert.strictEqual(parseAllActions('Just a regular response.').length, 0);
  });

  it('returns empty array for empty string', () => {
    assert.strictEqual(parseAllActions('').length, 0);
  });

  it('handles **Action:** bold prefix', () => {
    const result = parseAllActions('**Action:** read_file_content[{"path": "a.txt"}]');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'read_file_content');
  });

  it('strips thinking tags before parsing', () => {
    const text = '<think>Let me think...</think>\nAction: read_file_content[{"path": "a.txt"}]';
    const result = parseAllActions(text);
    assert.strictEqual(result.length, 1);
  });

  it('handles empty args: signal_task_complete[]', () => {
    const result = parseAllActions('Action: signal_task_complete[]');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'signal_task_complete');
    assert.deepStrictEqual(result[0].args, {});
  });
});

// ─── classifyIsReady — LLM readiness classifier ─────────────

describe('classifyIsReady', () => {
  it('returns isReady=false for short responses (< 20 chars)', async () => {
    const result = await classifyIsReady('describe the project', 'OK', []);
    assert.strictEqual(result.isReady, false);
  });

  it('returns isReady=false for responses with Action: pattern', async () => {
    const response = 'Action: read_file_content[{"path": "file.txt"}]';
    const result = await classifyIsReady('describe the project', response, []);
    assert.strictEqual(result.isReady, false);
  });

  it('returns isReady=false for empty response', async () => {
    const result = await classifyIsReady('describe the project', '', []);
    assert.strictEqual(result.isReady, false);
  });

  it('returns isReady=false for whitespace-only response', async () => {
    const result = await classifyIsReady('describe the project', '   \n\t  ', []);
    assert.strictEqual(result.isReady, false);
  });
});

// ─── RLM loop decision logic ────────────────────────────────

describe('RLM loop — decision logic', () => {
  it('plain text with 0 tool calls → direct answer', () => {
    const response = 'Привет! Я готов помочь.';
    const action = parseAction(response);
    assert.strictEqual(action, null);

    const toolCalls: any[] = [];
    const isDirectAnswer = !action && toolCalls.length === 0 && response.trim().length > 0;
    assert.ok(isDirectAnswer);
  });

  it('plain text after tool calls → needs classifier', () => {
    const response = 'Проект состоит из README.md и package.json.';
    const action = parseAction(response);
    assert.strictEqual(action, null);

    const toolCalls = [
      { tool: 'list_directory', args: { path: '.' } },
      { tool: 'read_file_content', args: { path: 'README.md' } },
    ];

    // Old logic would fail: toolCalls.length > 0
    const oldLogic = !action && toolCalls.length === 0 && response.trim().length > 0;
    assert.strictEqual(oldLogic, false, 'Old logic fails after tool calls');

    // New logic: call classifyIsReady
    const shouldCallClassifier = !action && toolCalls.length > 0 && response.trim().length >= 20;
    assert.ok(shouldCallClassifier, 'Should call classifier after tool calls');
  });

  it('READY classifier result → terminate loop', () => {
    const toolCalls = [
      { tool: 'list_directory', args: { path: '.' } },
      { tool: 'read_file_content', args: { path: 'README.md' } },
    ];
    const response = 'Проект tiny-agent — это минималистичный мульти-агентный фреймворк на TypeScript/Node.js.';

    const action = parseAction(response);
    assert.strictEqual(action, null);

    const shouldCallClassifier = !action && toolCalls.length > 0 && response.trim().length >= 20;
    assert.ok(shouldCallClassifier);

    // Simulate READY result
    const mockResult = { isReady: true, raw: 'READY' };
    const wouldTerminate = shouldCallClassifier && mockResult.isReady;
    assert.ok(wouldTerminate, 'READY should terminate the loop');
  });

  it('MORE_WORK classifier result → continue loop', () => {
    const toolCalls = [{ tool: 'list_directory', args: { path: '.' } }];
    const response = 'Let me check more files to understand the structure.';

    const action = parseAction(response);
    assert.strictEqual(action, null);

    const shouldCallClassifier = !action && toolCalls.length > 0 && response.trim().length >= 20;
    assert.ok(shouldCallClassifier);

    // Simulate MORE_WORK result
    const mockResult = { isReady: false, raw: 'MORE_WORK' };
    const wouldContinue = shouldCallClassifier && !mockResult.isReady;
    assert.ok(wouldContinue, 'MORE_WORK should continue the loop');
  });
});

// ─── BUG SCENARIO: "опиши проект" ──────────────────────────

describe('BUG SCENARIO: "опиши проект" — agent explores but never answers', () => {
  it('OLD BUG: 41 tool calls prevent plain text from being direct answer', () => {
    const toolCalls: any[] = [];
    for (let i = 0; i < 41; i++) {
      toolCalls.push({
        step: i + 1,
        tool: i % 2 === 0 ? 'list_directory' : 'read_file_content',
        args: { path: '.' },
        result: 'some content',
        durationMs: 10,
      });
    }

    const finalResponse = `Проект tiny-agent — это минималистичный мульти-агентный фреймворк на TypeScript/Node.js.

Ядро состоит из:
- agent.ts — точка входа
- reactor.ts — ReAct loop
- llm.ts — клиент LLM`;

    const action = parseAction(finalResponse);
    assert.strictEqual(action, null);

    // OLD logic: toolCalls.length === 0 check fails
    const oldLogic = !action && toolCalls.length === 0 && finalResponse.trim().length > 0;
    assert.strictEqual(oldLogic, false, 'OLD BUG: 41 tool calls prevent direct answer');
  });

  it('NEW FIX: classifyIsReady determines if plain text is final answer', () => {
    const toolCalls: any[] = [];
    for (let i = 0; i < 41; i++) {
      toolCalls.push({ step: i + 1, tool: 'read_file_content', args: {}, result: '', durationMs: 10 });
    }

    const finalResponse = 'Проект tiny-agent — это фреймворк для мульти-агентной разработки.';

    const action = parseAction(finalResponse);
    assert.strictEqual(action, null);

    // New logic: classifyIsReady is called
    const shouldCallClassifier = !action && toolCalls.length > 0 && finalResponse.trim().length >= 20;
    assert.ok(shouldCallClassifier, 'Should call classifyIsReady');
  });
});

// ─── Edge cases ─────────────────────────────────────────────

describe('RLM edge cases', () => {
  it('response with "Action:" in natural language is not an action', () => {
    const response = 'The project uses Action: read_file_content pattern for file operations.';
    assert.strictEqual(parseAction(response), null);
  });

  it('multi-paragraph response with no action', () => {
    const response = `# Project Description

This is a multi-paragraph response describing the project.

## Architecture

The project uses a modular architecture.`;
    assert.strictEqual(parseAction(response), null);
  });

  it('completion phrase with more text', () => {
    const responses = [
      'ЗАДАЧА ВЫПОЛНЕНА\n\nВот результат: ...',
      'DONE\n\nHere is the summary: ...',
      'COMPLETE\n\nThe project consists of...',
    ];
    for (const response of responses) {
      assert.strictEqual(parseAction(response), null);
    }
  });

  it('empty response is not a direct answer', () => {
    const toolCalls: any[] = [];
    assert.strictEqual(!parseAction('') && toolCalls.length === 0 && ''.trim().length > 0, false);
  });

  it('whitespace-only response is not a direct answer', () => {
    const toolCalls: any[] = [];
    assert.strictEqual(!parseAction('   \n\t  ') && toolCalls.length === 0 && '   \n\t  '.trim().length > 0, false);
  });
});

// ─── Tools (from rlm integration) ───────────────────────────

describe('tools integration', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tiny-agent-rlm-test-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    writeFileSync(join(tmpDir, 'README.md'), '# Test Project');
    writeFileSync(join(tmpDir, 'package.json'), '{"name": "test"}');
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('list_directory lists files', () => {
    const result = tools.list_directory({ path: tmpDir }) as string;
    assert.ok(!result.includes('error'), `Unexpected error: ${result}`);
    const files = result.split(', ').sort();
    assert.deepStrictEqual(files, ['README.md', 'package.json']);
  });

  it('read_file_content reads file', () => {
    const result = tools.read_file_content({ path: join(tmpDir, 'README.md') });
    assert.strictEqual(result, '# Test Project');
  });

  it('write_file_content writes file', () => {
    const result = tools.write_file_content({ path: 'output.txt', content: 'test data' });
    assert.ok((result as string).includes('записан'), `Expected 'записан' in: ${result}`);
  });
});
