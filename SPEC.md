# PL/I Graph: functional specification

Status: draft, 2026-11-09. Describes the tool PL/I Graph is growing into: a
reverse-engineering assistant for a large IMS / MVS PL/I code base whose
business logic is partly no longer understood.

Requirements are numbered (`FR-…`, `NFR-…`) so code, tests and discussions
can point at them.

---

## 1. Purpose

The code base has about 30,000 files and 8 million lines of PL/I, JCL, MFS,
PSB/DBD gens and Db2 DDL. Many programs have no available expert. Around the
code there is metadata of varying quality: file descriptions, UC4 job
descriptions, interface examples, usage statistics and documents.

The tool answers questions like these, with evidence:

- What does transaction `KD01` do, step by step, and which rules apply?
- Where is field `KD_TYP` set, what values can it take, what do they mean?
- Which jobs write dataset `PROD.KD.BESTAND`, which read it, in what order?
- What breaks if column `CUSTOMER.LIMIT` changes?
- Which programs have not run in a year and are reachable from nothing?
- How is the overdraft fee calculated?

The end results:

1. **A wiki** that describes every business process (transaction, job
   chain) in business terms: what it does, its rules, its data, with UML
   diagrams and with every statement linked to the code that proves it
   (§7.4).
2. **Answers inside the AI tools people already use** (Copilot, Claude
   Code, any MCP client), built from the same verified knowledge and marked
   with how far they are verified (§7.2).
3. **Later, a specification to replace the applications from**: business
   rules with stable ids and acceptance criteria, interfaces, data, and
   recorded real cases to test a replacement against (§13).

### 1.1 Principles

1. **Facts before prose.** A program extracts everything it can know with
   certainty (the graph). A language model only writes explanations, and
   only from facts it is given.
2. **Everything has a source.** Every fact, text and claim records where it
   came from: a source file and line, a metadata file and entry, a model run,
   or a person. Nothing is shown without it.
3. **Claims are checked.** A model's statement about the code cites lines,
   and a program checks that the cited lines contain what the statement
   says. What fails the check is flagged, never shown as true.
4. **Sources are pluggable.** Adding, replacing or removing a kind of
   metadata is a configuration change, plus at most one small adapter file.
   Nothing else in the tool changes.
5. **Incremental.** A change to one file or metadata entry redoes only what
   depends on it.
6. **People have the last word.** Experts confirm, correct or reject
   glossary entries, summaries and rules. Their decisions survive every
   rebuild.
7. **Confidential by default.** Code and metadata stay on the machine
   unless sent to a model provider the company approved. What is sent is
   logged.

### 1.2 Not in scope

- Changing the existing code. Writing the replacement is a later project
  that uses this tool's output (§13); the tool itself does not generate
  application code.
- Running or tracing programs. Run-time data comes in only as metadata
  (usage statistics, scheduler data).
- Replacing the scheduler, the repository or the documentation system.
  The tool reads their exports.

---

## 2. Users and use cases

| User | Needs |
|---|---|
| Developer changing code | Impact of a change, where a field is used, what a procedure does |
| New team member | The big picture: transactions, jobs, data, glossary |
| Analyst / domain expert | Business rules in business words, checked against the code |
| Architect / migration planner | Interfaces, data flows, dead code, sizes |
| AI assistant (Copilot over MCP) | Exact facts and verified summaries as tools |

Use cases (each is an acceptance scenario for the phase that delivers it):

- **UC-1 Explain a program or procedure.** Purpose, inputs, outputs, rules
  with line references, callers and callees, and everything the metadata
  says about it.
- **UC-2 Trace a field.** Declaration, meaning (glossary), every place it is
  set, compared or passed, the values it takes, the screens, columns and
  segments it comes from or goes to.
- **UC-3 Follow a process.** From an entry point (IMS transaction, UC4 job
  plan, JCL job) through programs, data and rules, as a narrative and as a
  graph.
- **UC-4 Impact of a change.** Everything that depends on a field, record
  layout, table, segment, dataset or program.
- **UC-5 Find dead code.** Programs, procedures and jobs that nothing
  reaches and nothing runs.
- **UC-6 Ask in plain language.** Copilot answers from the graph, the
  metadata and the verified summaries, citing them.
- **UC-7 Review knowledge.** An expert goes through proposed glossary
  entries and rules and confirms, corrects or rejects each.
- **UC-8 Check coverage.** How much of the code and the metadata the tool
  understood, without exposing the code (the coverage report).

---

## 3. Concepts

### 3.1 Subjects

A **subject** is anything knowledge can be about. Each has a **kind** and
a **key**: a stable text that identifies it across rebuilds and that
metadata can name without knowing the graph's internals.

| Kind | Key | Example |
|---|---|---|
| `file` | path relative to the folder | `file:SRC/KDP00001` |
| `member` | member name (all files with that name) | `member:KDP00001` |
| `program` | load module / main procedure name | `program:KDP00001` |
| `procedure` | file path and procedure name | `procedure:SRC/KDP00001#PRUEFE_LIMIT` |
| `field` | file path and qualified name | `field:COPY/KDSEG#KUNDE_SEG.KD_TYP` |
| `job` | JCL job name | `job:KDJ00001` |
| `step` | job and step name | `step:KDJ00001.S010` |
| `dataset` | dataset name, without generation | `dataset:PROD.KD.BESTAND` |
| `table` | schema and table | `table:PROD.CUSTOMER` |
| `column` | table and column | `column:PROD.CUSTOMER.LIMIT` |
| `psb`, `dbd` | name | `psb:KDPSB01` |
| `segment` | DBD and segment | `segment:KDDBD01.KUNDE` |
| `transaction` | transaction code | `transaction:KD01` |
| `screen` | MFS format or message | `screen:KDFMT01` |
| `screen-field` | format and field | `screen-field:KDFMT01.KDTYP` |
| `schedule-job` | scheduler object name (UC4) | `schedule-job:KD.TAEGLICH.J010` |
| `interface` | name given by its source | `interface:SCHUFA-ANFRAGE` |
| `term` | glossary term | `term:Kundentyp` |

