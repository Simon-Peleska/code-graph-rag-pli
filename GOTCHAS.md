# Gotchas

- **Names come from labels, not a `name` field.** cgr reads names from a
  `name` field in many places. PL/I needs `pli_label()` at each of them. So
  far that means the handler, the FQN spec, the call pass's caller name and
  `_resolve_method_name`. A PL/I definition that silently disappears is
  probably another such spot.
- **Bodies need the grammar's `body` field** (tree-sitter-pli `4b4dc00`).
  Older grammar commits attribute every call to the module and flatten
  packages.
- **`codebase_rag/queries/highlights/pli.scm` is cgr's own query, not the
  grammar's.** cgr's in-place binding build ships no `HIGHLIGHTS_QUERY`. cgr
  treats every highlights capture in a procedure header as a modifier, so the
  grammar's full file would turn PROC, RETURNS, FIXED etc. into modifiers.
  A symlink to the grammar's file also breaks `test_packaged_data.py`.
- **`LICENSE` counts as a member name.** In extensionless mode, any
  7-8-character uppercase name passes the rule, so `LICENSE` is indexed as an
  (empty) PL/I module. Accepted. Use cgr's exclude rules if it matters.
- **Fixed-format detection is a heuristic** (`utils/pli_margins.py`). A file
  counts as fixed-format when:
  - no line is longer than 80 characters;
  - every code line starts with a blank, `0`, `1`, `-`, `+` or `*PROCESS` /
    `%PROCESS`.

  Columns 73-80 are blanked only when at least 90% of code lines have
  something there. A `MARGINS(...)` compiler option is not read. On the Zowe
  samples this brings parse errors from 3336 down to 134.
- **Editing tools see blanked bytes.** cgr's editors patch the bytes the
  grammar parsed (`grammar_bytes`). An edit through cgr to a fixed-format
  file would write it back without its sequence numbers.
- **Every new cgr language moves the fuzz seeds.** The parse harness indexes
  `sorted(languages)`, so `fuzz/build_corpus.py` has to be rerun.
  `scripts/generate_readme.py` regenerates the support matrix.
- **Running tests needs the full grammar set.** On a base install, the
  conftest skips any updater run with "javascript parser not available".
- **Some test failures on this machine come from the environment.** Judging
  by their messages (no baseline run without the patch yet):
  - Go/.NET oracle tests;
  - single-file project-root tests (a project marker above `/tmp`);
  - `failed_clone` (the test expects English git messages);
  - Memgraph tests (no Docker);
  - Go rename tests (`go build` can't read VCS status in the temp repo);
  - shell-command `pwd` tests (the nix shell nests `TMPDIR`).
- **Tables, screens and jobs are Functions.** The graph has no node types
  for them, and the website and the VS Code trees only follow CALLS between
  functions, so a program reading a table "calls" it. Search by name to tell
  them apart, or by file language.
- **Tables and screens resolve by bare name.** `PROD.CUSTOMER` and
  `TEST.CUSTOMER` are the same table, and two DDL files defining `CUSTOMER`
  both get the edge. A PL/I string literal that happens to equal a format or
  message name links to it.
- **A program links to its procedure named like the member.** PL/I nests
  procedures flat (`member.INNER`), so when no procedure is named like the
  member, every procedure of it gets the edge, internal ones included.
- **A cataloged procedure needs a named `PROC` statement** to be a Function.
  An `EXEC` of a member whose PROC is unnamed links to nothing.
- **Unknown programs are dropped.** `PGM=IEFBR14`, `SORT`, `IDCAMS` etc. have
  no member in the repository, and no edge or placeholder node is created.
- **Symbolic parameters aren't substituted.** `PGM=&PROG` and other `&`
  values link to nothing.
- **Db2 DDL with sequence numbers in columns 73-80 doesn't parse.** The JCL
  and HLASM grammars handle the columns themselves, the Db2 grammar reads
  free-format SQL.
- **The extension's declaration reader is not a parser.** `vscode/src/source.ts`
  splits PL/I at semicolons and reads `DCL` lists with their level numbers;
  HLASM by columns (label in 1, continuation in 72, operands from 16). It
  doesn't evaluate `%` preprocessor statements (`%IF`, `%DCL` substitutions),
  knows no `DEFINE STRUCTURE` / `TYPE`, and takes procedure scopes from the
  graph, so a `BEGIN` block's declarations count for the whole procedure.
  An unsaved edit that moves lines puts declarations in the wrong procedure
  until cgr has re-indexed the file.
- **Column references need the graph's table edges.** A program's SQL names
  count as columns only of the tables cgr linked it to; a table it reaches
  through a view or an alias the graph doesn't resolve leaves its columns
  out.
