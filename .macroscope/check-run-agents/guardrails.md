---
title: Guardrails
input: full_diff
conclusion: neutral
reasoning: medium
effort: medium
tools:
  - browse_code
  - git_tools
  - github_api_read_only
  - modify_pr
maxBudgetPerRun: 1
---
Check this pull request against the repo guardrails below. Only consider these rules and ignore any other issues.

Guardrails:
- No new npm dependencies in `package.json`. The game is static and dependency-free; third-party code goes in `vendor/` only with a clear reason.
- No change to the save format in `js/save.js` without bumping the save version and handling older saves.
- No new system added to an existing file that would push it past 700 lines. New systems get their own module in `js/`.
- No per-frame allocations (`new THREE.Vector3`, new arrays or objects) inside the render or simulation loop. Reuse scratch objects.
- Feature PRs must not modify files in `.macroscope/`.

For each violation, post an inline comment with the rule it breaks and a short fix. If none are found, report success.
