---
title: Security Review
input: full_diff
conclusion: failure
reasoning: medium
effort: medium
include:
  - "js/**"
  - "api/**"
  - "supabase/**"
  - "index.html"
tools:
  - browse_code
  - git_tools
  - github_api_read_only
  - modify_pr
maxBudgetPerRun: 1
---
Review this pull request for security risks introduced or activated by its changes. Only consider the standards below and ignore any other issues.

This is a browser city builder (static files) with a small serverless API in `api/` and a Supabase table for cloud saves in `supabase/`. User-entered text includes neighborhood names, city names and artist/performer names. `esc()` in `js/ui.js` is the HTML-escaping helper.

Standards:
- User-entered text must go through `esc()` before being inserted into HTML (innerHTML, insertAdjacentHTML, or template strings rendered as HTML).
- No `eval()`, `new Function()`, or `setTimeout`/`setInterval` with string arguments.
- Save data and imported JSON must be validated before use. Flag parsed save data used without checking its shape or bounds.
- No API keys, tokens, service-role keys or other secrets in client code or committed config.
- `api/` handlers must validate inputs and must not expose secrets or other users' data.
- Supabase SQL must keep row-level security on and grant no broader access than the app needs.
- No new third-party `<script>` tags or new external fetch domains.

For each violation, post an inline comment on the line with the risk, how it could be exploited, and a 1-line fix. Report failure only for real, reachable risks. If none are found, report success.
