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

Status: built. The `screen_input` MCP tool and *Show Input Rules of the
Screen* take an MFS format or input message. For each input field they give
the I/O area variable the GU on the I/O PCB reads it into, the IF and WHEN
conditions that test that variable (and the parameters it is passed to),
and the outcomes of each branch, such as the message set. The programs are
found by the transaction code in the message's first literal field, else by
naming the format or message. Limits: only the first segment; no alignment
padding; an area is laid out up to its first field with `LIKE`, dimensions
or an unknown length. The sample's messages carry no transaction code and
its programs make no GU, so there it lists the fields only.

## 2. A database column's path

`sql_columns` + `columns` + the host variables in `accesses` + the field
lineage (moves and parameters, `fieldLineage`).

- For each column: which screen field or computation it comes from, under
  which conditions it is written, and who reads it again.
- That gives you the data lineage from screen to database, and back to batch
  output.

Status: built. The `column_path` MCP tool and *Show Path of the Column* (on
a column of a `CREATE TABLE` or an `EXEC SQL`) take a table and column. For
each `INSERT` or `UPDATE SET` they give the IF, WHEN, DO and ON conditions
it runs under and where the host variable's value comes from, followed back
through moves, calls and parameters to an MFS input field (by the program's
transaction code), another column, a segment, a record read or a literal. A
write that comes later in the same procedure, outside a loop around both,
does not count. For each `SELECT` or `FETCH INTO` they give where the value
goes: other columns, the `ISRT` reply on the I/O PCB, segments, and records
written with the dataset of their DD. They also list the statements that look
rows up by the column.

## 3. Decision tables

`comparisons` + `statements` + `accesses` with `value`.

- For each code field such as `KD_TYP`, list every value it is compared to:
  `'G'`, `'P'`, … Join that with what is assigned in each branch.
- The result is a table of the form "if TYP = 'G' then RC = 4, MSG = 'xyz'".
  Joined with the comments on the declaration, it's close to a glossary entry
  for that code.

Status: built. The *By value* tab of *Show Data Flow* and the
`decision_table` MCP tool give one row per value a field is compared to,
in every program that uses it (a field of an include is one variable for
all of them), with what follows when it has the value and when not, and
where: `= 'G'` then `STUFE = 0` in KDP00015, `STUFE = 4` in KDP00016. A
`STATIC INIT` constant counts as its value and shows its name and comment;
`^=` is the Else of `=`; a `SELECT`'s `OTHERWISE` is a row of its own. On
the sample a field takes 3–11 ms. Limits: for a condition that tests more
than the field (`&`, `|`), only what follows when it is true is listed,
under the condition.

## 4. Error codes and messages

`literals` + `accesses` writing to return code and message fields + the
conditions from the statement tree.

- For each message text or return code: the condition that produces it.
- That's the most direct way to read business rules: "this is rejected
  when…".

Status: built. The `messages` MCP tool and *Show Messages and Codes* (the
active file's, else the workspace's) list each literal assigned to a field,
directly or through a `STATIC INIT` nothing changes, and the literals
passed to a CALL, PUT, DISPLAY, SIGNAL or RETURN (DL/I calls aside), each
with the IF, WHEN, DO and ON conditions it is produced under, outermost
first: `AUSGABE.MELDUNG = 'KD201 BETRAG FEHLT'` when `NOT (BUCHUNG > 0)`.
A rule is a target and value with its places grouped by conditions. The
workspace keeps the fields set to two values or more, the rules found in
most places first, up to 1,000, with the conditions of 50 places each; on
the sample that is `RC = 0/4/8` in 10,157 places, in 0.5 s. Limits: a
message built by concatenation shows its literal parts only, and a value
moved through another variable first is not followed.

## 5. A transaction end to end

sysdef `TRANSACT` → PSB → program → `pcbs`/`sensegs` → `dli_calls` with
segment and function → `segments`/`segment_fields`.

