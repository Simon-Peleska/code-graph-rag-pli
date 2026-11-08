// Answers the editor's questions straight from the SQLite graph that
// `cgr watch` keeps up to date. Knows nothing about VS Code, so tests can use it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { languageOf, sqlOperation } from "./source.ts";

export interface Target {
  path: string;
  line: number;
}

// Where a call or %INCLUDE is: lines from 1, columns from 0, as cgr stores them.
export interface Site {
  path: string;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
}

// A procedure, program, table or screen and where it is defined.
export interface Definition {
  name: string;
  path: string;
  line: number;
  end: number;
}

// One row in the Dependencies or Dependents tree. `module` is the node id of
// the file the row expands into.
export interface TreeRow {
  kind: "file" | "include" | "call" | "table" | "includedBy" | "calledBy" | "unresolved";
  label: string;
  // What a program does with a table: SELECT, UPDATE, ...
  detail?: string;
  module?: number;
  target?: Target;
  parent?: TreeRow;
  repeated: boolean;
}

export interface GraphNode {
  id: string;
  kind: string;
  name: string;
  path?: string;
  line?: number;
  end?: number;
  mods?: string[];
  unresolved?: string[];
}

export interface WholeGraph {
  project: string;
  nodes: GraphNode[];
  // Source and target are positions in `nodes`: names repeated in every edge
  // made the page for 20,000 files 43 MB instead of 24.
  edges: [number, string, number][];
}

const KIND: Record<string, string> = {
  Module: "module",
  ExternalModule: "external",
  Class: "class",
  Function: "function",
  Method: "method",
};

interface NodeRow {
  id: number;
  label: string;
  name: string;
  path: string | null;
  line: number | null;
  end: number | null;
}

const NODE = `n.id, n.label, json_extract(n.props, '$."name"') AS name,
  replace(json_extract(n.props, '$.path'), '\\', '/') AS path,
  json_extract(n.props, '$.start_line') AS line, json_extract(n.props, '$.end_line') AS end`;
// Everything a module defines, nested procedures and package methods included.
const OWNED = `WITH RECURSIVE owned(id) AS (
  SELECT ? UNION SELECT e.dst FROM cgr_edges e JOIN owned ON e.src = owned.id
  WHERE e.type IN ('DEFINES', 'DEFINES_METHOD'))`;

// `%INCLUDE SHOPDCL` names the file shopdcl.pli.
const memberName = (name: string) => name.replace(/\.[^.]*$/, "").toUpperCase();
const byLabel = (a: TreeRow, b: TreeRow) => a.label.localeCompare(b.label);
const sameFolder = (a: string, b: string) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

export class Graph {
  readonly project: string;
  // Reads a file of the project; the extension hands in the open editors' text.
  read: (path: string) => string | undefined;
  private readonly db: DatabaseSync;
  private readonly prefix: string;
  private readonly statements = new Map<string, StatementSync>();

  // Throws when cgr has not synced `root` into this database yet.
  constructor(db: DatabaseSync, root: string) {
    this.db = db;
    const projects = this.all<{ key: string; root: string }>(
      `SELECT key, json_extract(props, '$.root_path') AS root FROM cgr_nodes WHERE label = 'Project'`,
    );
    const project = projects.find((p) => p.root && sameFolder(p.root, root));
    if (!project) {
      throw new Error(`no project for ${root} in the graph yet`);
    }
    this.project = project.key;
    this.prefix = `${project.key}.`;
    this.read = (path) => {
      try {
        return readFileSync(join(root, path), "utf-8");
      } catch {
        return undefined;
      }
    };
  }

  // Bumped by cgr on every write.
  static version(db: DatabaseSync): string | undefined {
    const row = db.prepare(`SELECT value FROM cgr_meta WHERE name = 'graph_version'`).get() as
      | { value: string }
      | undefined;
    return row?.value;
  }

  private all<T>(sql: string, ...params: (string | number)[]): T[] {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement.all(...params) as T[];
  }

  private target(node: NodeRow): Target | undefined {
    return node.path ? { path: node.path, line: node.line ?? 1 } : undefined;
  }

  // Finding a module by its path scans every module, so they are mapped once
  // per graph version.
  private modules?: { version: string | undefined; byPath: Map<string, NodeRow> };

