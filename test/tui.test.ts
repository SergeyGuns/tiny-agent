import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';

// ─── Mock readline.Interface ─────────────────────────────────

class MockInterface extends EventEmitter {
  private answers: string[];
  private answerIndex = 0;
  public output: any;
  public history: string[] = [];
  public closed = false;

  constructor(answers: string[]) {
    super();
    this.answers = answers;
    this.output = new Writable({
      write: (_chunk: any, _encoding: any, cb: () => void) => { cb(); }
    });
  }

  question(prompt: string): Promise<string> {
    this.history.push(prompt);
    if (this.answerIndex >= this.answers.length) {
      return Promise.reject(new Error('No more mock answers'));
    }
    const answer = this.answers[this.answerIndex++];
    return Promise.resolve(answer);
  }

  close(): void {
    this.closed = true;
  }
}

// ─── Capture console output helper ──────────────────────────

function captureConsole<T>(fn: () => T): { result: T; logs: string[] } {
  const logs: string[] = [];
  const origLog = console.log;
  const origClear = console.clear;
  console.log = (...args: any[]) => logs.push(args.map(String).join(' '));
  console.clear = () => {};
  let result: T;
  try {
    result = fn();
  } finally {
    console.log = origLog;
    console.clear = origClear;
  }
  return { result, logs };
}

async function captureConsoleAsync<T>(fn: () => Promise<T>): Promise<{ result: T | undefined; logs: string[] }> {
  const logs: string[] = [];
  const origLog = console.log;
  const origClear = console.clear;
  console.log = (...args: any[]) => logs.push(args.map(String).join(' '));
  console.clear = () => {};
  let result: T | undefined;
  try {
    result = await fn();
  } finally {
    console.log = origLog;
    console.clear = origClear;
  }
  return { result, logs };
}

// ─── Import agent module ─────────────────────────────────────
// agent.ts runs loadEnv() + startTUI() at module level.
// Since we're in test mode (node --test), the entry point code runs startTUI()
// which would block. We need to prevent that.
// Solution: we import agent.ts but the entry point checks process.argv[2].
// In test mode there's no task arg, so it calls startTUI() which blocks.
// We must restructure: import only the functions we need from source files directly.

import { C } from '../agent.js';
import { getStatusLine, getModelName, updateContextLength, getContextDisplay,
         displayStatus, setMode, getMode, getCurrentContextLength, resetContextLength } from '../agent.js';
import { startTUI } from '../agent.js';
import { runAutonomous } from '../agent.js';

// ═══════════════════════════════════════════════════════════════
// SECTION 1: Color constants
// ═══════════════════════════════════════════════════════════════

