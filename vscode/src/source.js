// Reads names straight from source text: PL/I declarations and the names a
// program uses, HLASM labels and operands, the columns of Db2 tables, and
// the SQL a PL/I program runs. Works on offsets into the text as given, so
// every name maps back to its place in the file. Knows nothing about VS Code.

/** @typedef {"pli" | "jcl" | "hlasm" | "db2"} Language */

/** A procedure detail of OPTIONS(MAIN). */
export const MAIN_OPTIONS = /OPTIONS\s*\([^)]*\bMAIN\b/i;

/** @type {Record<string, Language>} */
const EXTENSIONS = {
  ".pli": "pli", ".pl1": "pli", ".pco": "pli", ".inc": "pli",
  ".jcl": "jcl", ".cntl": "jcl",
  ".mfs": "hlasm", ".asm": "hlasm", ".hlasm": "hlasm", ".mlc": "hlasm",
  ".ddl": "db2", ".db2": "db2",
};
/** @type {Record<string, Language>} */
const MEMBER_LANGUAGES = { J: "jcl", F: "hlasm", T: "db2" };

// The extension decides, and an extensionless z/OS member whose third
// character is J, F or T is JCL, MFS or Db2; any other member is PL/I.
/**
 * @param {string} path
 * @returns {Language | undefined}
 */
export function languageOf(path) {
  const file = path.split("/").pop() ?? "";
  const dot = file.lastIndexOf(".");
  if (dot > 0) {
    return EXTENSIONS[file.slice(dot).toLowerCase()];
  }
  return MEMBER_LANGUAGES[file.charAt(2).toUpperCase()] ?? "pli";
}

/**
 * A name in the text, upper-cased, and where it is.
 * @typedef {object} Name
 * @property {string} name
 * @property {number} start
 * @property {number} end
 */

/**
 * A name a program uses. `qualifiers` are the structure names written before
 * it, outermost first (`A.B.C` gives C the qualifiers A, B). `sql` is the
 * EXEC SQL statement it is in, and `host` marks a `:NAME` host variable.
 * @typedef {Name & { qualifiers: string[], sql?: SqlStatement, host: boolean }} Use
 */

/**
 * A declared name: a PL/I variable or structure field, an HLASM label, or a
 * Db2 column. `parent` is the structure a field belongs to.
 * @typedef {Name & { level: number, parent?: Declaration, attributes: string }} Declaration
 */

/**
 * @typedef {object} SqlStatement
 * @property {number} start
 * @property {number} end
 */

/** @typedef {Name & { qualified: string, columns: Declaration[] }} Table */

