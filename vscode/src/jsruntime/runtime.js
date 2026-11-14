// The runtime of the JavaScript generated from PL/I: PL/I's fixed-length
// strings, decimals and pictures, IMS message calls on the I/O PCB, record
// and stream files, Db2 through ibm_db, and JCL jobs. Copied as is next to
// the generated programs.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull } from "node:os";
import { dirname, join } from "node:path";

/**
 * A CHAR(n): the value cut or padded with blanks to n.
 * @param {unknown} value
 * @param {number} n
 */
export function char(value, n) {
  if (typeof value === "object" && value !== null) {
    const copy = structuredClone(value);
    held.add(copy);
    return copy;
  }
  const text = String(value ?? "");
  return text.length >= n ? text.slice(0, n) : text.padEnd(n);
}

/**
 * A CHAR(n) VARYING: the value cut to n.
 * @param {unknown} value
 * @param {number} n
 */
export function varchar(value, n) {
  return String(value ?? "").slice(0, n);
}

/**
 * A FIXED DEC(p,q): truncated to q decimals, and to p digits as PL/I does
 * with SIZE disabled.
 * @param {unknown} value
 * @param {number} p
 * @param {number} [q]
 */
export function dec(value, p, q = 0) {
  const number = typeof value === "string" ? Number(value.trim() || 0) : Number(value);
  // The noise of 10116.31 - 10000 is relative to the operands, not the result, so 15 significant digits
  // of 116.30999999999949 keep it; 6 decimals past the scale do not. Large values need the 15 digits.
  return (Math.trunc(Number(Number(num(number * 10 ** q)).toFixed(6))) % 10 ** p) / 10 ** q;
}

/**
 * A number without the noise of binary floating point: 0.29 * 100 is
 * 28.999999999999996, 1.1 + 2.2 is 3.3000000000000003. A double holds 15
 * decimal digits exactly, so a FIXED DEC up to 15 digits comes back exact;
 * integers are exact already.
 * @param {unknown} value
 */
export function num(value) {
  return typeof value === "number" && !Number.isInteger(value) && Number.isFinite(value) ? Number(value.toPrecision(15)) : value;
}

/**
 * A FIXED BIN: an integer.
 * @param {unknown} value
 */
export function bin(value) {
  return Math.trunc(Number(value));
}

/**
 * PL/I's MOD: never negative for a positive divisor.
 * @param {number} a
 * @param {number} b
 */
export function mod(a, b) {
  return ((a % b) + b) % b;
}

/**
 * PL/I's ROUND: to n decimals, halves away from zero.
 * @param {number} value
 * @param {number} n
 */
export function round(value, n = 0) {
  const scaled = Math.abs(Number(num(value * 10 ** n)));
  return (Math.sign(value) * Math.floor(scaled + 0.5)) / 10 ** n;
}

/**
 * SUBSTR(s, i, n): n characters from the i-th, 1-based.
 * @param {unknown} s
 * @param {number} i
 * @param {number} [n]
 */
export function substr(s, i, n) {
  const text = String(s);
  return n === undefined ? text.slice(i - 1) : text.slice(i - 1, i - 1 + n);
}

/**
 * VERIFY(s, set): the position of the first character of s not in set, 0 if
 * there is none.
 * @param {unknown} s
 * @param {string} set
 */
export function verify(s, set) {
  const text = String(s);
  for (let i = 0; i < text.length; i++) if (!set.includes(text[i])) return i + 1;
  return 0;
}

/**
 * TRANSLATE(s, to, from): each character of s found in from replaced by the
 * one at the same place in to, a blank when to is shorter.
 * @param {unknown} s
 * @param {string} to
 * @param {string} from
 */
export function translate(s, to, from) {
  return [...String(s)].map((c) => (from.includes(c) ? (to[from.indexOf(c)] ?? " ") : c)).join("");
}

/** SUM(array): the sum of all its elements. @param {unknown} array */
export function sum(array) {
  return Array.isArray(array) ? array.reduce((total, x) => total + sum(x), 0) : Number(array);
}

/** @param {number} n @param {number} [width] */
const two = (n, width = 2) => String(n).padStart(width, "0");

/** DATETIME(): YYYYMMDDHHMMSSmmm. */
export function datetime() {
  const now = new Date();
  return `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}${two(now.getMilliseconds(), 3)}`;
}

/** DATE(): YYMMDD. */
export function date() {
  return datetime().slice(2, 8);
}

/** TIME(): HHMMSSmmm. */
export function time() {
  return datetime().slice(8);
}

/** @param {string} picture */
function expand(picture) {
  return picture.toUpperCase().replace(/\((\d+)\)(.)/g, (_, n, c) => c.repeat(Number(n)));
}

/**
 * The number a numeric picture's characters hold. Lenient, for typed input:
 * fewer digits than the picture has count from the right, and a typed
 * decimal point wins over the picture's V.
 * @param {string} text
 * @param {string} picture
 */
export function fromPic(text, picture) {
  const trimmed = String(text ?? "").trim();
  const negative = /-|CR|DB/i.test(trimmed);
  const typed = trimmed.replace(/[^\d.,]/g, "").replace(",", ".");
  if (typed.includes(".")) return (negative ? -1 : 1) * (Number(typed) || 0);
  const chars = expand(picture);
  const v = chars.indexOf("V");
  const scale = v < 0 ? 0 : chars.slice(v + 1).replace(/[^9Z]/g, "").length;
  return ((negative ? -1 : 1) * Number(typed || 0)) / 10 ** scale;
}

/**
 * A number in a numeric picture's characters: 9 a digit, Z a digit or a
 * blank while leading zeros last, V the implied decimal point, S and - the
 * sign, B a blank; anything else is inserted as is.
 * @param {number} value
 * @param {string} picture
 */
export function toPic(value, picture) {
  const chars = expand(picture);
  const v = chars.indexOf("V");
  const scale = v < 0 ? 0 : chars.slice(v + 1).replace(/[^9Z]/g, "").length;
  const positions = chars.replace(/[^9Z]/g, "").length;
  const digits = String(Math.trunc(Math.abs(Number(num(Number(value) * 10 ** scale))))).padStart(positions, "0").slice(-positions);
  let at = 0;
  let leading = true;
  let out = "";
  for (const [i, c] of [...chars].entries()) {
    if (c === "9" || c === "Z") {
      const digit = digits[at++];
      if (digit !== "0" || c === "9" || (v >= 0 && i > v)) leading = false;
      out += leading && c === "Z" ? " " : digit;
    } else if (c === "V") {
      leading = false;
    } else if (c === "S") {
      out += value < 0 ? "-" : "+";
    } else if (c === "-") {
      out += value < 0 ? "-" : " ";
    } else if (c === "B") {
      out += " ";
    } else {
      out += leading ? " " : c;
    }
  }
  return out;
}

/**
 * An array of the given lengths, made by `make` from each element's index in
 * row-major order, the first elements set from INIT's values, each
 * `[count, value]` a repeat factor.
 * @template T
 * @param {number[]} lengths
 * @param {(index: number) => T} make
 * @param {[number, T][]} [init]
 * @returns {any[]}
 */
export function array(lengths, make, init = []) {
  const values = init.flatMap(([count, value]) => Array(count).fill(value));
  let next = 0;
  /** @param {number[]} rest @returns {any[]} */
  const build = ([n, ...rest]) => Array.from({ length: n }, () => (rest.length ? build(rest) : next < values.length ? values[next++] : make(next++)));
  return build(lengths);
}

/**
 * What the generator could not translate; fails when the program gets there.
 * @param {string} what
 * @returns {never}
 */
export function todo(what) {
  throw new Error(`[PLG051E] Not translated from PL/I: ${what}`);
}

/**
 * A SELECT without OTHERWISE where no WHEN matched: PL/I raises ERROR.
 * @param {string} where
 * @returns {never}
 */
export function noWhen(where) {
  throw new Error(`[PLG052E] No WHEN of the SELECT at ${where} matched, and it has no OTHERWISE`);
}

/**
 * Where each field of an area lies in a message or record: its path in the
 * area, how it is held (CHAR, a numeric PIC with its picture, a NUMBER in
 * characters with its precision, or a BIT as 1 or 0), and its length.
 * @typedef {[(string | number)[], "CHAR" | "PIC" | "NUMBER" | "BIT", string, number][]} Layout
 */

/**
 * @typedef {object} Pcb the I/O PCB: the message in and the messages out
 * @property {string | null} input
 * @property {string[]} output
 * @property {string} STATUS
 */

/** @param {any} area @param {(string | number)[]} path @param {unknown} value */
function put(area, path, value) {
  let at = area;
  for (const key of path.slice(0, -1)) at = at[key];
  at[path[path.length - 1]] = value;
}

/** @param {any} area @param {(string | number)[]} path */
function get(area, path) {
  return path.reduce((at, key) => at[key], area);
}

/**
 * The fields of `text` into `area`.
 * @param {string} text
 * @param {object} area
 * @param {Layout} layout
 */