New kinds may be added by sources (FR-SRC-6). Keys are case-insensitive
where z/OS names are.

- **FR-SUB-1** Every subject the graph knows has a key of the form above,
  computed from the graph and not from row ids.
- **FR-SUB-2** A key resolves to zero, one or several graph rows. Several
  is normal: dev and prod copies, or a member in several folders. A
  resolution says which, and uses the graph's nearest-copy rule where one
  is needed.
- **FR-SUB-3** Keys that resolve to nothing are kept and reported, not
  dropped (§5.4).

### 3.2 Knowledge items

Everything the tool knows beyond the graph is a **knowledge item** about one
subject. Four shapes cover all sources:

| Shape | Holds | Example |
|---|---|---|
| `attribute` | a name and a short value | `owner = Team Kredit`, `runs_90d = 412` |
| `text` | a title and a longer body | a file description, a doc section, a summary |
| `link` | a relation to another subject | UC4 job `runs` JCL job; doc section `mentions` table |
| `example` | a sample of data with its layout | an interface record, a screen message |

Every item has:

- the **subject key**
- the **source** (its id, the source file, and the line, entry or anchor in it)
- **trust**: `exact` (read from the code by the indexer), `recorded` (as
  stated by a metadata source, may be outdated), `generated` (written by a
  model, with its verification result), `confirmed` (a person checked it),
  `rejected` (a person rejected it, kept so it is not proposed again)
- **as-of**: when the source last changed
- a **hash** of what it was derived from, for invalidation (§8)

- **FR-KI-1** Two sources that say different things about one subject are
  both kept and both shown, each with its source. The tool does not merge
  or pick.
- **FR-KI-2** Every view, report and MCP answer shows trust and source for
  every item, in a way a reader can tell `exact` from `generated` at a
  glance.

---

## 4. Layers

The tool is built in layers. Each one only reads the ones below it.

```
5  Process views       per transaction / job: narrative, data, rules
4  Verification        every generated claim checked against the graph
3  Summaries           per procedure, bottom-up, structured, cited
2  Glossary            what names mean, from screens, columns, docs, people
1b Metadata            file descriptions, UC4, examples, usage, docs (pluggable)
1a Facts (the graph)   exact, from the code (exists today)
```

### 4.1 Layer 1a: facts from the code (exists)

What the graph holds today is described in `README.md` and
`vscode/README.md`: definitions and references, includes, calls, JCL steps
and DDs, datasets, Db2 tables and columns, PSBs, DBDs, segments, DL/I calls,
MFS fields with their labels, declarations, statements as a tree, field
reads and writes resolved to declarations, comparisons, literals and
comments.

Open work in this layer:

- **FR-FACT-1** A `CALL` or `FETCH` through a variable, or a DL/I call whose
  function or segment comes from a variable no `INIT` explains, is recorded
  as unresolved with its reason. It is never guessed.
- **FR-FACT-2** A PL/I file declaration is linked to the DD of the step
  that runs the program, and through it to the dataset. Job chains follow:
  job A writes the dataset job B reads.
- **FR-FACT-3** Entry points are subjects of their own: IMS transactions
  (system definition → PSB → program, screen → message → program) and
  batch jobs (JCL, and scheduler jobs from metadata).
- **FR-FACT-4** Preprocessor statements (`%IF`, `%DO`, `%ACTIVATE`) and
  data reached through `BASED` pointers and `DEFINED` overlays are marked
  as such, so later layers know the facts there are incomplete.
- **FR-FACT-5** Procedures longer than a configurable limit are split
  into blocks (by `DO`/`SELECT`/labelled sections) for layer 3, with the
  facts of each block.
- **FR-FACT-6** The coverage report (exists) states for every kind of fact
  how much of the code it covers, so gaps are found before they mislead.

### 4.2 Layer 1b: metadata sources

See §5. This is the extension point of the tool.

### 4.3 Layer 2: glossary

Maps cryptic names to business terms.

- **FR-GLO-1** Exact evidence is collected first, without a model:
  - the label left of an MFS input field (the best source)
  - Db2 column names and their `COMMENT ON` / `LABEL ON`
  - DBD field names
  - comments on declarations
  - descriptions and terms from metadata sources (data dictionaries,
    interface descriptions, docs)
  - lineage: a screen field moved into a program field that is moved into
    a column connects the three names
- **FR-GLO-2** A term is a subject (`term:…`) with a name, a definition,
  the names it stands for (fields, columns, screen fields, segments), and
  known values with their meanings (`KD_TYP = 'G'` → Geschäftskunde).
- **FR-GLO-3** A model may propose terms, definitions and value meanings
  from the evidence. Proposals are `generated` and cite their evidence.
- **FR-GLO-4** An expert reviews proposals one by one (UC-7). Confirmed and
  rejected decisions are stored as knowledge items of the `review` source
  and survive rebuilds.
- **FR-GLO-5** Values a field takes come from the code (literals assigned
  and compared) and from metadata (interface examples, value lists).

### 4.4 Layer 3: summaries

- **FR-SUM-1** Procedures are summarized bottom-up: a procedure after all
  procedures it calls, so each prompt can include the callees' summaries.
  Recursion and unresolved calls are cut and said so in the prompt.
