// An MCP server over a workspace folder's graph, for Copilot and any other
// MCP client: stdio, one JSON-RPC message per line, read-only. The extension
// registers it with VS Code; elsewhere start it as
//
//   node out/mcp.cjs <graph .sqlite> <workspace folder>
//
// Logs go to stderr, which VS Code shows in the server's output.

import { DatabaseSync } from "node:sqlite";
import { createInterface } from "node:readline";
import { Graph } from "./graph.js";

const [graphFile, root] = process.argv.slice(2);
const log = (/** @type {string} */ text) => process.stderr.write(`${text}\n`);

const SCHEMA = `files(id, path, language: pli|jcl|hlasm|db2, member, syntax_errors: places the grammar could not read, facts there may be missing, error_line: the first, failure: why reading it failed, then it has no facts)
symbols(id, file → files, parent → symbols, kind: procedure|job|format|message|table|psb|dbd|segment|transaction|..., name, qualifier, detail: OPTIONS(...) RETURNS(...) for procedures, the operands for psb|dbd|transaction (PSB=, PGMTYPE= of its APPLCTN), comment: a procedure's, the comments right above it, line, end_line, name_line, name_col: where the name stands, col from 0)
refs(id, file → files, caller → symbols, kind: call|fetch|program|procedure|include|screen|table|psb|dbd|segment|cursor|..., name, qualifier: a table's schema, a segment's DBD, detail: SELECT|INSERT|UPDATE|DELETE for tables, DECLARE|OPEN|FETCH|CLOSE for cursors, line, col, end_line, end_col: the name's span); cursor refs are never linked
links(ref → refs, target_file → files, target_symbol → symbols or NULL for an include of the whole file); an unresolved ref has no link
steps(id, file → files, job → symbols: the job or JCL procedure, name, program: what runs, also the program DFSRRC00's PARM names, procedure, psb, parm, line)
dds(id, file → files, step → steps, name, dsn: without member or generation, member: a PDS member or GDG generation like +1, disp: NEW,CATLG,DELETE|SHR|OLD|MOD|..., attributes: the operands as written, line, dsn_line, dsn_col: where the dsn stands); a concatenation repeats the DD name
file_io(id, file → files, caller → symbols, operation: OPEN|CLOSE|READ|WRITE|REWRITE|DELETE|LOCATE|GET|PUT, name: the PL/I file, SYSIN|SYSPRINT for GET|PUT without FILE, record: INTO|FROM|SET, key: KEY|KEYTO|KEYFROM, title: OPEN TITLE, statement: as written, line); the file's DD is the one named like title or name
sql_columns(id, file → files, caller → symbols, operation: SELECT|INSERT|UPDATE|DELETE|DECLARE for a cursor's query|FETCH, cursor, schema, table_name: NULL when an unqualified column could be of several tables, column_name: * for all, NULL for COUNT(*) and the like, usage: select|where|join|group|order|having|set|insert|read, host: the host variable it goes into or is compared with, expression: the predicate, the assigned value or the select item, line); FETCH rows take their columns from the cursor's query
columns(id, file → files, table_symbol → symbols, table_name, name, type: CHAR(8)|DECIMAL(11,2)|..., not_null: 0|1, key: position in the primary key, position, line): CREATE TABLE
pcbs(id, file → files, psb → symbols, position: from 1 as written in the PSB gen, type: TP|DB|GSAM, name: PCBNAME= or label, dbd, procopt, attributes, line)
sensegs(id, file → files, pcb → pcbs, name, parent, procopt, line)
segments(id, file → files, dbd → symbols, name, parent, bytes, position: order in the DBD, line)
segment_fields(id, file → files, segment → segments, name, sequence: U|M for the key field, start: from 1, bytes, type: C|P|X|..., line)
mfs_fields(id, file → files, screen → symbols: the format or message, kind: DFLD|MFLD, name: a DFLD's label, NULL for a literal, dfld: the DFLD an MFLD maps, row, col: from 1, length, segment: an MFLD's message segment from 1, offset: of an MFLD's data in its segment after LL ZZ and any ATTR=YES bytes, label: the literal left of a DFLD on its row, literal: a literal DFLD's text or an MFLD's literal or default, attributes: the operands as written, line); only a format's first DEV
statements(id, file → files, caller → symbols, parent → statements: the statement it is in, kind: if|do|select|when|otherwise|assignment|call|return|goto|signal|on|read|write|exec|leave|..., branch: then|else in its parent IF, label, detail: the IF condition, WHEN values, SELECT subject, DO spec, ON condition, RETURN value, GOTO label, SIGNAL condition or CALL entry, line, end_line); declarations and procedures are no statements
accesses(id, statement → statements, name: the field as written, KD.TYP or TYP, mode: read|write|arg: passed to a CALL, value: the literal written, position: an argument's from 1, variable → variables: the declaration it names, through → variables: the LIKE structure when variable is the template's field)
comparisons(id, statement → statements, left, operator: =|^=|<>|<|>|<=|>=|^<|^>, right): from conditions, and a SELECT's subject = each WHEN value
literals(id, statement → statements, text: a string literal of the statement, without quotes, trailing blanks trimmed)
dli_calls(id, file → files, caller → symbols, entry: PLITDLI|CEETDLI|AIBTDLI, function: GU|GN|GNP|GHU|ISRT|REPL|DLET|CHKP|..., pcb: the PCB (AIB) passed, pcb_parameter: the main procedure's parameter the PCB comes from, its position in the PSB counting the I/O PCB, io_area, segment: the last SSA's, path: all SSA segments KUNDE/KONTO, ? for one not known, arguments, line)
variables(id, file → files, scope → symbols: the procedure, NULL in an include outside one, parent → variables: the enclosing structure, level, name, qualified: KUNDE.ADRESSE.ORT, type: CHAR|VARCHAR|BIT|PIC|FIXED DEC|FIXED BIN|FLOAT|POINTER|ENTRY|FILE|STRUCTURE|..., size: 8|11,2|99999 for PIC, dims: 12|0:9,3, storage: STATIC|AUTOMATIC|BASED|DEFINED|CONTROLLED|CONSTANT for VALUE|PARAMETER, base: the BASED pointer or DEFINED target, init: the INIT or VALUE text, like, external: 0|1, parameter: position from 1, attributes: the declaration's attribute text, comment: the comments right above it or after it on its line, line); a filler is named *`;