export function decode(text, area, layout) {
  let at = 0;
  for (const [path, kind, size, length] of layout) {
    const field = text.slice(at, at + length).padEnd(length);
    at += length;
    put(area, path, kind === "CHAR" ? field : kind === "PIC" ? fromPic(field, size) : kind === "BIT" ? field === "1" : Number(field.trim()) || 0);
  }
}

/**
 * The fields of `area` as text.
 * @param {object} area
 * @param {Layout} layout
 */
export function encode(area, layout) {
  let text = "";
  for (const [path, kind, size, length] of layout) {
    const value = get(area, path);
    const decimals = Number(size.split(",")[1] ?? 0);
    const number = kind === "NUMBER" ? (decimals ? Number(value).toFixed(decimals) : String(value)) : "";
    text += kind === "CHAR" ? char(value, length) : kind === "PIC" ? toPic(Number(value), size) : kind === "BIT" ? (value ? "1" : "0") : number.padStart(length).slice(-length);
  }
  return text;
}

/** A pointer to a scalar: ADDR of a CHAR or other non-structure variable. */
export class Ref {
  /** @param {() => any} get @param {(value: any) => void} set */
  constructor(get, set) {
    this.get = get;
    this.set = set;
  }
}

/** @type {WeakMap<object, (string | number)[][]>} the paths of each structure's fields, in order */
const leafPaths = new WeakMap();
/** @type {WeakSet<object>} the fields a CHAR holds in place of its text: one field of the structure around it */
const held = new WeakSet();
/** @param {object} area */
function leavesOf(area) {
  let paths = leafPaths.get(area);
  if (!paths) {
    /** @type {(string | number)[][]} */
    const found = [];
    paths = found;
    /** @param {any} at @param {(string | number)[]} path */
    const walk = (at, path) => {
      for (const [key, value] of Object.entries(at)) {
        const next = [...path, Array.isArray(at) ? Number(key) : key];
        if (typeof value === "object" && value !== null && !held.has(value)) walk(value, next);
        else found.push(next);
      }
    };
    walk(area, []);
    leafPaths.set(area, paths);
  }
  return paths;
}

/**
 * A DEFINED or BASED variable: a view on another variable's storage. On a
 * string (a CHAR) each field reads and writes its slice of it, until a
 * field that is no text is written: then the string becomes an object
 * holding the view's fields. On an object (a structure, or a CHAR holding
 * fields) the view's n-th field is the object's n-th field, whatever its
 * name.
 * @param {() => any} base the variable: a structure, a Ref, or null
 * @param {Layout} layout the view's fields with their lengths
 * @param {number} [offset] POSITION - 1
 */
export function overlay(base, layout, offset = 0) {
  /** @param {Layout} fields @returns {any} */
  const fresh = (fields) => {
    /** @type {any} */
    const area = typeof fields[0][0][0] === "number" ? [] : {};
    for (const [path] of fields) {
      let at = area;
      path.slice(0, -1).forEach((key, i) => {
        at[key] ??= typeof path[i + 1] === "number" ? [] : {};
        at = at[key];
      });
    }
    return area;
  };
  /** @type {number[]} where each field starts in a string */
  const starts = [];
  layout.reduce((at, field) => (starts.push(at), at + field[3]), offset);
  /** The k-th field read from a string. @param {string} value @param {number} k */
  const sliced = (value, k) => {
    const [, kind, size, length] = layout[k];
    const field = value.slice(starts[k], starts[k] + length).padEnd(length);
    return kind === "CHAR" ? field : kind === "PIC" ? fromPic(field, size) : kind === "BIT" ? field.trim() === "1" : Number(field.trim()) || 0;
  };
  /** The path of the k-th field in an object. @param {object} value @param {number} k */
  const pathIn = (value, k) => {
    const paths = leavesOf(value);
    if (k >= paths.length) throw new Error(`[PLG074E] a view's field ${k + 1} (${layout[k][0].join(".")}) lies beyond the ${paths.length} fields its area holds`);
    return paths[k];
  };
  const root = fresh(layout);
  layout.forEach(([path, kind, size, length], k) => {
    let at = root;
    for (const key of path.slice(0, -1)) at = at[key];
    Object.defineProperty(at, path[path.length - 1], {
      enumerable: true,
      get() {
        const target = base();
        const value = target instanceof Ref ? target.get() : target;
        return typeof value === "string" ? sliced(value, k) : get(value, pathIn(value, k));
      },
      set(field) {
        const target = base();
        const value = target instanceof Ref ? target.get() : target;
        if (typeof value !== "string") return put(value, pathIn(value, k), field);
        if (kind === "CHAR" || kind === "PIC") {
          const text = kind === "PIC" ? toPic(Number(field), size) : char(field, length);
          return target.set(value.padEnd(starts[k]).slice(0, starts[k]) + text + value.slice(starts[k] + length));
        }
        const area = fresh(layout);
        layout.forEach(([p], j) => put(area, p, j === k ? field : sliced(value, j)));
        held.add(area);
        target.set(area);
      },
    });
  });
  return root;
}

export const ims = {
  /**
   * GU on the I/O PCB: the input message into `area`. Status QC when there
   * is none left.
   * @param {Pcb} pcb
   * @param {object} area
   * @param {Layout} layout
   */
  async gu(pcb, area, layout) {
    if (pcb.input === null) {
      pcb.STATUS = "QC";
      return;
    }
    decode(pcb.input, area, layout);
    pcb.input = null;
    pcb.STATUS = "  ";
  },
  /**
   * ISRT on the I/O PCB: `area` as the reply.
   * @param {Pcb} pcb
   * @param {object} area
   * @param {Layout} layout
   */
  async isrt(pcb, area, layout) {
    pcb.output.push(encode(area, layout));
    pcb.STATUS = "  ";
  },
};

/**
 * @typedef {object} Database what the generated SQL runs on
 * @property {(sql: string, params: unknown[]) => Promise<{ rows: unknown[][], count: number }>} query
 *   count is the rows read or changed; a failure throws, with Db2's sqlcode if it has one
 */

/** @type {Database | null} */
let database = null;

/**
 * Makes the generated SQL run on `db`, for tests or another database.
 * @param {Database} db
 */
export function setDatabase(db) {
  database = db;
}

/**
 * SQLite in the file SQLITE: its tables are made from sqlite.sql when
 * missing. SQLite has no schemas, so a table SCHEMA.NAME is named
 * "SCHEMA.NAME", and a few Db2 words are swapped for SQLite's.
 * @param {string} path
 * @returns {Promise<Database>}
 */