  module(path: string): NodeRow | undefined {
    const version = Graph.version(this.db);
    if (!this.modules || this.modules.version !== version) {
      const byPath = new Map<string, NodeRow>();
      const rows = this.all<NodeRow>(
        `SELECT ${NODE} FROM cgr_nodes n WHERE n.label = 'Module' AND substr(n.key, 1, ?) = ?`,
        this.prefix.length,
        this.prefix,
      );
      for (const row of rows) {
        if (row.path) byPath.set(row.path, row);
      }
      this.modules = { version, byPath };
    }
    return this.modules.byPath.get(path);
  }

  private procedures(module: number): NodeRow[] {
    return this.all<NodeRow>(
      `${OWNED} SELECT ${NODE} FROM owned JOIN cgr_nodes n ON n.id = owned.id
       WHERE n.label IN ('Function', 'Method')`,
      module,
    );
  }

  private moduleOf(id: number): number | undefined {
    return this.all<{ id: number }>(
      `WITH RECURSIVE up(id) AS (
         SELECT ? UNION SELECT e.src FROM cgr_edges e JOIN up ON e.dst = up.id
         WHERE e.type IN ('DEFINES', 'DEFINES_METHOD'))
       SELECT n.id FROM up JOIN cgr_nodes n ON n.id = up.id WHERE n.label = 'Module'`,
      id,
    )[0]?.id;
  }

  private callees(id: number): NodeRow[] {
    return this.all<NodeRow>(
      `SELECT ${NODE} FROM cgr_edges e JOIN cgr_nodes n ON n.id = e.dst WHERE e.src = ? AND e.type = 'CALLS'`,
      id,
    );
  }

  // The procedures `id` calls, once per call, with the lines of the call.
  private calleeSites(id: number): (NodeRow & { site: number | null; siteEnd: number | null })[] {
    return this.all<NodeRow & { site: number | null; siteEnd: number | null }>(
      `SELECT ${NODE}, json_extract(e.props, '$.line') AS site, json_extract(e.props, '$.end_line') AS siteEnd
       FROM cgr_edges e JOIN cgr_nodes n ON n.id = e.dst WHERE e.src = ? AND e.type = 'CALLS'`,
      id,
    );
  }

  private includes(module: number): NodeRow[] {
    return this.all<NodeRow>(
      `SELECT ${NODE} FROM cgr_edges e JOIN cgr_nodes n ON n.id = e.dst WHERE e.src = ? AND e.type = 'IMPORTS'`,
      module,
    );
  }

  // The files `path` includes (%INCLUDE, JCL INCLUDE, HLASM COPY) and the
  // line of each include.
  includedFiles(path: string): { path: string; line: number }[] {
    const module = this.module(path);
    return this.all<{ path: string | null; line: number | null }>(
      `SELECT replace(json_extract(n.props, '$.path'), '\\', '/') AS path, json_extract(e.props, '$.line') AS line
       FROM cgr_edges e JOIN cgr_nodes n ON n.id = e.dst
       WHERE e.src = ? AND e.type = 'IMPORTS' AND n.label = 'Module'`,
      module?.id ?? -1,
    ).flatMap((row) => (row.path ? [{ path: row.path, line: row.line ?? 1 }] : []));
  }

  // The files that include `path`.
  includingFiles(path: string): string[] {
    const module = this.module(path);
    return this.all<{ path: string | null }>(
      `SELECT replace(json_extract(n.props, '$.path'), '\\', '/') AS path
       FROM cgr_edges e JOIN cgr_nodes n ON n.id = e.src WHERE e.dst = ? AND e.type = 'IMPORTS'`,
      module?.id ?? -1,
    ).flatMap((row) => (row.path ? [row.path] : []));
  }

  // The procedures of a file with the lines they span.
  blocks(path: string): Definition[] {
    const module = this.module(path);
    return (module ? this.procedures(module.id) : []).flatMap((node) =>
      node.path && node.line ? [{ name: node.name, path: node.path, line: node.line, end: node.end ?? node.line }] : [],
    );
  }

  // The programs, jobs and procedures, tables and screens of one language:
  // what a file defines at its top level, not the procedures nested inside.
  topLevel(language: string): Definition[] {
    return this.all<NodeRow>(
      `SELECT ${NODE} FROM cgr_nodes m JOIN cgr_edges d ON d.src = m.id AND d.type = 'DEFINES'
       JOIN cgr_nodes n ON n.id = d.dst
       WHERE m.label = 'Module' AND substr(m.key, 1, ?) = ? AND n.label IN ('Function', 'Method')`,
      this.prefix.length,
      this.prefix,
    ).flatMap((node) =>
      node.path && node.line && languageOf(node.path) === language
        ? [{ name: node.name, path: node.path, line: node.line, end: node.end ?? node.line }]
        : [],
    );
  }

