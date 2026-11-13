// Formats PL/I, JCL, HLASM (MFS, PSB and DBD gens) and Db2 DDL in the style of
// IBM's language references and the shop's code: the layout of every
// statement, the case of keywords and names, abbreviations (DCL, PROC, ...),
// string quotes, comment blanks, END labels and blank lines. Sequence numbers
// (columns 73-80) and PL/I's carriage control (column 1) are dropped.
// format() checks the result means what the source meant before returning it.
// Knows nothing about VS Code.

import { blankMargins } from "./source.js";

/** @typedef {import("./source.js").Language} Language */
/** @typedef {import("web-tree-sitter").Parser} Parser */
/** @typedef {import("web-tree-sitter").Node} Node */
/** @typedef {"upper" | "lower" | "keep"} Case */
/** @typedef {"short" | "long" | "keep"} Abbreviations */

/**
 * indent: blanks per level. keywordCase also covers SQL, assembler and the
 * letters in numbers ('1'B, 1E5); JCL is upper case always.
 * @typedef {{ indent: number, pli: Parser, keywordCase?: Case, identifierCase?: Case, abbreviations?: Abbreviations }} Options
 * @typedef {{ indent: number, pli: Parser, keywordCase: Case, identifierCase: Case, abbreviations: Abbreviations }} Style
 */

/**
 * The document's lines after formatting, or why it can't be formatted.
 * @typedef {{ lines: string[] } | { error: string }} Formatted
 */

/**
 * @param {Language} language
 * @param {string} text
 * @param {Options} options
 * @returns {Formatted}
 */
export function format(language, text, options) {
  /** @type {Style} */
  const style = { ...options, keywordCase: options.keywordCase ?? "upper", identifierCase: options.identifierCase ?? "upper", abbreviations: options.abbreviations ?? "short" };
  const code = blankMargins(text.replace(/\r$/gm, ""), language);
  const lines = code.split("\n").map((line) => line.trimEnd());
  let formatted;
  if (language === "pli") formatted = formatPli(lines, lines.join("\n"), style);
  else if (language === "jcl") formatted = { lines: formatJcl(lines) };
  else if (language === "hlasm") formatted = { lines: formatHlasm(lines, style) };
  else formatted = { lines: formatDb2(lines, style) };
  if ("error" in formatted) return formatted;
  const result = formatted.lines;
  while (result.length && !result[0]) result.shift();
  while (result.length && !result.at(-1)) result.pop();
  result.push("");
  const after = result.join("\n");
  const same = language === "pli" ? samePli(code, after, style.pli) : folded(language, code) === folded(language, after);
  if (!same) return { error: "[PLG041E] Formatting would change what the code means, so nothing was changed. This is a bug in the formatter." };
  return { lines: result };
}

/** @param {string} text @param {Case} how */
const cased = (text, how) => (how === "upper" ? text.toUpperCase() : how === "lower" ? text.toLowerCase() : text);

