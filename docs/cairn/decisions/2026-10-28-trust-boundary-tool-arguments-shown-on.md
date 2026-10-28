---
id: 2026-10-28-trust-boundary-tool-arguments-shown-on
status: active
paths:
  - plugins/cairn/hooks/mod/**
plan: richer-pane-cards
date: 2026-10-28
---

# Trust boundary: tool arguments shown on cards

**Decision:** Strip control and bidi characters from every shown argument; Bash shows only the program and subcommand (npm test, git commit, curl), never flags or values; paths and Grep patterns shown as-is, cut to fit

**Why:** agent tool arguments are outside text and Bash commands can carry secrets