- **FR-SUM-2** A prompt holds the procedure's source (or block, FR-FACT-5),
  its exact facts (calls, fields read and written, tables, segments,
  screens, files, comparisons), its callees' summaries, the glossary terms
  of its fields, and the metadata about it and its program, marked with
  trust and as-of date.
- **FR-SUM-3** A summary is structured, not free text:
  - purpose (one or two sentences)
  - inputs and outputs (parameters, records, tables, segments, screens,
    files, each with its role)
  - business rules, each with:
    - a stable id derived from its subject and position
      (`R-KDP00001-PRUEFE_LIMIT-03`), kept while the rule's lines still
      exist, so the wiki, reviews and later tests can point at it
    - a type: validation, calculation, decision, state change, routing
    - the rule in business words, using glossary terms
    - acceptance criteria as Given / When / Then with concrete values
    - the cited lines
  - side effects and error handling
  - open questions the model could not answer from what it was given
- **FR-SUM-4** Programs, then entry points, are summarized from their
  procedures' summaries (layer 5).
- **FR-SUM-5** Before a run the tool shows its scope (procedures), its
  estimated tokens and cost, and which provider it will use, and waits for
  a confirmation. A run can be stopped and resumed.
- **FR-SUM-6** Summaries are ordered by value: procedures of entry points
  that run (usage statistics) first, unused code last or never.
- **FR-SUM-7** Prompts are versioned. A new prompt version marks old
  summaries stale but keeps them until replaced.

### 4.5 Layer 4: verification

- **FR-VER-1** Every rule and every input or output in a summary names
  lines. A check confirms against the graph that those lines:
  - access the fields the rule names (`accesses`)
  - compare with or assign the values it names (`comparisons`, `literals`,
    accesses with values)
  - call, read or write what it names (`refs`, `sql_columns`, `dli_calls`,
    `file_io`)
- **FR-VER-2** Each claim gets a result: `verified`, `partly verified`
  (some named things not found at those lines), `unverifiable` (names
  nothing the graph can check), `contradicted`. Views show the result;
  contradicted claims are hidden by default and listed for review.
- **FR-VER-3** A summary whose claims are mostly not verified is
  regenerated once with the failures fed back, then flagged.
- **FR-VER-4** A fixed question set (§10.3) is answered after every change
  to prompts, models or layers, and the answers are compared to the expected
  ones.

### 4.6 Layer 5: process views

- **FR-PRO-1** For every entry point: a narrative of the flow (screens,
  programs, calls, data read and written, rules in order), built from the
  summaries and the graph, with links to every part.
- **FR-PRO-2** Job chains: UC4 job plans and JCL jobs in order, with the
  datasets passed between them and the programs each step runs.
- **FR-PRO-4** Business domains: entry points, programs and data are
  grouped into domains (customer, account, payments, …). Candidates come
  from exact signals: shared tables and segments, call clusters (a
  community algorithm such as Leiden over the call and data graph), name
  prefixes, UC4 job plan folders. A model proposes names; an expert
  confirms the cut. The wiki is organized by domain.
- **FR-PRO-5** State machines: for fields that hold a status (assigned
  only literals from a small set, and compared in conditions), the
  transitions are derived exactly: which statement sets which value under
  which guard, from which previous value when a comparison shows it.
- **FR-PRO-3** Dead code candidates (UC-5): subjects not reachable from any
  entry point and without runs in the usage statistics, with the reason.
  The tool flags; it never deletes.

---

## 5. Metadata sources

### 5.1 What a source is

A **source** reads one kind of input (files in a folder, an export, a
database dump) and turns it into knowledge items about subjects (§3.2). The
rest of the tool only sees knowledge items, so it does not care where they
came from.

The planned sources:

| Source | Input (assumed, to be confirmed) | Gives | Subjects |
|---|---|---|---|
| File descriptions | CSV / Excel export: member, description, owner, … | `text` description, `attribute`s | `member`, `program` |
| UC4 job descriptions | Automic export (XML/JSON): jobs, job plans, schedules, predecessors, the JCL each submits, descriptions | `text`, `attribute` schedule, `link` runs / follows / part-of | `schedule-job` → `job`, `schedule-job` |
| Interface examples | Sample files and messages, with the layout they follow | `example`, decoded into fields by the layout | `interface`, `dataset`, `screen`, `field` |
| Usage statistics | CSV: job / transaction / program, run count, last run, period | `attribute` runs, last run | `job`, `transaction`, `program`, `schedule-job` |
| Documents | Markdown, text, HTML, Word, PDF: specs, manuals, wiki exports | `text` per section, `link` mentions | anything named in them |
| Reviews (built in) | The tool's own store | `confirmed` / `rejected` decisions, corrections | any |
| Summaries (built in) | Model runs | `generated` texts and rules | `procedure`, `program`, entry points |

### 5.2 Requirements

- **FR-SRC-1** Sources are listed in one configuration file in the
  workspace (`pli-graph.sources.json`). Adding a source is adding an entry,
  removing it is deleting the entry: its items disappear on the next sync,
  and nothing else changes.
- **FR-SRC-2** Most sources need no code. Built-in readers handle:
  - `table`: CSV, TSV and Excel sheets, with a mapping from columns to the
    subject key and to attributes and texts
  - `json`: JSON / JSON Lines, with the same mapping by field path
  - `documents`: Markdown, text and HTML, split into sections by headings;
    Word and PDF once a converter is approved (§11)
  - `examples`: sample files paired with a layout (a PL/I structure, a
    copybook, an MFS message, a Db2 table) by name or by configuration
