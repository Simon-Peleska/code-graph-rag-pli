// Highlighting from the grammars themselves: the document is parsed with the
// same tree-sitter grammars the indexer uses, and each grammar's own
// queries/highlights.scm names what each piece of text is. VS Code gets the
// result as semantic tokens, on top of the TextMate grammars, which color the
// file until the first parse is done. Modelled on tree-sitter-vscode.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Language, Parser, Query } from "web-tree-sitter";
import { blankMargins } from "./source.js";

/** @typedef {"pli" | "jcl" | "hlasm" | "db2"} HighlightLanguage */
/** @typedef {{ parser: Parser, query: Query }} Grammar */
/** @typedef {Record<HighlightLanguage, Grammar>} Highlighter */

/**
 * One semantic token: line and character from 0, as VS Code counts them, and
 * indexes into TOKEN_TYPES and a bit set of TOKEN_MODIFIERS.
 * @typedef {{ line: number, char: number, length: number, type: number, modifiers: number }} Token
 */

export const TOKEN_TYPES = [
  "comment",
  "string",
  "number",
  "keyword",
  "operator",
  "function",
  "variable",
  "type",
  "namespace",
  "property",
  "label",
  "macro",
];
export const TOKEN_MODIFIERS = ["defaultLibrary", "readonly"];

// Capture names the grammars use. A dotted name not listed takes the style of
// its prefix (keyword.control.conditional is a keyword); punctuation is left
// to the TextMate grammar.
/** @type {Record<string, [string, ...string[]]>} */
const CAPTURES = {
  comment: ["comment"],
  string: ["string"],
  "string.special": ["string", "readonly"],
  number: ["number"],
  keyword: ["keyword"],
  "keyword.directive": ["macro"],
  operator: ["operator"],
  function: ["function"],
  "function.builtin": ["function", "defaultLibrary"],
  variable: ["variable"],
  "variable.special": ["variable", "readonly"],
  "variable.builtin": ["variable", "defaultLibrary"],
  "constant.builtin": ["variable", "readonly", "defaultLibrary"],
  type: ["type"],
  "type.builtin": ["type", "defaultLibrary"],
  module: ["namespace"],
  property: ["property"],
  label: ["label"],
};

// Styles are numbered from 1 so a text position can hold 0 for "none".
/** @type {{ type: number, modifiers: number }[]} */
const STYLES = [{ type: -1, modifiers: 0 }];
/** @type {Map<string, number>} */
const styleOfCapture = new Map();
for (const [capture, [type, ...modifiers]] of Object.entries(CAPTURES)) {
  styleOfCapture.set(capture, STYLES.length);
  STYLES.push({
    type: TOKEN_TYPES.indexOf(type),
    modifiers: modifiers.reduce((bits, modifier) => bits | (1 << TOKEN_MODIFIERS.indexOf(modifier)), 0),
  });
}

/** @param {string} capture */
function styleOf(capture) {
  for (let name = capture; name; name = name.slice(0, Math.max(0, name.lastIndexOf(".")))) {
    const style = styleOfCapture.get(name);
    if (style) return style;
  }
  return 0;
}

/**
 * Loads the grammars and their highlights queries from `dir`, where
 * build-grammars.sh puts them.
 * @param {string} dir
 * @returns {Promise<Highlighter>}
 */
export async function createHighlighter(dir) {
  await Parser.init();
  /** @param {HighlightLanguage} name @returns {Promise<Grammar>} */
  const load = async (name) => {
    const language = await Language.load(join(dir, `tree-sitter-${name}.wasm`));
    const parser = new Parser();
    parser.setLanguage(language);
    const query = new Query(language, readFileSync(join(dir, `tree-sitter-${name}-highlights.scm`), "utf-8"));
    return { parser, query };
  };
  return { pli: await load("pli"), jcl: await load("jcl"), hlasm: await load("hlasm"), db2: await load("db2") };
}

/**
 * The semantic tokens of a document, in order, none spanning lines.
 * @param {Highlighter} highlighter
 * @param {HighlightLanguage} language
 * @param {string} text
 * @returns {Token[]}
 */
export function highlight(highlighter, language, text) {
  // The style of every UTF-16 position, which is how tree-sitter counts
  // positions in a JavaScript string and VS Code counts characters.
  const styles = new Uint8Array(text.length);
  const parsed = language === "pli" || language === "hlasm" ? blankMargins(text, language) : text;
  const tree = highlighter[language].parser.parse(parsed);
  if (!tree) return [];
  paint(styles, highlighter[language].query, tree.rootNode, 0);

  // EXEC SQL is only tokenized by the PL/I grammar; the Db2 grammar reads
  // the statement after the language name, as the indexer does.
  if (language === "pli") {
    for (const exec of tree.rootNode.descendantsOfType("exec_statement")) {
      const name = exec?.childForFieldName("language");
      if (!exec || name?.text.toUpperCase() !== "SQL") continue;
      const sql = parsed.slice(name.endIndex, exec.endIndex).replace(/[;\s]+$/, "");
      const sqlTree = highlighter.db2.parser.parse(`${sql};`);
      if (!sqlTree) continue;
      paint(styles, highlighter.db2.query, sqlTree.rootNode, name.endIndex, name.endIndex + sql.length);
      sqlTree.delete();
    }
  }
  tree.delete();

  /** @type {Token[]} */
  const tokens = [];
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (c === "\n") {
      line++;
      lineStart = ++i;
      continue;
    }
    const style = styles[i];
    if (style === 0 || c === "\r") {
      i++;
      continue;
    }
    let end = i + 1;
    while (end < text.length && styles[end] === style && text[end] !== "\n" && text[end] !== "\r") end++;
    tokens.push({ line, char: i - lineStart, length: end - i, ...STYLES[style] });
    i = end;
  }
  return tokens;
}

/**
 * Writes the style of each capture into `styles`, from position `offset` on.
 * The innermost capture wins, and of two on the same text the one from the
 * earlier pattern, as tree-sitter's own highlighter does.
 * @param {Uint8Array} styles
 * @param {Query} query
 * @param {import("web-tree-sitter").Node} root
 * @param {number} offset
 * @param {number} [limit] positions from here on are left alone
 */
function paint(styles, query, root, offset, limit = styles.length) {
  const captures = query
    .captures(root)
    .map((capture) => ({ style: styleOf(capture.name), start: capture.node.startIndex, end: capture.node.endIndex, pattern: capture.patternIndex }))
    .filter((capture) => capture.style !== 0)
    .sort((a, b) => b.end - b.start - (a.end - a.start) || b.pattern - a.pattern);
  for (const capture of captures) {
    styles.fill(capture.style, offset + capture.start, Math.min(offset + capture.end, limit));
  }
}
