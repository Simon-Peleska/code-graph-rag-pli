// Go to Definition, Find All References and completion for the names cgr's
// graph does not hold: PL/I variables and structure fields, HLASM labels and
// Db2 columns. Declarations are read from the source (source.ts); the graph
// supplies what a file includes, its procedures and the tables it uses.
// Knows nothing about VS Code, so tests can use it.

import type { Definition } from "./graph.ts";
import {
  type Declaration,
  ddlTables,
  hlasmStatements,
  isNameChar,
  type Language,
  languageOf,
  Lines,
  pliCode,
  pliDeclarations,
  pliUses,
  qualifiersBefore,
  skipBlanksBack,
  type Table,
  type Use,
  sqlStatements,
} from "./source.ts";

// What the symbols need from the rest of the project.
export interface Sources {
  read(path: string): string | undefined;
  // The files `path` includes, with the line (from 1) of each include.
  includedFiles(path: string): { path: string; line: number }[];
  includingFiles(path: string): string[];
  // The procedures of `path`: what a declaration is local to.
  blocks(path: string): Definition[];
  // The tables and views the procedures of `path` use.
  tablesOf(path: string): Definition[];
  // The files using the table `name` defined in `path`.
  tableUsers(path: string, name: string): string[];
}

// A declared name and where it is; lines and columns from 0.
export interface Symbol {
  kind: "variable" | "field" | "label" | "column";
  name: string;
  path: string;
  line: number;
  col: number;
  endCol: number;
  // `CUST.ADDR.CITY CHAR(20)`: the qualified name and its attributes.
  detail: string;
}

export interface Site {
  path: string;
  line: number;
  col: number;
  endCol: number;
}

// What to complete at a position: the fields of a structure (`CUST.`), the
// columns in an SQL statement, the variables of a `:host` reference, or any
// name in code.
export interface Completions {
  context: "fields" | "sql" | "host" | "code";
  symbols: Symbol[];
}

interface Analysis {
  path: string;
  text: string;
  language: Language | undefined;
  lines: Lines;
  code: string;
  declarations: Declaration[];
  uses: Use[];
  tables: Table[];
}

// A declaration as seen from a place in a file: `scope` is the first line of
// the procedure it is local to there, 0 for the whole file.
interface Visible {
  declaration: Declaration;
  analysis: Analysis;
  scope: number;
}

