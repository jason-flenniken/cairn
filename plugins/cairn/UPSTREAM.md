# Upstream sources

cairn adapts material from these MIT-licensed projects. Each was snapshotted 2026-10-20 into `sources/upstream/<name>/` (gitignored). `scripts/upstream-diff.sh` re-clones a source and shows what changed since this snapshot. Licenses and credits are in `NOTICE`.

| Name | Repository | Snapshot commit |
|---|---|---|
| ce | https://github.com/everyinc/compound-engineering-plugin | `2e41b4490a37f53db0beb6d4904618da9af2f559` |
| superpowers | https://github.com/obra/superpowers | `bb92a77741419a4ab5f06e711a283343f1ada0c3` |
| mattpocock | https://github.com/mattpocock/skills | `5beb35b040e3de97e54fa9e386d7e42d15c295c2` |
| vercel-ceo | resource pack in `sources/vercel-ceo/` | (local copy) |

For the full map of which cairn file borrows from which source file, see the "Borrow map" appendix of the design plan in `docs/design.md`.
