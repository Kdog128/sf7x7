---
title: Numeric Safety
input: full_diff
conclusion: failure
tools:
  - browse_code
  - git_tools
maxBudgetPerRun: 1
---
This is a browser 3D city sim (Three.js). Look for math in changed code that can produce NaN, Infinity, or negative time:
- Normalizing a vector that could be zero-length
- Dividing by a length, count, or distance that could be 0
- Frame or sim deltas (dt) that aren't clamped to a sane min/max
- Values from these paths that feed lighting, post-processing/bloom, or the sim clock
This repo has shipped 2 of these bugs: a zero normal caused a NaN pixel that bloom spread over the whole frame, and a negative first-frame step froze the clock. Report each risk with file, line, and a 1-line fix. If none are found, report success.