// What JCL, assembler and SQL say, whatever their blanks and case. JCL
// statements join and split, so their lines' // come and go.
/** @param {Language} language @param {string} text */
function folded(language, text) {
  return (language === "jcl" ? text.replace(/^\/\//gm, "") : text).replace(/\s+/g, "").toUpperCase();
}

// ---- Laying out tokens ------------------------------------------------------
// Every language but HLASM is printed from tokens: words, strings, comments
// and punctuation, each knowing whether a blank goes before it, how good a
// line break before it is, and whether a line must start with it.

/**
 * @typedef {object} Token
 * @property {string} text
 * @property {boolean} space a blank before it, when on the same line
 * @property {number} prio how good a line break before it is, 0 for never
 * @property {number} row where it started in the source, for comments
 * @property {number} endRow
 * @property {number} column
 * @property {boolean} [comment]
 * @property {number} [newline] it starts a line in this column
 * @property {number} [padTo] it starts at least in this column
 */

/** @param {string} text @param {Partial<Token>} rest @returns {Token} */
const token = (text, rest = {}) => ({ text, space: true, prio: 1, row: -1, endRow: -1, column: 0, ...rest });

/**
 * The tokens on lines from `col` on, wrapped before column `limit`. A wrapped
 * line goes on after the innermost open parenthesis or, outside any (or with
 * `align` off), `contOffset` in from the line it continues.
 * @param {Token[]} tokens
 * @param {number} col
 * @param {number} contOffset
 * @param {number} limit the longest a line may be
 * @param {boolean} [align]
 * @returns {string[]}
 */
function fill(tokens, col, contOffset, limit, align = true) {
  /** @type {Set<number>} */
  const forced = new Set();
  for (;;) {
    const { lines, overflow } = place(tokens, col, contOffset, limit, align, forced);
    if (overflow === undefined || forced.has(overflow)) return lines;
    forced.add(overflow);
  }
}

/**
 * One try of fill(): breaks only where it must and before the tokens in
 * `forced`, and says where the first line too long could best have broken.
 * @param {Token[]} tokens
 * @param {number} col
 * @param {number} contOffset
 * @param {number} limit
 * @param {boolean} align
 * @param {Set<number>} forced
 * @returns {{ lines: string[], overflow: number | undefined }}
 */
function place(tokens, col, contOffset, limit, align, forced) {
  /** @type {string[]} */
  const lines = [];
  let line = " ".repeat(col);
  let fresh = true;
  let base = col;
  /** @type {number[]} columns after the open parentheses */
  const parens = [];
  /** @type {{ index: number, score: number } | undefined} */
  let best;
  /** @type {number | undefined} */
  let overflow;
  let breakNext = false;
  let previousRow = -1;
  /** @param {number} column */
  const newLine = (column) => {
    if (!fresh) lines.push(line.trimEnd());
    line = " ".repeat(column);
    fresh = true;
    best = undefined;
  };
  const contColumn = () => {
    const paren = parens.at(-1);
    return align && paren !== undefined && paren <= limit - 24 ? paren : base + contOffset;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.newline !== undefined) {
      newLine(t.newline);
      base = t.newline;
    } else if (!fresh && (forced.has(i) || breakNext)) {
      newLine(contColumn());
    }
    breakNext = false;
    if (t.comment) {
      if (!fresh && t.row !== previousRow) newLine(contColumn());
      line = placeComment(lines, line, fresh, t, limit);
      fresh = false;
      breakNext = true;
      previousRow = t.endRow;
      continue;
    }
    let text = (fresh || !t.space ? "" : " ") + t.text;
    if (t.padTo !== undefined && line.length < t.padTo) text = " ".repeat(t.padTo - line.length) + t.text;
    if (!fresh && t.prio > 0) {
      const score = t.prio * 4 - parens.length;
      if (!best || score >= best.score) best = { index: i, score };
    }
    if (!fresh && overflow === undefined && line.length + text.length > limit) overflow = best?.index;
    line += text;
    fresh = false;
    if (t.text === "(") parens.push(line.length);
    else if (t.text === ")") parens.pop();
    previousRow = t.endRow;
  }
  if (!fresh) lines.push(line.trimEnd());
  return { lines, overflow };
}

// A comment goes after the code on its line, in its old column when that is
// free, else on a line of its own. A comment over several lines keeps its
// shape: its other lines move as far as its first.
/**
 * @param {string[]} lines the finished lines, which this adds to
 * @param {string} line the line being built
 * @param {boolean} fresh nothing but blanks on it yet
 * @param {Token} t
 * @param {number} limit
 * @returns {string} the new line being built
 */
function placeComment(lines, line, fresh, t, limit) {
  const parts = t.text.split("\n");
  const width = parts[0].length;
  let at = line.length;
  if (!fresh) {
    at = Math.max(line.length + 1, t.column);
    if (at + width > limit) at = line.length + 1;
    if (at + width > limit) {
      lines.push(line.trimEnd());
      line = " ".repeat(Math.max(line.search(/\S/), 0));
      at = line.length;
    }
  }
  line = line.padEnd(at) + parts[0];
  const shift = at - t.column;
  for (const part of parts.slice(1)) {
    lines.push(line.trimEnd());
    const blanks = part.search(/\S|$/);
    line = shift >= 0 ? " ".repeat(shift) + part : part.slice(Math.min(blanks, -shift));
  }
  return line;
}

/** Whether any line between two rows is blank. @param {string[]} lines @param {number} from @param {number} to */
function blankBetween(lines, from, to) {
  for (let row = from + 1; row < to; row++) if (!lines[row].trim()) return true;
  return false;
}

/** The finished line `last` as a token, to put a comment after it. @param {string} last @param {number} row */
const lineToken = (last, row) => token(last.trim(), { row, endRow: row, prio: 0 });

// ---- PL/I -------------------------------------------------------------------
// Code from column 2; statements one indent (the tab size) in from the DO,
// BEGIN, SELECT, PROC, ON, IF, WHEN or OTHERWISE they are in, END and ELSE
// level with it. A statement goes on one line when it fits, else it wraps
// after a comma or before an operator, aligned after its parenthesis. A
// structure's level-2 names stand under the level-1 name, each further level
// 2 further in, as in the Language Reference. EXEC SQL is laid out as SQL.
// A statement with a string over a line end is left as it is, but for its
// words. Keywords and names get their case, keywords their short or long form
// (DCL, PROC, GOTO, CONV), strings 'quotes', comments a blank inside, ¬ ^ | !
// the symbol the file uses most, a procedure's END its name; blocks start
// and end without blank lines, a nested procedure has one before it.

const PLI_LIMIT = 72;
// The Language Reference's abbreviations. G for GRAPHIC is left out: G is a
// name too often.
const ABBREVIATIONS = [
  ["PROC", "PROCEDURE"], ["OTHER", "OTHERWISE"], ["DCL", "DECLARE"], ["DFT", "DEFAULT"], ["GOTO", "GO TO"], ["ALLOC", "ALLOCATE"],
  ["INT", "INTERNAL"], ["EXT", "EXTERNAL"], ["DIM", "DIMENSION"], ["AUTO", "AUTOMATIC"], ["CTL", "CONTROLLED"], ["PTR", "POINTER"],
  ["ASGN", "ASSIGNABLE"], ["NONASGN", "NONASSIGNABLE"], ["CONN", "CONNECTED"], ["NONCONN", "NONCONNECTED"], ["DEF", "DEFINED"],
  ["POS", "POSITION"], ["INIT", "INITIAL"], ["SEQL", "SEQUENTIAL"], ["BUF", "BUFFERED"], ["UNBUF", "UNBUFFERED"], ["ENV", "ENVIRONMENT"],
  ["BIN", "BINARY"], ["CPLX", "COMPLEX"], ["DEC", "DECIMAL"], ["PREC", "PRECISION"], ["CHAR", "CHARACTER"], ["WCHAR", "WIDECHAR"],
  ["NONVAR", "NONVARYING"], ["VAR", "VARYING"], ["VARZ", "VARYINGZ"], ["PIC", "PICTURE"], ["CHARG", "CHARGRAPHIC"], ["NOCHARG", "NOCHARGRAPHIC"],
  ["RED", "REDUCIBLE"], ["IRRED", "IRREDUCIBLE"], ["ASM", "ASSEMBLER"], ["ACT", "ACTIVATE"], ["DEACT", "DEACTIVATE"], ["ANS", "ANSWER"],
  ["COL", "COLUMN"], ["MAR", "MARGINS"],
  ["ANYCOND", "ANYCONDITION"], ["ATTN", "ATTENTION"], ["COND", "CONDITION"], ["UNDF", "UNDEFINEDFILE"],
  ...[["CONV", "CONVERSION"], ["FOFL", "FIXEDOVERFLOW"], ["OFL", "OVERFLOW"], ["STRG", "STRINGRANGE"], ["STRZ", "STRINGSIZE"],
    ["SUBRG", "SUBSCRIPTRANGE"], ["UFL", "UNDERFLOW"], ["ZDIV", "ZERODIVIDE"]].flatMap(([s, l]) => [[s, l], [`NO${s}`, `NO${l}`]]),
];
const SHORT = new Map(ABBREVIATIONS.map(([s, l]) => [l, s]));
const LONG = new Map(ABBREVIATIONS.map(([s, l]) => [s, l]));
const GROUPS = new Set(["procedure_statement", "package_statement", "begin_statement", "do_statement", "select_statement"]);
const COMPOUND = new Set(["if_statement", "when_clause", "otherwise_clause", "on_statement", "labeled_statement"]);
const SPACED_BEFORE_PAREN = new Set(["WHEN", "SELECT", "IF", "WHILE", "UNTIL", "THEN", "ELSE", "DO", "TO", "BY", "DCL", "DECLARE", "AND", "OR", "NOT", "REPEAT", "UPTHRU", "DOWNTHRU", "RETURN"]);
const TIGHT_COMMAS = new Set(["precision", "dimension_attribute", "length_spec", "bound"]);
const LOGICAL = new Set(["&", "|", "!", "AND", "OR"]);

/**
 * @param {string[]} lines the source with its margins blanked
 * @param {string} code the same, as one text
 * @param {Style} style
 * @returns {Formatted}
 */
function formatPli(lines, code, { indent, pli, keywordCase, identifierCase, abbreviations }) {
  const tree = pli.parse(code);
  if (!tree) return { error: "[PLG043E] The PL/I parser gave no tree, so nothing was changed." };
  const root = tree.rootNode;
  if (root.hasError) {
    const bad = firstError(root);
    tree.delete();
    return { error: `[PLG039W] Not formatted: the PL/I parser can't read line ${(bad?.startPosition.row ?? 0) + 1}.` };
  }
  /** @type {string[]} */
  const out = [];
  /** @type {Map<number, string>} a bare END's id, the name it gets */
  const endLabels = new Map();

  // ¬ or ^ for NOT, | or ! for OR: whichever the file uses more, IBM's ¬ and | if even.
  const bare = code.replace(/\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|"(?:[^"]|"")*"/g, "");
  /** @param {string} c */
  const count = (c) => bare.split(c).length - 1;
  /** @type {Record<string, string>} */
  const symbol = {};
  symbol["¬"] = symbol["^"] = count("^") > count("¬") ? "^" : "¬";
  symbol["|"] = symbol["!"] = count("!") > count("|") ? "!" : "|";

  /** A keyword in its form and case. @param {string} text */
  const keyword = (text) => {
    const upper = text.toUpperCase();
    const form = (abbreviations === "short" ? SHORT.get(upper) : abbreviations === "long" ? LONG.get(upper) : undefined) ?? text;
    if (keywordCase !== "keep") return cased(form, keywordCase);
    return form === text || text !== text.toLowerCase() ? form : form.toLowerCase();
  };

  /** How a leaf is written. @param {Node} leaf */
  const rewrite = (leaf) => {
    const { type, text } = leaf;
    if (type === "comment") return spacedComment(text);
    if (type === "string_literal" || type.endsWith("_literal")) return quoted(text, keywordCase);
    if (type === "number") return cased(text, keywordCase);
    if (leaf.parent?.type === "condition_name" || (!leaf.isNamed && /^[a-z]/i.test(type))) return keyword(text);
    if (type === "identifier") return cased(text, identifierCase);
    if (!leaf.isNamed) return text.replace(/[¬^|!]/g, (c) => symbol[c]);
    return text;
  };

  /** The leaves of `nodes`, as tokens. @param {(Node | null)[]} nodes @returns {Token[]} */
  const tokensOf = (nodes) => {
    const leaves = pliLeaves(nodes);
    /** @type {Token[]} */
    const tokens = [];
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      const before = leaves[i - 1];
      const space = before ? pliSpace(before, leaf) : leaf.type !== ";";
      let text = rewrite(leaf);
      if (abbreviations === "short" && leaf.type === "go" && leaves[i + 1]?.type === "to" && leaf.parent?.type === "goto_statement") {
        text = keyword("GOTO");
        i++;
      }
      tokens.push(token(text, {
        space,
        prio: before ? pliBreak(before, leaf, space) : 0,
        row: leaf.startPosition.row,
        endRow: leaf.endPosition.row,
        column: leaf.startPosition.column,
        comment: leaf.type === "comment",
      }));
    }
    return tokens;
  };

  /** Whether a string in `node` runs over a line end. @param {Node} node @param {number} [before] only one starting before this index */
  const spansString = (node, before = Infinity) => node.descendantsOfType("string_literal").some((s) => s && s.startPosition.row !== s.endPosition.row && s.startIndex < before);

  /**
   * The source lines of `node` with their blanks as they are, its first moved
   * to `col`; the words on one line rewritten.
   * @param {Node} node @param {number} col @param {Token[]} prefix
   */
  const verbatim = (node, col, prefix) => {
    const start = node.startPosition;
    const end = node.endPosition;
    const head = prefix.map((t, i) => (i && t.space ? " " : "") + t.text).join("");
    const rows = lines.slice(start.row, end.row + 1);
    rows[rows.length - 1] = rows[rows.length - 1].slice(0, end.column);
    for (const leaf of pliLeaves([node]).reverse()) {
      const { row, column } = leaf.startPosition;
      if (leaf.endPosition.row !== row) continue;
      const r = row - start.row;
      rows[r] = rows[r].slice(0, column) + rewrite(leaf) + rows[r].slice(leaf.endPosition.column);
    }
    rows[0] = " ".repeat(col) + (head ? `${head} ` : "") + rows[0].slice(start.column);
    out.push(...rows.map((row) => row.trimEnd()));
  };

  /** @param {Token[]} tokens @param {number} col */
  const emit = (tokens, col) => {
    const laid = fill(tokens, col, indent, PLI_LIMIT);
    out.push(...laid);
    return laid;
  };

  /** Puts a comment after the last line. @param {Node} comment */
  const appendComment = (comment) => {
    const last = /** @type {string} */ (out.pop());
    out.push(...fill([lineToken(last, comment.startPosition.row), ...tokensOf([comment])], last.search(/\S/), indent, PLI_LIMIT));
  };

  /**
   * Statements one after the other, each at its column, and comments on the
   * line they were on. One blank line where there was at least one, and
   * before a procedure (but after its comment), none first or before END.
   * @param {[Node, number][]} items
   * @param {number} previousRow where the code before them ended
   */
  const statements = (items, previousRow) => {
    /** @type {Node | null} */
    let previous = null;
    for (const [node, col] of items) {
      const row = node.startPosition.row;
      if (node.type === "comment" && row === previousRow && out.at(-1)?.trim()) appendComment(node);
      else {
        let inner = node;
        while (inner.type === "labeled_statement" && inner.namedChildren.at(-1)) inner = /** @type {Node} */ (inner.namedChildren.at(-1));
        const procedure = inner.type === "procedure_statement" && previous?.type !== "comment";
        if (previous && node.type !== "end_statement" && (procedure || blankBetween(lines, previousRow, row)) && out.at(-1) !== "") out.push("");
        statement(node, col, []);
        previous = node;
      }
      previousRow = node.endPosition.row;
    }
  };

  /**
   * @param {Node} node
   * @param {number} col
   * @param {Token[]} prefix tokens that go before it: labels, IF ... THEN, ELSE, WHEN (...)
   */
  const statement = (node, col, prefix) => {
    const children = /** @type {Node[]} */ (node.children.filter(Boolean));
    if (node.type === "comment") {
      emit([...prefix, ...tokensOf([node])], col);
    } else if (node.type === "process_statement" || (node.type.startsWith("preprocessor_") && node.type !== "preprocessor_include")) {
      verbatim(node, prefix.length ? col : node.type === "process_statement" ? 0 : col, prefix);
    } else if (node.type === "labeled_statement") {
      const inner = node.namedChildren.at(-1);
      if (!inner) return verbatim(node, col, prefix);
      const label = children.map((c) => c.childForFieldName("label")).find(Boolean);
      const end = inner.namedChildren.at(-1);
      if (label && end?.type === "end_statement" && end.namedChildren.every((c) => c?.type === "statement_prefix") && (inner.type === "procedure_statement" || inner.type === "package_statement")) endLabels.set(end.id, rewrite(label));
      statement(inner, col, [...prefix, ...tokensOf(children.filter((c) => c.id !== inner.id))]);
    } else if (GROUPS.has(node.type)) {
      const header = children.findIndex((c) => c.type === ";" || c.type.endsWith("_heading"));
      if (header < 0 || spansString(node, children[header].endIndex)) return verbatim(node, col, prefix);
      emit([...prefix, ...tokensOf(children.slice(0, header + 1))], col);
      /** @type {[Node, number][]} */
      const items = [];
      for (const child of children.slice(header + 1)) {
        if (child.type === "block") for (const s of child.children) { if (s) items.push([s, col + indent]); }
        else if (child.type === "end_statement") items.push([child, col]);
        else if (child.isNamed) items.push([child, col + indent]);
      }
      statements(items, children[header].endPosition.row);
    } else if (spansString(node) && !COMPOUND.has(node.type)) {
      verbatim(node, col, prefix);
    } else if (node.type === "if_statement") {
      const consequence = node.childForFieldName("consequence");
      const alternative = node.childForFieldName("alternative");
      if (!consequence) return verbatim(node, col, prefix);
      const ci = children.findIndex((c) => c.id === consequence.id);
      unit([...prefix, ...tokensOf(children.slice(0, ci))], consequence, col);
      if (!alternative) return;
      const ai = children.findIndex((c) => c.id === alternative.id);
      let from = ci + 1;
      for (let row = consequence.endPosition.row; children[from].type === "comment" && children[from].startPosition.row === row; from++) {
        row = children[from].endPosition.row;
        appendComment(children[from]);
      }
      const head = tokensOf(children.slice(from, ai));
      if (alternative.type === "if_statement") statement(alternative, col, head);
      else unit(head, alternative, col);
    } else if (COMPOUND.has(node.type)) {
      const inner = children.map(isStatement).lastIndexOf(true);
      if (inner < 0) return void emit([...prefix, ...tokensOf(children)], col);
      unit([...prefix, ...tokensOf(children.slice(0, inner))], children[inner], col);
    } else if (node.type === "declare_statement" || (node.type === "define_statement" && children.some((c) => c.type === "declaration_item"))) {
      declare(children, col, prefix);
    } else if (node.type === "exec_statement" && /^EXEC\s+SQL\b/i.test(node.text)) {
      execSql(node, col, prefix);
    } else {
      const tokens = tokensOf(children);
      const label = endLabels.get(node.id);
      if (label) tokens.splice(-1, 0, token(label, { prio: 0, row: node.startPosition.row, endRow: node.startPosition.row }));
      const laid = emit([...prefix, ...tokens], col);
      if (laid.some((line) => line.length > PLI_LIMIT)) {
        out.splice(out.length - laid.length, laid.length);
        verbatim(node, col, prefix);
      }
    }
  };

  // After IF ... THEN, ELSE, WHEN (...), OTHERWISE or ON ...: a DO, BEGIN or
  // short statement on the same line, anything else one indent further in.
  /** @param {Token[]} head @param {Node} node @param {number} col */
  const unit = (head, node, col) => {
    let inner = node;
    while (inner.type === "labeled_statement" && inner.namedChildren.at(-1)) inner = /** @type {Node} */ (inner.namedChildren.at(-1));
    if (GROUPS.has(inner.type)) return statement(node, col, head);
    if (!COMPOUND.has(inner.type) && !spansString(node) && !inner.type.startsWith("preprocessor_") && node.type !== "comment") {
      const mark = out.length;
      statement(node, col, head);
      if (out.length === mark + 1) return;
      out.splice(mark);
    }
    if (head.length) emit(head, col);
    statement(node, col + indent, []);
  };

  /** @param {Node[]} children @param {number} col @param {Token[]} prefix */
  const declare = (children, col, prefix) => {
    const items = children.filter((c) => c.type === "declaration_item");
    const tokens = [...prefix, ...tokensOf(children)];
    const structure = items.some((item) => item.childForFieldName("level"));
    if (!structure) {
      const one = fill(tokens, col, indent, PLI_LIMIT);
      if (one.length === 1) return void out.push(one[0]);
    }
    // The first item goes after DCL, the others under it; a structure's
    // members under its level-1 name, 2 further in per level.
    const lead = [...prefix, ...tokensOf(children.slice(0, children.indexOf(items[0])))];
    const first = col + lead.map((t, i) => (i && t.space ? " " : "") + t.text).join("").length + 1;
    /** @type {number[]} */
    const levels = [];
    let nameColumn = first;
    let at = lead.length;
    for (const child of children.slice(children.indexOf(items[0]))) {
      if (child.type === "declaration_item") {
        const levelNode = child.childForFieldName("level");
        const level = levelNode ? Number(levelNode.text) : 1;
        while (levels.length && /** @type {number} */ (levels.at(-1)) >= level) levels.pop();
        const depth = levels.length;
        levels.push(level);
        if (depth === 0) nameColumn = first + (levelNode ? levelNode.text.length + 1 : 0);
        if (child.id !== items[0].id) tokens[at].newline = depth === 0 ? first : nameColumn + 2 * (depth - 1);
      }
      at += tokensOf([child]).length;
    }
    out.push(...fill(tokens, col, indent, PLI_LIMIT));
  };

  // EXEC SQL laid out as SQL, its clauses under its first word.
  /** @param {Node} node @param {number} col @param {Token[]} prefix */
  const execSql = (node, col, prefix) => {
    const match = /** @type {RegExpExecArray} */ (/^EXEC\s+SQL\b/i.exec(node.text));
    const head = [...prefix, token(keyword("EXEC")), token(cased("SQL", identifierCase))].map((t, i) => (i && t.space ? " " : "") + t.text).join("");
    const start = node.startPosition;
    const sql = sqlTokens(node.text.slice(match[0].length), start.row, start.column + match[0].length, { indent, pli, keywordCase, identifierCase, abbreviations });
    const verb = col + head.length + 1;
    const laid = sqlLayout(sql, verb, verb, PLI_LIMIT);
    if (!sql.length || sql[0].comment || laid.some((line) => line.length > PLI_LIMIT)) return verbatim(node, col, prefix);
    laid[0] = " ".repeat(col) + head + laid[0].slice(col + head.length);
    out.push(...laid);
  };

  /** @type {[Node, number][]} */
  const top = [];
  for (const child of root.children) if (child) top.push([child, 1]);
  statements(top, -1);
  tree.delete();
  return { lines: out };
}