- **FR-SRC-3** A source with an unusual format (a UC4 export, say) is one
  JavaScript module in the workspace with one function: given the files that
  changed, return the knowledge items they contain. The module never touches
  the database.
- **FR-SRC-4** A source can be disabled without being removed, and
  rebuilt alone.
- **FR-SRC-5** Sources are read incrementally: only changed input files are
  read again, and only the items of those files are replaced.
- **FR-SRC-6** A source may declare new subject kinds and new link kinds.
  They show up in views and MCP tools without code changes, in a generic
  form.
- **FR-SRC-7** A source's failures (unreadable file, bad row) are logged
  with a stable error code, the file and the row, and reported. The rest of
  the source is still read.
- **FR-SRC-8** Mentions in texts (documents, descriptions) are linked to
  subjects by exact name matches against the graph: member, program, job,
  dataset, table, transaction and screen names, and glossary terms. Matches
  are `recorded` links with the position in the text. Fuzzy or semantic
  matching is a later option and would be `generated`.

### 5.3 Configuration example

```json
{
  "sources": [
    {
      "id": "file-descriptions",
      "reader": "table",
      "files": "meta/dateibeschreibungen.csv",
      "subject": "member:{Member}",
      "texts": { "description": "{Beschreibung}" },
      "attributes": { "owner": "{Verantwortlich}", "status": "{Status}" }
    },
    {
      "id": "usage",
      "reader": "table",
      "files": "meta/usage/*.csv",
      "subject": "{Typ}:{Name}",
      "attributes": { "runs": "{Anzahl}", "last_run": "{Letzter Lauf}", "period": "{Zeitraum}" }
    },
    {
      "id": "uc4",
      "reader": "module",
      "files": "meta/uc4/*.xml",
      "module": "meta/readers/uc4.js"
    },
    {
      "id": "docs",
      "reader": "documents",
      "files": "doku/**/*.{md,txt,html}"
    },
    {
      "id": "interfaces",
      "reader": "examples",
      "files": "meta/schnittstellen/**/*",
      "layout": "by-name"
    }
  ]
}
```

### 5.4 Matching metadata to the code

- **FR-MAT-1** Every source reports its items whose subject key resolves to
  nothing in the graph, grouped by key, in the coverage report (UC-8).
  Typical causes: renamed members, deleted programs, typos, names of other
  systems.
- **FR-MAT-2** A source may give alias rules (a prefix to drop, a mapping
  table) to match its names to the code's.
- **FR-MAT-3** Unmatched items stay searchable and visible as metadata
  without a code subject.

---

## 6. The analysis harness

How the model work in layers 2-4 is run. It is a batch pipeline, not an
autonomous agent: the program decides what the model reads, the model fills
in a form, the program checks the form. The model never browses the code on
its own during analysis. That keeps runs predictable, cheap, repeatable and
checkable. (Agents with tools are for the interactive questions of §7.2,
where they read the stored, already checked results.)

### 6.1 The loop for one procedure

```
graph ──► 1. context pack ──► 2. model ──► 3. parse ──► 4. check ──► 5. store
              (program)        (on prem)    (program)    (program)    (knowledge db)
                                   ▲                         │
                                   └──── one retry with ─────┘
                                         the check's errors
```

1. **Context pack.** A program builds the model's input from the graph,
   in a fixed order, as plain text:
   - the instructions and the output form (the same for every request, so
     the model server can cache it, see 6.3)
   - the glossary terms of the fields used
   - the procedure's source **with line numbers**
   - its facts as short tables: fields read and written with their
     declarations and terms, comparisons, calls with the callees'
     summaries, SQL, DL/I, files, screens
   - its metadata items, marked with source and date
   Only what the procedure uses goes in, not whole include members. Target
   size 4-16k tokens; bigger procedures are split into blocks
   (FR-FACT-5), each summarized, then the procedure from the blocks.
2. **Model.** One request, temperature 0, output forced into a JSON schema
   (structured output / guided decoding, which on-prem servers such as
   vLLM, llama.cpp and Ollama support).
3. **Parse** into the form of FR-SUM-3.
4. **Check** (layer 4, FR-VER-1): every rule's lines exist in the
   procedure, the fields and values it names occur at those lines, the
   inputs and outputs it lists match the facts. Failures go back to the
   model once, as a list ("line 412 does not compare KD_TYP"), then the
   result is stored with its failures marked.
5. **Store** with the hash of the context pack, prompt version and model
   (FR-STO-4), so the same input is never sent twice.

### 6.2 Order and scope of a run

- **FR-LLM-6** A run takes a scope (a transaction, a job chain, a folder,
  everything), collects the procedures reachable from it, and orders them
  bottom-up over the call graph (callees first). Cycles are cut and the
  cut is stated in the pack.
- **FR-LLM-7** Before sending anything the run removes work:
  - procedures whose text is identical to one already summarized (dev and
    prod copies, copied members) reuse that summary
  - trivial procedures (a few statements, no conditions) are described
    from facts alone, without a model
  - code the usage statistics show as never run goes last or is skipped
- **FR-LLM-8** The run shows the count of procedures, the tokens and the
  estimated hours on the configured server before it starts (FR-SUM-5),
  and progress while it runs.

### 6.3 Throughput

- **FR-LLM-5** Requests run as many at once as the model server batches
  well (typically 8-64; measured, configurable). A run survives a restart
  of VS Code and resumes where it stopped.
- **FR-LLM-9** The instructions, the form and the glossary come first in
  every pack and are identical across requests, so the server's prefix
  cache reuses them and only the procedure-specific part is processed.