const TOOLS = [
  {
    name: "find_definition",
    description:
      "Where a PL/I procedure, JCL job or procedure, IMS MFS format or message, Db2 table or z/OS member is defined. Names are matched without case.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "find_references",
    description: "Every place that calls, runs, includes or uses the definition or member with this name.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "dependencies",
    description:
      "What a file needs: its includes, the tables it uses and how, what it calls or runs in other files, and the names that resolve to nothing.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "relative to the workspace folder" } }, required: ["path"] },
  },
  {
    name: "dependents",
    description: "Who needs a file: the files that include it and the definitions elsewhere that call, run or use what it defines.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "relative to the workspace folder" } }, required: ["path"] },
  },
  {
    name: "dataset",
    description:
      "Who writes and who reads a z/OS dataset: every JCL DD statement naming it, with its DISP, job, step and the program the step runs. % in the name matches anything, so PROD.KD.% finds a whole group.",
    inputSchema: { type: "object", properties: { dsn: { type: "string" } }, required: ["dsn"] },
  },
  {
    name: "program_files",
    description:
      "The files a PL/I program reads and writes (OPEN, READ, WRITE, REWRITE, DELETE, LOCATE, GET, PUT) with their records and keys, and the dataset each is in every JCL step that runs the program.",
    inputSchema: { type: "object", properties: { program: { type: "string", description: "the program's member name" } }, required: ["program"] },
  },
  {
    name: "table_columns",
    description:
      "A Db2 table's columns with their types, and for each column every embedded SQL statement that selects, compares, sets or inserts it, with the host variable it goes into or comes from.",
    inputSchema: { type: "object", properties: { table: { type: "string", description: "without schema" } }, required: ["table"] },
  },
  {
    name: "psb",
    description:
      "An IMS PSB, or the PSB of a transaction code: its PCBs in order with their type, DBD and PROCOPT, the segments each may access with their length and key, and the jobs and transactions using the PSB.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "a PSB name or transaction code" } }, required: ["name"] },
  },
  {
    name: "screen",
    description:
      "An IMS MFS format, or the format of a message: each screen field with its position, length, attributes and the label left of it, each message's fields in order with their segment and byte offset (where they are in the program's I/O area), and the PL/I members naming the screen.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "a format or message name" } }, required: ["name"] },
  },
  {
    name: "dli",
    description:
      "A program's IMS DL/I calls: the function, the segments its SSAs name, the PCB and I/O area, each PCB matched to the PCB it is in the PSBs the program runs under.",
    inputSchema: { type: "object", properties: { program: { type: "string" } }, required: ["program"] },
  },
  {
    name: "field",
    description:
      "A PL/I field's business rules: every statement that sets it (with the literal it gets), passes it to a CALL or compares it, each with the IF, WHEN, DO and ON conditions it happens under, outermost first. Matches the field however it is qualified.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "a field name without qualification" } }, required: ["name"] },
  },
  {
    name: "lineage",
    description:
      "Where a PL/I variable's value comes from and where it goes, one step each way: the fields or literals assigned to it, the fields it is assigned to, statements like READ INTO that set it, the parameters it is passed to and, for a parameter, the arguments its callers pass. Follow a field step by step by asking again for the names it shows.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "a variable, qualified as far as wanted: KDNR or MSG.KDNR" } }, required: ["name"] },
  },
  {
    name: "text",
    description:
      "Where a word or code shows up in the program text: the comments above procedures and on declarations, and the string literals of statements (messages, report text, error codes), with the field a literal is assigned to or the entry it is passed to. Ignores case and matches part of the text.",
    inputSchema: { type: "object", properties: { text: { type: "string", description: "a word, phrase or message code: Kredit, GESPERRT, KDE001" } }, required: ["text"] },
  },
  {
    name: "get_source",
    description: "The source of a definition, with line numbers.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "query_graph",
    description: `A read-only SQLite query over the code graph; at most 500 rows come back. Lines count from 1, columns from 0, paths are relative to the workspace folder. Tables:\n${SCHEMA}`,
    inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
  },
];

