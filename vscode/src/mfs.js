// Reads an IMS MFS format (FMT ... FMTEND) as the 3270 screen it describes:
// the literals as protected text, the other DFLDs as fields, placed by POS=
// and colored the way a 3279 colors them. Only the first DEV of a format is
// read, and only page 1 of a DPAGE.

import { hlasmLines } from "./source.js";

/**
 * Protected text: a literal DFLD.
 * @typedef {{ row: number, col: number, text: string, fg: string, gr: string | null }} MfsText
 *
 * A named DFLD, or an unnamed one at its position. Rows and columns from 0.
 * @typedef {object} MfsField
 * @property {string} name
 * @property {number} row
 * @property {number} col
 * @property {number} width
 * @property {boolean} protected output only, not typed into
 * @property {boolean} hidden ATTR=NODISP
 * @property {boolean} numeric ATTR=NUM
 * @property {string} fg a tn3270 host color name
 * @property {number} line of the DFLD, from 0
 *
 * @typedef {object} MfsFormat
 * @property {string} name
 * @property {number} line of the FMT statement, from 0
 * @property {number} rows
 * @property {number} cols
 * @property {{ row: number, col: number } | null} cursor DPAGE CURSOR=
 * @property {MfsText[]} texts
 * @property {MfsField[]} fields
 */

/** Screen sizes of the 3270 models, by the number in TYPE=(3270,n) or 3270-An. */
/** @type {Record<string, [number, number]>} */
const MODELS = { 1: [12, 40], 2: [24, 80], 3: [32, 80], 4: [43, 80], 5: [27, 132] };

const COLORS = { BLUE: "blue", RED: "red", PINK: "pink", GREEN: "green", TURQ: "turquoise", YELLOW: "yellow", NEUTRAL: "white" };

/**
 * @param {string} text an MFS source
 * @returns {MfsFormat[]}
 */
export function mfsFormats(text) {
  /** @type {MfsFormat[]} */
  const formats = [];
  /** @type {MfsFormat | null} */
  let format = null;
  let devices = 0;
  for (const { label, operation, operands, line } of statements(text)) {
    if (operation === "FMT") {
      format = { name: label, line, rows: 24, cols: 80, cursor: null, texts: [], fields: [] };
      formats.push(format);
      devices = 0;
      continue;
    }
    if (format === null) continue;
    if (operation === "DEV") devices++;
    if (devices > 1 && operation !== "FMTEND") continue;
    if (operation === "FMTEND") {
      format = null;
    } else if (operation === "DEV") {
      const type = keyword(operands, "TYPE") ?? "";
      const model = /3270\D*(\d)/.exec(type)?.[1] ?? "2";
      [format.rows, format.cols] = MODELS[model] ?? MODELS[2];
    } else if (operation === "DPAGE" && format.cursor === null) {
      const [row, col] = numbers(keyword(operands, "CURSOR"));
      if (row && col) format.cursor = { row: row - 1, col: col - 1 };
    } else if (operation === "DFLD") {
      const [row, col, page] = numbers(keyword(operands, "POS"));
      if (!row || !col || (page !== undefined && page !== 1)) continue;
      const literal = operands[0]?.startsWith("'") ? operands[0].slice(1, -1).replaceAll("''", "'") : null;
      const width = Number(keyword(operands, "LTH")) || literal?.length || 1;
      const attributes = list(keyword(operands, "ATTR"));
      const extended = list(keyword(operands, "EATTR"));
      const prot = attributes.includes("PROT") || (literal !== null && !attributes.includes("NOPROT"));
      const high = attributes.includes("HI");
      const named = extended.find((word) => word in COLORS);
      // A 3279 without an extended color shows the four combinations of
      // protected and intensified in four colors.
      const fg = named ? COLORS[/** @type {keyof COLORS} */ (named)] : prot ? (high ? "white" : "blue") : high ? "red" : "green";
      const gr = [high && "highlight", extended.includes("HUL") && "underline", extended.includes("HREV") && "reverse", extended.includes("HBLINK") && "blink"]
        .filter(Boolean)
        .join(",");
      if (literal !== null) {
        format.texts.push({ row: row - 1, col: col - 1, text: literal.slice(0, width), fg, gr: gr || null });
        continue;
      }
      format.fields.push({
        name: label || `R${row}C${col}`,
        row: row - 1,
        col: col - 1,
        width,
        protected: prot,
        hidden: attributes.includes("NODISP"),
        numeric: attributes.includes("NUM"),
        fg,
        line,
      });
    }
  }
  return formats;
}

/**
 * A DFLD of a format's first device, or an MFLD of a message. Lines from 1,
 * rows and columns from 1.
 * @typedef {object} MfsFieldFact
 * @property {string} screen the format or message
 * @property {"DFLD" | "MFLD"} kind
 * @property {string | null} name a DFLD's label, null for a literal
 * @property {string | null} dfld the DFLD an MFLD maps
 * @property {number | null} row
 * @property {number | null} col
 * @property {number | null} length
 * @property {number | null} segment the message segment, from 1
 * @property {number | null} offset of an MFLD's data in its segment after LL and ZZ, behind the two attribute bytes of ATTR=YES
 * @property {string | null} label the literal left of a DFLD on its row
 * @property {string | null} literal a literal DFLD's text, an MFLD's literal or default
 * @property {string} attributes the operands as written
 * @property {number} line
 */