- Rough size: about 50M tokens of source; with facts and callee summaries
  perhaps 150-300M tokens in, 10-20M out, for a full first pass. Whether
  that is hours or days depends on the server and the model, and is
  measured in the pilot (§11 phase 2) before a full run is planned. After
  the first pass only changed procedures and their callers run again.

### 6.4 Providers

- **FR-LLM-1** The tool talks to one kind of interface: an
  OpenAI-compatible HTTP endpoint (chat completions with a JSON schema).
  Every common on-prem server offers it (vLLM, llama.cpp, Ollama, TGI), so
  the model and server can change without code changes. The endpoint,
  model name and limits are settings.
- **FR-LLM-2** Without a configured endpoint every model feature is off,
  and the tool works with the exact layers alone.
- **FR-LLM-3** Every request is logged with its purpose, subject, model,
  prompt version, token counts, duration and check result. The prompt text
  is logged only when turned on.
- **FR-LLM-4** Output that does not parse is retried once, then recorded as
  a failure with an error code.
- **FR-LLM-10** Tests run against recorded model answers, so they need no
  server. A developer can point the tool at a small local model (Ollama on
  the laptop) to try changes.

### 6.5 Choosing prompts and models by measurement

The harness is tuned like any other program: by a test suite.

- **FR-LLM-11** The gold set: 20-50 procedures from the pilot, with what an
  expert says each does and its rules. Every prompt version and every model
  is run over it, and scored:
  - share of claims that pass the check (automatic)
  - share of the expert's rules found (automatic, by matching lines and
    fields)
  - an expert's grade of a sample (manual)
- **FR-LLM-12** A prompt or model change is taken only when it scores
  better on the gold set. Scores are kept per prompt version and model.

### 6.6 Languages

- **FR-LANG-1** Every text a person reads (summaries, rules, glossary,
  wiki, diagrams' labels, the tool's own UI and the review forms) exists in
  German and English. Further languages can be added by configuration.
- **FR-LANG-2** The model writes in one configured primary language; the
  other is a translation step of the same harness, which keeps the
  glossary's terms as fixed translations and leaves names from the code
  untouched.
- **FR-LANG-3** The structured parts of a rule (id, fields, values, lines,
  Given/When/Then values) are language-neutral and stored once; only the
  wording exists per language.
- **FR-LANG-4** An expert may review and correct in either language. A
  correction marks the other language's text stale; it is translated again
  and shown as "translated, not reviewed" until someone confirms it.

---

## 7. Interfaces

### 7.1 VS Code

- **FR-UI-1** Graph page (exists): the details of any subject show, in
  sections, its exact facts, its glossary terms, its metadata items grouped
  by source, its summary with verification results, and its review state.
  Every item links to its source (a line in the code, a file and row of the
  metadata).
- **FR-UI-2** Hover on a name in the editor shows its glossary term and the
  first line of its summary.
- **FR-UI-3** A review view lists proposals (terms, value meanings, rules)
  waiting for an expert, with their evidence, and buttons to confirm,
  correct or reject.
- **FR-UI-4** A process view per entry point (layer 5).
- **FR-UI-5** Commands: sync metadata, summarize (with scope: a procedure,
  a program, a transaction, a folder), show the cost estimate, stop and
  resume a run, coverage report (exists).
- **FR-UI-6** Errors are shown in place with their code, never as a
  redirect or a lost state.

### 7.2 MCP server (for Copilot and other assistants)

Exists today: `find_definition`, `find_references`, `dependencies`,
`dependents`, `dataset`, `program_files`, `table_columns`, `psb`, `screen`,
`dli`, `transaction`, `data_use`, `dead_code`, `field`, `lineage`, `text`, `get_source`, `query_graph`.

- **FR-MCP-1** `explain(subject)`: the summary, rules, glossary terms and
  metadata of a subject, with trust and sources.
- **FR-MCP-2** `rules_for(subject)`: verified business rules that read or
  set a field, column or segment.
- **FR-MCP-3** `glossary(query)`: terms and the names they stand for.
- **FR-MCP-4** `metadata(subject, source?)`: the knowledge items of one or
  all sources.
- **FR-MCP-5** `search(query)`: full text over summaries, descriptions,
  documents, comments and literals, ranked, each hit with its subject and
  source.
- **FR-MCP-6** `process(entry point)`: the layer 5 view.
- **FR-MCP-7** Every answer carries trust and sources per item, so the
  assistant can cite them.
- **FR-MCP-8** Every answer says whether it is **complete** or a **lower
  bound**: `find_references`, `dependents`, `field` and impact answers are
  lower bounds when dynamic calls, `BASED` storage, overlays or
  preprocessor code could hide more (FR-FACT-1, FR-FACT-4), and say which.
- **FR-MCP-9** `verify(claims)`: an assistant hands in the claims of its
  draft answer, each with the lines it cites; the tool checks them like
  layer 4 (FR-VER-1) and returns a result per claim. This is how an answer
  composed by an outside AI becomes a verified one.
- **FR-MCP-10** `wiki_contents()` and `wiki_page(subject)`: the wiki's
  table of contents and pages, so an assistant can read what people read.
- **FR-MCP-11** `trace(from, to)`: the shortest path between two subjects
  (screen field to column, job to table), and `impact(change)`: what a
  change to a subject, or a git diff, reaches, up to the entry points and
  wiki pages.
- **FR-MCP-12** The extension ships instructions for the assistants
  (`.github/copilot-instructions.md`, `AGENTS.md`, a Claude Code skill)
  that tell them to answer from these tools, cite subjects and lines, run
  `verify` before answering, and say plainly what is unverified.