/** @type {Graph | undefined} */
let graph;

/** The worker may not have written the graph yet, so it is opened on first use. */
function open() {
  if (graph) return graph;
  const db = new DatabaseSync(graphFile, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 2000");
  graph = new Graph(db, root);
  log(`graph ${graphFile} for ${root}`);
  return graph;
}

/** @typedef {{ kind: string, name: string, path: string, line: number, end: number, parent: string | null }} Defined */

/** @param {string} name @returns {Defined[]} */
function defined(name) {
  return open().all(
    `SELECT s.kind, s.name, f.path, s.line, s.end_line AS end, p.name AS parent
     FROM symbols s JOIN files f ON f.id = s.file LEFT JOIN symbols p ON p.id = s.parent
     WHERE s.name = ? ORDER BY f.path, s.line`,
    name.toUpperCase(),
  );
}

/** @param {string} name @param {Record<string, string>} args @returns {string} */
function call(name, args) {
  if (name === "find_definition") {
    const rows = defined(args.name).map((d) => `${d.kind} ${d.name}${d.parent ? ` in ${d.parent}` : ""}: ${d.path}:${d.line}-${d.end}`);
    const members = /** @type {{ path: string, language: string }[]} */ (
      open().all(`SELECT path, language FROM files WHERE member = ? ORDER BY path`, args.name.toUpperCase())
    ).map((f) => `member (${f.language}): ${f.path}`);
    return [...rows, ...members].join("\n") || `Nothing named ${args.name} is defined.`;
  }
  if (name === "find_references") {
    const rows = /** @type {{ kind: string, detail: string | null, path: string, line: number, caller: string | null }[]} */ (
      open().all(
        `SELECT DISTINCT r.kind, r.detail, f.path, r.line, c.name AS caller
         FROM links l JOIN refs r ON r.id = l.ref JOIN files f ON f.id = r.file LEFT JOIN symbols c ON c.id = r.caller
         LEFT JOIN symbols t ON t.id = l.target_symbol JOIN files tf ON tf.id = l.target_file
         WHERE t.name = ?1 OR (l.target_symbol IS NULL AND tf.member = ?1) ORDER BY f.path, r.line`,
        args.name.toUpperCase(),
      )
    );
    return (
      rows.map((r) => `${r.kind}${r.detail ? ` ${r.detail}` : ""} from ${r.caller ?? "the file"}: ${r.path}:${r.line}`).join("\n") ||
      `Nothing references ${args.name}.`
    );
  }
  if (name === "dependencies" || name === "dependents") {
    const graph = open();
    const top = graph.root(args.path);
    if (!top) return `${args.path} is not in the graph.`;
    const rows = name === "dependencies" ? graph.dependencies(top) : graph.dependents(top);
    return (
      rows.map((r) => `${r.label}${r.detail ? ` (${r.detail})` : ""}${r.target ? `: ${r.target.path}:${r.target.line}` : ""}`).join("\n") ||
      `${args.path} has no ${name}.`
    );
  }
  if (name === "dataset") {
    const rows = open().datasetUsers(args.dsn.toUpperCase());
    return (
      rows
        .map(
          (d) =>
            `${d.dsn}${d.member ? `(${d.member})` : ""} DISP=${d.disp ?? "-"} as ${d.dd} in ${d.job ?? "?"} step ${d.step ?? "?"} running ${d.program ?? `procedure ${d.procedure ?? "?"}`}: ${d.path}:${d.line}`,
        )
        .join("\n") || `No DD statement names ${args.dsn}.`
    );
  }
  if (name === "program_files") {
    const files = open().programFiles(args.program.toUpperCase());
    return (
      files
        .map((f) => {
          const head = `${f.name}${f.dd !== f.name ? ` (DD ${f.dd})` : ""}: ${f.operations.join(", ")}${f.records.length ? ` record ${f.records.join(", ")}` : ""}${f.keys.length ? ` key ${f.keys.join(", ")}` : ""}`;
          const dds = f.dds.map(
            (d) => `  ${d.job ?? "?"} step ${d.step ?? "?"}: ${d.dsn ? `${d.dsn}${d.member ? `(${d.member})` : ""} DISP=${d.disp}` : "no dataset"}, ${d.path}:${d.line}`,
          );
          return [head, ...(dds.length ? dds : ["  in no JCL step running the program"])].join("\n");
        })
        .join("\n") || `${args.program} does no file I/O of its own.`
    );
  }
  if (name === "table_columns") {
    const columns = open().tableColumns(args.table.toUpperCase());
    return (
      columns
        .map((c) => {
          const head = `${c.name || "(no column)"}${c.type ? ` ${c.type}${c.notNull ? " NOT NULL" : ""}${c.key ? ` key ${c.key}` : ""}` : " (not in any CREATE TABLE)"}`;
          const uses = c.uses.map(
            (u) =>
              `  ${u.operation}${u.cursor ? ` ${u.cursor}` : ""} ${u.usage}${u.expression ? ` ${u.expression}` : ""}${u.host ? ` ${u.usage === "select" ? "into" : "with"} :${u.host}` : ""} in ${u.caller ?? "the file"}: ${u.path}:${u.line}`,
          );
          return [head, ...(uses.length ? uses : ["  used by no SQL statement"])].join("\n");
        })
        .join("\n") || `No table ${args.table} has columns or column uses.`
    );
  }
  if (name === "psb") {
    const layout = open().psbLayout(args.name.toUpperCase());
    const lines = layout.psbs.flatMap((psb) => [
      `PSB ${psb.name}${psb.detail ? ` (${psb.detail})` : ""}: ${psb.path}:${psb.line}`,
      ...psb.pcbs.flatMap((pcb) => [
        `  PCB ${pcb.position} ${pcb.type}${pcb.name ? ` ${pcb.name}` : ""}${pcb.dbd ? ` DBD ${pcb.dbd}` : ""}${pcb.procopt ? ` PROCOPT=${pcb.procopt}` : ""}`,
        ...pcb.segments.map(
          (s) =>
            `    ${s.name}${s.parent ? ` under ${s.parent}` : ""}${s.procopt ? ` PROCOPT=${s.procopt}` : ""}${s.bytes ? ` ${s.bytes} bytes` : ""}${s.key ? ` key ${s.key}` : ""}`,
        ),
      ]),
    ]);
    if (!lines.length) lines.push(`No PSB gen defines ${layout.name}.`);
    lines.push(...layout.users.map((u) => `used by ${u.kind ?? "file"} ${u.name ?? ""}: ${u.path}:${u.line}`));
    return lines.join("\n");
  }
  if (name === "screen") {
    const { format, users, screens } = open().screenFields(args.name.toUpperCase());
    if (screens.length === 0) return `No MFS format or message ${args.name}.`;
    const labels = new Map(screens.flatMap((s) => s.fields).filter((f) => f.name && f.label).map((f) => [f.name, f.label]));
    const lines = screens.flatMap((s) => [
      `${s.kind === "format" ? "FMT" : "MSG"} ${s.name}: ${s.path}:${s.line}`,
      ...s.fields.map((f) => {
        if (s.kind === "format") {
          const attr = /ATTR=(\([^)]*\)|\w+)/i.exec(f.attributes)?.[0];
          const where = `at ${f.row ?? "?"},${f.col ?? "?"}`;
          if (f.literal !== null) return `  '${f.literal}' ${where}`;
          return `  ${f.name ?? "?"} ${where} length ${f.length ?? "?"}${f.label ? ` label '${f.label}'` : ""}${attr ? ` ${attr}` : ""}`;
        }
        const label = f.dfld ? labels.get(f.dfld) : undefined;
        const what = f.dfld ? `${f.dfld}${label ? ` label '${label}'` : ""}${f.literal !== null ? ` default '${f.literal}'` : ""}` : `'${f.literal ?? ""}'`;
        return `  segment ${f.segment} offset ${f.offset} length ${f.length ?? "?"} ${what}`;
      }),
    ]);
    if (!screens.some((s) => s.kind === "format")) lines.unshift(`No format ${format} is defined.`);
    lines.push(...users.map((u) => `named as ${u.name} in ${u.path}:${u.line}`));
    return lines.join("\n");
  }
  if (name === "dli") {
    const { calls, psbs } = open().programDli(args.program.toUpperCase());
    if (calls.length === 0) return `${args.program} makes no DL/I calls of its own.`;
    /** @param {(typeof calls)[number]} c @param {string} pcb @param {boolean} [message] a message PCB, whose path is a destination */
    const line = (c, pcb, message = false) =>
      `  ${c.function ?? "?"}${c.path ? ` ${message ? "MOD " : ""}${c.path}` : ""} on ${c.pcb ?? "?"}${pcb} I/O area ${c.io_area ?? "-"} in ${c.caller ?? "the file"}: ${c.file}:${c.line}`;
    if (psbs.length === 0) {
      return [`${args.program} runs under no known PSB.`, ...calls.map((c) => line(c, c.pcb_parameter ? ` (parameter ${c.pcb_parameter})` : ""))].join("\n");
    }
    return psbs
      .flatMap((psb) => [
        `PSB ${psb.name} as ${psb.uses.join(", ")}${psb.defined ? "" : " (no PSB gen)"}${psb.ioPcb ? "" : ", no I/O PCB"}`,
        ...calls.map((c) => {
          if (!c.pcb_parameter) return line(c, "");
          const position = c.pcb_parameter - (psb.ioPcb ? 1 : 0);
          if (position === 0) return line(c, " = I/O PCB", true);
          const pcb = psb.pcbs.find((p) => p.position === position);
          if (!pcb) return line(c, ` = PCB ${position}, not in the PSB`);
          return line(c, ` = PCB ${position} ${pcb.type}${pcb.name ? ` ${pcb.name}` : ""}${pcb.dbd ? ` DBD ${pcb.dbd}` : ""}${pcb.procopt ? ` PROCOPT=${pcb.procopt}` : ""}`, pcb.type === "TP");
        }),
      ])
      .join("\n");
  }
  if (name === "field") {
    const sites = open().fieldUses(args.name.toUpperCase());
    if (sites.length === 0) return `No statement sets, passes or compares ${args.name}.`;
    return sites
      .map((site) => {
        let what = `compares ${site.name} ${site.operator} ${site.other}`;
        if (site.mode === "arg") what = `passes ${site.name} to ${site.detail ?? "?"}`;
        else if (site.mode === "write" && site.value !== null) what = `sets ${site.name} = ${site.value}`;
        else if (site.mode === "write") what = `sets ${site.name} by ${site.kind === "assignment" ? "an assignment" : site.kind.toUpperCase()}`;
        const guards = site.guards.flatMap((g) => {
          if (g.kind === "if") return [g.via === "else" ? `NOT (${g.detail})` : `${g.detail}`];
          if (g.kind === "when") return [g.subject ? `${g.subject} = ${g.detail}` : `${g.detail}`];
          if (g.kind === "otherwise") return [g.subject ? `OTHERWISE of SELECT (${g.subject})` : "OTHERWISE"];
          if (g.kind === "do" && g.detail) return [`DO ${g.detail}`];
          if (g.kind === "on") return [`ON ${g.detail}`];
          return [];
        });
        return `${what} in ${site.caller ?? "the file"}: ${site.path}:${site.line}${guards.length ? ` when ${guards.join("; ")}` : ""}`;
      })
      .join("\n");
  }
  if (name === "lineage") {
    const variables = open().fieldLineage(args.name.toUpperCase());
    if (variables.length === 0) return `No variable ${args.name} is declared.`;
    /** @param {string | null} written @param {string | null} qualified */
    const field = (written, qualified) => (qualified && qualified !== written ? `${written} (${qualified})` : `${written}`);
    /** @param {{ caller: string | null, path: string, line: number }} site */
    const at = (site) => `in ${site.caller ?? "the file"}: ${site.path}:${site.line}`;
    return variables
      .flatMap((v) => [
        `${v.qualified}${v.parameter ? ` parameter ${v.parameter}` : ""}${v.scope ? ` of ${v.scope}` : ""}: ${v.path}:${v.line}`,
        ...v.receives.map((r) => `  from ${field(r.name, r.qualified)} passed ${at(r)}`),
        ...v.moves.map((m) => {
          // A LIKE structure's field is the template's, so say which copy.
          const copy = m.copy ? `as ${m.copy} ` : "";
          if (m.mode === "read") return `  ${copy}to ${field(m.name, m.qualified)} ${at(m)}`;
          if (m.name) return `  ${copy}from ${field(m.name, m.qualified)} ${at(m)}`;
          if (m.value !== null) return `  ${copy}from ${m.value} ${at(m)}`;
          return `  ${copy}set by ${m.kind === "assignment" ? "an assignment" : m.kind.toUpperCase()} ${at(m)}`;
        }),
        ...v.passes.map((p) => `  to ${p.callee ?? "?"} ${p.parameter ? `parameter ${p.parameter}` : `argument ${p.position}`} ${at(p)}`),
      ])
      .join("\n");
  }
  if (name === "text") {
    const found = open().textSearch(args.text);
    if (found.length === 0) return `No comment or literal contains ${args.text}.`;
    return found
      .map((t) => {
        if (t.what !== "literal") return `${t.what} ${t.name}: ${t.path}:${t.line}: ${t.text}`;
        let use = `in ${t.kind === "assignment" ? "an assignment" : t.kind?.toUpperCase()}`;
        if (t.kind === "assignment" && t.target) use = `assigned to ${t.target}`;
        else if (t.kind === "call" && t.detail) use = `passed to ${t.detail}`;
        return `'${t.text}' ${use} in ${t.caller ?? "the file"}: ${t.path}:${t.line}`;
      })
      .join("\n");
  }
  if (name === "get_source") {
    const found = defined(args.name);
    if (found.length === 0) return `Nothing named ${args.name} is defined.`;
    return found
      .map((d) => {
        const lines = (open().read(d.path) ?? "").split("\n").slice(d.line - 1, d.end);
        return `${d.kind} ${d.name}, ${d.path}:\n${lines.map((text, i) => `${String(d.line + i).padStart(6)}  ${text}`).join("\n")}`;
      })
      .join("\n\n");
  }
  if (name === "query_graph") {
    // A query over every access can return millions of rows; only the first 500 are read.
    const rows = [];
    for (const row of open().db.prepare(args.sql).iterate()) if (rows.push(row) >= 500) break;
    return JSON.stringify(rows);
  }
  throw new Error(`no tool ${name}`);
}