- For each transaction code: which IMS segments it reads, inserts, replaces
  or deletes. That's a CRUD matrix per transaction.
- The same works for Db2 with `sql_columns` and the operation in it.

Status: built. The `transaction` MCP tool and *Show Transaction Data Use*
give the matrix per transaction code, over the program named like the PSB
and every program it calls; `data_use` and *Show Data Use of the Procedure*
give it per procedure, record files included. Limits: SQL statements of one kind on one table
in one procedure merge into one use, and programs called through a variable
name are not followed.

## 6. Batch chains

`steps` + `dds` + `file_io` + dataset refs.

- Which job writes a dataset and which job reads it next, down to the PL/I
  record structure.
- That shows the nightly processing order and what passes between programs.

Status: built. The `batch_chain` MCP tool and *Show Batch Chain* (the
active JCL file's jobs, the steps running the active program, else the
workspace's) give the jobs in processing order, each after the jobs whose
datasets it reads, and for each dataset a step writes (`DISP=NEW` or `MOD`,
or a program writing through the DD) who writes and who reads it, with the
generation, the DISP, the operations and the PL/I record written or read
through the DD with its fields, also from an include: KDJOB06 writes
`PROD.KD.MAHNUNG(+1)` from `MAHN_SATZ`, KDJOB07 reads it into `SATZ` with
another layout. Jobs that wait on each other come by name. Limits: datasets
nobody writes (libraries, input from outside) are left out; a DD without a
program file I/O on it counts by its DISP alone; jobs are ordered by their
datasets, not by the scheduler. The sample's DDs only read libraries, so
it has no chain; the workspace query takes 20 ms there.

## 7. Dead code and dead fields

`variables` without reads in `accesses`, procedures without incoming
`links`, statements under conditions that are never true.

- These are the safe things to drop when you replace the system.
- They also tell you which code you don't need to understand at all.

Status: built. The `dead_code` MCP tool and *Show Dead Code* (the active
file's, else the workspace's) list:
- IF, WHEN and DO WHILE conditions that are always false or true because they
  compare constants (literals, or a `STATIC INIT` nothing writes, passes or
  overlays), with the branch that never runs;
- procedures that no main or fetchable program, transaction, job or live
  caller reaches, calls from dead branches not counting;
- variables nothing live reads, those that are only written marked so.

Its limits: a call through an unresolved dynamic name and a program run
only from outside PL/I (a REXX exec, a scheduler) look dead, so check a
procedure before dropping it. Conditions joined with `|` or negated
parentheses are not decided. On the sample it finds 423 dead branches (all
"RC is always 0") and 4,270 variables, mostly the generator's unused
`OUTMSG`, in about 2 s for the whole workspace, once per graph version.

## 8. Hotspots

Counts of `accesses` and `comparisons` per variable or column, joined with
the number of procedures and transactions involved.

- The handful of fields that most of the logic depends on.
- These are good candidates for the glossary and for the experts' review
  first.

Status: built. The `hotspots` MCP tool and *Show Hotspots* (the active
program's, else the workspace's) rank the fields and the Db2 columns by the
programs, then the procedures using them, then their uses. Each row gives:
- how often the field is read, written, passed to a CALL and tested (read in
  an IF, WHEN, SELECT or DO), or how often a column is read, written and in
  a WHERE;
- its declaration and comment;
- the IMS transactions reaching it.

A field of an include is one field for all programs, so `KUNDE_SEG.KDTYP`
("KUNDENTYP: P ODER G") comes first in the fixture, in 3 programs. The page
filters by name, type, comment or transaction. On the sample the workspace
takes 640 ms, once per graph version, and the first 200 of each are shown;
the top fields are those of the generator's shared record `RBM00061`, in 18
programs. Limits: a field counts as tested only where its statement is an
IF, WHEN, SELECT or DO, not when an assignment computes a flag from it.