  // The Db2 tables and views the procedures of `path` use.
  tablesOf(path: string): Definition[] {
    const module = this.module(path);
    const seen = new Set<string>();
    return (module ? this.procedures(module.id) : []).flatMap((procedure) =>
      this.callees(procedure.id).flatMap((node) => {
        if (!node.path || !node.line || languageOf(node.path) !== "db2" || seen.has(`${node.path}:${node.line}`)) {
          return [];
        }
        seen.add(`${node.path}:${node.line}`);
        return [{ name: node.name, path: node.path, line: node.line, end: node.end ?? node.line }];
      }),
    );
  }

  // The files whose procedures use the table or view `name` defined in `path`.
  tableUsers(path: string, name: string): string[] {
    return this.all<{ path: string | null }>(
      `SELECT DISTINCT replace(json_extract(n.props, '$.path'), '\\', '/') AS path
       FROM cgr_nodes t JOIN cgr_edges e ON e.dst = t.id AND e.type = 'CALLS' JOIN cgr_nodes n ON n.id = e.src
       WHERE t.label = 'Function' AND substr(t.key, 1, ?) = ?
       AND replace(json_extract(t.props, '$.path'), '\\', '/') = ? AND upper(json_extract(t.props, '$."name"')) = ?`,
      this.prefix.length,
      this.prefix,
      path,
      name.toUpperCase(),
    ).flatMap((row) => (row.path ? [row.path] : []));
  }

  // What the SQL at a call site does with `table`.
  private operation(path: string, line: number, end: number, table: string): string | undefined {
    const text = this.read(path);
    if (text === undefined) {
      return undefined;
    }
    const statement = text.split("\n").slice(line - 1, end).join("\n");
    return sqlOperation(statement, table);
  }

  // The innermost procedure of the file whose lines contain `line`.
  procedureAt(path: string, line: number): NodeRow | undefined {
    const module = this.module(path);
    let found: NodeRow | undefined;
    for (const procedure of module ? this.procedures(module.id) : []) {
      const start = procedure.line ?? 0;
      const end = procedure.end ?? start;
      if (start <= line && line <= end && (!found || start >= (found.line ?? 0))) {
        found = procedure;
      }
    }
    return found;
  }

  // The procedures or included files `word` at `path`:`line` names. cgr
  // already resolved the calls of the procedure around the cursor (includes
  // first, then the rest of the repository), so its edges answer first; plain
  // name matches are the fallback, unless `byName` is false.
  private named(path: string, line: number, word: string, byName: boolean): NodeRow[] {
    const name = word.toUpperCase();
    const here = this.procedureAt(path, line);
    const called = here ? this.callees(here.id).filter((node) => node.name.toUpperCase() === name) : [];
    if (called.length > 0) {
      return called;
    }
    const module = this.module(path);
    const included = (module ? this.includes(module.id) : []).filter(
      (node) => node.label === "Module" && memberName(node.name) === name,
    );
    if (included.length > 0 || !byName) {
      return included;
    }
    const named = this.all<NodeRow & { key: string }>(
      `SELECT ${NODE}, n.key FROM cgr_nodes n
       WHERE n.label IN ('Function', 'Method') AND json_extract(n.props, '$."name"') = ?`,
      name,
    ).filter((node) => node.key.startsWith(this.prefix));
    const sameFile = named.filter((node) => node.path === path);
    return sameFile.length > 0 ? sameFile : named;
  }

  // Where `word` at `path`:`line` is defined; an included file at its top.
  definitions(path: string, line: number, word: string, byName = true): Target[] {
    return this.named(path, line, word, byName).flatMap((node) =>
      node.label === "Module" ? (node.path ? [{ path: node.path, line: 1 }] : []) : (this.target(node) ?? []),
    );
  }

