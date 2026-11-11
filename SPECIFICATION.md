# PL/I code graph for VS Code

Goal: Go to Definition, references, completion and dependency trees for an
IMS / MVS z/OS code base (PL/I, JCL, IMS MFS, Db2 DDL) in VS Code, from a
code graph of the whole repository, using the tree-sitter grammars from
[tree-sitter-pli](https://github.com/Simon-Peleska/tree-sitter-pli) and its
JCL, HLASM and Db2 siblings.

## Decisions (settled with the user, 2026-11-08)

- **No Python.** The extension indexes the sources itself, with
  web-tree-sitter and the grammars compiled to WebAssembly, in a worker
  thread. code-graph-rag (cgr) was too big to ship self-contained and too
  slow (20,000 files: about 3 minutes and 1.2 GB with cgr, about 4 seconds
  and 300 MB now).
- **The graph stays in SQLite**, one file per workspace folder, through
  `node:sqlite`. An MCP server or an LLM retrieval step can later read the
  same file; nothing for that exists yet.
- **Plain JavaScript with JSDoc types**, checked by `tsc --noEmit`, bundled
  by esbuild. One `.vsix` for every platform.
- **Incremental sync**: changed files are re-read and the references whose
  targets may have moved are re-linked. Changes that arrive during a sync
  are synced together when it ends; there is no batching timer.

The rest of this file is the original plan for adding PL/I to cgr, which
the patch set in `patches/` implements. The grammar notes still hold.

## The grammar: tree-sitter-pli

- Local checkout: `~/projects/tree-sitter-pli`. Remote:
  `https://github.com/Simon-Peleska/tree-sitter-pli`. The extension's wasm is
  built from the commit in `vscode/grammars/VERSIONS` (`2aa2abd`, pushed).
  Check `git -C ~/projects/tree-sitter-pli status` for unpushed commits
  before pointing a submodule at the GitHub URL.
- `tree-sitter.json`: language name `pli`, scope `source.pli`, file types
  `pli`, `pl1`, `pco`, `inc`. It ships `queries/highlights.scm` only (no
  tags.scm).
- Its README describes the scope. In short: free-form IBM/Enterprise PL/I
  plus some Multics syntax, keywords are reserved words, and
  `EXEC SQL/CICS` bodies are tokenized but not parsed. Fixed-format source
  (sequence numbers in columns 73-80, carriage control in column 1) is
  **not** supported. Many real mainframe files are fixed-format, so expect
  ERROR nodes there unless cgr strips the margins first. Decide this
  deliberately.
- It is validated against Zowe's PL/I parser (`test/zowe/` in the grammar
  repo): 245 of 260 texts are accepted by both parsers.

### Node types that matter for cgr (check `src/node-types.json`)

- `source_file`: the module/file root.
- `procedure_statement` (`procedure_heading`, body, `end_statement`): the
  function. **Gotcha:** the procedure *name* is not a child of
  `procedure_statement`. It is a label: `labeled_statement >
  statement_prefix(label: identifier)` followed by the `procedure_statement`.
  cgr's generic name extraction will not find it, so a `get_name` for PL/I
  must look at the enclosing `labeled_statement`.
- `entry_statement`: secondary entry points into a procedure (multiple-entry
  procedures). These are also callable names, again via the label.
- `package_statement`: a package containing procedures (named via the label
  as well). It is the closest thing to a class/namespace, and possibly better
  modelled as a module.
- `begin_statement`: anonymous block, not a function.
- Calls:
  - `call_statement` (field `entry: reference`) is unambiguous.
  - Function invocations inside expressions are `reference` nodes with a
    parenthesised list. Syntactically these are **indistinguishable from
    array subscripts** (`A(I)`). Resolving them needs the declarations
    (`declare_statement` with `entry` attributes / known procedure names).
  - `fetch_statement` loads an external procedure dynamically.
- Imports: `preprocessor_include` (`%INCLUDE member;` /
  `%INCLUDE ddname(member);`, child `include_spec`). Members map to files by
  name, usually without an extension; a `.inc`/`.cpy` lookup is a guess the
  user should confirm. `EXEC SQL INCLUDE member` is tagged as field `member`
  inside `exec_statement`.

## code-graph-rag: how a language gets added (history)

Read these in the cgr repo first:

