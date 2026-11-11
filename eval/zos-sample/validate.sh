#!/usr/bin/env bash
# Parses every member of repo/ with its grammar; fixed-format members get
# columns 1 and 73-80 blanked first, as code-graph-rag-pli does.
set -u
repo=${1:-repo}
grammars=${GRAMMARS:-$HOME/projects}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
status=0
for pair in SRC:pli INCLUDE:pli JCL:jcl MFS:hlasm DDL:db2; do
	library=${pair%%:*}
	grammar=$grammars/tree-sitter-${pair##*:}
	mkdir -p "$work/$library"
	for f in "$repo/$library"/*; do
		awk 'length($0) == 80 { $0 = " " substr($0, 2, 71) } { print }' "$f" >"$work/$library/${f##*/}"
	done
	ls -d "$work/$library"/* >"$work/$library.paths"
	failed=$(tree-sitter parse -q --grammar-path "$grammar" --paths "$work/$library.paths" 2>/dev/null | grep -c 'ERROR\|MISSING')
	echo "validate: $library $(wc -l <"$work/$library.paths") files, $failed with errors"
	[ "$failed" -eq 0 ] || status=1
done
exit $status
