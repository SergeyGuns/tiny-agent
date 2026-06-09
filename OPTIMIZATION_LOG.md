# tiny-agent Optimization Log

## Summary

Three iterations of benchmark-driven optimization. Iter 1 (bug fixes) gave the best
result. Two subsequent prompt-only changes regressed due to LM stochasticity — strict
rollback policy applied each time, reverting to Iter 1 final state.

| Iter | Changes | Score | Passed | Verdict |
|------|---------|-------|--------|---------|
| 0 (v8 baseline) | — | 73/101 (67%) | 12/27 | baseline |
| 1 | webSearch→Wikipedia API, runCommand cmd|command, emptySteps counter | 101/122 (83%) | 16/27 | ✅ Best — kept |
| 2 | Added search rules to system prompt | 92/113 (81%) | 16/27 | ❌ Rolled back |
| 3 | Added search example to system prompt | 92/122 (75%) | 15/27 | ❌ Rolled back |

**Final state = Iter 1: 83% (101/122), 16/27 passed, up from 67% baseline.**

## Changes kept (from Iter 1)

### 1. webSearch: DuckDuckGo HTML → Wikipedia Search API
- DuckDuckGo HTML endpoint started returning CAPTCHA instead of results
- Replaced with `en.wikipedia.org/w/api.php?action=query&list=search`
- Added fallback: auto-translate Russian keywords to English when no results
- Zero external dependencies (uses native fetch)

### 2. runCommand: accept both `cmd` and `command` args
- Model was calling `runCommand[{"cmd": "..."}]` but code read `args.command`
- Single-line fix: `const cmd = (args.command || args.cmd) as string`

### 3. ReActLoop: emptySteps counter
- Added counter for consecutive steps without Action
- After 3 empty steps, nudges model to act or writeFile the result
- Prevents infinite thinking loops

### 4. Removed debug logging
- Removed `/tmp/bench-debug.log` writes that were slowing execution

## Improvements by category

| Category | Baseline (v8) | Final (Iter 1) | Delta |
|----------|--------------|----------------|-------|
| Terminal | 88% | 100% | +12 |
| Planning | 18% | 83% | +65 |
| Research | 70% | 70% | = |
| Tool Use | 79% | 78% | -1 |

## Known remaining issues
- TERM-007: Partial variable replacement (model skips `temp2` etc.)
- TERM-008: Sometimes reads files but won't write merged result
- TOOL-006: JSON escaping in writeFile content (workaround: runCommand + jq)
- RES-007: Complex research with 3+ sources times out
- webSearch: Wikipedia API doesn't always have specific data (LTS versions, dates)
- LM stochasticity: same code + prompt gives different results across runs (~8% variance)