- `docs/advanced/adding-languages.md`
- `docs/architecture/language-support.md`
- `codebase_rag/language_spec.py` (`LANGUAGE_SPECS`, per-language `_x_get_name`
  functions)
- `codebase_rag/parser_loader.py`
- `codebase_rag/parsers/` (handlers, `import_processor.py`,
  `class_ingest/parent_extraction.py`)

The mechanics:

- `uv run cgr language add-grammar --grammar-url <url>` must be run **inside
  a clone of code-graph-rag**. It adds the grammar as a git submodule under
  `grammars/`, reads `tree-sitter.json` and `node-types.json`, and appends a
  `LanguageSpec` to `language_spec.py` (function/class/module/call node
  types). The grammar is compiled on first use by the parser loader.
- That alone only gives "definitions and calls", and per the docs the
  failure is silent: missing name extraction or import resolution makes the
  graph thinner, not an error. For PL/I, expect to hand-write at least:
  - a `_pli_get_name` (label-based names, see above);
  - call-node handling for `call_statement`;
  - `%INCLUDE` import resolution in `import_processor.py`;
  - a support-matrix row in `docs/architecture/language-support.md`;
  - tests in the style of the existing per-language tests.
- Also check `parser_fingerprint.py`. It may need a registration so existing
  graphs re-parse when the grammar changes.
- Check whether the repo's `AGENTS.md`/`CLAUDE.md`/`CONTRIBUTING.md` set
  contribution rules (changelog in `changes/`, test layout, PR conventions).

Last looked at upstream commit `ed322ab` ("chore: bump version to 0.5.7").

## Decisions for the cgr patch set (2026-11-07)

- **Local patch set, no fork/PR.** This project holds a patch series that
  applies to an upstream code-graph-rag checkout; the checkout itself is a
  gitignored working copy, not committed here.
- **Fixed-format source: blank the margins before parsing.** Replace column 1
  (carriage control) and columns 73-80 (sequence numbers) with spaces rather
  than deleting them, so byte offsets and line/column positions stay valid.
  Needs a fixed-format detection heuristic and a pre-parse hook in cgr.
- **`package_statement` maps to a class.** Procedures inside a package become
  its methods (qualified name `file.PKG.PROC`).
- **The user's source files have no extension.** cgr picks a language purely
  from `Path.suffix` (`_EXTENSION_TO_SPEC` in `language_spec.py`, ~60 call
  sites), so extensionless files are skipped today. The user's naming rule:
  member names are z/OS-style, **uppercase, 7 or 8 characters**
  (`^[A-Z@#$][A-Z0-9@#$]{6,7}$`); the **third character** picks the
  language: `J` JCL job, `F` HLASM (IMS MFS) mask, `T` Db2 table definition,
  anything else PL/I.
  This is repo-specific, so it must be opt-in (config/env flag), not the
  default. The regex rules out dotfiles and `Makefile`, but **not**
  `LICENSE` (7 uppercase letters); such files need cgr's normal ignore rules.
- **`%INCLUDE member` resolves to a file named exactly `member`** (no
  extension), same directory first, then the repo.

- **JCL, MFS and Db2 are linked into the same graph** (grammars
  `tree-sitter-{jcl,hlasm,db2}`). Jobs/procs, FMT/MSG statements and
  tables/views/aliases are Functions; a job running a program, a message
  naming its format, a program reading a table or sending a screen are CALLS.
  The website and VS Code only follow CALLS between functions, so no new node
  or edge types. `codebase_rag/parsers/mainframe.py` finds and resolves them
  in the call pass.
- **Variables, structure fields, HLASM labels and Db2 columns stay out of the
  graph** (2026-11-07). The VS Code extension reads them from the source when
  asked (`vscode/src/source.js`, `symbols.js`) and takes from the graph only
  what a file includes (IMPORTS, HLASM `COPY` too), its procedures' line
  ranges and the tables it uses. A graph node per variable would multiply the
  20,000-file graph several times over for names only the editor needs.

## Test material

- `~/projects/tree-sitter-pli/examples/*.pli` are free-form sample programs.
- Zowe's `code_samples/*.pli` are real-world programs, mostly fixed-format.
  Fetch them with `bash ~/projects/tree-sitter-pli/test/zowe/run.sh`, which
  checks out the Zowe repo under `~/projects/tree-sitter-pli/test/zowe/.work/`.
