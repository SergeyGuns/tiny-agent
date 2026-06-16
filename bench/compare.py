#!/usr/bin/env python3
"""Compare two benchmark reports and show delta."""
import json
import sys

if len(sys.argv) < 3:
    print("Usage: compare.py <baseline.json> <current.json>")
    sys.exit(1)

with open(sys.argv[1]) as f:
    base = json.load(f)
with open(sys.argv[2]) as f:
    curr = json.load(f)

print(f"{'='*60}")
print(f"BENCHMARK COMPARISON")
print(f"{'='*60}")
print(f"")
print(f"  Baseline:  {base['totalScore']}/{base['maxScore']} ({base['percentage']}%)  {base['passed']}/{base['totalTasks']} passed")
print(f"  Current:   {curr['totalScore']}/{curr['maxScore']} ({curr['percentage']}%)  {curr['passed']}/{curr['totalTasks']} passed")
delta_pct = curr['percentage'] - base['percentage']
delta_score = curr['totalScore'] - base['totalScore']
delta_passed = curr['passed'] - base['passed']
sign = '+' if delta_pct >= 0 else ''
print(f"  Delta:     {sign}{delta_score} score, {sign}{delta_pct}%, {sign}{delta_passed} passed")
print(f"")

# Per-task comparison
base_map = {r['task']['id']: r for r in base['results']}
curr_map = {r['task']['id']: r for r in curr['results']}

print(f"  PER-TASK CHANGES:")
print(f"  {'-'*56}")
for tid in sorted(set(list(base_map.keys()) + list(curr_map.keys()))):
    b = base_map.get(tid)
    c = curr_map.get(tid)
    if b and c:
        b_score = b['score']
        c_score = c['score']
        b_pass = b['passed']
        c_pass = c['passed']
        if b_score != c_score or b_pass != c_pass:
            delta = c_score - b_score
            sign = '+' if delta >= 0 else ''
            status = 'PASS' if c_pass else 'FAIL'
            b_status = 'PASS' if b_pass else 'FAIL'
            print(f"  {tid}: {b_status}({b_score}) -> {status}({c_score})  {sign}{delta}")
    elif c and not b:
        print(f"  {tid}: NEW -> {'PASS' if c['passed'] else 'FAIL'}({c['score']})")
    elif b and not c:
        print(f"  {tid}: {'PASS' if b['passed'] else 'FAIL'}({b['score']}) -> MISSING")

print(f"")
print(f"  BY CATEGORY:")
for cat in ['terminal', 'tool_use', 'research', 'planning']:
    bc = base['byCategory'].get(cat, {})
    cc = curr['byCategory'].get(cat, {})
    if bc and cc:
        b_pct = bc.get('percentage', 0)
        c_pct = cc.get('percentage', 0)
        delta = c_pct - b_pct
        sign = '+' if delta >= 0 else ''
        print(f"  {cat:12} {b_pct:3}% -> {c_pct:3}%  ({sign}{delta}%)")