const LIKE = /\bLIKE\s+((?:[A-Za-z@#$_][A-Za-z0-9@#$_]*\s*\.\s*)*([A-Za-z@#$_][A-Za-z0-9@#$_]*))/i;

export class Symbols {
  private readonly analyses = new Map<string, Analysis>();
  private readonly sources: Sources;

  constructor(sources: Sources) {
    this.sources = sources;
  }

  // Parses a file once per text it has.
  private analysis(path: string): Analysis | undefined {
    const text = this.sources.read(path);
    if (text === undefined) {
      return undefined;
    }
    const cached = this.analyses.get(path);
    if (cached?.text === text) {
      return cached;
    }
    const language = languageOf(path);
    const analysis: Analysis = {
      path, text, language, lines: new Lines(text), code: text, declarations: [], uses: [], tables: [],
    };
    if (language === "pli") {
      analysis.code = pliCode(text);
      analysis.declarations = pliDeclarations(analysis.code);
      analysis.uses = pliUses(analysis.code);
    } else if (language === "hlasm") {
      for (const statement of hlasmStatements(text)) {
        const label = statement.label;
        if (label) {
          const lineEnd = text.indexOf("\n", label.start);
          const rest = text.slice(label.start, lineEnd < 0 ? undefined : lineEnd).slice(0, 71).slice(label.end - label.start);
          analysis.declarations.push({ ...label, level: 1, attributes: rest.replace(/\s+/g, " ").trim() });
        }
        analysis.uses.push(...statement.operands.map((name) => ({ ...name, qualifiers: [], host: false })));
      }
    } else if (language === "db2") {
      analysis.tables = ddlTables(text);
    }
    this.analyses.set(path, analysis);
    return analysis;
  }

  private symbol(analysis: Analysis, declaration: Declaration, kind?: Symbol["kind"]): Symbol {
    const at = analysis.lines.at(declaration.start);
    const qualified: string[] = [];
    for (let d: Declaration | undefined = declaration; d; d = d.parent) qualified.unshift(d.name);
    return {
      kind: kind ?? (analysis.language === "hlasm" ? "label" : declaration.parent ? "field" : "variable"),
      name: declaration.name,
      path: analysis.path,
      line: at.line,
      col: at.col,
      endCol: at.col + declaration.end - declaration.start,
      detail: `${qualified.join(".")} ${declaration.attributes}`.trim(),
    };
  }

  // The innermost of `blocks` holding `line` (from 1).
  private block(blocks: Definition[], line: number): Definition | undefined {
    let found: Definition | undefined;
    for (const block of blocks) {
      if (block.line <= line && line <= block.end && (!found || block.line >= found.line)) {
        found = block;
      }
    }
    return found;
  }

  // Every declaration visible at `line` (from 1) of `path`: its own, local
  // ones of the procedures around the line included, and those of the files
  // it includes, nested includes too.
  private visible(path: string, line: number): Visible[] {
    const own = this.analysis(path);
    if (!own) {
      return [];
    }
    const result: Visible[] = [];
    const blocks = this.sources.blocks(path);
    const inside = (block: Definition | undefined) => !block || (block.line <= line && line <= block.end);
    for (const declaration of own.declarations) {
      const block = this.block(blocks, own.lines.at(declaration.start).line + 1);
      if (inside(block)) result.push({ declaration, analysis: own, scope: block?.line ?? 0 });
    }
    const seen = new Set([path]);
    const include = (file: string, scope: number) => {
      for (const included of this.sources.includedFiles(file)) {
        if (seen.has(included.path)) continue;
        seen.add(included.path);
        const analysis = this.analysis(included.path);
        for (const declaration of analysis?.declarations ?? []) {
          result.push({ declaration, analysis: analysis!, scope });
        }
        include(included.path, scope);
      }
    };
    for (const included of this.sources.includedFiles(path)) {
      const block = this.block(blocks, included.line);
      if (!inside(block) || seen.has(included.path)) continue;
      seen.add(included.path);
      const analysis = this.analysis(included.path);
      for (const declaration of analysis?.declarations ?? []) {
        result.push({ declaration, analysis: analysis!, scope: block?.line ?? 0 });
      }
      include(included.path, block?.line ?? 0);
    }
    return result;
  }

  // The declarations `name` with `qualifiers` means among `visible`: the
  // innermost ones. PL/I lets a reference leave out structure levels, and a
  // structure declared LIKE another has that one's fields.
  private resolve(visible: Visible[], name: string, qualifiers: string[]): Visible[] {
    const likes = new Map<string, string>();
    for (const v of visible) {
      const like = LIKE.exec(v.declaration.attributes);
      if (like) likes.set(v.declaration.name, like[2].toUpperCase());
    }
    const matches = (declaration: Declaration) => {
      const ancestors: string[] = [];
      for (let d = declaration.parent; d; d = d.parent) ancestors.unshift(d.name);
      const fits = (wanted: string[]) => {
        let at = 0;
        for (const ancestor of ancestors) if (at < wanted.length && ancestor === wanted[at]) at++;
        return at === wanted.length;
      };
      return fits(qualifiers) || fits(qualifiers.map((q) => likes.get(q) ?? q));
    };
    const found = visible.filter((v) => v.declaration.name === name && matches(v.declaration));
    const innermost = Math.max(...found.map((v) => v.scope));
    return found.filter((v) => v.scope === innermost);
  }

  // The columns `use`, a name in an SQL statement, can be: those of the
  // tables the statement names, or else of every table the file uses.
  private columns(analysis: Analysis, use: Use): Symbol[] {
    const tables = this.tablesUsed(analysis.path);
    const named = new Set(
      analysis.uses.filter((u) => u.sql?.start === use.sql?.start && !u.host).map((u) => u.name),
    );
    const inStatement = tables.filter(({ table }) => named.has(table.name));
    return (inStatement.length > 0 ? inStatement : tables).flatMap(({ table, analysis: ddl }) =>
      table.columns
        .filter((column) => column.name === use.name)
        .map((column) => this.symbol(ddl, { ...column, parent: { ...table, level: 1, attributes: "" } }, "column")),
    );
  }

  // The tables `path` uses, read from their DDL.
  private tablesUsed(path: string): { table: Table; analysis: Analysis }[] {
    return this.sources.tablesOf(path).flatMap((definition) => {
      const ddl = this.analysis(definition.path);
      const table = ddl?.tables.find((t) => t.name === definition.name.toUpperCase());
      return table && ddl ? [{ table, analysis: ddl }] : [];
    });
  }

  private useAt(analysis: Analysis, offset: number): Use | undefined {
    return analysis.uses.find((u) => u.start <= offset && offset <= u.end);
  }

  private definitionsOf(analysis: Analysis, use: Use, memo?: Map<string, Visible[]>): Symbol[] {
    if (use.sql && !use.host) {
      return this.columns(analysis, use);
    }
    const line = analysis.lines.at(use.start).line + 1;
    const key = `${analysis.path}:${this.block(this.sources.blocks(analysis.path), line)?.line ?? 0}`;
    let visible = memo?.get(key);
    if (!visible) {
      visible = this.visible(analysis.path, line);
      memo?.set(key, visible);
    }
    return this.resolve(visible, use.name, use.qualifiers).map((v) => this.symbol(v.analysis, v.declaration));
  }

  // Where the name at `offset` of `path` is declared. On a declaration
  // itself, that declaration.
  definitions(path: string, offset: number): Symbol[] {
    const analysis = this.analysis(path);
    if (!analysis) {
      return [];
    }
    const declared = analysis.declarations.find((d) => d.start <= offset && offset <= d.end);
    if (declared) {
      return [this.symbol(analysis, declared)];
    }
    if (analysis.language === "db2") {
      for (const table of analysis.tables) {
        const column = table.columns.find((c) => c.start <= offset && offset <= c.end);
        if (column) return [this.symbol(analysis, { ...column, parent: { ...table, level: 1, attributes: "" } }, "column")];
      }
      return [];
    }
    const use = this.useAt(analysis, offset);
    return use ? this.definitionsOf(analysis, use) : [];
  }

  // Every place that uses what the name at `offset` of `path` declares,
  // across the files that can see it: those including the declaring file,
  // and for a column the files using its table.
  references(path: string, offset: number): Site[] {
    const sites = new Map<string, Site>();
    const memo = new Map<string, Visible[]>();
    for (const target of this.definitions(path, offset)) {
      const same = (s: Symbol) => s.path === target.path && s.line === target.line && s.col === target.col;
      let files: string[];
      if (target.kind === "column") {
        const ddl = this.analysis(target.path);
        const at = ddl?.lines.offset(target.line, target.col);
        const table = ddl?.tables.find((t) => t.columns.some((c) => c.start === at));
        files = table ? this.sources.tableUsers(target.path, table.name) : [];
      } else if (this.block(this.sources.blocks(target.path), target.line + 1)) {
        files = [target.path];
      } else {
        files = this.includersOf(target.path);
      }
      for (const file of files) {
        const text = this.sources.read(file);
        if (!text?.toUpperCase().includes(target.name)) {
          continue;
        }
        const analysis = this.analysis(file)!;
        const declared = new Set(analysis.declarations.map((d) => d.start));
        for (const use of analysis.uses) {
          if (use.name !== target.name || declared.has(use.start)) continue;
          if (target.kind === "column" ? !use.sql || use.host : false) continue;
          if (!this.definitionsOf(analysis, use, memo).some(same)) continue;
          const at = analysis.lines.at(use.start);
          sites.set(`${file}:${use.start}`, { path: file, line: at.line, col: at.col, endCol: at.col + use.end - use.start });
        }
      }
    }
    return [...sites.values()];
  }

  // `path` and every file including it, directly or through other includes.
  private includersOf(path: string): string[] {
    const files = new Set([path]);
    const queue = [path];
    while (queue.length > 0) {
      for (const includer of this.sources.includingFiles(queue.pop()!)) {
        if (!files.has(includer)) {
          files.add(includer);
          queue.push(includer);
        }
      }
    }
    return [...files];
  }

  // What may be typed at `offset` of `path`.
  completions(path: string, offset: number): Completions {
    const analysis = this.analysis(path);
    if (!analysis || (analysis.language !== "pli" && analysis.language !== "hlasm")) {
      return { context: "code", symbols: [] };
    }
    const code = analysis.code;
    let start = offset;
    while (start > 0 && isNameChar(code[start - 1])) start--;
    const line = analysis.lines.at(offset).line + 1;
    const visible = this.visible(path, line);

    if (analysis.language === "pli") {
      const qualifiers = qualifiersBefore(code, start).names;
      if (qualifiers.length > 0) {
        const name = qualifiers[qualifiers.length - 1];
        const structures = this.resolve(visible, name, qualifiers.slice(0, -1));
        const fields = structures.flatMap((structure) => {
          const like = LIKE.exec(structure.declaration.attributes);
          const shapes = like ? this.resolve(visible, like[2].toUpperCase(), []) : [structure];
          return shapes.flatMap((shape) =>
            shape.analysis.declarations
              .filter((d) => d.parent === shape.declaration)
              .map((d) => this.symbol(shape.analysis, d)),
          );
        });
        return { context: "fields", symbols: fields };
      }
      const statement = sqlStatements(code).find((s) => s.start <= start && start <= s.end);
      if (statement && code[skipBlanksBack(code, qualifiersBefore(code, start).start - 1)] === ":") {
        return { context: "host", symbols: this.innermost(visible) };
      }
      if (statement) {
        const columns = this.tablesUsed(path).flatMap(({ table, analysis: ddl }) =>
          table.columns.map((c) => this.symbol(ddl, { ...c, parent: { ...table, level: 1, attributes: "" } }, "column")),
        );
        return { context: "sql", symbols: columns };
      }
    }
    return { context: "code", symbols: this.innermost(visible) };
  }

  // One symbol per name: the declaration in the innermost scope.
  private innermost(visible: Visible[]): Symbol[] {
    const best = new Map<string, Visible>();
    for (const v of visible) {
      const known = best.get(v.declaration.name);
      if (!known || v.scope > known.scope) best.set(v.declaration.name, v);
    }
    return [...best.values()].map((v) => this.symbol(v.analysis, v.declaration));
  }
}