async function sqlite(path) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path);
  const ddl = readFileSync(new URL("./sqlite.sql", import.meta.url), "utf-8");
  db.exec(ddl);
  const tables = [...ddl.matchAll(/^CREATE TABLE IF NOT EXISTS "([^".]+)\.([^"]+)"/gm)].map((m) => [m[1], m[2]]);
  const escape = (/** @type {string} */ s) => s.replace(/[$#@]/g, "\\$&");
  const qualified = tables.length
    ? new RegExp(`(?<![\\w$#@"])(${tables.map(([schema, name]) => `${escape(schema)}\\s*\\.\\s*${escape(name)}`).join("|")})(?![\\w$#@])`, "gi")
    : null;
  /** @param {string} text */
  const translate = (text) =>
    text
      .split(/('(?:[^']|'')*')/)
      .map((part, i) =>
        i % 2
          ? part
          : (qualified ? part.replace(qualified, (m) => `"${m.replace(/\s+/g, "").toUpperCase()}"`) : part)
              .replace(/\bCURRENT\s+(DATE|TIME|TIMESTAMP)\b/gi, "CURRENT_$1")
              .replace(/\bFETCH\s+FIRST\s+(\d+)\s+ROWS?\s+ONLY\b/gi, "LIMIT $1")
              .replace(/\bFETCH\s+FIRST\s+ROW\s+ONLY\b/gi, "LIMIT 1")
              .replace(/\bWITH\s+(UR|CS|RS|RR)\s*$/i, ""),
      )
      .join("");
  /** @type {Map<string, import("node:sqlite").StatementSync>} each SQL text prepared once, as programs run the same SQL again and again */
  const prepared = new Map();
  return {
    async query(text, params) {
      let statement = prepared.get(text);
      if (!statement) prepared.set(text, (statement = db.prepare(translate(text))));
      const values = /** @type {import("node:sqlite").SQLInputValue[]} */ (params.map((p) => (typeof p === "boolean" ? Number(p) : p === undefined ? null : p)));
      try {
        if (statement.columns().length) {
          statement.setReturnArrays(true);
          const rows = /** @type {unknown[][]} */ (/** @type {unknown} */ (statement.all(...values)));
          return { rows, count: rows.length };
        }
        return { rows: [], count: Number(statement.run(...values).changes) };
      } catch (error) {
        // Db2's SQLCODE for a duplicate key, which programs test for.
        if (/UNIQUE constraint failed/.test(String(error))) Object.assign(/** @type {object} */ (error), { sqlcode: -803 });
        throw error;
      }
    },
  };
}

/** SQLite when SQLITE names a file, else Db2 through ibm_db, connected by DB2_CONNECTION, on first use. */
async function connection() {
  if (database) return database;
  if (process.env.SQLITE) return (database = await sqlite(process.env.SQLITE));
  // @ts-ignore installed with the generated package, not with the extension
  const { default: ibmdb } = await import("ibm_db");
  const conn = await ibmdb.open(process.env.DB2_CONNECTION ?? "");
  database = {
    async query(sql, params) {
      if (/^\s*(SELECT|WITH|VALUES)\b/i.test(sql)) {
        const rows = await conn.query(sql, params);
        return { rows: rows.map((/** @type {object} */ row) => Object.values(row)), count: rows.length };
      }
      const statement = await conn.prepare(sql);
      const count = await statement.executeNonQuery(params);
      await statement.close();
      return { rows: [], count };
    },
  };
  return database;
}

/**
 * Runs SQL with the values of its host variables. sqlcode is as Db2 sets
 * it: 100 when a SELECT, UPDATE or DELETE finds no row.
 * @param {string} text
 * @param {unknown[]} params
 */
export async function sql(text, params) {
  try {
    const { rows, count } = await (await connection()).query(text, params);
    return { sqlcode: count === 0 && /^\s*(SELECT|WITH|UPDATE|DELETE)\b/i.test(text) ? 100 : 0, rows };
  } catch (error) {
    const sqlcode = /** @type {{ sqlcode?: unknown }} */ (error)?.sqlcode;
    console.error(`[PLG050E] SQL failed: ${text}\n`, error);
    return { sqlcode: typeof sqlcode === "number" ? sqlcode : -1, rows: [] };
  }
}

/**
 * OPEN of a cursor: its rows, fetched one by one.
 * @param {string} text
 * @param {unknown[]} params
 */
export async function openCursor(text, params) {
  const { sqlcode, rows } = await sql(text, params);
  return { sqlcode: sqlcode === 100 ? 0 : sqlcode, rows, next: 0 };
}

/**
 * FETCH: the cursor's next row, sqlcode 100 after the last.
 * @param {{ rows: unknown[][], next: number } | undefined} cursor
 */
export function fetchCursor(cursor) {
  if (!cursor) return { sqlcode: -501, row: undefined };
  const row = cursor.rows[cursor.next];
  if (row) cursor.next++;
  return { sqlcode: row ? 0 : 100, row };
}

/**
 * A segment's column: name, first byte (0-based), bytes, how Db2 holds it
 * and its precision.
 * @typedef {[string, number, number, "CHAR" | "DECIMAL" | "INTEGER" | "FLOAT" | "BIT", string]} Column
 * @typedef {{ parent: string | null, position: number, key: string | null, unique: boolean, columns: Column[], fields: Record<string, string> }} Segment
 *   position: the segment's in the DBD, its order in the hierarchy; key: its sequence field's column;
 *   fields: the column of each DBD field an SSA can name
 * @typedef {{ name: string, segments: Record<string, Segment> }} Dbd
 * An IMS database as Db2 tables: DBD.SEGMENT, a row each segment, with
 * IMS_ID, IMS_PARENT (the parent's IMS_ID) and the segment's columns.
 * @typedef {{ segment: string, id: number, key: unknown }} Level
 * @typedef {{ path: Level[], parentage: Level[], held: boolean }} Position
 *   path: down to the segment last got or inserted; parentage: down to the one GU or GN got last, GNP's parent
 */

/** @type {WeakMap<object, Position>} where each DB PCB is in its database */
const positions = new WeakMap();

/** The segments from the root down to `name`. @param {Dbd} dbd @param {string} name */
function chainOf(dbd, name) {
  /** @type {string[]} */
  const chain = [];
  for (let at = /** @type {string | null} */ (name); at; at = dbd.segments[at]?.parent ?? null) chain.unshift(at);
  return chain;
}

/**
 * An SSA's segment and its qualification: `NAME    *CC(FIELD   OP VALUE&...)`,
 * each value as long as its field.
 * @param {Dbd} dbd
 * @param {unknown} ssa its text, or a structure of CHAR fields
 */
function parseSsa(dbd, ssa) {
  const text = typeof ssa === "string" ? ssa : leavesOf(/** @type {object} */ (ssa)).map((p) => String(get(ssa, p))).join("");
  const name = /^[^ (*]*/.exec(text)?.[0] ?? "";
  const segment = dbd.segments[name];
  if (!segment) throw new Error(`[PLG076E] the SSA ${JSON.stringify(text)} names no segment of ${dbd.name}`);
  /** @type {{ column: Column, op: string, value: string, or: boolean }[]} */
  const tests = [];
  let at = name.length;
  while (text[at] === " " && at < 8) at++;
  if (text[at] === "*") while (at < text.length && text[at] !== "(" && text[at] !== " ") at++;
  if (text[at] !== "(") return { name, tests };
  at++;
  for (;;) {
    const field = text.slice(at, at + 8).trim();
    const columnName = segment.fields[field];
    const column = segment.columns.find((c) => c[0] === columnName);
    if (!column) throw new Error(`[PLG077E] the SSA ${JSON.stringify(text)} tests ${field}, no field of ${name} in ${dbd.name}`);
    const op = text.slice(at + 8, at + 10).trim();
    const sqlOp = { "=": "=", EQ: "=", ">": ">", GT: ">", "<": "<", LT: "<", ">=": ">=", "=>": ">=", GE: ">=", "<=": "<=", "=<": "<=", LE: "<=", "¬=": "<>", "!=": "<>", "=¬": "<>", NE: "<>", "<>": "<>" }[op];
    if (!sqlOp) throw new Error(`[PLG078E] the SSA ${JSON.stringify(text)} has the operator ${JSON.stringify(op)}`);
    const value = text.slice(at + 10, at + 10 + column[2]);
    at += 10 + column[2];
    const next = text[at] ?? ")";
    tests.push({ column, op: sqlOp, value, or: false });
    if (next === ")") break;
    if (tests.length && (next === "|" || next === "+")) tests[tests.length - 1].or = true;
    at++;
  }
  return { name, tests };
}

/** A column's value as the program sees it. @param {Column} column @param {unknown} value */
function fromColumn(column, value) {
  if (column[3] === "CHAR") return char(value ?? "", column[2]);
  if (column[3] === "BIT") return Boolean(Number(value));
  return Number(value ?? 0);
}

/** A value as its column holds it. @param {Column} column @param {unknown} value */
function toColumn(column, value) {
  if (column[3] === "CHAR") return char(value ?? "", column[2]);
  if (column[3] === "BIT") return value === true || value === "1" ? 1 : 0;
  return typeof value === "string" ? Number(value.trim() || 0) : Number(value ?? 0);
}

/**
 * The text of bytes `from` to `from + length` of pieces of text, each a
 * column or field with its first byte; blanks where none lies.
 * @param {{ start: number, text: string }[]} pieces
 * @param {number} from
 * @param {number} length
 */
function textAt(pieces, from, length) {
  let text = " ".repeat(length);
  for (const { start, text: piece } of pieces) {
    const a = Math.max(start, from);
    const b = Math.min(start + piece.length, from + length);
    if (a < b) text = text.slice(0, a - from) + piece.slice(a - start, b - start) + text.slice(b - from);
  }
  return text;
}

/**
 * Copies values between the fields of an I/O area and a segment's columns
 * by where they lie: a field and a column on the same bytes, or CHAR fields
 * and CHAR columns splitting the same text differently.
 * @param {{ start: number, length: number, char: boolean, value: unknown }[]} from
 * @param {{ start: number, length: number, char: boolean }[]} to
 * @param {string} what for the error
 */
function byBytes(from, to, what) {
  const pieces = from.filter((f) => f.char).map((f) => ({ start: f.start, text: String(char(f.value, f.length)) }));
  return to.map((t) => {
    const same = from.find((f) => f.start === t.start && f.length === t.length);
    if (same) return same.value;
    const overlapping = from.filter((f) => f.start < t.start + t.length && t.start < f.start + f.length);
    if (!t.char || overlapping.some((f) => !f.char)) throw new Error(`[PLG075E] ${what}: bytes ${t.start + 1} to ${t.start + t.length} are a number on one side and not on the other`);
    return textAt(pieces, t.start, t.length);
  });
}

/**
 * The I/O area's fields with their bytes: a structure by its layout; a CHAR
 * holding a segment's columns by their order; a CHAR's text by the columns'
 * bytes.
 * @param {any} area the structure, or a Ref to the CHAR
 * @param {Layout | null} layout
 * @param {Segment} segment
 */
function areaFields(area, layout, segment) {
  if (layout) {
    let start = 0;
    return layout.map(([path, kind, , length]) => {
      const field = { start, length, char: kind === "CHAR", value: get(area, path) };
      start += length;
      return field;
    });
  }
  const value = area.get();
  if (typeof value === "object" && value !== null) {
    const paths = leavesOf(value);
    if (paths.length !== segment.columns.length) throw new Error(`[PLG079E] the I/O area holds ${paths.length} fields, the segment ${segment.columns.length} columns`);
    return segment.columns.map((c, i) => ({ start: c[1], length: c[2], char: c[3] === "CHAR", value: get(value, paths[i]) }));
  }
  return segment.columns.map((c) => ({ start: c[1], length: c[2], char: c[3] === "CHAR", value: c[3] === "CHAR" ? textAt([{ start: 0, text: String(value) }], c[1], c[2]) : String(value).slice(c[1], c[1] + c[2]) }));
}

/**
 * Sets a DB PCB's fields by their place in it, whatever the program calls
 * them: DBDNAME, SEGLEVEL, STATUS, PROCOPT, a reserved word, SEGNAME,
 * KEYLEN, NUMSENS, KEYFB.
 * @param {any} pcb
 * @param {Record<number, unknown>} values
 */
function setPcb(pcb, values) {
  const paths = leavesOf(pcb);
  for (const [i, value] of Object.entries(values)) {
    const path = paths[Number(i)];
    const now = path && get(pcb, path);
    if (path) put(pcb, path, typeof now === "number" ? Number(value) : typeof now === "string" ? char(value, now.length) : value);
  }
}

/**
 * A DL/I call on a DB PCB, run as SQL on the database's tables: GU, GN, GNP
 * and their hold forms read in IMS's hierarchic order (each level by its
 * key, twins by IMS_ID); ISRT, REPL and DLET change the rows. Sets the
 * PCB's STATUS: blank, GE (not found), GB (end of the database), II (the
 * key is there), DJ (no segment held), DA (REPL changed the key), AD (an
 * unknown function).
 * @param {string} fn
 * @param {any} pcb
 * @param {any} area the I/O area, a structure or a Ref to a CHAR
 * @param {Layout | null} layout the structure's fields
 * @param {unknown[]} ssas
 * @param {Dbd} dbd
 */
export async function dli(fn, pcb, area, layout, ssas, dbd) {
  try {
    return await dliCall(fn, pcb, area, layout, ssas, dbd);
  } catch (error) {
    if (error instanceof Error && /^\[PLG07\dE\]/.test(error.message)) throw error;
    console.error(`[PLG080E] ${fn} on ${dbd.name} failed\n`, error);
    throw new Error(`[PLG080E] ${fn} on ${dbd.name} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/** dli without its error handling. @param {string} fn @param {any} pcb @param {any} area @param {Layout | null} layout @param {unknown[]} ssas @param {Dbd} dbd */
async function dliCall(fn, pcb, area, layout, ssas, dbd) {
  const call = fn.trim().toUpperCase();
  const position = positions.get(pcb) ?? { path: [], parentage: [], held: false };
  positions.set(pcb, position);
  const parsed = ssas.map((s) => parseSsa(dbd, s));
  const db = await connection();
  /** @param {string} status @param {Level[]} [path] */
  const done = (status, path) => {
    const at = path ?? position.path;
    const last = at[at.length - 1];
    const keys = at.map((l) => {
      const segment = dbd.segments[l.segment];
      const column = segment.columns.find((c) => c[0] === segment.key);
      return column ? char(l.key, column[2]) : "";
    });
    setPcb(pcb, { 0: dbd.name, 1: two(at.length), 2: status, 5: last?.segment ?? "", 6: keys.join("").length, 8: keys.join("") });
    console.log(`[DLI] ${call} ${dbd.name} ${parsed.map((p) => p.name).join("/")}: ${JSON.stringify(status)}`);
  };
  const table = (/** @type {string} */ name) => `${dbd.name}.${name}`;

  if (call === "REPL" || call === "DLET") {
    const last = position.path[position.path.length - 1];
    if (!position.held || !last) return done("DJ");
    position.held = false;
    if (call === "DLET") {
      await db.query(`DELETE FROM ${table(last.segment)} WHERE IMS_ID = ?`, [last.id]);
      return done("  ");
    }
    const segment = dbd.segments[last.segment];
    const values = byBytes(areaFields(area, layout, segment), segment.columns.map((c) => ({ start: c[1], length: c[2], char: c[3] === "CHAR" })), `REPL of ${last.segment}`);
    const keyAt = segment.columns.findIndex((c) => c[0] === segment.key);
    if (keyAt >= 0 && toColumn(segment.columns[keyAt], values[keyAt]) !== toColumn(segment.columns[keyAt], last.key)) return done("DA");
    const changed = segment.columns.filter((_, i) => i !== keyAt);
    await db.query(`UPDATE ${table(last.segment)} SET ${changed.map((c) => `${c[0]} = ?`).join(", ")} WHERE IMS_ID = ?`, [
      ...changed.map((c) => toColumn(c, values[segment.columns.indexOf(c)])),
      last.id,
    ]);
    return done("  ");
  }

  /**
   * The first path down to `target` in hierarchic order, each level tested
   * by its SSA, below `fixed` (ids of the upper levels), after `after` (a
   * position) when given.
   * @param {string} target
   * @param {Map<string, ReturnType<typeof parseSsa>>} bySegment
   * @param {number[]} fixed
   * @param {Level[] | null} after
   */
  const first = async (target, bySegment, fixed, after) => {
    const chain = chainOf(dbd, target);
    const segment = dbd.segments[target];
    const from = chain.map((name, i) => (i === 0 ? `${table(name)} T0` : `JOIN ${table(name)} T${i} ON T${i}.IMS_PARENT = T${i - 1}.IMS_ID`)).join(" ");
    /** @type {string[]} */
    const where = [];
    /** @type {unknown[]} */
    const params = [];
    fixed.forEach((id, i) => {
      where.push(`T${i}.IMS_ID = ?`);
      params.push(id);
    });
    chain.forEach((name, i) => {
      const tests = bySegment.get(name)?.tests ?? [];
      if (!tests.length) return;
      const terms = [];
      let term = [];
      for (const t of tests) {
        term.push(`T${i}.${t.column[0]} ${t.op} ?`);
        params.push(toColumn(t.column, t.value));
        if (t.or) {
          terms.push(term.join(" AND "));
          term = [];
        }
      }
      terms.push(term.join(" AND "));
      where.push(`(${terms.join(" OR ")})`);
    });
    /** @type {[string, unknown][]} the order of a path: each level's key, then its IMS_ID */
    const order = chain.flatMap((name, i) => {
      const key = dbd.segments[name].key;
      return /** @type {[string, unknown][]} */ ([...(key ? [[`T${i}.${key}`, null]] : []), [`T${i}.IMS_ID`, null]]);
    });
    if (after) {
      let common = 0;
      while (common < chain.length && common < after.length && chain[common] === after[common].segment) common++;
      const equalIsAfter =
        common === after.length ? chain.length > common : common === chain.length ? false : dbd.segments[chain[common]].position > dbd.segments[after[common].segment].position;
      /** @type {[string, unknown][]} */
      const tuple = after.slice(0, common).flatMap((l, i) => {
        const key = dbd.segments[l.segment].key;
        return /** @type {[string, unknown][]} */ ([...(key ? [[`T${i}.${key}`, l.key]] : []), [`T${i}.IMS_ID`, l.id]]);
      });
      if (tuple.length) {
        const ors = tuple.map((_, j) => [...tuple.slice(0, j).map(([c]) => `${c} = ?`), `${tuple[j][0]} > ?`].join(" AND "));
        const values = tuple.flatMap((_, j) => [...tuple.slice(0, j).map(([, v]) => v), tuple[j][1]]);
        if (equalIsAfter) {
          ors.push(tuple.map(([c]) => `${c} = ?`).join(" AND "));
          values.push(...tuple.map(([, v]) => v));
        }
        where.push(`(${ors.join(" OR ")})`);
        params.push(...values);
      }
    }
    const columns = [...chain.map((_, i) => `T${i}.IMS_ID`), ...chain.map((name, i) => (dbd.segments[name].key ? `T${i}.${dbd.segments[name].key}` : "NULL")), ...segment.columns.map((c) => `T${chain.length - 1}.${c[0]}`)];
    // Aliased: a driver giving rows by column name would merge a key column selected twice.
    const { rows } = await db.query(`SELECT ${columns.map((c, i) => `${c} AS C${i}`).join(", ")} FROM ${from}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order.map(([c]) => c).join(", ")} LIMIT 1`, params);
    const row = rows[0];
    if (!row) return null;
    /** @type {Level[]} */
    const path = chain.map((name, i) => ({ segment: name, id: Number(row[i]), key: row[chain.length + i] }));
    return { path, values: row.slice(2 * chain.length) };
  };

  if (call === "ISRT") {
    const last = parsed[parsed.length - 1];
    if (!last) return done("AC");
    const segment = dbd.segments[last.name];
    const chain = chainOf(dbd, last.name);
    const bySegment = new Map(parsed.slice(0, -1).map((p) => [p.name, p]));
    /** @type {number | null} */
    let parent = null;
    /** @type {Level[]} */
    let parentPath = [];
    if (segment.parent) {
      // Levels without an SSA stay where the PCB is.
      const fixed = [];
      for (let i = 0; i < chain.length - 1 && !bySegment.has(chain[i]) && position.path[i]?.segment === chain[i]; i++) fixed.push(position.path[i].id);
      const found = await first(segment.parent, bySegment, fixed, null);
      if (!found) return done("GE");
      parentPath = found.path;
      parent = found.path[found.path.length - 1].id;
    }
    const values = byBytes(areaFields(area, layout, segment), segment.columns.map((c) => ({ start: c[1], length: c[2], char: c[3] === "CHAR" })), `ISRT of ${last.name}`).map((v, i) =>
      toColumn(segment.columns[i], v),
    );
    const keyAt = segment.columns.findIndex((c) => c[0] === segment.key);
    const parentTest = parent === null ? "IMS_PARENT IS NULL" : "IMS_PARENT = ?";
    const parentParams = parent === null ? [] : [parent];
    if (keyAt >= 0 && segment.unique) {
      const { rows } = await db.query(`SELECT IMS_ID FROM ${table(last.name)} WHERE ${parentTest} AND ${segment.key} = ?`, [...parentParams, values[keyAt]]);
      if (rows.length) return done("II", [...parentPath, { segment: last.name, id: Number(rows[0][0]), key: values[keyAt] }]);
    }
    await db.query(`INSERT INTO ${table(last.name)} (IMS_PARENT, ${segment.columns.map((c) => c[0]).join(", ")}) VALUES (?, ${segment.columns.map(() => "?").join(", ")})`, [parent, ...values]);
    const { rows } = await db.query(
      `SELECT IMS_ID FROM ${table(last.name)} WHERE ${parentTest}${keyAt >= 0 ? ` AND ${segment.key} = ?` : ""} ORDER BY IMS_ID DESC LIMIT 1`,
      [...parentParams, ...(keyAt >= 0 ? [values[keyAt]] : [])],
    );
    position.path = [...parentPath, { segment: last.name, id: Number(rows[0]?.[0]), key: keyAt >= 0 ? values[keyAt] : null }];
    return done("  ");
  }

  const hold = call.startsWith("GH");
  const kind = hold ? `G${call.slice(2)}` : call;
  if (kind !== "GU" && kind !== "GN" && kind !== "GNP") return done("AD");
  const bySegment = new Map(parsed.map((p) => [p.name, p]));
  const parentage = kind === "GNP" ? position.parentage : [];
  if (kind === "GNP" && !parentage.length) return done("GP");
  // An unqualified GN gets the next segment of any type below the parentage.
  const targets = parsed.length
    ? [parsed[parsed.length - 1].name]
    : Object.keys(dbd.segments).filter((name) => {
        const chain = chainOf(dbd, name);
        return chain.length > parentage.length && parentage.every((l, i) => chain[i] === l.segment);
      });
  /** @type {Awaited<ReturnType<typeof first>>} */
  let best = null;
  for (const target of targets) {
    const chain = chainOf(dbd, target);
    if (!parentage.every((l, i) => chain[i] === l.segment) || chain.length <= parentage.length) continue;
    const found = await first(target, bySegment, parentage.map((l) => l.id), kind === "GU" ? null : position.path);
    if (found && (!best || before(dbd, found.path, best.path))) best = found;
  }
  if (!best) return done(kind === "GN" ? "GB" : "GE");
  const name = best.path[best.path.length - 1].segment;
  const segment = dbd.segments[name];
  const fields = segment.columns.map((c, i) => ({ start: c[1], length: c[2], char: c[3] === "CHAR", value: fromColumn(c, best?.values[i]) }));
  if (layout) {
    let start = 0;
    const to = layout.map(([, kind, , length]) => {
      const field = { start, length, char: kind === "CHAR" };
      start += length;
      return field;
    });
    const values = byBytes(fields, to, `${call} of ${name}`);
    layout.forEach(([path, kind, , length], i) => put(area, path, kind === "CHAR" ? char(values[i], length) : kind === "BIT" ? Boolean(values[i]) : Number(values[i]) || 0));
  } else {
    /** @type {Record<string, unknown>} */
    const row = Object.fromEntries(segment.columns.map((c, i) => [c[0], fields[i].value]));
    held.add(row);
    area.set(row);
  }
  position.path = best.path;
  if (kind !== "GNP") position.parentage = best.path;
  position.held = hold;
  return done("  ");
}

/**
 * Whether path `a` comes before `b` in hierarchic order.
 * @param {Dbd} dbd @param {Level[]} a @param {Level[]} b
 */
function before(dbd, a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i].segment !== b[i].segment) return dbd.segments[a[i].segment].position < dbd.segments[b[i].segment].position;
    const key = dbd.segments[a[i].segment].key;
    if (key && a[i].key !== b[i].key) return /** @type {any} */ (a[i].key) < /** @type {any} */ (b[i].key);
    if (a[i].id !== b[i].id) return a[i].id < b[i].id;
  }
  return a.length < b.length;
}

/** @type {Set<{ save(): void, close(): unknown }>} the files open, written out when the program ends */
const openFiles = new Set();
process.on("exit", () => {
  for (const file of openFiles) file.save();
});

/** The lines already in an output file its DD extends, DISP=MOD. @param {string} name @param {string | number} path */
const extended = (name, path) =>
  process.env[`DISP_${name}`] === "MOD" && typeof path === "string" && existsSync(path) ? readFileSync(path, "utf-8").split("\n").filter((line) => line !== "") : [];

/** The return code CALL PLIRETC sets, the step's when the program ends. */
let returnCode = 0;

/** CALL PLIRETC(n). @param {unknown} code */
export function setReturnCode(code) {
  returnCode = Number(code);
}

/**
 * Runs a file's ON unit for a condition, or fails without one.
 * @param {string} name
 * @param {(() => Promise<void>) | null} unit
 * @param {"ENDFILE" | "KEY"} condition
 * @param {string} why
 */
async function raise(name, unit, condition, why) {
  if (!unit) throw new Error(`[${condition === "ENDFILE" ? "PLG060E" : "PLG061E"}] ${condition} on ${name} without an ON unit: ${why}`);
  await unit();
}

/**
 * A PL/I record file, held as a text file of one record per line, a keyed
 * one as the key, a tab and the record, sorted by key. Its path is in
 * DD_<name> (the DD name, or the TITLE of its OPEN), else files/<name>.txt
 * under FILES. The records stay in memory while it is open and are written
 * when it closes, or when the program ends.
 */
export class RecordFile {
  /**
   * @param {string} name
   * @param {{ keyed: boolean, mode: "INPUT" | "OUTPUT" | "UPDATE" | null }} attributes from its declaration
   */
  constructor(name, { keyed, mode }) {
    this.name = name;
    this.keyed = keyed;
    this.mode = mode;
    this.path = "";
    /** @type {[string | null, string][] | null} key and record, null while closed */
    this.records = null;
    /** the record READ goes to next */
    this.next = 0;
    /** @type {number | null} the record read last, for REWRITE and DELETE without KEY */
    this.last = null;
    /** @type {(() => Promise<void>) | null} the ON ENDFILE unit */
    this.onEndfile = null;
    /** @type {(() => Promise<void>) | null} the ON KEY unit */
    this.onKey = null;
  }

  /** OPEN; READ, WRITE, REWRITE and DELETE open a closed file themselves. @param {{ mode?: "INPUT" | "OUTPUT" | "UPDATE", title?: string }} [options] */
  open({ mode, title } = {}) {
    if (this.records) return;
    const name = (title ?? this.name).trim();
    this.mode = mode ?? this.mode ?? "INPUT";
    this.path = process.env[`DD_${name}`] ?? join(process.env.FILES ?? "files", `${name}.txt`);
    /** @type {string[]} */
    let lines = [];
    if (this.mode === "OUTPUT") lines = extended(name, this.path);
    else if (existsSync(this.path)) lines = readFileSync(this.path, "utf-8").split("\n").filter((line) => line !== "");
    else if (this.mode !== "UPDATE") throw new Error(`[PLG062E] The file ${this.name} cannot be opened: ${this.path} does not exist`);
    this.records = lines.map((line) => {
      if (!this.keyed) return [null, line];
      const tab = line.indexOf("\t");
      return [line.slice(0, tab), line.slice(tab + 1)];
    });
    this.next = 0;
    this.last = null;
    openFiles.add(this);
  }

  /** CLOSE: written out unless it was only read. */
  close() {
    if (!this.records) return;
    this.save();
    this.records = null;
    openFiles.delete(this);
  }

  /** Writes the records to the file, unless it is only read. */
  save() {
    if (!this.records || this.mode === "INPUT") return;
    mkdirSync(dirname(this.path), { recursive: true });
    const lines = this.records.map(([key, record]) => (this.keyed ? `${key}\t${record}` : record));
    writeFileSync(this.path, lines.map((line) => `${line}\n`).join(""));
  }

  /** @param {string} key */
  find(key) {
    return /** @type {[string | null, string][]} */ (this.records).findIndex(([k]) => k === key);
  }

  /** @param {"ENDFILE" | "KEY"} condition @param {string} why */
  async raise(condition, why) {
    await raise(this.name, condition === "ENDFILE" ? this.onEndfile : this.onKey, condition, why);
  }

  /**
   * READ INTO: the next record, or the one with `key`, into `area` by
   * `layout`; a whole CHAR area has no layout. Null after ENDFILE or KEY.
   * @param {object | null} area
   * @param {Layout | null} layout
   * @param {string} [key]
   * @returns {Promise<{ key: string | null, text: string } | null>}
   */
  async read(area, layout, key) {
    this.open();
    const records = /** @type {[string | null, string][]} */ (this.records);
    const at = key === undefined ? this.next : this.find(key);
    if (key !== undefined && at < 0) {
      await this.raise("KEY", `no record has the key ${key}`);
      return null;
    }
    if (at >= records.length) {
      await this.raise("ENDFILE", "no record is left");
      return null;
    }
    this.next = at + 1;
    this.last = at;
    const [found, text] = records[at];
    if (area && layout) decode(text, area, layout);
    return { key: found, text };
  }

  /**
   * WRITE FROM: `area` as a new record, a keyed one with `key`.
   * @param {unknown} area
   * @param {Layout | null} layout
   * @param {string} [key]
   */
  async write(area, layout, key) {
    this.open({ mode: this.mode ?? "OUTPUT" });
    const records = /** @type {[string | null, string][]} */ (this.records);
    const text = layout ? encode(/** @type {object} */ (area), layout) : String(area);
    if (!this.keyed || key === undefined) {
      records.push([key ?? null, text]);
      return;
    }
    if (this.find(key) >= 0) return this.raise("KEY", `a record has the key ${key} already`);
    const at = records.findIndex(([k]) => /** @type {string} */ (k) > key);
    records.splice(at < 0 ? records.length : at, 0, [key, text]);
  }

  /**
   * REWRITE FROM: `area` in place of the record with `key`, or of the one
   * read last.
   * @param {unknown} area
   * @param {Layout | null} layout
   * @param {string} [key]
   */
  async rewrite(area, layout, key) {
    this.open({ mode: "UPDATE" });
    const at = await this.target(key);
    if (at === null) return;
    const records = /** @type {[string | null, string][]} */ (this.records);
    records[at] = [records[at][0], layout ? encode(/** @type {object} */ (area), layout) : String(area)];
  }

  /** DELETE: the record with `key`, or the one read last. @param {string} [key] */
  async delete(key) {
    this.open({ mode: "UPDATE" });
    const at = await this.target(key);
    if (at === null) return;
    /** @type {[string | null, string][]} */ (this.records).splice(at, 1);
    if (this.next > at) this.next--;
    this.last = null;
  }

  /** The record a REWRITE or DELETE means, null after KEY. @param {string} [key] */
  async target(key) {
    const at = key === undefined ? this.last : this.find(key);
    if (at === null || at < 0) {
      await this.raise("KEY", key === undefined ? "no record was read before" : `no record has the key ${key}`);
      return null;
    }
    return at;
  }
}

/**
 * A format item of PUT and GET EDIT: its letter and arguments, like
 * ["A", 8], ["F", 13, 2], ["P", "ZZ9V.99"], ["X", 2], ["COL", 5] or ["SKIP", 1].
 * @typedef {[string, ...any[]]} FormatItem
 * @typedef {{ skip?: number, page?: boolean, line?: number }} Control SKIP, PAGE and LINE before the data
 */

const CONTROL_FORMATS = new Set(["X", "COL", "SKIP", "LINE", "PAGE"]);

/** @param {unknown} value as PUT LIST and PUT DATA write it */
const listed = (value) => (typeof value === "boolean" ? `'${value ? 1 : 0}'B` : String(value));

/**
 * PL/I's stream I/O on text: PUT and GET with LIST, EDIT and DATA. On its
 * own it is PUT STRING and GET STRING; StreamFile is a file.
 */
export class Stream {
  /** @param {string} [input] the text GET reads */
  constructor(input = "") {
    /** @type {string[]} the lines PUT finished */
    this.lines = [];
    /** the line PUT writes to */
    this.current = "";
    /** its number on the page */
    this.lineNo = 1;
    /** @type {string[]} */
    this.input = input === "" ? [] : input.split("\n");
    this.row = 0;
    this.col = 0;
  }

  /** Before each PUT and GET: StreamFile opens itself. @param {"INPUT" | "OUTPUT"} mode */
  ready(mode) {}

  /** A line PUT finished. @param {string} line */
  done(line) {
    this.lines.push(line);
  }

  /** When GET runs out of text: ERROR here, ENDFILE on a file. */
  async ended() {
    throw new Error("[PLG063E] GET STRING ran out of text");
  }

  newLine() {
    this.done(this.current);
    this.current = "";
    this.lineNo++;
  }

  /** What PUT wrote, its lines joined. */
  text() {
    return [...this.lines, this.current].join("\n");
  }

  /** PUT SKIP, PAGE or LINE. @param {Control} [control] */
  control({ skip, page, line } = {}) {
    this.ready("OUTPUT");
    if (page) {
      if (this.current) this.newLine();
      this.current = "\f";
      this.lineNo = 1;
    }
    for (let i = 0; i < (skip ?? 0); i++) this.newLine();
    if (line !== undefined) {
      if (this.lineNo >= line) this.newLine();
      while (this.lineNo < line) this.newLine();
    }
    return this;
  }

  /** A control format on output; false for a data format. @param {FormatItem} item */
  put(item) {
    const [code, n = 1] = item;
    if (code === "X") this.current += " ".repeat(n);
    else if (code === "COL") {
      if (this.current.length > n - 1) this.newLine();
      this.current = this.current.padEnd(n - 1);
    } else if (code === "SKIP" || code === "LINE" || code === "PAGE") this.control({ [code.toLowerCase()]: code === "PAGE" ? true : n });
    return CONTROL_FORMATS.has(code);
  }

  /** @param {FormatItem} item a data format @param {unknown} value */
  static formatted(item, value) {
    const [code, w, d] = item;
    switch (code) {
      case "A":
        return w === undefined ? String(value) : char(value, w);
      case "B": {
        const bits = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
        return w === undefined ? bits : char(bits, w);
      }
      case "F": {
        const text = Number(value).toFixed(d ?? 0);
        return text.length > w ? "*".repeat(w) : text.padStart(w);
      }
      case "E": {
        const [mantissa, exponent] = Number(value).toExponential(d ?? 6).split("e");
        const text = `${mantissa}E${exponent.startsWith("-") ? "-" : "+"}${exponent.replace(/^[+-]/, "").padStart(2, "0")}`;
        return text.length > w ? "*".repeat(w) : text.padStart(w);
      }
      case "P":
        return toPic(Number(value), w);
      default:
        throw new Error(`[PLG064E] The format item ${code} is not supported`);
    }
  }

  /** PUT EDIT. @param {unknown[]} values @param {FormatItem[]} format @param {Control} [control] */
  edit(values, format, control) {
    this.control(control);
    let at = 0;
    for (const value of values) {
      for (let tried = 0; ; tried++) {
        if (tried > format.length) throw new Error("[PLG065E] The format list has no data format");
        const item = format[at];
        at = (at + 1) % format.length;
        if (this.put(item)) continue;
        this.current += Stream.formatted(item, value);
        break;
      }
    }
    return this;
  }

  /** PUT LIST: the values with a blank between. @param {unknown[]} values @param {Control} [control] */
  list(values, control) {
    this.control(control);
    for (const value of values) this.current += (this.current.replace("\f", "") ? " " : "") + listed(value);
    return this;
  }

  /** PUT DATA: NAME=value, strings quoted, and a semicolon. @param {[string, unknown][]} pairs @param {Control} [control] */
  data(pairs, control) {
    this.control(control);
    const items = pairs.map(([name, value]) => `${name}=${typeof value === "string" ? `'${value.replace(/'/g, "''")}'` : listed(value)}`);
    this.current += (this.current.replace("\f", "") ? " " : "") + items.join(" ") + ";";
    return this;
  }

  /** The next n characters, across lines; null at the end. @param {number} n */
  take(n) {
    let out = "";
    while (out.length < n) {
      if (this.row >= this.input.length) return null;
      const rest = this.input[this.row].slice(this.col);
      const need = n - out.length;
      if (rest.length >= need) {
        out += rest.slice(0, need);
        this.col += need;
      } else {
        out += rest;
        this.row++;
        this.col = 0;
      }
    }
    return out;
  }

  /** A control format on input; false for a data format. @param {FormatItem} item */
  skipOver(item) {
    const [code, n = 1] = item;
    if (code === "X") this.take(n);
    else if (code === "COL") {
      if (this.col > n - 1) this.row++;
      this.col = n - 1;
    } else if (code === "SKIP" || code === "LINE" || code === "PAGE") {
      this.row += n;
      this.col = 0;
    }
    return CONTROL_FORMATS.has(code);
  }

  /**
   * GET EDIT: `count` values; null when the text ran out.
   * @param {number} count
   * @param {FormatItem[]} format
   * @param {{ skip?: number }} [control]
   * @returns {Promise<unknown[] | null>}
   */
  async getEdit(count, format, { skip } = {}) {
    this.ready("INPUT");
    if (skip) this.skipOver(["SKIP", skip]);
    /** @type {unknown[]} */
    const values = [];
    let at = 0;
    while (values.length < count) {
      for (let tried = 0; ; tried++) {
        if (tried > format.length) throw new Error("[PLG065E] The format list has no data format");
        const item = format[at];
        at = (at + 1) % format.length;
        if (this.skipOver(item)) continue;
        const [code, w, d] = item;
        const width = code === "P" ? toPic(0, w).length : code === "A" && w === undefined ? Math.max(this.input[this.row]?.length - this.col, 0) : w;
        const text = this.take(width);
        if (text === null) {
          await this.ended();
          return null;
        }
        if (code === "A" || code === "B") values.push(text);
        else if (code === "P") values.push(fromPic(text, w));
        else {
          const number = Number(text.trim()) || 0;
          values.push(code === "F" && d && !text.includes(".") ? number / 10 ** d : number);
        }
        break;
      }
    }
    return values;
  }

  /**
   * GET LIST: `count` values separated by blanks or commas, strings in
   * quotes; null when the text ran out.
   * @param {number} count
   * @param {{ skip?: number }} [control]
   * @returns {Promise<unknown[] | null>}
   */
  async getList(count, { skip } = {}) {
    this.ready("INPUT");
    if (skip) this.skipOver(["SKIP", skip]);
    /** @type {unknown[]} */
    const values = [];
    while (values.length < count) {
      if (this.row >= this.input.length) {
        await this.ended();
        return null;
      }
      const line = this.input[this.row];
      const found = /^[\s,]*(?:'((?:[^']|'')*)'|([^\s,]+))/.exec(line.slice(this.col));
      if (!found) {
        this.row++;
        this.col = 0;
        continue;
      }
      this.col += found[0].length;
      if (found[1] !== undefined) values.push(found[1].replace(/''/g, "'"));
      else values.push(/^[+-]?(\d+\.?\d*|\.\d+)(E[+-]?\d+)?$/i.test(found[2]) ? Number(found[2]) : found[2]);
    }
    return values;
  }

  /**
   * GET DATA: `NAME=value` items, separated by blanks or commas, up to a
   * semicolon; an element as `NAME(1,2)=value`. Null when the text ran out.
   * @param {{ skip?: number }} [control]
   * @returns {Promise<{ name: string, subscripts: number[], value: unknown }[] | null>}
   */
  async getData({ skip } = {}) {
    this.ready("INPUT");
    if (skip) this.skipOver(["SKIP", skip]);
    /** @type {{ name: string, subscripts: number[], value: unknown }[]} */
    const items = [];
    for (;;) {
      if (this.row >= this.input.length) {
        await this.ended();
        return null;
      }
      const rest = this.input[this.row].slice(this.col);
      const end = /^[\s,]*;/.exec(rest);
      if (end) {
        this.col += end[0].length;
        return items;
      }
      const found = /^[\s,]*([A-Z_#@$][\w#@$.]*)\s*(?:\(([^)]*)\))?\s*=\s*(?:'((?:[^']|'')*)'|([^\s,;]+))/i.exec(rest);
      if (!found) {
        if (/\S/.test(rest.replace(/,/g, ""))) throw new Error(`[PLG072E] GET DATA cannot read ${rest.trim()}`);
        this.row++;
        this.col = 0;
        continue;
      }
      this.col += found[0].length;
      const text = found[4];
      items.push({
        name: found[1].toUpperCase(),
        subscripts: found[2] ? found[2].split(",").map(Number) : [],
        value: found[3] !== undefined ? found[3].replace(/''/g, "'") : /^[+-]?(\d+\.?\d*|\.\d+)(E[+-]?\d+)?$/i.test(text) ? Number(text) : text,
      });
    }
  }
}

/**
 * A PL/I stream file: SYSPRINT writes to stdout and SYSIN reads stdin,
 * unless DD_SYSPRINT or DD_SYSIN names a file; any other is at the path in
 * DD_<name>, else files/<name>.txt under FILES, as RecordFile.
 */
export class StreamFile extends Stream {
  /** @param {string} name @param {{ mode: "INPUT" | "OUTPUT" | null }} attributes from its declaration */
  constructor(name, { mode }) {
    super();
    this.name = name;
    this.mode = mode;
    /** @type {string | number} a path, or stdin */
    this.path = "";
    this.stdout = false;
    this.isOpen = false;
    /** @type {(() => Promise<void>) | null} the ON ENDFILE unit */
    this.onEndfile = null;
  }

  /** OPEN; PUT and GET open a closed file themselves. @param {{ mode?: "INPUT" | "OUTPUT", title?: string }} [options] */
  open({ mode, title } = {}) {
    if (this.isOpen) return;
    const name = (title ?? this.name).trim();
    this.mode = mode ?? this.mode ?? "OUTPUT";
    const dd = process.env[`DD_${name}`];
    this.stdout = !dd && name === "SYSPRINT";
    this.path = dd ?? (name === "SYSIN" ? 0 : join(process.env.FILES ?? "files", `${name}.txt`));
    this.lines = this.mode === "OUTPUT" ? extended(name, this.path) : [];
    this.current = "";
    this.lineNo = 1;
    this.row = 0;
    this.col = 0;
    if (this.mode === "INPUT") {
      if (typeof this.path === "string" && !existsSync(this.path)) throw new Error(`[PLG062E] The file ${this.name} cannot be opened: ${this.path} does not exist`);
      this.input = readFileSync(this.path, "utf-8").split("\n");
      if (this.input.at(-1) === "") this.input.pop();
    }
    this.isOpen = true;
    openFiles.add(this);
  }

  /** @param {"INPUT" | "OUTPUT"} mode */
  ready(mode) {
    this.open({ mode: this.mode ?? mode });
  }

  /** @param {string} line */
  done(line) {
    if (this.stdout) process.stdout.write(`${line}\n`);
    else this.lines.push(line);
  }

  async ended() {
    await raise(this.name, this.onEndfile, "ENDFILE", "no text is left");
  }

  /** CLOSE: the last line finished and written out. */
  close() {
    if (!this.isOpen) return;
    this.save();
    this.isOpen = false;
    openFiles.delete(this);
  }

  /** Writes what PUT wrote. */
  save() {
    if (this.mode !== "OUTPUT") return;
    if (this.current) {
      this.done(this.current);
      this.current = "";
    }
    if (this.stdout || typeof this.path !== "string") return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, this.lines.map((line) => `${line}\n`).join(""));
  }
}

/** The files a program has without declaring them. */
export const standardFiles = {
  SYSPRINT: new StreamFile("SYSPRINT", { mode: "OUTPUT" }),
  SYSIN: new StreamFile("SYSIN", { mode: "INPUT" }),
};

/** A GOTO out of an ON unit or a procedure, caught by the block with the label. */
export class GoTo extends Error {
  /** @param {string} label */
  constructor(label) {
    super(`[PLG068E] GOTO ${label}: no active block has the label`);
    this.name = "GoTo";
    this.label = label;
  }
}

/** STOP and EXIT: the program ends normally. */
export class Stop extends Error {
  constructor() {
    super("STOP");
    this.name = "Stop";
  }
}

/** The external programs running now; a program not RECURSIVE must not be called again before it returns. */
/** @type {Record<string, any>} the EXTERNAL variables, one each for all programs */
export const EXTERNAL = {};

const running = new Set();

/** @param {string} program */
export function begin(program) {
  if (running.has(program)) {
    const error = new Error(`[PLG081E] ${program} is called while it runs: ${[...running, program].join(" -> ")}, but it is not RECURSIVE`);
    console.error(error);
    throw error;
  }
  running.add(program);
}

/** @param {string} program */
export function end(program) {
  running.delete(program);
}

/** @typedef {Map<string, (() => Promise<void>) | null>} OnUnits a block's ON units by condition; null for ON ... SYSTEM */
/** @type {OnUnits[]} the ON units of the active blocks, the newest last */
const onUnits = [];
/** Errors an ERROR unit has seen, so the blocks further out do not run theirs too. */
const seen = new WeakSet();
let lastOncode = 0;
/** @type {Record<string, number>} */
const ONCODES = { ERROR: 9, CONDITION: 500, ZERODIVIDE: 320, FIXEDOVERFLOW: 310, OVERFLOW: 300, UNDERFLOW: 330, SIZE: 340, CONVERSION: 600, STRINGRANGE: 350, SUBSCRIPTRANGE: 520, STRINGSIZE: 150 };

/** The ON units of a block that has ON statements, active until `leave`. */
export function enter() {
  /** @type {OnUnits} */
  const units = new Map();
  onUnits.push(units);
  return units;
}

/** @param {OnUnits} units */
export function leave(units) {
  onUnits.splice(onUnits.lastIndexOf(units), 1);
}

/** The newest unit for a condition: undefined when there is none, null for SYSTEM. @param {string} condition */
function unitFor(condition) {
  for (let i = onUnits.length - 1; i >= 0; i--) if (onUnits[i].has(condition)) return onUnits[i].get(condition);
  return undefined;
}

/** ONCODE(): the code of the condition raised last. */
export function oncode() {
  return lastOncode;
}

/** @param {Error} error */
function ended(error) {
  seen.add(error);
  return error;
}

/**
 * SIGNAL: runs the newest ON unit for the condition (`ERROR`, `ZERODIVIDE`,
 * `CONDITION:NAME`, ...). After an ERROR unit returns the program ends;
 * after any other it goes on. Without a unit CONDITION is logged and goes
 * on, ERROR ends the program, and the others raise ERROR.
 * @param {string} condition
 * @returns {Promise<void>}
 */
export async function signal(condition) {
  lastOncode = ONCODES[condition.split(":")[0]] ?? 0;
  const unit = unitFor(condition);
  if (unit) {
    await unit();
    if (condition === "ERROR") throw ended(new Error("[PLG071E] the ON ERROR unit returned, so the program ends"));
    return;
  }
  if (condition.startsWith("CONDITION:")) return void console.error(`[PLG069W] ${condition} was signaled and no ON unit takes it`);
  if (condition === "ERROR") throw ended(new Error("[PLG070E] ERROR was signaled and no ON unit takes it"));
  return signal("ERROR");
}

/**
 * An error thrown in a block with ON units, as PL/I's ERROR: the newest
 * ERROR unit runs while the blocks are still active, and the program ends
 * unless it leaves with GOTO.
 * @param {unknown} error
 * @returns {Promise<unknown>} the error to throw on
 */
export async function failed(error) {
  if (error instanceof GoTo || error instanceof Stop || (error instanceof Error && seen.has(error))) return error;
  const unit = unitFor("ERROR");
  if (!unit) return error instanceof Error ? ended(error) : error;
  lastOncode = ONCODES.ERROR;
  await unit();
  return ended(new Error(`[PLG071E] the ON ERROR unit returned, so the program ends: ${error instanceof Error ? error.message : String(error)}`, { cause: error }));
}

/**
 * Where an error thrown in a GOTO dispatcher goes: the label of a GoTo to
 * one of `labels`; any other error is ERROR first, whose unit may GOTO.
 * Throws what does not land here.
 * @param {unknown} error
 * @param {string[]} labels
 * @returns {Promise<string>}
 */
export async function landing(error, labels) {
  try {
    if (!(error instanceof GoTo)) error = await failed(error);
  } catch (thrown) {
    error = thrown;
  }
  if (error instanceof GoTo && labels.includes(error.label)) return error.label;
  throw error;
}

/**
 * A DD of a JCL step: a dataset, its generation (+1, 0, -1) or member; a
 * SYSOUT class; in-stream data; or DUMMY.
 * @typedef {{ dsn?: string, generation?: number, member?: string, disp?: string, sysout?: string, data?: string, dummy?: boolean }} Dd
 * A COND test `[code, op, step?]` is true when `code op` the return code
 * of that step, or of any step run before.
 * @typedef {[number, string, string?]} CondTest
 * @typedef {{ rc: (step?: string) => number, abend: (step?: string) => boolean, ran: (step: string) => boolean }} JobState
 * @typedef {{ step: string, program: string, run: ((parm?: string) => Promise<unknown>) | null, parm: string | null, dds: Record<string, Dd>,
 *   cond?: { tests: CondTest[], even?: true, only?: true }, when?: (s: JobState) => boolean, afterAbend?: true,
 *   procedure?: string, procedureWhen?: (s: JobState) => boolean }} Step
 * procedure: the job's step that runs the procedure this step is in;
 * procedureWhen: the IF around it, tested once, before its first step.
 */

/**
 * Runs a JCL job's steps in order. Each DD is a file under DATASETS
 * (default "datasets"): DSN.txt, DSN/MEMBER.txt, a GDG generation as
 * DSN/G0001V00.txt (relative numbers count from the newest when the job
 * starts), SYSOUT as SYSOUT/JOB/STEP.DD.txt (SYSPRINT on stdout), in-stream
 * data as INSTREAM/JOB/STEP.DD.txt, DUMMY as the null device.
 *
 * A step is bypassed when a COND test is true, or its IF (`when`) is false.
 * After a step fails, only steps with COND EVEN or ONLY, or under an IF
 * testing ABEND, run; then the job fails. A true test of the job's COND
 * bypasses the rest.
 * @param {string} job
 * @param {Step[]} steps
 * @param {CondTest[]} [jobCond]
 * @returns {Promise<number>} the highest return code of its steps
 */
export async function runJob(job, steps, jobCond = []) {
  const root = process.env.DATASETS ?? "datasets";
  /** @type {Map<string, number>} the newest generation of each GDG when the job started */
  const newest = new Map();
  /** @param {string} dsn */
  const newestOf = (dsn) => {
    if (!newest.has(dsn)) {
      const numbers = existsSync(join(root, dsn)) ? readdirSync(join(root, dsn)).map((f) => /^G(\d{4})V00\.txt$/.exec(f)?.[1]).filter((n) => n !== undefined).map(Number) : [];
      newest.set(dsn, Math.max(0, ...numbers));
    }
    return /** @type {number} */ (newest.get(dsn));
  };
  /** @param {Step} step @param {string} name @param {Dd} dd */
  const pathOf = (step, name, dd) => {
    if (dd.dummy) return devNull;
    if (dd.sysout !== undefined) return name === "SYSPRINT" ? null : join(root, "SYSOUT", job, `${step.step}.${name}.txt`);
    if (dd.data !== undefined) {
      const path = join(root, "INSTREAM", job, `${step.step}.${name}.txt`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, dd.data);
      return path;
    }
    const dsn = /** @type {string} */ (dd.dsn);
    if (dsn.startsWith("&&")) return join(root, "TEMP", job, `${dsn.slice(2)}.txt`);
    if (dd.generation !== undefined) return join(root, dsn, `G${String(newestOf(dsn) + dd.generation).padStart(4, "0")}V00.txt`);
    if (dd.member !== undefined) return join(root, dsn, `${dd.member}.txt`);
    return join(root, `${dsn}.txt`);
  };

  /** @type {Map<string, { rc: number, abended: boolean }>} the steps that ran */
  const results = new Map();
  /** @type {Error | null} */
  let failure = null;
  /** @param {CondTest} test */
  const holds = ([code, op, name]) => {
    const codes = name === undefined ? [...results.values()].filter((r) => !r.abended).map((r) => r.rc) : results.has(name) && !results.get(name)?.abended ? [results.get(name)?.rc ?? 0] : [];
    return codes.some((rc) => ({ GT: code > rc, GE: code >= rc, EQ: code === rc, LT: code < rc, LE: code <= rc, NE: code !== rc })[op]);
  };
  /** @type {JobState} */
  const state = {
    rc: (name) => (name === undefined ? Math.max(0, ...[...results.values()].map((r) => r.rc)) : (results.get(name)?.rc ?? 0)),
    abend: (name) => (name === undefined ? failure !== null : (results.get(name)?.abended ?? false)),
    ran: (name) => results.has(name) && !results.get(name)?.abended,
  };

  /** @type {Map<string, boolean>} whether the IF around each procedure's EXEC was true */
  const procedures = new Map();
  let highest = 0;
  for (const step of steps) {
    if (step.procedure && step.procedureWhen && !procedures.has(step.procedure)) procedures.set(step.procedure, step.procedureWhen(state));
    const when = (step.procedure ? procedures.get(step.procedure) ?? true : true) && (step.when?.(state) ?? true);
    const bypass =
      jobCond.some(holds) ||
      (failure ? !(step.cond?.even || step.cond?.only || (step.afterAbend && when)) : step.cond?.only) ||
      (step.cond?.tests.some(holds) ?? false) ||
      !when;
    if (bypass) {
      console.error(`${job}.${step.step}: bypassed`);
      continue;
    }
    if (!step.run && step.program !== "IEFBR14") throw new Error(`[PLG066E] ${job}.${step.step}: the program ${step.program} is not translated`);
    /** @type {[string, string, Dd][]} */
    const files = Object.entries(step.dds).map(([name, dd]) => [name, pathOf(step, name, dd) ?? "", dd]);
    for (const [name, path, dd] of files) {
      if (path) process.env[`DD_${name}`] = path;
      if (dd.disp) process.env[`DISP_${name}`] = dd.disp.split(",")[0] || "NEW";
    }
    console.error(`${job}.${step.step}: ${step.program}`);
    returnCode = 0;
    let abended = false;
    try {
      if (step.run) await (step.parm === null ? step.run() : step.run(step.parm));
    } catch (error) {
      if (!(error instanceof Stop)) {
        abended = true;
        const failed = new Error(`[PLG067E] ${job}.${step.step} (${step.program}) ended abnormally: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        console.error(failed);
        failure ??= failed;
      }
    } finally {
      for (const file of [...openFiles]) file.close();
      for (const [name] of files) {
        delete process.env[`DD_${name}`];
        delete process.env[`DISP_${name}`];
      }
    }
    results.set(step.step, { rc: returnCode, abended });
    if (abended) continue;
    for (const [, path, dd] of files) if (dd.disp?.split(",")[1] === "DELETE" && path && existsSync(path)) rmSync(path);
    console.error(`${job}.${step.step}: return code ${returnCode}`);
    highest = Math.max(highest, returnCode);
  }
  if (failure) throw failure;
  return highest;
}
