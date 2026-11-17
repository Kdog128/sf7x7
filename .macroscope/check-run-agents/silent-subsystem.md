---
title: Silent Subsystem
input: full_diff
conclusion: neutral
tools:
  - browse_code
  - git_tools
maxBudgetPerRun: 1
---
Flag any new system, manager, engine, or module in the diff (audio, traffic, events, UI panels, etc.) that is defined but never created, initialized, or wired into the main loop or UI. This repo once shipped an audio engine that was never instantiated, so the game was silent. Trace each new system to where it starts. If all are wired up, report success.