  // Every call of the procedure `word` at `path`:`line` names, or every
  // %INCLUDE of the file, where cgr found it.
  references(path: string, line: number, word: string, byName = true): Site[] {
    const sites = new Map<string, Site>();
    for (const node of this.named(path, line, word, byName)) {
      const rows = this.all<Site>(
        `SELECT replace(json_extract(n.props, '$.path'), '\\', '/') AS path,
           json_extract(e.props, '$.line') AS line, json_extract(e.props, '$.col') AS col,
           json_extract(e.props, '$.end_line') AS endLine, json_extract(e.props, '$.end_col') AS endCol
         FROM cgr_edges e JOIN cgr_nodes n ON n.id = e.src WHERE e.dst = ? AND e.type = ?`,
        node.id,
        node.label === "Module" ? "IMPORTS" : "CALLS",
      );
      for (const site of rows) {
        if (site.path && site.line) {
          sites.set(`${site.path}:${site.line}:${site.col}`, site);
        }
      }
    }
    return [...sites.values()];
  }

  root(path: string): TreeRow | undefined {
    const module = this.module(path);
    if (!module) {
      return undefined;
    }
    return { kind: "file", label: module.name, module: module.id, target: { path, line: 1 }, repeated: false };
  }

  // What the row's file needs: its includes, the procedures it calls in other
  // files, and the names cgr could not resolve.
  dependencies(row: TreeRow): TreeRow[] {
    if (row.module === undefined || row.repeated) {
      return [];
    }
    const rows: TreeRow[] = [];
    const missing: TreeRow[] = [];
    for (const node of this.includes(row.module)) {
      if (node.label !== "Module" || !node.path) {
        // cgr found no file for the member; its node is named after it.
        missing.push({ kind: "unresolved", label: `%INCLUDE ${node.name}`, parent: row, repeated: false });
        continue;
      }
      rows.push(this.row(row, "include", node.name, node.id, { path: node.path, line: 1 }));
    }
    rows.push(...missing.sort(byLabel));

    const owned = this.procedures(row.module);
    const ownedIds = new Set(owned.map((node) => node.id));
    const seen = new Set<number>();
    const calls: TreeRow[] = [];
    const tables = new Map<number, { row: TreeRow; operations: Set<string> }>();
    for (const procedure of owned) {
      for (const callee of this.calleeSites(procedure.id)) {
        if (ownedIds.has(callee.id)) {
          continue;
        }
        if (callee.path && languageOf(callee.path) === "db2") {
          let table = tables.get(callee.id);
          if (!table) {
            const tableRow = this.row(row, "table", `TABLE ${callee.name}`, this.moduleOf(callee.id), this.target(callee));
            table = { row: tableRow, operations: new Set() };
            tables.set(callee.id, table);
          }
          const operation = procedure.path && callee.site
            ? this.operation(procedure.path, callee.site, callee.siteEnd ?? callee.site, callee.name)
            : undefined;
          if (operation) table.operations.add(operation);
          continue;
        }
        if (seen.has(callee.id)) {
          continue;
        }
        seen.add(callee.id);
        calls.push(this.row(row, "call", `CALL ${callee.name}`, this.moduleOf(callee.id), this.target(callee)));
      }
    }
    for (const { row: tableRow, operations } of tables.values()) {
      tableRow.detail = [...operations].sort().join(", ");
    }
    rows.push(...[...tables.values()].map((table) => table.row).sort(byLabel));
    rows.push(...calls.sort(byLabel));

    const unresolved = this.all<{ names: string | null }>(
      `SELECT json_extract(props, '$.unresolved_references') AS names FROM cgr_nodes WHERE id = ?`,
      row.module,
    )[0]?.names;
    for (const name of (JSON.parse(unresolved ?? "[]") as string[]).sort()) {
      rows.push({ kind: "unresolved", label: `CALL ${name}`, parent: row, repeated: false });
    }
    return rows;
  }

