---
title: Numeric Safety
input: full_diff
conclusion: failure
tools:
  - browse_code
  - git_tools
  - modify_pr
maxBudgetPerRun: 1
---
This is a browser 3D city sim (Three.js). Look for math in changed code that can produce NaN, Infinity, or negative time:
- Dividing by a length, count, population, distance, or width that could be 0
- Normalizing a vector that could be zero-length
- Frame or sim deltas (dt) that aren't clamped to a sane min/max

Report failure for any such risk whose result can reach user-visible output (UI text, panels, overlays), rendering (lighting, post-processing/bloom), or simulation state (the sim clock, growth, economy, saves).

This repo has shipped 2 of these bugs: a zero normal caused a NaN pixel that bloom spread over the whole frame, and a negative first-frame step froze the clock.

For each risk, post an inline comment on the line with the file, why it can hit zero, and a 1-line fix. If none are found, report success.