const IDENTIFIER = /[A-Za-z@#$_][A-Za-z0-9@#$_]*/y;
/** @param {string | undefined} c */
export const isNameChar = (c) => c !== undefined && /[A-Za-z0-9@#$_]/.test(c);
/** @param {string} text */
const spaces = (text) => text.replace(/[^\n\r]/g, " ");

// Mainframe sources are often fixed-format: a sequence number in columns
// 73-80 and, in PL/I, a carriage-control character in column 1. Both are
// blanked before parsing.
/**
 * @param {string} text
 * @param {Language} language
 * @returns {string}
 */
export function blankMargins(text, language) {
  const lines = text.split("\n");
  const plain = lines.map((line) => line.replace(/\r$/, ""));
  const code = plain.filter((line) => line.trim());
  if (code.length === 0 || plain.some((line) => line.length > 80)) {
    return text;
  }
  /** @param {string} line */
  const isProcess = (line) => /^[*%]PROCESS/i.test(line);
  const carriageControl = language === "pli" && code.every((line) => isProcess(line) || " 01-+".includes(line[0]));
  const numbered = code.filter((line) => line.slice(72).trim()).length;
  const blankSequence = numbered * 10 >= code.length * 9;
  if (!carriageControl && !blankSequence) {
    return text;
  }
  return lines
    .map((line) => {
      let result = line;
      if (blankSequence && line.length > 72) {
        result = result.slice(0, 72) + spaces(result.slice(72).replace(/\r$/, "")) + (line.endsWith("\r") ? "\r" : "");
      }
      if (carriageControl && result.length > 0 && !isProcess(result) && result[0] !== "\r") {
        result = ` ${result.slice(1)}`;
      }
      return result;
    })
    .join("\n");
}

// PL/I with its margins, comments and string literals blanked, so only code
// is left at the same offsets. A literal's suffix (`'01'B`, `'C1'X`) goes too.
/**
 * @param {string} text
 * @returns {string}
 */
export function pliCode(text) {
  const source = blankMargins(text, "pli");
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      const end = close < 0 ? source.length : close + 2;
      out += spaces(source.slice(i, end));
      i = end;
    } else if (c === "'" || c === '"') {
      let end = i + 1;
      for (;;) {
        const close = source.indexOf(c, end);
        if (close < 0) {
          end = source.length;
          break;
        }
        if (source[close + 1] === c) {
          end = close + 2;
          continue;
        }
        end = close + 1;
        break;
      }
      const suffix = /^(?:B[1-4]?|BX|X|XN|XU|GX|G|M|WX)(?![A-Za-z0-9@#$_])/i.exec(source.slice(end, end + 3));
      end += suffix ? suffix[0].length : 0;
      out += spaces(source.slice(i, end));
      i = end;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// The statements of PL/I code, split at semicolons.
/**
 * @param {string} code
 * @returns {SqlStatement[]}
 */
function statements(code) {
  /** @type {SqlStatement[]} */
  const result = [];
  let start = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === ";") {
      result.push({ start, end: i });
      start = i + 1;
    }
  }
  if (code.slice(start).trim()) {
    result.push({ start, end: code.length });
  }
  return result;
}

// Splits code[start, end) at the commas outside parentheses.
/**
 * @param {string} code
 * @param {number} start
 * @param {number} end
 * @returns {SqlStatement[]}
 */
function splitTopLevel(code, start, end) {
  /** @type {SqlStatement[]} */
  const parts = [];
  let depth = 0;
  let from = start;
  for (let i = start; i < end; i++) {
    const c = code[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) {
      parts.push({ start: from, end: i });
      from = i + 1;
    }
  }
  parts.push({ start: from, end });
  return parts;
}

/**
 * @param {string} code
 * @param {number} at
 * @returns {Name | undefined}
 */
function identifierAt(code, at) {
  IDENTIFIER.lastIndex = at;
  const match = IDENTIFIER.exec(code);
  return match ? { name: match[0].toUpperCase(), start: at, end: at + match[0].length } : undefined;
}

/**
 * @param {string} code
 * @param {number} at
 * @param {number} [end]
 * @returns {number}
 */
function skipBlanks(code, at, end = code.length) {
  while (at < end && /\s/.test(code[at])) at++;
  return at;
}

/**
 * @param {string} code
 * @param {number} open
 * @param {number} end
 * @returns {number}
 */
function matchingParen(code, open, end) {
  let depth = 0;
  for (let i = open; i < end; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) return i;
  }
  return end;
}

/** @param {string} text */
const tidy = (text) => text.replace(/\s+/g, " ").trim().slice(0, 80);

// Every name a DECLARE (DCL) statement declares, structure fields with
// their parent: `DCL 1 A, 2 B CHAR(8), 2 (C, D) FIXED BIN(31);`.
/**
 * @param {string} code
 * @returns {Declaration[]}
 */
export function pliDeclarations(code) {
  /** @type {Declaration[]} */
  const declarations = [];
  for (const statement of statements(code)) {
    const head = /^\s*(?:[A-Za-z@#$_][A-Za-z0-9@#$_]*\s*:\s*)*%?\s*(?:DCL|DECLARE)\b/i.exec(
      code.slice(statement.start, statement.end),
    );
    if (!head) {
      continue;
    }
    /** @type {Declaration[]} */
    const structure = [];
    for (const item of splitTopLevel(code, statement.start + head[0].length, statement.end)) {
      let at = skipBlanks(code, item.start, item.end);
      const level = /^\d+/.exec(code.slice(at, item.end));
      if (level) {
        at = skipBlanks(code, at + level[0].length, item.end);
      }
      /** @type {Name[]} */
      const names = [];
      let rest = at;
      if (code[at] === "(") {
        const close = matchingParen(code, at, item.end);
        for (const part of splitTopLevel(code, at + 1, close)) {
          const name = identifierAt(code, skipBlanks(code, part.start, part.end));
          if (name) names.push(name);
        }
        rest = close + 1;
      } else {
        const name = identifierAt(code, at);
        if (!name) continue;
        names.push(name);
        rest = name.end;
      }
      const depth = level ? Number(level[0]) : 1;
      while (structure.length > 0 && structure[structure.length - 1].level >= depth) {
        structure.pop();
      }
      const parent = structure[structure.length - 1];
      const attributes = tidy(code.slice(rest, item.end));
      for (const name of names) {
        /** @type {Declaration} */
        const declaration = { ...name, level: depth, parent, attributes };
        declarations.push(declaration);
        if (names.length === 1) structure.push(declaration);
      }
    }
  }
  return declarations;
}

// The EXEC SQL statements of PL/I code.
/**
 * @param {string} code
 * @returns {SqlStatement[]}
 */
export function sqlStatements(code) {
  return statements(code).filter((s) => /^\s*(?:[A-Za-z@#$_][A-Za-z0-9@#$_]*\s*:\s*)*EXEC\s+SQL\b/i.test(code.slice(s.start, s.end)));
}

// Every name PL/I code uses, with the qualifiers written before it.
/**
 * @param {string} code
 * @returns {Use[]}
 */
export function pliUses(code) {
  const sql = sqlStatements(code);
  /** @type {Use[]} */
  const uses = [];
  let inSql = 0;
  const pattern = /[A-Za-z@#$_][A-Za-z0-9@#$_]*/g;
  for (let match = pattern.exec(code); match; match = pattern.exec(code)) {
    const start = match.index;
    if (isNameChar(code[start - 1])) {
      continue;
    }
    while (inSql < sql.length && sql[inSql].end < start) inSql++;
    const statement = inSql < sql.length && sql[inSql].start <= start ? sql[inSql] : undefined;
    const qualifiers = qualifiersBefore(code, start);
    uses.push({
      name: match[0].toUpperCase(),
      start,
      end: start + match[0].length,
      qualifiers: qualifiers.names,
      sql: statement,
      host: statement !== undefined && code[skipBlanksBack(code, qualifiers.start - 1)] === ":",
    });
  }
  return uses;
}

/**
 * @param {string} code
 * @param {number} at
 * @returns {number}
 */
export function skipBlanksBack(code, at) {
  while (at >= 0 && /\s/.test(code[at])) at--;
  return at;
}

// `A.B.` before `start` gives A, B, and the offset where A starts. A pointer
// (`P->A.B`) ends the chain.
/**
 * @param {string} code
 * @param {number} start
 * @returns {{ names: string[], start: number }}
 */
export function qualifiersBefore(code, start) {
  /** @type {string[]} */
  const names = [];
  let first = start;
  let at = skipBlanksBack(code, start - 1);
  while (at >= 0 && code[at] === ".") {
    at = skipBlanksBack(code, at - 1);
    let begin = at;
    while (begin >= 0 && isNameChar(code[begin])) begin--;
    if (begin === at || /[0-9]/.test(code[begin + 1])) {
      break;
    }
    names.unshift(code.slice(begin + 1, at + 1).toUpperCase());
    first = begin + 1;
    at = skipBlanksBack(code, begin);
  }
  return { names, start: first };
}

/**
 * One HLASM statement: its label, operation and the names its operands use.
 * Comment lines are skipped, continuation lines joined and remarks dropped.
 * @typedef {object} HlasmStatement
 * @property {Name} [label]
 * @property {Name} [operation]
 * @property {Name[]} operands
 */

const HLASM_NAME = /[.&]?[A-Za-z@#$_][A-Za-z0-9@#$_]*/y;
// L'FIELD and its kin read an attribute of a symbol; C'..', X'..' and the
// rest are constants.
const ATTRIBUTES = new Set(["L", "T", "K", "N", "I", "S", "O", "D"]);

/**
 * @param {string} text
 * @returns {HlasmStatement[]}
 */
export function hlasmStatements(text) {
  /** @type {HlasmStatement[]} */
  const result = [];
  for (const { segments } of hlasmLines(text)) {
    const first = segments[0];
    /** @type {HlasmStatement} */
    const statement = { operands: [] };
    const body = first.text;
    let at = 0;
    if (body[0] !== " ") {
      HLASM_NAME.lastIndex = 0;
      const label = HLASM_NAME.exec(body);
      if (label) statement.label = { name: label[0].toUpperCase(), start: first.base, end: first.base + label[0].length };
      while (at < body.length && body[at] !== " ") at++;
    }
    at = skipBlanks(body, at);
    HLASM_NAME.lastIndex = at;
    const operation = HLASM_NAME.exec(body);
    if (operation) {
      statement.operation = { name: operation[0].toUpperCase(), start: first.base + at, end: first.base + at + operation[0].length };
      at = skipBlanks(body, at + operation[0].length);
    }
    const constants = statement.operation !== undefined && /^(DC|DS)$/.test(statement.operation.name);

    // The operands run to the first blank outside quotes. One that follows a
    // comma on a continued line goes on in the next segment; any other starts the remarks.
    let quoted = false;
    let s = 0;
    scan: while (s < segments.length) {
      const { text: current, base } = segments[s];
      while (at < current.length) {
        const c = current[at];
        if (c === " " && !quoted) {
          if (current[at - 1] === "," && s + 1 < segments.length) {
            break;
          }
          break scan;
        }
        if (c === "'") {
          quoted = !quoted;
          at++;
          continue;
        }
        if (quoted || !/[.&A-Za-z@#$_]/.test(c) || isNameChar(current[at - 1])) {
          at++;
          continue;
        }
        HLASM_NAME.lastIndex = at;
        const name = /** @type {RegExpExecArray} */ (HLASM_NAME.exec(current));
        const after = at + name[0].length;
        const upper = name[0].toUpperCase();
        at = after;
        if (current[after] === "'") {
          // C'..', F'1', =CL8'X' are constants; L'FIELD reads FIELD's length.
          if (!constants && ATTRIBUTES.has(upper)) at++;
          continue;
        }
        if (current[after] === "=" && current[after + 1] !== "=") {
          continue;
        }
        if (constants && current[after] === "(" && /^[AVYSQRJ]D?$/.test(upper)) {
          // A(TARGET), V(EXTERN): the type of an address constant.
          continue;
        }
        statement.operands.push({ name: upper, start: base + after - name[0].length, end: base + after });
      }
      s++;
      at = 15;
    }
    result.push(statement);
  }
  return result;
}

/**
 * The lines each statement of an HLASM source spans, comment lines skipped:
 * columns 1-71 of each, with `base` the text offset of its column 1. A
 * character in column 72 continues the statement in column 16 of the next line.
 * @param {string} text
 * @returns {{ line: number, segments: { text: string, base: number }[] }[]}
 */
export function hlasmLines(text) {
  /** @type {{ text: string, base: number }[]} */
  const lines = [];
  let base = 0;
  for (const line of blankMargins(text, "hlasm").split("\n")) {
    lines.push({ text: line.replace(/\r$/, ""), base });
    base += line.length + 1;
  }
  const result = [];
  for (let n = 0; n < lines.length; n++) {
    const first = lines[n].text;
    if (!first.trim() || first.startsWith("*") || first.startsWith(".*")) continue;
    const statement = { line: n, segments: [{ text: first.slice(0, 71), base: lines[n].base }] };
    while ((lines[n].text[71] ?? " ") !== " " && n + 1 < lines.length) {
      n++;
      statement.segments.push({ text: lines[n].text.slice(0, 71), base: lines[n].base });
    }
    result.push(statement);
  }
  return result;
}

// SQL with comments and strings blanked: `--` to the end of the line, /* */.
/**
 * @param {string} text
 * @returns {string}
 */
export function sqlCode(text) {
  return blankMargins(text, "db2")
    .replace(/\/\*[\s\S]*?\*\//g, spaces)
    .replace(/--[^\n]*/g, spaces)
    .replace(/'(?:[^']|'')*'/g, spaces);
}

const CONSTRAINTS = new Set(["PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "CONSTRAINT", "PERIOD", "LIKE"]);

// The tables a DDL file creates, with their columns.
/**
 * @param {string} text
 * @returns {Table[]}
 */
export function ddlTables(text) {
  const code = sqlCode(text);
  /** @type {Table[]} */
  const tables = [];
  for (const statement of statements(code)) {
    const head = /^\s*CREATE\s+(?:GLOBAL\s+TEMPORARY\s+|AUXILIARY\s+)?TABLE\s+((?:[A-Za-z0-9@#$_"]+\s*\.\s*)*([A-Za-z0-9@#$_"]+))\s*\(/i.exec(
      code.slice(statement.start, statement.end),
    );
    if (!head) {
      continue;
    }
    const nameStart = statement.start + head[0].indexOf(head[1]) + head[1].length - head[2].length;
    const open = statement.start + head[0].length - 1;
    const close = matchingParen(code, open, statement.end);
    /** @type {Table} */
    const table = {
      name: head[2].replaceAll('"', "").toUpperCase(),
      start: nameStart,
      end: nameStart + head[2].length,
      qualified: head[1].replace(/\s+/g, "").replaceAll('"', "").toUpperCase(),
      columns: [],
    };
    for (const part of splitTopLevel(code, open + 1, close)) {
      const at = skipBlanks(code, part.start, part.end);
      const quoted = code[at] === '"';
      const name = identifierAt(code, quoted ? at + 1 : at);
      if (!name || CONSTRAINTS.has(name.name)) {
        continue;
      }
      table.columns.push({ ...name, level: 2, attributes: tidy(code.slice(name.end + (quoted ? 1 : 0), part.end)) });
    }
    tables.push(table);
  }
  return tables;
}

// What a statement does to `table`: INSERT, UPDATE, DELETE or MERGE when the
// table is what it writes, SELECT when it only reads it.
/**
 * @param {string} statement
 * @param {string} table
 * @returns {string | undefined}
 */
export function sqlOperation(statement, table) {
  const sql = /\bEXEC\s+SQL\s+([\s\S]*)/i.exec(statement)?.[1] ?? statement;
  const verb = /^\s*([A-Za-z]+)/.exec(sql)?.[1].toUpperCase();
  if (!verb) {
    return undefined;
  }
  const target = /^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO)\s+((?:[A-Za-z0-9@#$_"]+\s*\.\s*)*[A-Za-z0-9@#$_"]+)/i.exec(sql);
  if (target && target[1].replaceAll('"', "").toUpperCase().split(".").pop()?.trim() === table.toUpperCase()) {
    return verb;
  }
  if (["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "DECLARE", "WITH", "VALUES", "SET", "FETCH", "OPEN"].includes(verb)) {
    return "SELECT";
  }
  return verb;
}

// Converts offsets to 0-based lines and columns.
export class Lines {
  /** @type {number[]} */
  #starts = [0];

  /** @param {string} text */
  constructor(text) {
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") this.#starts.push(i + 1);
    }
  }

  /**
   * @param {number} offset
   * @returns {{ line: number, col: number }}
   */
  at(offset) {
    let low = 0;
    let high = this.#starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.#starts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low, col: offset - this.#starts[low] };
  }

  /**
   * @param {number} line
   * @param {number} col
   * @returns {number}
   */
  offset(line, col) {
    return (this.#starts[line] ?? this.#starts[this.#starts.length - 1]) + col;
  }
}

// The PL/I built-in functions and pseudovariables, for completion.
export const PLI_BUILTINS = [
  "ABS", "ACOS", "ADD", "ADDR", "ADDRDATA", "ALL", "ALLOCATION", "ANY", "ASIN", "ATAN", "ATAND", "ATANH",
  "BINARY", "BIT", "BOOL", "BYTE", "CEIL", "CENTER", "CHAR", "CHARACTER", "COLLATE", "COMPARE", "COPY", "COS",
  "CSTG", "CURRENTSIZE", "DATAFIELD", "DATE", "DATETIME", "DAYS", "DECIMAL", "DIM", "DIVIDE", "EDIT", "EMPTY",
  "ENDFILE", "ENTRYADDR", "EXP", "FIXED", "FLOAT", "FLOOR", "HBOUND", "HEX", "HIGH", "INDEX", "LBOUND",
  "LEFT", "LENGTH", "LINENO", "LOG", "LOG10", "LOW", "LOWERCASE", "LTRIM", "MAX", "MAXLENGTH", "MIN", "MOD",
  "MULTIPLY", "NULL", "OFFSET", "ONCHAR", "ONCODE", "ONFILE", "ONKEY", "ONLOC", "ONSOURCE", "PLIRETV",
  "POINTER", "POINTERADD", "PTRADD", "PRECISION", "PROD", "RANDOM", "RANK", "REAL", "REPEAT", "REVERSE",
  "RIGHT", "ROUND", "RTRIM", "SEARCH", "SEARCHR", "SIGN", "SIN", "SIZE", "SQRT", "STG", "STORAGE", "STRING",
  "SUBSTR", "SUM", "SYSNULL", "TALLY", "TAN", "TIME", "TRANSLATE", "TRIM", "TRUNC", "UNSPEC", "UPPERCASE",
  "VALID", "VARGLIST", "VERIFY", "VERIFYR", "WHIGH", "WLOW",
];