/**
 * The fields of every format and message, for the graph.
 * @param {string} text an MFS source
 * @returns {MfsFieldFact[]}
 */
export function mfsFields(text) {
  /** @type {MfsFieldFact[]} */
  const fields = [];
  let screen = "";
  let devices = 0;
  let segment = 0;
  let offset = 0;
  /** @type {MfsFieldFact[]} the current format's DFLDs, to find labels in */
  let dflds = [];
  /** @param {string} value */
  const unquote = (value) => value.slice(1, value.lastIndexOf("'")).replaceAll("''", "'");
  for (const { label, operation, operands, line } of statements(text)) {
    if (operation === "FMT" || operation === "MSG") {
      screen = label;
      devices = 0;
      segment = 0;
      dflds = [];
      continue;
    }
    if (operation === "DEV") devices++;
    if (operation === "SEG") {
      segment++;
      offset = 0;
    }
    if (operation === "DFLD" && screen && devices === 1) {
      const [row, col] = numbers(keyword(operands, "POS"));
      const literal = operands[0]?.startsWith("'") ? unquote(operands[0]) : null;
      /** @type {MfsFieldFact} */
      const field = {
        screen, kind: "DFLD", name: literal === null ? label || null : null, dfld: null,
        row: row ?? null, col: col ?? null, length: Number(keyword(operands, "LTH")) || literal?.length || null,
        segment: null, offset: null, label: null, literal, attributes: operands.join(","), line: line + 1,
      };
      if (literal === null) {
        const left = dflds.filter((d) => d.literal !== null && d.row === field.row && (d.col ?? 0) < (field.col ?? 0));
        field.label = left.sort((a, b) => (b.col ?? 0) - (a.col ?? 0))[0]?.literal?.trim() || null;
      }
      dflds.push(field);
      fields.push(field);
    }
    if (operation === "MFLD" && screen) {
      // MFLD KDNR, MFLD (KDNR,'default'), MFLD 'literal', MFLD (,SCA)
      const first = operands[0] ?? "";
      const parts = first.startsWith("(") ? list(first.slice(0, first.lastIndexOf(")") + 1)) : [first];
      const dfld = parts[0] && !parts[0].startsWith("'") ? parts[0].toUpperCase() : null;
      const quoted = /'(?:[^']|'')*'/.exec(first)?.[0];
      const length = Number(keyword(operands, "LTH")) || (quoted ? unquote(quoted).length : null);
      const attributeBytes = keyword(operands, "ATTR")?.toUpperCase().startsWith("YES") ? 2 : 0;
      fields.push({
        screen, kind: "MFLD", name: null, dfld, row: null, col: null, length,
        segment: Math.max(segment, 1), offset: offset + attributeBytes, label: null, literal: quoted ? unquote(quoted) : null,
        attributes: operands.join(","), line: line + 1,
      });
      offset += attributeBytes + (length ?? 0);
    }
  }
  return fields;
}

/**
 * @param {string[]} operands
 * @param {string} name
 * @returns {string | undefined} the value of `name=`
 */
function keyword(operands, name) {
  return operands.find((operand) => operand.toUpperCase().startsWith(`${name}=`))?.slice(name.length + 1);
}

/** @param {string | undefined} value `(3,20)` or `((3,20))` @returns {number[]} */
function numbers(value) {
  return (value ?? "").match(/\d+/g)?.map(Number) ?? [];
}

/** @param {string | undefined} value `(PROT,HI)` or `PROT` @returns {string[]} */
function list(value) {
  return (value ?? "").toUpperCase().replace(/[()]/g, "").split(",");
}

/**
 * The statements of an assembler source: label, operation and the operands
 * split at the commas outside quotes and parentheses.
 * @param {string} text
 * @returns {{ label: string, operation: string, operands: string[], line: number }[]}
 */
function statements(text) {
  const result = [];
  for (const { line, segments } of hlasmLines(text)) {
    const head = /^(\S*)\s+(\S+)\s*/.exec(segments[0].text);
    if (!head) continue;

    // The operands run to the first blank outside quotes; one after a comma
    // on a continued line goes on in column 16 of the next.
    let operands = "";
    let quoted = false;
    let at = head[0].length;
    scan: for (let s = 0; s < segments.length; s++, at = 15) {
      const current = segments[s].text;
      for (; at < current.length; at++) {
        const c = current[at];
        if (c === " " && !quoted) {
          if (current[at - 1] === "," && s + 1 < segments.length) break;
          break scan;
        }
        if (c === "'") quoted = !quoted;
        operands += c;
      }
    }

    /** @type {string[]} */
    const split = [];
    let depth = 0;
    let from = 0;
    quoted = false;
    for (let at = 0; at <= operands.length; at++) {
      const c = operands[at];
      if (c === "'") quoted = !quoted;
      else if (!quoted && c === "(") depth++;
      else if (!quoted && c === ")") depth--;
      else if (at === operands.length || (!quoted && depth === 0 && c === ",")) {
        if (at > from) split.push(operands.slice(from, at));
        from = at + 1;
      }
    }
    result.push({ label: head[1].toUpperCase(), operation: head[2].toUpperCase(), operands: split, line });
  }
  return result;
}