/** @param {any} message @returns {object | undefined} the result, or nothing for a notification */
function answer(message) {
  if (message.method === "initialize") {
    return {
      protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "pli-graph", version: "0.1.0" },
      instructions:
        "A code graph of an IMS / z/OS code base in PL/I, JCL, IMS MFS and Db2 DDL, kept up to date by the PL/I Graph extension. Ask it where things are defined, who calls or uses them and what a file depends on before reading files.",
    };
  }
  if (message.method === "tools/list") return { tools: TOOLS };
  if (message.method === "tools/call") {
    const { name, arguments: args } = message.params;
    try {
      log(`call ${name} ${JSON.stringify(args)}`);
      return { content: [{ type: "text", text: call(name, args ?? {}) }] };
    } catch (error) {
      const text = `[PLG020E] ${name} failed: ${error instanceof Error ? error.message : error}`;
      log(text);
      return { content: [{ type: "text", text }], isError: true };
    }
  }
  if (message.method === "ping") return {};
  return undefined;
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  /** @type {any} */
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    log(`[PLG021E] Not JSON: ${line.slice(0, 200)}`);
    return;
  }
  if (message.id === undefined) return;
  const result = answer(message);
  const reply =
    result === undefined
      ? { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `no method ${message.method}` } }
      : { jsonrpc: "2.0", id: message.id, result };
  process.stdout.write(`${JSON.stringify(reply)}\n`);
});
log(`PL/I Graph MCP server for ${root}`);