/** The leaves of `nodes`; a literal's suffix (the B of '1'B) is no node of its own. @param {(Node | null)[]} nodes */
function pliLeaves(nodes) {
  /** @type {Node[]} */
  const leaves = [];
  /** @param {Node} node */
  const collect = (node) => {
    if (node.childCount === 0 || node.type === "comment" || node.type.endsWith("_literal")) leaves.push(node);
    else for (const child of node.children) if (child) collect(child);
  };
  for (const node of nodes) if (node) collect(node);
  return leaves;
}

// /*text*/ gets a blank inside, a one-line comment just one; boxes and rules
// (/***, /*---) stay as they are.
/** @param {string} text */
function spacedComment(text) {
  const inner = text.slice(2, -2);
  if (!inner.trim() || /^\s*([*=\-_#+~.])\1|([*=\-_#+~.])\2\s*$/.test(inner) || inner.startsWith("*") || inner.endsWith("*")) return text;
  if (!inner.includes("\n")) return `/* ${inner.trim()} */`;
  return `/*${/^\s/.test(inner) ? "" : " "}${inner}${/\s$/.test(inner) ? "" : " "}*/`;
}

// A string in 'quotes', a "string" turned into one; its suffix (B, X) in case.
/** @param {string} text @param {Case} suffixCase */
function quoted(text, suffixCase) {
  const m = /^(['"])([\s\S]*)\1([A-Za-z0-9]*)$/.exec(text);
  if (!m) return text;
  const body = m[1] === "'" ? m[2] : m[2].replaceAll('""', '"').replaceAll("'", "''");
  return `'${body}'${cased(m[3], suffixCase)}`;
}

/**
 * Whether two PL/I texts mean the same: the same leaves, but for blanks in
 * comments, the quotes and doubled quotes of strings, the case of words, the
 * forms of keywords, ¬ for ^ and ! for |, and END's names.
 * @param {string} before @param {string} after @param {Parser} pli
 */
function samePli(before, after, pli) {
  /** @param {string} text */
  const canonical = (text) => {
    const tree = pli.parse(text);
    if (!tree || tree.rootNode.hasError) return null;
    /** @type {string[]} */
    const words = [];
    for (const leaf of pliLeaves([tree.rootNode])) {
      const { type, text } = leaf;
      const m = /^(['"])([\s\S]*)\1([A-Za-z0-9]*)$/.exec(text);
      if (type === "comment") words.push(text.replace(/\s+/g, ""));
      else if ((type === "string_literal" || type.endsWith("_literal")) && m) words.push(`'${m[2].replaceAll(m[1] + m[1], m[1])}'${m[3].toUpperCase()}`);
      else if (type === "identifier" && leaf.parent?.type === "end_statement") continue;
      else if (leaf.parent?.type === "condition_name" || (!leaf.isNamed && /^[a-z]/i.test(type))) words.push(...(LONG.get(text.toUpperCase()) ?? text.toUpperCase()).split(" "));
      else words.push(text.toUpperCase().replace(/¬/g, "^").replace(/!/g, "|"));
    }
    tree.delete();
    return words.join("\n");
  };
  const a = canonical(before);
  return a !== null && a === canonical(after);
}

/** @param {Node} node */
const isStatement = (node) => node.isNamed && (node.type.endsWith("_statement") || node.type.startsWith("preprocessor_") || node.type === "when_clause" || node.type === "otherwise_clause");

// The blank between two PL/I tokens: none after ( and before , ; ), none
// around . -> => and after a prefix operator, none between a name and its (
// (but after keywords like WHEN and WHILE), one everywhere else.
/** @param {Node} a @param {Node} b */
function pliSpace(a, b) {
  const A = a.type;
  const B = b.type;
  if (B === "," || B === ";" || B === ")") return false;
  if (A === "(" || A === "%") return false;
  if (A === "." || B === "." || A === "->" || B === "->" || A === "=>" || B === "=>") return false;
  if (A === "," && a.parent && TIGHT_COMMAS.has(a.parent.type)) return false;
  if (a.parent?.type === "unary_expression" && a.parent.childForFieldName("operator")?.id === a.id) return false;
  if (B === ":" && b.parent?.type === "statement_prefix") return false;
  if (A === ":" && (a.parent?.type === "host_variable" || a.parent?.type === "bound")) return false;
  if (B === ":" && b.parent?.type === "bound") return false;
  if (A === ")" && b.parent?.type === "repeated_string") return a.endIndex !== b.startIndex;
  if (B === "(") {
    if (A === ")") return false;
    if (/^[A-Za-z_#@$]/.test(a.text)) return SPACED_BEFORE_PAREN.has(a.text.toUpperCase());
  }
  return true;
}

/** @param {Node} a @param {Node} b @param {boolean} space */
function pliBreak(a, b, space) {
  if (a.type === ",") return 3;
  if (!space) return 0;
  if (b.parent?.type === "binary_expression" && !b.isNamed) return LOGICAL.has(b.text.toUpperCase()) ? 3 : 2;
  return 1;
}

/** @param {Node} node @returns {Node | undefined} */
function firstError(node) {
  if (node.isError || node.isMissing) return node;
  for (const child of node.children) {
    if (child?.hasError || child?.isMissing) return firstError(child) ?? child;
  }
  return undefined;
}

// ---- SQL --------------------------------------------------------------------
// Db2 DDL and the SQL in EXEC SQL, laid out as in the SQL Reference: each
// clause (FROM, WHERE, ...) starts a line, AND and OR 2 further in, lists wrap
// after a comma aligned after their parenthesis, and a CREATE TABLE's columns
// go one per line with their names and types lined up.

const SQL_CLAUSES = new Set(["SELECT", "INTO", "FROM", "WHERE", "GROUP", "HAVING", "ORDER", "UNION", "EXCEPT", "INTERSECT", "SET", "VALUES", "OPTIMIZE", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS"]);
const DDL_CLAUSES = new Set(["IN", "USING", "PARTITION", "PRIMARY", "BUFFERPOOL"]);
const JOINS = new Set(["INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER"]);
const CONSTRAINTS = new Set(["PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "CONSTRAINT", "PERIOD", "LIKE"]);
const ISOLATION = new Set(["UR", "CS", "RS", "RR"]);

/**
 * The tokens of SQL text that starts at `row`, `column` of the source, its
 * words in keywordCase, host variables in identifierCase.
 * @param {string} text
 * @param {number} row
 * @param {number} column
 * @param {Style} style
 * @returns {Token[]}
 */
function sqlTokens(text, row, column, style) {
  /** @type {Token[]} */
  const tokens = [];
  const pattern = /(\s+)|(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*'?|"(?:[^"]|"")*"?)|([A-Za-z0-9_@#$.]+)|(<>|<=|>=|¬=|\^=|!=|\|\||\S)/g;
  let previousEnd = -1;
  let r = row;
  let lineStart = -column;
  let scanned = 0;
  for (const m of text.matchAll(pattern)) {
    const start = /** @type {number} */ (m.index);
    for (; scanned < start; scanned++) if (text[scanned] === "\n") { r++; lineStart = scanned + 1; }
    const startRow = r;
    const startColumn = start - lineStart;
    for (; scanned < start + m[0].length; scanned++) if (text[scanned] === "\n") { r++; lineStart = scanned + 1; }
    if (m[1]) continue;
    const adjacent = previousEnd === start;
    previousEnd = start + m[0].length;
    const host = adjacent && tokens.at(-1)?.text === ":";
    tokens.push(token(m[4] ? cased(m[0], host ? style.identifierCase : style.keywordCase) : m[0], { row: startRow, endRow: r, column: startColumn, comment: Boolean(m[2]), space: !adjacent }));
  }
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    const a = tokens[i - 1];
    const word = /^[A-Za-z0-9_@#$'"]/.test(a.text);
    let space = true;
    if ([",", ";", ")"].includes(t.text) || a.text === "(") space = false;
    else if (a.text === ":" || t.text === "." || a.text === ".") space = t.space;
    else if (t.text === "(" && (word || a.text === ")")) space = t.space;
    else if (t.text === ":" && !t.space) space = false;
    else if (a.text === "," && !t.space && /^\d/.test(t.text) && /^\d/.test(tokens[i - 2]?.text ?? "")) space = false;
    else if ((a.text === "-" || a.text === "+") && !t.space && !/^[A-Za-z0-9_@#$)'"]/.test(tokens[i - 2]?.text ?? "(")) space = false;
    if (!t.comment) t.space = space;
    t.prio = a.text === "," || ["AND", "OR"].includes(t.text.toUpperCase()) ? 3 : space ? 1 : 0;
  }
  return tokens;
}

/**
 * One SQL statement on lines from `col` on, its clauses starting in `clause`.
 * @param {Token[]} tokens
 * @param {number} col
 * @param {number} clause
 * @param {number} limit
 * @returns {string[]}
 */
function sqlLayout(tokens, col, clause, limit) {
  const code = tokens.filter((t) => !t.comment);
  const words = code.map((t) => t.text.toUpperCase());
  const createTable = words[0] === "CREATE" && words.slice(1, 4).includes("TABLE");
  const view = words[0] === "CREATE" && words.slice(1, 4).includes("VIEW");
  const ddl = (words[0] === "CREATE" || words[0] === "ALTER") && !view;
  let depth = 0;
  let between = false;
  /** @type {Token[][]} a CREATE TABLE's elements */
  const elements = [];
  let inList = false;
  for (const [n, t] of code.entries()) {
    const upper = words[n];
    const before = words[n - 1] ?? "";
    const next = words[n + 1] ?? "";
    if (depth === 0 && n > 0) {
      const clauseWord = SQL_CLAUSES.has(upper)
        && !(upper === "JOIN" && JOINS.has(before)) && !(JOINS.has(upper) && JOINS.has(before))
        && !(upper === "INTO" && before === "INSERT") && !(upper === "FROM" && before === "DELETE")
        && !(upper === "SELECT" && n === 1) && !(upper === "SET" && before === "UPDATE")
        && !(upper === "UNION" && before === "UNION") && !(upper === "ORDER" && before === "INTO");
      const special = (upper === "FOR" && ["UPDATE", "FETCH", "READ"].includes(next))
        || (upper === "FETCH" && next === "FIRST" && n > 1)
        || (upper === "WITH" && ISOLATION.has(next.replace(/;$/, "")) && n > 1)
        || (ddl && DDL_CLAUSES.has(upper) && !createTable && before !== "NOT");
      if (upper === "BETWEEN") between = true;
      if (upper === "AND" && between) between = false;
      else if (upper === "AND" || upper === "OR") t.newline = clause + 2;
      else if (clauseWord || special) t.newline = clause;
      if (upper === "AS" && words[0] === "CREATE" && words.includes("VIEW") && next === "SELECT") code[n + 1].newline = clause;
    }
    if (createTable && depth === 0 && t.text === "(" && !elements.length) {
      inList = true;
      elements.push([]);
    } else if (inList && depth === 1 && t.text === ",") {
      elements.push([]);
    } else if (inList && !(depth === 1 && t.text === ")")) {
      elements.at(-1)?.push(t);
    }
    if (t.text === "(") depth++;
    else if (t.text === ")") {
      depth--;
      if (inList && depth === 0) {
        inList = false;
        t.newline = col;
      }
    }
  }
  // A CREATE TABLE's columns one per line, names, types and the rest lined up.
  const inner = col + 2;
  for (const e of elements) if (e[0]) e[0].newline = inner;
  const columns = elements.filter((e) => e.length >= 2 && !CONSTRAINTS.has(e[0].text.toUpperCase()));
  /** @param {Token[]} e */
  const typeEnd = (e) => (e[2]?.text === "(" ? e.findIndex((t) => t.text === ")") + 1 : 2);
  /** @param {Token[]} e */
  const typeText = (e) => e.slice(1, typeEnd(e)).map((t, i) => (i && t.space ? " " : "") + t.text).join("");
  const names = Math.max(0, ...columns.map((e) => e[0].text.length)) + 1;
  const types = Math.max(0, ...columns.map((e) => typeText(e).length)) + 1;
  for (const e of columns) {
    e[1].padTo = inner + names;
    const rest = e[typeEnd(e)];
    if (rest && inner + names + types + 16 <= limit) rest.padTo = inner + names + types;
  }
  return fill(tokens, col, 2, limit);
}

/** @param {string[]} lines @param {Style} style */
function formatDb2(lines, style) {
  const tokens = sqlTokens(lines.join("\n"), 0, 0, style);
  /** @type {string[]} */
  const out = [];
  let previousRow = -1;
  let start = 0;
  /** @param {Token} t */
  const gap = (t) => {
    if (previousRow >= 0 && blankBetween(lines, previousRow, t.row) && out.length) out.push("");
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // A comment between statements: after the ; on its line, or on a line of its own.
    if (i === start && t.comment) {
      if (t.row === previousRow && out.length) {
        const last = /** @type {string} */ (out.pop());
        out.push(...fill([lineToken(last, t.row), t], last.search(/\S|$/), 2, 72));
      } else {
        gap(t);
        out.push(...fill([t], 0, 2, Infinity));
      }
      previousRow = t.endRow;
      start = i + 1;
      continue;
    }
    if (t.text !== ";" && i < tokens.length - 1) continue;
    const statement = tokens.slice(start, i + 1);
    start = i + 1;
    gap(statement[0]);
    out.push(...sqlLayout(statement, 0, 2, 72));
    previousRow = t.endRow;
  }
  return out;
}

// ---- JCL --------------------------------------------------------------------
// //NAME     OPERATION OPERANDS, as in the JCL Reference: in upper case but for
// strings and comments, the operation in column 12, the operands one blank
// after it. A statement that fits goes on
// one line, else each parameter on a line of its own from column 16, one too
// long for that split after a comma in its parentheses. Comment statements,
// JES2 statements, in-stream data, IF/THEN and a string continued over a line
// end are left alone.

const JCL_LIMIT = 71;

/** @param {string[]} lines */
function formatJcl(lines) {
  /** @type {string[]} */
  const out = [];
  /** @type {string | null} what ends DD * or DATA data */
  let dataEnd = null;
  for (let row = 0; row < lines.length; ) {
    const line = lines[row];
    if (dataEnd !== null) {
      if (line.startsWith(dataEnd) || (dataEnd === "/*" && line.startsWith("//"))) dataEnd = null;
      else {
        out.push(line);
        row++;
        continue;
      }
      if (!line.startsWith("//") || line.startsWith("//*")) {
        out.push(line);
        row++;
        continue;
      }
    }
    const first = /^\/\/([^\s*]\S*|)\s+(\S+)\s*(.*)$/.exec(line);
    if (!line.startsWith("//") || line.startsWith("//*") || !first) {
      out.push(line);
      row++;
      continue;
    }
    // The statement's lines: as long as the operands end with a comma.
    /** @type {{ operands: string, comment: string, row: number, column: number }[]} */
    const fields = [];
    let frozen = false;
    let r = row;
    let rest = first[3];
    for (;;) {
      const text = lines[r];
      const split = operandEnd(rest);
      const comment = rest.slice(split.end).trim();
      fields.push({ operands: rest.slice(0, split.end), comment, row: r, column: comment ? text.lastIndexOf(comment) : 0 });
      if (text.length > JCL_LIMIT || split.quoted) frozen = true;
      if (split.quoted || !rest.slice(0, split.end).endsWith(",")) break;
      const nextLine = lines[r + 1];
      if (nextLine === undefined || !/^\/\/ +\S/.test(nextLine) || nextLine.startsWith("//*")) break;
      r++;
      rest = nextLine.slice(2).trimStart();
    }
    const statementRows = lines.slice(row, r + 1);
    row = r + 1;
    const [, name, operation] = first;
    const op = operation.toUpperCase();
    const operands = fields.map((f) => f.operands).join("");
    if (op === "DD" && /^(\*|DATA)(,|$)/i.test(operands)) {
      const delimiter = /DLM=(?:'([^']{2})'|([^,\s]{2}))/i.exec(operands);
      dataEnd = delimiter ? (delimiter[1] ?? delimiter[2]) : "/*";
    }
    const head = `//${name.toUpperCase().padEnd(8)} ${op}`;
    if (frozen || ["IF", "THEN", "ELSE", "ENDIF"].includes(op) || /^(JES|\/\*)/.test(name)) {
      if (statementRows.length === 1 && !frozen) out.push(`${head} ${first[3]}`.trimEnd());
      else out.push(...statementRows);
      continue;
    }
    // Parameters at the commas outside parentheses and quotes, each with the comment after it.
    /** @type {Token[]} */
    const tokens = [token(head, { space: false, prio: 0, row: fields[0].row, endRow: fields[0].row })];
    for (const field of fields) {
      for (const piece of splitOperands(field.operands)) {
        const firstOperand = tokens.length === 1;
        tokens.push(token(piece.text.replace(/('[^']*')|[^']+/g, (m, q) => q ?? m.toUpperCase()), { space: firstOperand, prio: firstOperand ? 0 : piece.top ? 3 : 2, row: field.row, endRow: field.row }));
      }
      if (field.comment) tokens.push(token(field.comment, { comment: true, row: field.row, endRow: field.row, column: field.column }));
    }
    let laid = fill(tokens, 0, 15, JCL_LIMIT, false);
    if (laid.length > 1) {
      for (const [i, t] of tokens.entries()) if (i > 1 && t.prio === 3) t.newline = 15;
      laid = fill(tokens, 0, 15, JCL_LIMIT, false);
    }
    const continued = laid.slice(1).map((l) => `//${l.slice(2)}`);
    laid = [laid[0], ...continued];
    if (laid.some((l) => l.length > JCL_LIMIT) || continued.some((l) => !/^\/\/ {13}\S/.test(l))) out.push(...statementRows);
    else out.push(...laid);
  }
  return out;
}

// Where a JCL operand field ends: at the first blank outside quotes.
/** @param {string} text */
function operandEnd(text) {
  let quoted = false;
  let end = 0;
  while (end < text.length && (quoted || text[end] !== " ")) {
    if (text[end] === "'") quoted = !quoted;
    end++;
  }
  return { end, quoted };
}

// Operands split after each comma outside quotes; top: outside parentheses too.
/** @param {string} text */
function splitOperands(text) {
  /** @type {{ text: string, top: boolean }[]} */
  const pieces = [];
  let quoted = false;
  let depth = 0;
  let start = 0;
  let top = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") quoted = !quoted;
    else if (!quoted && c === "(") depth++;
    else if (!quoted && c === ")") depth--;
    else if (!quoted && c === ",") {
      pieces.push({ text: text.slice(start, i + 1), top });
      top = depth === 0;
      start = i + 1;
    }
  }
  if (start < text.length) pieces.push({ text: text.slice(start), top });
  return pieces;
}

// ---- HLASM ------------------------------------------------------------------
// NAME     OPERATION OPERANDS                REMARKS: the operation in column
// 10, the operands in 16, remarks in 40, all but strings and remarks in
// keywordCase. Comment lines and continuation lines (which must start in
// column 16) are left alone.

const ATTRIBUTES = new Set(["L", "T", "K", "N", "I", "S", "O", "D"]);

/** @param {string[]} lines @param {Style} style */
function formatHlasm(lines, style) {
  const result = [...lines];
  let continued = false;
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row];
    const wasContinued = continued;
    continued = line.length > 71 && line[71] !== " ";
    if (wasContinued || !line.trim() || line.startsWith("*") || line.startsWith(".*")) continue;
    const parts = /^(\S*)\s+(\S+)\s*(.*)$/.exec(line.slice(0, 71));
    if (!parts) continue;
    const [, name, operation, rest] = parts;
    const constants = /^(DC|DS)$/i.test(operation);
    // The operands end at the first blank outside quotes and parentheses.
    let quoted = false;
    let depth = 0;
    let end = 0;
    let operands = "";
    for (; end < rest.length; end++) {
      const c = rest[end];
      if (c === " " && !quoted && depth === 0) break;
      operands += quoted ? c : cased(c, style.keywordCase);
      if (c === "'") {
        // L'FIELD reads FIELD's length, it opens no string.
        const before = rest[end - 1];
        if (!quoted && !constants && before && ATTRIBUTES.has(before.toUpperCase()) && !/[A-Za-z0-9@#$_]/.test(rest[end - 2] ?? " ")) continue;
        quoted = !quoted;
      } else if (!quoted && c === "(") depth++;
      else if (!quoted && c === ")") depth--;
    }
    if (quoted || depth !== 0) continue;
    const remarks = rest.slice(end).trim();
    let text = pad(cased(name, style.keywordCase), 9) + cased(operation, style.keywordCase);
    if (operands) text = pad(text, 15) + operands;
    if (remarks) text = pad(text, 39) + remarks;
    if (text.length > 71) continue;
    const tail = line.slice(71);
    result[row] = tail ? text.padEnd(71) + tail : text;
  }
  return result;
}

/** At least one blank after `text`, up to column `at`. @param {string} text @param {number} at */
const pad = (text, at) => (text.length < at ? text.padEnd(at) : `${text} `);