What "verified" means must be stated in every answer and in the wiki: a
verified claim cites lines that really contain what it says. That does not
prove the claim's interpretation is right. Only an expert's confirmation or
a test against recorded real behavior (§13) does that, and items carry
which of these they have.

### 7.3 Reports and export

- **FR-REP-1** Coverage report (exists), extended by metadata coverage:
  per source, items read, matched, unmatched, failed.
- **FR-REP-2** Knowledge export: glossary, summaries and rules as Markdown
  or JSON, per program or entry point, for documentation outside the tool.

### 7.4 Wiki

- **FR-WIKI-1** The wiki is generated as a folder of Markdown files with
  Mermaid diagrams, which renders in VS Code, GitLab/GitHub, Azure DevOps,
  Confluence (with a plugin) and plain static site generators, and can be
  kept in version control. A static HTML build of it needs no server.
- **FR-WIKI-2** Pages, each about one subject:
  - start page: domains, entry points, how to read the wiki, coverage
  - domain: its processes, data, terms
  - process (transaction, job chain): narrative, diagrams, rules in order,
    interfaces, data read and written, schedule and usage
  - program and procedure: purpose, inputs and outputs, rules, callers and
    callees
  - data: table, segment, dataset, record layout, with fields, their terms,
    who reads and writes them
  - interface: layout, examples, producers and consumers
  - glossary: one page per term, and an index
  - rule: one page per rule id, with its acceptance criteria and evidence
- **FR-WIKI-3** Pages are built from the graph first and from model text
  second. Everything that can be rendered exactly (lists, tables,
  diagrams, cross-links) is rendered without a model, so a wiki exists
  before any summary does, and stays right where the model is wrong.
- **FR-WIKI-4** Every sentence a model wrote shows its verification
  state and links to its lines; confirmed, verified, unverified and
  contradicted are visibly different.
- **FR-WIKI-5** Pages are regenerated only when their inputs change
  (FR-STO-4). A page shows the code version it was built from, and a
  stale page says so.
- **FR-WIKI-6** Guided tours: an ordered reading path through a domain or
  process for newcomers, from entry point down.
- **FR-WIKI-7** Expert corrections are made in the review view or as
  comments, not by editing generated pages, so they survive regeneration.
- **FR-WIKI-8** The wiki and the review work in a browser, for experts who
  do not use VS Code: published to the company's wiki or collaboration
  tool through an adapter, with comments and corrections read back into the
  knowledge store (§12).

### 7.5 Diagrams

All diagrams are drawn from the graph, not by a model. A model only
labels nodes in business words, and the labels are marked as such.

| Diagram | UML kind | Built from |
|---|---|---|
| Process flow of a procedure or transaction | activity | the statement tree: `IF` / `SELECT` branches, loops, calls, `RETURN`; leaves collapsed to rule ids |
| Dialog of a transaction | sequence | screen → IMS → program → calls → DL/I and SQL → reply message |
| Job chain | activity (with object flow) | UC4 plans and JCL steps, datasets passed between them |
| Status field | state machine | FR-PRO-5 |
| Data model | class / ER | DBD hierarchies, Db2 tables and foreign keys, record layouts |
| Programs and interfaces of a domain | component | calls, datasets, tables, queues between programs |

- **FR-DIA-1** Diagrams that would be too big (over about 40 nodes) are
  folded: sub-procedures and branches collapse to one node that links to
  their own diagram.
- **FR-DIA-2** Every node of a diagram links to its wiki page or its lines.

---

## 8. Storage and invalidation

- **FR-STO-1** The graph (layer 1a) stays one SQLite file per workspace
  folder, rebuilt freely: its rows have no meaning outside it.
- **FR-STO-2** Knowledge (metadata items, glossary, summaries, reviews)
  lives in a second SQLite file next to it, keyed by subject keys and not by
  graph row ids, so a graph rebuild loses nothing.
- **FR-STO-3** The knowledge store is shared by the team, not per person:
  one store per code base, written by the batch runs and the reviews, read
  by everyone's VS Code, the wiki and the MCP server. Reviews are also
  exportable to plain files for version control, and importable again.
- **FR-STO-4** Every derived item stores the hash of its inputs. A summary's
  inputs are its procedure's source text, its facts, its callees' summaries,
  its glossary terms, its metadata items and the prompt version. When any of
  them changes, it is marked stale; stale items are shown as such until
  regenerated.
- **FR-STO-6** Staleness is tracked per claim, not only per summary: a
  rule whose cited lines did not change stays valid when other lines of
  its procedure change, and only rules whose lines changed are redone.
- **FR-STO-7** The pipeline is a list of phases, each declaring what it
  reads and writes (parse, link, facts, each source, glossary, summaries,
  verification, wiki). A phase runs only when its inputs changed, and a
  new phase or source is added by declaring it, not by editing the others.
- **FR-STO-5** Staleness propagates upward: a changed callee summary marks
  its callers' summaries stale, a changed procedure marks its process views
  stale.

---

## 9. Non-functional requirements

- **NFR-1 Scale.** 30,000 files, 8 million lines, tens of thousands of
  procedures, metadata files in the thousands, on a 4-6 core laptop with
  limited RAM.
- **NFR-2 Speed.** Exact layers: a full graph build in minutes (today about
  2 minutes per 6 million lines); a metadata sync of everything in under a
  minute; any view or MCP answer from stored data in under a second.
- **NFR-3 Responsiveness.** Long work runs off the editor's thread, shows
  progress, and can be cancelled.
- **NFR-4 Confidentiality.** No network access except to a configured model
  provider. Reports meant to leave the company (coverage part 1) contain no
  names, paths, code or data.
