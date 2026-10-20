#!/bin/sh
# Show what changed upstream since the snapshot recorded in UPSTREAM.md.
# usage: scripts/upstream-diff.sh ce|superpowers|mattpocock [path-inside-repo]
set -eu
name="${1:?usage: scripts/upstream-diff.sh <name> [path]}"
here="$(cd "$(dirname "$0")/.." && pwd)"
row="$(grep "^| $name |" "$here/UPSTREAM.md")"
url="$(echo "$row" | awk -F'|' '{print $3}' | tr -d ' ')"
sha="$(echo "$row" | awk -F'|' '{print $4}' | tr -d ' `')"
tmp="$(mktemp -d)"
git clone -q --filter=blob:none "$url" "$tmp/repo"
git -C "$tmp/repo" log --oneline "$sha..HEAD" -- ${2:-.} | head -50
git -C "$tmp/repo" diff --stat "$sha..HEAD" -- ${2:-.}
echo "(clone at $tmp/repo for a closer look)"
