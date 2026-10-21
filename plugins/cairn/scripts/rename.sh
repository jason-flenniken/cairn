#!/bin/sh
# Rename the plugin. The brand lives only in plugin.json, marketplace.json, the bin/ wrapper's
# file name, and the `/<name>:` prefix in user-facing text. Data paths (docs/sdlc, .sdlc) are neutral.
set -eu
new="${1:?usage: scripts/rename.sh <new-name>}"
here="$(cd "$(dirname "$0")/.." && pwd)"
old="$(sed -n 's/.*"name": *"\([^"]*\)".*/\1/p' "$here/.claude-plugin/plugin.json" | head -1)"
[ "$old" = "$new" ] && { echo "already named $new"; exit 0; }
repo="$(cd "$here/../.." && pwd)"
sed -i.bak "s/\"name\": *\"$old\"/\"name\": \"$new\"/" "$here/.claude-plugin/plugin.json"
sed -i.bak "s/\"name\": *\"$old\"/\"name\": \"$new\"/; s#plugins/$old#plugins/$new#" "$repo/.claude-plugin/marketplace.json"
git -C "$repo" mv "plugins/$old/bin/$old" "plugins/$old/bin/$new" 2>/dev/null || mv "$here/bin/$old" "$here/bin/$new"
sed -i.bak "s#/bin/$old\\\\\"#/bin/$new\\\\\"#g" "$here/hooks/hooks.json"
# User-facing text: slash-command prefix and CLI name.
grep -rlE "/$old:|\\b$old (next|status|new|decide|approve|advance|plan|ready|task|evidence|drift|pause|resume|close|render|product|hook)\\b" \
  "$here/skills" "$here/procedures" "$here/agents" "$here/references" "$here/templates" 2>/dev/null | while read -r f; do
  sed -i.bak -E "s#/$old:#/$new:#g; s#\\b$old (next|status|new|decide|approve|advance|plan|ready|task|evidence|drift|pause|resume|close|render|product|hook)\\b#$new \\1#g" "$f"
done
find "$here" "$repo/.claude-plugin" -name '*.bak' -delete
git -C "$repo" mv "plugins/$old" "plugins/$new" 2>/dev/null || mv "$repo/plugins/$old" "$repo/plugins/$new"
echo "Renamed $old → $new. Rebuild (npm run build), then reinstall the plugin."