- **NFR-5 Traceability.** Every error has a stable code shown in the UI and
  the log. Every item has its source.
- **NFR-6 One package.** The extension stays one platform-independent
  `.vsix` that needs nothing else installed. Optional converters (Word, PDF)
  are optional.
- **NFR-7 Cost.** A full summary pass of the code base is a one-time cost
  (about 50M tokens of source, a few hundred million with prompts); after
  that only changed code is summarized again. The estimate is shown before
  every run (FR-SUM-5).

---

## 10. Quality and acceptance

### 10.1 Tests

- Each source reader is tested with a small, made-up example of its input
  format: items produced, unmatched keys, bad rows.
- Verification (layer 4) is tested with summaries containing correct,
  partly correct and wrong claims.
- The model layers are tested with recorded model answers, so the tests
  need no provider.

### 10.2 Measures shown in the coverage report

- Per kind of fact: share of code covered (exists).
- Per source: items matched to subjects.
- Summaries: share of procedures summarized, share of claims verified,
  share stale.
- Glossary: share of fields accessed in the code that have a confirmed term.

### 10.3 The question set

20 to 50 questions with answers known to the team ("what happens when the
customer type is G and the balance is over the limit?"), stored with the
expected answer and the lines that prove it. They are asked after every
change to prompts, models or layers; the answers are scored by whether they
cite the right lines and match the expected answer.

---

## 11. Phases

Each phase ends with something usable and with the acceptance scenarios
named.

| Phase | Delivers | Accepted when |
|---|---|---|
| 0 | Coverage report on the real code (done); fix the gaps it shows | Coverage of facts known and acceptable (UC-8) |
| 1 | **Pilot scope and gold set.** Pick one transaction with an expert. A command lists the procedures it reaches, with sizes, duplicates and estimated tokens. The expert writes for 20-50 of them what they do and their rules (in German is fine) | The gold set exists; the pilot's size in tokens is known |
| 2 | **Context packs.** `pack(procedure)` builds the model input of §6.1 from the graph, shown as a command and an MCP tool. The size distribution over the whole code base is measured | Packs of the pilot fit the budget; an expert reading a pack sees nothing missing that the code shows |
| 3 | **Checker.** The claim check of FR-VER-1 on hand-written claims, and the `verify` MCP tool | Correct, partly correct and wrong claims of the gold set are told apart |
| 4 | **One model call end to end.** Endpoint setting, structured output, retry with check errors, the knowledge store (FR-STO-2), recorded answers for tests. A small local model is enough to build it | One procedure summarized, checked, stored, shown in the graph page |
| 5 | **Batch runner and evaluation.** Bottom-up order, dedup, skip rules, concurrency, resume, estimate (§6.2-6.3); the gold set score (§6.5). Run on the pilot against the on-prem server; tune prompts and pick the model | Gold set scores recorded; pilot run time measured; the expert judges the pilot's summaries useful |
| 6 | **Review in a browser and German/English** (§6.6, FR-WIKI-8) for the pilot, published where the experts work | An expert reviews and corrects pilot rules in German without VS Code, and the corrections survive a re-run |
| 7 | Metadata store and sources (§5): file descriptions and usage statistics first, then UC4 | A source is added and removed by configuration only |
| 8 | Remaining facts (FR-FACT-1..5), entry points and job chains; glossary (§4.3) | UC-2, UC-3, UC-4 without a model |
| 9 | Wiki and diagrams (§7.4, §7.5) for the pilot, then by priority; assistant instructions | A newcomer understands the pilot process from the wiki alone; an assistant answers the question set with verified citations |
| 10 | Replacement groundwork (§13) for the pilot: rule catalog, interface contracts, recorded cases | A replacement of the pilot process passes its recorded cases |

Phases 1-5 make the vague part concrete and cheap to change: everything
after them builds on what the pilot shows works.

---|---|---|
| 0 | Coverage report on the real code (done); fix the gaps it shows | Coverage of facts known and acceptable (UC-8) |
| 1 | Knowledge store, source configuration, the `table`, `json` and `documents` readers; file descriptions and usage statistics as the first sources; metadata in the graph page and over MCP | A source is added and removed by editing the configuration only; UC-1 shows metadata |
| 2 | Pilot: one important transaction walked end to end by hand with Copilot, the MCP server and a domain expert; notes on what was missing or wrong | A written list of missing facts and wanted answers, which reorders phases 3-6 |
| 3 | FR-FACT-1..5; UC4 source; job chains and entry points | UC-3 and UC-4 for a job chain without a model |
| 4 | Glossary: exact evidence, model proposals, review view | UC-2, UC-7 |
| 5 | Summaries bottom-up with verification, for the pilot transaction, then by priority | UC-1, UC-6 with verified rules; question set scored |
| 6 | Process views, domains, dead code, interface examples | UC-3, UC-5 |
| 7 | Wiki and diagrams: exact pages and diagrams first (possible right after phase 3), model text as summaries arrive; assistant instructions and `verify` | A newcomer finds and understands the pilot process from the wiki alone; Copilot answers the question set with verified citations |
| 8 | Replacement groundwork (§13): rule catalog export, recorded cases, the first process re-specified | A replacement of one process passes its recorded cases |

---

## 12. Decisions and open questions

Decided (2026-11-09):

1. **Models run on premises.** The harness targets an OpenAI-compatible
   endpoint (§6.4). Cloud assistants (Copilot, Claude) get no code unless
   that changes; the interactive side (§7.2) must work with an assistant
   that can use an on-prem model.
2. **Experts in most fields review and change everything** the tool
   produces, many of them in German only (§6.6). Reviewing must not
   require VS Code: the review and the wiki must be usable in a browser.
3. **The first goal is a safe replacement** of the applications without
   breaking processes. This puts §13 (rule catalog, interface contracts,
   recorded cases) on the main path and orders phases 3-6 by what the
   first replaced process needs.
4. Metadata formats and document locations do not change the architecture
   and are settled when each source is built.

Open:

1. **Where the experts work.** The company's wiki or collaboration tool
   (Confluence, SharePoint, a GitLab / Azure DevOps wiki, …) decides where
   the wiki is published and where reviews happen. The knowledge store
   stays the master; publishing and reading back reviews is an adapter
   per target, like the metadata sources.
2. **Which assistant may use an on-prem model** with MCP tools in the
   company (VS Code chat with a custom endpoint, Continue, Cline, Open
   WebUI, …).
3. **The model server**: hardware, model, and who runs it. Measured in the
   pilot with the gold set (§6.5).
4. **The pilot process** and the expert who walks it.
5. **Recorded cases**: which logs and dataset copies of production runs
   can be obtained, and how they must be anonymized.

---

## 13. Replacing the applications (later)

The knowledge the tool collects is meant to become the specification of a
replacement, one process at a time (strangler pattern: a new
implementation takes over one transaction or job chain while the rest
keeps running).

- **FR-REP-3** Rule catalog export: every rule of a process with its id,
  type, business wording, acceptance criteria, evidence and review state,
  as JSON and Markdown, the input a replacement team (or a coding
  assistant) builds from. Tests of the replacement name the rule ids they
  cover.
- **FR-REP-4** Interface contracts: for every process, its exact inputs
  and outputs (screen messages, records, segments, tables, datasets) with
  layouts, field meanings and examples, since the replacement must keep
  them while neighbours still run on the old code.
- **FR-REP-5** Recorded cases: real inputs and outputs of the old
  application (IMS message logs, datasets before and after a job, table
  snapshots), anonymized as needed, stored as an `example` source and
  linked to the rules they exercise. They are the regression suite the
  replacement must pass ("golden master"); acceptance criteria alone are
  not enough, because they are only as good as the summaries.
- **FR-REP-6** Rule coverage: which rules have recorded cases exercising
  them, which have only acceptance criteria, which have neither.
- **FR-REP-7** Unknowns are listed per process: unresolved calls, unverified
  or contradicted rules, code the facts cover only partly. A process is not
  ready to replace while that list is not empty or accepted.

---

## 14. Prior art and what this spec takes from it

Looked at in November 2026. Most tools target modern languages; none read
PL/I with IMS, MFS and JCL the way the graph does, which is why the fact
layer stays our own.

| Tool | What it is | Taken from it |
|---|---|---|
| [Understand Anything](https://github.com/Egonex-AI/Understand-Anything) | Claude Code / Copilot plugin: tree-sitter facts plus model agents into a JSON knowledge graph with a dashboard, tours, a domain view (domains → flows → steps) | the split "parser for facts, model for meaning"; guided tours (FR-WIKI-6); the domain view (FR-PRO-4); a graph that can be committed and shared; installing into many assistants at once (FR-MCP-12). Its model text is not verified, which this spec does (§4.5). |
| [GitNexus](https://github.com/abhigyanpatwari/GitNexus) | tree-sitter into an embedded graph database; Leiden communities, process detection, MCP tools `query`, `context`, `impact`, `trace`, `detect_changes`, `cypher` | a pipeline of phases with declared inputs (FR-STO-7); communities as domain candidates (FR-PRO-4); answers marked exact or lower bound (FR-MCP-8); `trace` and diff-based `impact` (FR-MCP-11); confidence on inferred edges; hybrid full text + vector search |
| [DeepWiki](https://deepwiki.com), [deepwiki-open](https://github.com/AsyncFuncAI/deepwiki-open), [OpenDeepWiki](https://github.com/AIDotNet/OpenDeepWiki) | model-written repository wikis with diagrams and chat; MCP `read_wiki_structure`, `read_wiki_contents`, `ask_question` | the simple wiki tools for assistants (FR-MCP-10). Diagrams there are model-drawn; here they come from the graph (§7.5). |
| OpenWiki (LangChain, [compared here](https://repowise.dev/blog/comparisons/openwiki-alternatives)) | Markdown wiki in the repo, each fact with the source lines behind it, updates scoped to facts whose lines changed | per-claim staleness (FR-STO-6); a wiki as plain files (FR-WIKI-1) |
| [repowise](https://repowise.dev) | wiki rendered from the code graph, prose optional; stale pages flagged; dead code, hotspots; MCP | exact pages before model pages (FR-WIKI-3); stale markers (FR-WIKI-5) |
| [AWS Transform for mainframe](https://aws.amazon.com/blogs/migration-and-modernization/reimagining-mainframe-applications-with-aws-transform-and-claude-code/) | COBOL, PL/I, JCL: business rules with ids and Given/When/Then acceptance criteria, data dictionary, lineage, domain decomposition, SMF usage analysis; then rebuilt with Claude Code from the specs | rule ids and acceptance criteria (FR-SUM-3); usage data for priority and dead code; the path to a replacement (§13). It runs in AWS, which the confidentiality question (§12) may rule out. |
| IBM watsonx Code Assistant for Z, BMC AMI Assistant, Swimm, EPAM, Hypercubic | commercial mainframe explanation and rule extraction; BMC writes rules in EARS form | worth a trial on a few programs as a yardstick for our summaries, if confidentiality allows |

The common gap in all of them is the one this spec puts first: telling a
reader which statements were checked against the code and which are a
model's guess.