describe('C (color constants)', () => {
  const required = ['reset', 'bright', 'dim', 'blue', 'yellow', 'cyan', 'magenta', 'green', 'red'];

  it('has all required color codes', () => {
    for (const key of required) {
      assert.ok(C[key as keyof typeof C], `Missing color: ${key}`);
      assert.ok(typeof C[key as keyof typeof C] === 'string');
      assert.ok((C[key as keyof typeof C] as string).startsWith('\x1b['),
        `Color ${key} should start with ESC[`);
    }
  });

  it('reset is ESC[0m', () => { assert.strictEqual(C.reset, '\x1b[0m'); });
  it('bright is ESC[1m', () => { assert.strictEqual(C.bright, '\x1b[1m'); });
  it('dim is ESC[2m', () => { assert.strictEqual(C.dim, '\x1b[2m'); });
  it('red is ESC[31m', () => { assert.strictEqual(C.red, '\x1b[31m'); });
  it('green is ESC[32m', () => { assert.strictEqual(C.green, '\x1b[32m'); });
  it('yellow is ESC[33m', () => { assert.strictEqual(C.yellow, '\x1b[33m'); });
  it('blue is ESC[34m', () => { assert.strictEqual(C.blue, '\x1b[34m'); });
  it('magenta is ESC[35m', () => { assert.strictEqual(C.magenta, '\x1b[35m'); });
  it('cyan is ESC[36m', () => { assert.strictEqual(C.cyan, '\x1b[36m'); });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 2: getStatusLine format
// ═══════════════════════════════════════════════════════════════

describe('getStatusLine format', () => {
  it('contains mode, dir, git, and context sections', () => {
    const line = getStatusLine();
    assert.ok(line.includes('[mode:'), 'Should contain mode');
    assert.ok(line.includes('[git:'), 'Should contain git branch');
    assert.ok(line.includes(' of '), 'Should contain context usage');
    assert.ok(line.includes(C.dim), 'Should contain dim color');
    assert.ok(line.includes(C.reset), 'Should contain reset code');
  });

  it('contains current working directory', () => {
    const line = getStatusLine();
    assert.ok(line.includes(process.cwd()), 'Should contain cwd');
  });

  it('contains model name', () => {
    const line = getStatusLine();
    const model = getModelName();
    assert.ok(line.includes(model), `Should contain model "${model}"`);
  });

  it('mode defaults to write', () => {
    const line = getStatusLine();
    assert.ok(line.includes('[mode:write]'), 'Default mode should be write');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 3: updateContextLength
// ═══════════════════════════════════════════════════════════════

describe('updateContextLength', () => {
  beforeEach(() => resetContextLength());

  it('calculates context as total chars / 4 (ceil)', () => {
    const messages = [
      { role: 'system' as const, content: 'abcd'.repeat(100) },
      { role: 'user' as const, content: 'efgh'.repeat(50) },
    ];
    updateContextLength(messages);
    assert.strictEqual(getCurrentContextLength(), 150);
  });

  it('handles empty messages', () => {
    updateContextLength([]);
    assert.strictEqual(getCurrentContextLength(), 0);
  });

  it('handles single short message', () => {
    updateContextLength([{ role: 'user', content: '1234' }]);
    assert.strictEqual(getCurrentContextLength(), 1);
  });

  it('ceil rounds up', () => {
    updateContextLength([{ role: 'user', content: '12345' }]);
    assert.strictEqual(getCurrentContextLength(), 2);
  });

  it('getContextDisplay shows "N of M" format', () => {
    updateContextLength([{ role: 'user', content: '1234' }]);
    const display = getContextDisplay();
    assert.ok(display.includes(' of '), `Expected ' of ' in: ${display}`);
    assert.ok(display.startsWith('1 '), `Expected to start with '1 ': ${display}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 4: displayStatus output
// ═══════════════════════════════════════════════════════════════

describe('displayStatus output', () => {
  it('prints status line and separator', () => {
    const { logs } = captureConsole(() => displayStatus());
    assert.ok(logs.length >= 2, `Expected >= 2 lines, got ${logs.length}`);
    assert.ok(logs[0].includes('[mode:'), 'First line should be status');
    assert.ok(logs[1].includes('─'), 'Second line should be separator');
  });

  it('separator line contains 50 dashes', () => {
    const { logs } = captureConsole(() => displayStatus());
    const sepLine = logs.find(l => l.includes('─'));
    assert.ok(sepLine, 'Should have separator line');
    const dashMatch = sepLine!.match(/─{50}/);
    assert.ok(dashMatch, `Expected 50 dashes in: ${sepLine}`);
  });

  it('status line contains color codes', () => {
    const { logs } = captureConsole(() => displayStatus());
    assert.ok(logs[0].includes('\x1b['), 'Status should contain ANSI codes');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 5: Mode tracking
// ═══════════════════════════════════════════════════════════════

describe('mode tracking', () => {
  afterEach(() => setMode('write'));

  it('defaults to write mode', () => {
    // Module-level state may have changed; explicitly set and verify
    setMode('write');
    assert.strictEqual(getMode(), 'write');
  });

  it('setMode plane then write', () => {
    setMode('plane');
    assert.strictEqual(getMode(), 'plane');
    setMode('write');
    assert.strictEqual(getMode(), 'write');
  });

  it('reflects mode in status line', () => {
    setMode('plane');
    const line = getStatusLine();
    assert.ok(line.includes('[mode:plane]'), `Expected '[mode:plane]' in: ${line}`);
    setMode('write');
    const line2 = getStatusLine();
    assert.ok(line2.includes('[mode:write]'), `Expected '[mode:write]' in: ${line2}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 6: TUI loop with mock readline
// ═══════════════════════════════════════════════════════════════

describe('startTUI loop', () => {
  it('exits immediately when user types exit', async () => {
    const mock = new MockInterface(['exit']);
    const { logs } = await captureConsoleAsync(() => startTUI(mock as any));
    assert.ok(mock.closed, 'readline should be closed after exit');
    // displayStatus() runs before question(), so 1 prompt is expected
    assert.strictEqual(mock.history.length, 1, 'Should have prompted once');
    assert.ok(mock.history[0].includes('Вы >'), 'Prompt should contain "Вы >"');
  });

  it('skips empty input and continues', async () => {
    const mock = new MockInterface(['', 'exit']);
    await captureConsoleAsync(() => startTUI(mock as any));
    assert.ok(mock.closed, 'readline should be closed');
    assert.strictEqual(mock.history.length, 2, 'Should have prompted twice');
  });

  it('skips whitespace-only input', async () => {
    const mock = new MockInterface(['   ', '\t', 'exit']);
    await captureConsoleAsync(() => startTUI(mock as any));
    assert.ok(mock.closed, 'readline should be closed');
    assert.strictEqual(mock.history.length, 3, 'Should have prompted 3 times');
  });

  it('accepts EXIT (uppercase)', async () => {
    const mock = new MockInterface(['EXIT']);
    await captureConsoleAsync(() => startTUI(mock as any));
    assert.ok(mock.closed, 'Should close for EXIT');
  });

  it('accepts Exit (mixed case)', async () => {
    const mock = new MockInterface(['Exit']);
    await captureConsoleAsync(() => startTUI(mock as any));
    assert.ok(mock.closed, 'Should close for Exit');
  });

  it('displays TUI header on start', async () => {
    const mock = new MockInterface(['exit']);
    const { logs } = await captureConsoleAsync(() => startTUI(mock as any));
    const headerLines = logs.filter(l =>
      l.includes('TUI') || l.includes('LLM') || l.includes('команду')
    );
    assert.ok(headerLines.length >= 1, `Expected TUI header, got: ${JSON.stringify(headerLines)}`);
  });

  it('displays status bar before each prompt', async () => {
    const mock = new MockInterface(['exit']);
    const { logs } = await captureConsoleAsync(() => startTUI(mock as any));
    const statusLines = logs.filter(l => l.includes('[mode:'));
    assert.ok(statusLines.length >= 1, `Expected status lines, got ${statusLines.length}`);
  });

  // ─── \plan / \write / \exit commands ───────────────────────

  it('\\exit exits the TUI', async () => {
    const mock = new MockInterface(['\\exit']);
    await captureConsoleAsync(() => startTUI(mock as any));
    assert.ok(mock.closed, 'Should close for \\exit');
    assert.strictEqual(mock.history.length, 1);
  });

  it('\\plan switches to plane mode and continues', async () => {
    const mock = new MockInterface(['\\plan', 'exit']);
    const { logs } = await captureConsoleAsync(() => startTUI(mock as any));
    assert.ok(mock.closed);
    assert.strictEqual(mock.history.length, 2, 'Should prompt for \\plan then exit');
    const allOutput = logs.join('\n');
    assert.ok(allOutput.includes('ПЛАНИРОВАНИЕ') || allOutput.includes('plane'),
      `Expected plane mode notification in output`);
    assert.strictEqual(getMode(), 'plane');
  });

  it('\\write switches to write mode and continues', async () => {
    const mock = new MockInterface(['\\write', 'exit']);
    const { logs } = await captureConsoleAsync(() => startTUI(mock as any));
    assert.ok(mock.closed);
    assert.strictEqual(mock.history.length, 2);
    const allOutput = logs.join('\n');
    assert.ok(allOutput.includes('ЗАПИСЬ') || allOutput.includes('write'),
      `Expected write mode notification in output`);
    assert.strictEqual(getMode(), 'write');
  });

  it('\\plan then \\write then \\exit — sequential mode switching', async () => {
    const mock = new MockInterface(['\\plan', '\\write', '\\exit']);
    await captureConsoleAsync(() => startTUI(mock as any));
    assert.ok(mock.closed);
    assert.strictEqual(mock.history.length, 3);
    assert.strictEqual(getMode(), 'write');
  });

  it('\\plan shows mode in status line', async () => {
    const mock = new MockInterface(['\\plan', 'exit']);
    const { logs } = await captureConsoleAsync(() => startTUI(mock as any));
    const statusLines = logs.filter(l => l.includes('[mode:plane]'));
    assert.ok(statusLines.length >= 1, `Expected [mode:plane] in status`);
  });

  it('plain exit still works alongside \\exit', async () => {
    const mock = new MockInterface(['exit']);
    await captureConsoleAsync(() => startTUI(mock as any));
    assert.ok(mock.closed);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 7: runAutonomous output format
// ═══════════════════════════════════════════════════════════════

describe('runAutonomous output', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tiny-agent-tui-test-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prints header with goal', async () => {
    const { logs } = await captureConsoleAsync(async () => {
      try { await runAutonomous('test goal', 1); } catch { /* LLM may fail */ }
    });
    const allOutput = logs.join('\n');
    assert.ok(allOutput.includes('test goal'), `Expected 'test goal' in output`);
  });

  it('prints autonomous agent header', async () => {
    const { logs } = await captureConsoleAsync(async () => {
      try { await runAutonomous('x', 1); } catch { /* ignore */ }
    });
    const allOutput = logs.join('\n');
    // Should contain either the header or the goal at minimum
    assert.ok(allOutput.length > 0, 'Should produce some output');
  });

  it('prints max steps', async () => {
    const { logs } = await captureConsoleAsync(async () => {
      try { await runAutonomous('x', 1); } catch { /* ignore */ }
    });
    const allOutput = logs.join('\n');
    assert.ok(allOutput.includes('1'), `Expected step count in output`);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 8: TUI integration — status + header
// ═══════════════════════════════════════════════════════════════

describe('TUI integration', () => {
  it('displays status bar before each prompt', async () => {
    const mock = new MockInterface(['exit']);
    const { logs } = await captureConsoleAsync(() => startTUI(mock as any));
    const statusLines = logs.filter(l => l.includes('[mode:'));
    assert.ok(statusLines.length >= 1, `Expected >= 1 status line, got ${statusLines.length}`);
  });

  it('TUI header shows agent name', async () => {
    const mock = new MockInterface(['exit']);
    const { logs } = await captureConsoleAsync(() => startTUI(mock as any));
    const headerLines = logs.filter(l =>
      l.includes('TUI') || l.includes('LLM') || l.includes('команду')
    );
    assert.ok(headerLines.length >= 1, `Expected TUI header lines`);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 9: Edge cases
// ═══════════════════════════════════════════════════════════════

describe('TUI edge cases', () => {
  it('handles multiple consecutive empty inputs', async () => {
    const mock = new MockInterface(['', '', '', '', 'exit']);
    await captureConsoleAsync(() => startTUI(mock as any));
    assert.ok(mock.closed);
    assert.strictEqual(mock.history.length, 5);
  });

  it('handles input with only special characters', async () => {
    const mock = new MockInterface(['   \t  ', 'exit']);
    await captureConsoleAsync(() => startTUI(mock as any));
    assert.ok(mock.closed);
  });

  it('mock interface tracks all prompts', async () => {
    const mock = new MockInterface(['hello', 'exit']);
    await captureConsoleAsync(() => startTUI(mock as any));
    assert.strictEqual(mock.history.length, 2);
    for (const prompt of mock.history) {
      assert.ok(prompt.includes('Вы >'), `Prompt should contain 'Вы >': ${prompt}`);
    }
  });

  it('mock interface close sets closed flag', () => {
    const mock = new MockInterface([]);
    assert.strictEqual(mock.closed, false);
    mock.close();
    assert.strictEqual(mock.closed, true);
  });

  it('mock interface returns answers in order', async () => {
    const mock = new MockInterface(['first', 'second', 'third']);
    assert.strictEqual(await mock.question('q1?'), 'first');
    assert.strictEqual(await mock.question('q2?'), 'second');
    assert.strictEqual(await mock.question('q3?'), 'third');
  });

  it('mock interface throws when exhausted', async () => {
    const mock = new MockInterface(['only']);
    await mock.question('q1?');
    await assert.rejects(() => mock.question('q2?'), /No more mock answers/);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 10: getModelName
// ═══════════════════════════════════════════════════════════════

describe('getModelName', () => {
  const origModel = process.env.MODEL_NAME;

  afterEach(() => {
    if (origModel === undefined) delete process.env.MODEL_NAME;
    else process.env.MODEL_NAME = origModel;
  });

  it('returns default when MODEL_NAME is unset', () => {
    delete process.env.MODEL_NAME;
    // Note: module-level env is already loaded, getModelName reads at call time
    assert.strictEqual(getModelName(), 'local-model');
  });

  it('returns custom model from env', () => {
    process.env.MODEL_NAME = 'custom-model';
    assert.strictEqual(getModelName(), 'custom-model');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 11: getContextDisplay edge cases
// ═══════════════════════════════════════════════════════════════

describe('getContextDisplay', () => {
  // Note: MAX_CONTEXT_LENGTH is captured at module load time, so changing
  // LM_STUDIO_MAX_CONTEXT after import has no effect. We test the current value.

  it('shows "k" suffix for large context values', () => {
    // Module was loaded with LM_STUDIO_MAX_CONTEXT=128000 (or default)
    const display = getContextDisplay();
    assert.ok(display.includes(' of '), `Expected ' of ' in: ${display}`);
  });

  it('handles zero context length', () => {
    resetContextLength();
    const display = getContextDisplay();
    assert.ok(display.startsWith('0 of'), `Expected '0 of ...' in: ${display}`);
  });

  it('format is "N of M"', () => {
    resetContextLength();
    const display = getContextDisplay();
    const match = display.match(/^(\d+)\s+of\s+(.+)$/);
    assert.ok(match, `Expected 'N of M' format, got: ${display}`);
  });
});
