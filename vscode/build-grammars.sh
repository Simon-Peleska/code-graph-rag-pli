#!/usr/bin/env bash
# Builds grammars/*.wasm, the parsers the indexer and the highlighting use,
# from checkouts of the grammar repositories (by default the ones next to this
# repository), copies each grammar's highlights query next to it and records
# which commit each came from. Needs the tree-sitter CLI, which
# fetches a WASI SDK into ~/.cache/tree-sitter the first time.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
from=${1:-$here/../..}
mkdir -p "$here/grammars"
: > "$here/grammars/VERSIONS"
for language in pli jcl hlasm db2; do
  repo="$from/tree-sitter-$language"
  (cd "$repo" && tree-sitter build --wasm -o "$here/grammars/tree-sitter-$language.wasm")
  cp "$repo/queries/highlights.scm" "$here/grammars/tree-sitter-$language-highlights.scm"
  echo "tree-sitter-$language $(git -C "$repo" rev-parse HEAD)$(git -C "$repo" diff --quiet || echo ' (uncommitted changes)')" >> "$here/grammars/VERSIONS"
done
cat "$here/grammars/VERSIONS"
