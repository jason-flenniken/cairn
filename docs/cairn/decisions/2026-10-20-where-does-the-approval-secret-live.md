---
id: 2026-10-20-where-does-the-approval-secret-live
status: active
areas:
  - approvals
plan: cairn-v0-2
date: 2026-10-20
---

# Where does the approval secret live?

**Decision:** Only its SHA-256 hash is on disk; the mod holds the secret in memory and rotates it, the CLI spends it once, there are no grant files, and child commands run with it stripped from their environment.

**Why:** A plaintext secret or a grant file could be read into model context or forged.