  // Who needs the row's file: files that include it, and procedures in other
  // files that call into it.
  dependents(row: TreeRow): TreeRow[] {
    if (row.module === undefined || row.repeated) {
      return [];
    }
    const rows = this.all<NodeRow>(
      `SELECT ${NODE} FROM cgr_edges e JOIN cgr_nodes n ON n.id = e.src WHERE e.dst = ? AND e.type = 'IMPORTS'`,
      row.module,
    ).map((node) => this.row(row, "includedBy", node.name, node.id, { path: node.path ?? "", line: 1 }));

    const callers = this.all<NodeRow & { callee: string; calleeId: number; site: number | null; siteEnd: number | null }>(
      `${OWNED} SELECT ${NODE}, json_extract(callee.props, '$."name"') AS callee, callee.id AS calleeId,
         json_extract(e.props, '$.line') AS site, json_extract(e.props, '$.end_line') AS siteEnd
       FROM owned JOIN cgr_nodes callee ON callee.id = owned.id
       JOIN cgr_edges e ON e.dst = owned.id AND e.type = 'CALLS'
       JOIN cgr_nodes n ON n.id = e.src`,
      row.module,
    );
    const tables = row.target && languageOf(row.target.path) === "db2";
    const calls = new Map<string, { row: TreeRow; operations: Set<string> }>();
    for (const caller of callers) {
      const module = this.moduleOf(caller.id);
      if (module === row.module) {
        continue;
      }
      // A file of tables lists each table a caller uses; any other file each caller once.
      const key = tables ? `${caller.id}:${caller.calleeId}` : `${caller.id}`;
      let call = calls.get(key);
      if (!call) {
        call = {
          row: this.row(row, "calledBy", `${caller.name} → ${caller.callee}`, module, this.target(caller)),
          operations: new Set(),
        };
        calls.set(key, call);
      }
      const operation = tables && caller.path && caller.site
        ? this.operation(caller.path, caller.site, caller.siteEnd ?? caller.site, caller.callee)
        : undefined;
      if (operation) call.operations.add(operation);
    }
    for (const call of calls.values()) {
      if (call.operations.size > 0) call.row.detail = [...call.operations].sort().join(", ");
    }
    return [...rows.sort(byLabel), ...[...calls.values()].map((call) => call.row).sort(byLabel)];
  }

  // The whole project in the shape viz/graph.template.html reads, the same
  // viz/build_graph_site.py writes from a `cgr index`.
  whole(): WholeGraph {
    const nodes: GraphNode[] = [];
    const position = new Map<number, number>();
    const rows = this.all<{
      id: number;
      label: string;
      key: string;
      name: string | null;
      path: string | null;
      line: number | null;
      end: number | null;
      mods: string | null;
      unresolved: string | null;
    }>(
      `SELECT n.id, n.label, n.key, json_extract(n.props, '$."name"') AS name,
         replace(json_extract(n.props, '$.path'), '\\', '/') AS path,
         json_extract(n.props, '$.start_line') AS line, json_extract(n.props, '$.end_line') AS end,
         json_extract(n.props, '$.modifiers') AS mods, json_extract(n.props, '$.unresolved_references') AS unresolved
       FROM cgr_nodes n WHERE n.label IN ('Module', 'Class', 'Function', 'Method') AND substr(n.key, 1, ?) = ?
       UNION
       SELECT n.id, n.label, n.key, json_extract(n.props, '$."name"'), NULL, NULL, NULL, NULL, NULL
       FROM cgr_nodes m JOIN cgr_edges e ON e.src = m.id AND e.type = 'IMPORTS' JOIN cgr_nodes n ON n.id = e.dst
       WHERE m.label = 'Module' AND substr(m.key, 1, ?) = ? AND n.label = 'ExternalModule'`,
      this.prefix.length,
      this.prefix,
      this.prefix.length,
      this.prefix,
    );
    for (const row of rows) {
      const node: GraphNode = { id: row.key, kind: KIND[row.label], name: row.name ?? row.key };
      if (row.path) node.path = row.path;
      if (row.line !== null) {
        node.line = row.line;
        node.end = row.end ?? row.line;
      }
      const mods = JSON.parse(row.mods ?? "[]") as string[];
      if (mods.length > 0) node.mods = mods;
      const unresolved = JSON.parse(row.unresolved ?? "[]") as string[];
      if (unresolved.length > 0) node.unresolved = unresolved.sort();
      position.set(row.id, nodes.length);
      nodes.push(node);
    }
    const edges: [number, string, number][] = [];
    const statement = this.db.prepare(
      `SELECT src, type, dst FROM cgr_edges WHERE type IN ('CALLS', 'IMPORTS', 'DEFINES', 'DEFINES_METHOD')`,
    );
    for (const edge of statement.iterate() as Iterable<{ src: number; type: string; dst: number }>) {
      const source = position.get(edge.src);
      const target = position.get(edge.dst);
      if (source !== undefined && target !== undefined) edges.push([source, edge.type, target]);
    }
    return { project: this.project, nodes, edges };
  }

  private row(
    parent: TreeRow,
    kind: TreeRow["kind"],
    label: string,
    module: number | undefined,
    target: Target | undefined,
  ): TreeRow {
    // A file already open further up would repeat its subtree forever.
    let repeated = false;
    for (let p: TreeRow | undefined = parent; p; p = p.parent) {
      repeated ||= p.module === module;
    }
    return { kind, label, module, target, parent, repeated };
  }
}
