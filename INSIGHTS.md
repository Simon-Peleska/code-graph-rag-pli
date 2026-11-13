# Insights: joining facts across boundaries

The graph holds the exact facts. The useful insights come from joining them
across the boundaries between program, screen, database and job. These are
the next tasks, most valuable first. Each one gets a diagram tab or a table
in the flow page and an MCP tool, both drawn from the graph, never by a model.

## 1. A screen field's path through the code

`mfs_fields` + message field order + the program's I/O area in `variables`
+ `accesses` + `comparisons`.

- For each field the user types on a 3270 screen: which program variable
  receives it, what it is checked against, and which error message is set
  when the check fails.
- That gives you the input validation rules per screen. It's also the first
  thing an expert would recognize in a German review.

Status: the `screen` MCP tool gives a format's fields and message order;
nothing joins a field to the I/O area variable and follows it.

## 2. A database column's path

`sql_columns` + `columns` + the host variables in `accesses` + the field
lineage (moves and parameters, `fieldLineage`).

- For each column: which screen field or computation it comes from, under
  which conditions it is written, and who reads it again.
- That gives you the data lineage from screen to database, and back to batch
  output.

Status: *Show Data Flow* on a host variable follows the value into SQL `INTO`,
moves and parameters; the `lineage` tool goes one step each way. No view
starts at a column and runs back to the screen or forward to batch output.

## 3. Decision tables

`comparisons` + `statements` + `accesses` with `value`.

- For each code field such as `KD_TYP`, list every value it is compared to:
  `'G'`, `'P'`, … Join that with what is assigned in each branch.
- The result is a table of the form "if TYP = 'G' then RC = 4, MSG = 'xyz'".
  Joined with the comments on the declaration, it's close to a glossary entry
  for that code.

Status: the *Tests* tab of *Show Data Flow* lists one variable's tests with
their outcomes; no table across the codebase per code field, no comments.

## 4. Error codes and messages

`literals` + `accesses` writing to return code and message fields + the
conditions from the statement tree.

- For each message text or return code: the condition that produces it.
- That's the most direct way to read business rules: "this is rejected
  when…".

Status: the *Sets* tab of *Show Data Flow* on a message field shows the
conditions per assignment; it can't be started from the literal.

## 5. A transaction end to end

sysdef `TRANSACT` → PSB → program → `pcbs`/`sensegs` → `dli_calls` with
segment and function → `segments`/`segment_fields`.

- For each transaction code: which IMS segments it reads, inserts, replaces
  or deletes. That's a CRUD matrix per transaction.
- The same works for Db2 with `sql_columns` and the operation in it.

Status: the `psb` and `dli` MCP tools give the pieces; no matrix.

## 6. Batch chains

`steps` + `dds` + `file_io` + dataset refs.

- Which job writes a dataset and which job reads it next, down to the PL/I
  record structure.
- That shows the nightly processing order and what passes between programs.

Status: the `dataset` MCP tool gives one dataset's writers and readers; no
chain across jobs.

## 7. Dead code and dead fields

`variables` without reads in `accesses`, procedures without incoming
`links`, statements under conditions that are never true.

- These are the safe things to drop when you replace the system.
- They also tell you which code you don't need to understand at all.

Status: not started.

## 8. Hotspots

Counts of `accesses` and `comparisons` per variable or column, joined with
the number of procedures and transactions involved.

- The handful of fields that most of the logic depends on.
- These are good candidates for the glossary and for the experts' review
  first.

Status: not started.
