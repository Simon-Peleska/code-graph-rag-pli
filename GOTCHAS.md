# Gotchas

## The indexer (`vscode/src/indexer.js`)

- **Names come from labels.** The grammar puts `MAIN: PROC;`'s name on the
  enclosing `labeled_statement`, not on the `procedure_statement`.
- **Bodies need the grammar's `body` field** (tree-sitter-pli `4b4dc00`).
  Older grammar commits attribute every call to the module and flatten
  packages.
- **The bundle must take web-tree-sitter's CommonJS build.** esbuild picks
  the ESM build, which finds its `.wasm` through `import.meta.url` and fails
  inside a CommonJS bundle; `build.mjs` aliases `web-tree-sitter` to
  `web-tree-sitter.cjs`.
- **The grammar `.wasm` files are committed.** CI doesn't build them;
  rebuild with `vscode/build-grammars.sh` after a grammar change and check
  `grammars/VERSIONS` for "(uncommitted changes)".
- **`LICENSE` counts as a member name.** With extensionless members on, any
  7-8-character uppercase name passes the rule, so `LICENSE` is indexed as an
  (empty) PL/I module. Accepted.
- **Fixed-format detection is a heuristic** (`blankMargins` in
  `vscode/src/source.js`). A file counts as fixed-format when:
  - no line is longer than 80 characters;
  - every code line starts with a blank, `0`, `1`, `-`, `+` or `*PROCESS` /
    `%PROCESS`.

  Columns 73-80 are blanked only when at least 90% of code lines have
  something there. A `MARGINS(...)` compiler option is not read. On the Zowe
  samples this brings parse errors from 3336 down to 134.
- **Tables and screens resolve by name.** Two DDL files defining `CUSTOMER`
  both get the link; a schema only narrows it when one of them matches. A
  PL/I string literal that happens to equal a format or message name links
  to it.
- **A program links to its procedure named like the member**, or else to
  every procedure of the member outside a package, internal ones included.
- **A cataloged procedure needs a named `PROC` statement** to be a
  definition. An `EXEC` of a member whose PROC is unnamed links to nothing.
- **Unknown programs link to nothing.** `PGM=IEFBR14`, `SORT`, `IDCAMS` etc.
  have no member in the repository; their references stay without a link,
  as do the unresolved screen literals (most string literals look like one).
- **Symbolic parameters aren't substituted.** `PGM=&PROG` and other `&`
  values link to nothing.
- **Db2 DDL with sequence numbers in columns 73-80 doesn't parse.** The JCL
  and HLASM grammars handle the columns themselves, the Db2 grammar reads
  free-format SQL.
- **`OPTIONS(MAIN)` is not recorded.** The graph page's `OPTIONS(MAIN)`
  badge and legend never light up.

## The extension

- **Highlighting is semantic tokens over TextMate.** The extension turns
  `editor.semanticHighlighting.enabled` on for its languages; a theme
  without semantic colors still shows the TextMate grammars' colors
  (`syntaxes/`), which are kept for the moment before the first parse.
  Punctuation is left to TextMate.
- **The highlights queries are copies.** `grammars/*-highlights.scm` come
  from each grammar's `queries/highlights.scm` through `build-grammars.sh`;
  edit them in the grammar repository.
- **It needs `node:sqlite`**, so VS Code 1.101 or newer.
- **The declaration reader is not a parser.** `vscode/src/source.js` splits
  PL/I at semicolons and reads `DCL` lists with their level numbers; HLASM by
  columns (label in 1, continuation in 72, operands from 16). It doesn't
  evaluate `%` preprocessor statements (`%IF`, `%DCL` substitutions), knows
  no `DEFINE STRUCTURE` / `TYPE`, and takes procedure scopes from the graph,
  so a `BEGIN` block's declarations count for the whole procedure. An
  unsaved edit that moves lines puts declarations in the wrong procedure
  until the file is saved and synced.
- **Column references need the graph's table links.** A program's SQL names
  count as columns only of the tables it is linked to; a table it reaches
  through a view or an alias leaves its columns out.
- **The graph page sets its pane widths from script.** vscode-elements'
  split layout measures its width before the page is laid out, so sizes in
  its attributes come out wrong; the page sets `handlePosition` on the first
  animation frame instead.
- **The graph page's controls are vscode-elements**, bundled by `build.mjs`
  from the components it names. A component the page starts using must be
  added to that list, or its tag stays an unknown element. They read the
  `--vscode-*` variables, so outside VS Code the page falls back to dark
  defaults.
- **The 3270 terminal is a copy.** `vscode/screen/vendor/tn3270/` holds
  tn3270's `public/` modules unchanged, at the commit in its `VERSION`; copy
  them again to update, don't edit them here. `Screen.layout()` does nothing
  until `resize()` has given it a size.
- **The MFS reader shows only the screen.** `vscode/src/mfs.js` takes the
  first `DEV` of a format and page 1 of `POS=`; `MSG`/`MFLD` are ignored, so
  output fields are shown blank and nothing maps fields to a message.
- **Dot paths are not watched.** Changes under `.git` and other dot folders
  never reach the indexer.

## The cgr patch set (`patches/`, no longer used by the extension)

- **cgr reads names from a `name` field in many places.** PL/I needs
  `pli_label()` at each: the handler, the FQN spec, the call pass's caller
  name and `_resolve_method_name`.
- **`codebase_rag/queries/highlights/pli.scm` is cgr's own query.** cgr
  treats every highlights capture in a procedure header as a modifier, so
  the grammar's full file would turn PROC, RETURNS, FIXED etc. into
  modifiers.
- **Editing tools see blanked bytes.** An edit through cgr to a fixed-format
  file would write it back without its sequence numbers.
- **Every new cgr language moves the fuzz seeds**: rerun
  `fuzz/build_corpus.py`.
- **Running cgr's tests needs the full grammar set**, and some fail on this
  machine for environment reasons (Go/.NET oracles, Memgraph without Docker,
  English git messages, `/tmp` project roots, nested `TMPDIR`).
