#!/usr/bin/env bash
# Fails when plugin/ changed since BASE without a version bump and a matching CHANGELOG entry.
# Usage: scripts/check-release.sh [BASE]   (default: origin/main)
set -euo pipefail
BASE="${1:-origin/main}"
MANIFEST=plugin/.claude-plugin/plugin.json

if ! git cat-file -e "$BASE^{commit}" 2>/dev/null; then
  echo "check-release: base $BASE not found; nothing to compare."
  exit 0
fi
if [ -z "$(git diff --name-only "$BASE" HEAD -- plugin/)" ]; then
  echo "check-release: plugin/ unchanged since $BASE."
  exit 0
fi

new=$(jq -r .version "$MANIFEST")
old=$(git show "$BASE:$MANIFEST" 2>/dev/null | jq -r .version || echo "0.0.0")
fail=0

if [ "$new" = "$old" ] || [ "$(printf '%s\n%s\n' "$old" "$new" | sort -V | tail -1)" != "$new" ]; then
  echo "::error file=$MANIFEST::plugin/ changed but the version is still $old. Bump it, or players won't get the change."
  fail=1
fi
if ! grep -qE "^## \[$(printf '%s' "$new" | sed 's/\./\\./g')\] - [0-9]{4}-[0-9]{2}-[0-9]{2}$" CHANGELOG.md; then
  echo "::error file=CHANGELOG.md::No entry for $new. Add '## [$new] - YYYY-MM-DD' with what changed."
  fail=1
fi
[ "$fail" -eq 0 ] && echo "check-release: $old → $new with a CHANGELOG entry."
exit "$fail"
