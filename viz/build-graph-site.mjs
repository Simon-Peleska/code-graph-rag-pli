// Indexes a source folder with the extension's indexer and writes one
// self-contained graph.html: modules, procedures, calls and includes.
//
//   node viz/build-graph-site.mjs SOURCES [-o graph.html] [--json]
//
// The page needs no server and no network: the graph data and Cytoscape.js are
// inlined. --json writes only the graph data.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createIndexer, grammarsIn, openGraph, sync } from "../vscode/src/indexer.js";

const here = import.meta.dirname;
// The extension's graph.template.html asks VS Code for each view; this is the
// page from before that, which reads the whole graph from the file.
const TEMPLATE = join(here, "site.template.html");
// Inlined in this order: each UMD build reads the globals of the ones before it.
const LIBRARIES = ["cytoscape.min.js", "layout-base.js", "cose-base.js", "cytoscape-fcose.js"].map((name) => join(here, "vendor", name));
const CALL_KINDS = new Set(["call", "fetch", "invoke", "program"]);

const log = (/** @type {string} */ text) => console.error(`INFO ${text}`);

export class SiteError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(`[${code}] ${message}`);
    this.code = code;
  }
}

/**
 * The graph of a folder as the page reads it: nodes with ids like
 * `shop.src.main.MAIN`, edges as [source, CALLS | IMPORTS | DEFINES | DEFINES_METHOD, target].
 * @param {string} root
 */
export async function buildGraph(root) {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new SiteError("VIZ-001", `${root} is no folder of sources`);
  const started = Date.now();
  const db = openGraph(join(mkdtempSync(join(tmpdir(), "graph-site-")), "graph.sqlite"));
  try {
    await sync(db, root, await createIndexer(grammarsIn(join(here, "../vscode/grammars"))));
  } catch (error) {
    throw new SiteError("VIZ-003", `indexing ${root} failed: ${error instanceof Error ? error.stack : error}`);
  }
  log(`indexed ${root} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  for (const f of /** @type {{ path: string, failure: string }[]} */ (db.prepare("SELECT path, failure FROM files WHERE failure IS NOT NULL /* full scan */").all())) {
    log(`could not read ${f.path}: ${f.failure}`);
  }

  const project = basename(resolve(root));
  /** @type {Map<number, any>} */
  const modules = new Map();
  for (const f of /** @type {{ id: number, path: string }[]} */ (db.prepare("SELECT id, path FROM files ORDER BY path /* full scan */").all())) {
    const name = f.path.replace(/\.[^./]*$/, "");
    modules.set(f.id, { id: `${project}.${name.replaceAll("/", ".")}`, kind: "module", name: basename(name), path: f.path });
  }

  /** @type {Map<number, any>} */
  const nodes = new Map();
  /** @type {[string, string, string][]} */
  const edges = [];
  const symbols = /** @type {{ id: number, file: number, parent: number | null, kind: string, name: string, detail: string | null, line: number, end_line: number }[]} */ (
    db.prepare("SELECT id, file, parent, kind, name, detail, line, end_line FROM symbols WHERE kind IN ('procedure', 'package') ORDER BY id /* full scan */").all());
  // Parents come before their children, so each parent's id is known.
  for (const s of symbols) {
    const parent = s.parent === null ? undefined : nodes.get(s.parent);
    const owner = parent ?? modules.get(s.file);
    const kind = s.kind === "package" ? "class" : parent?.kind === "class" ? "method" : "function";
    const options = /options\s*\(([^)]*)\)/i.exec(s.detail ?? "")?.[1];
    const node = { id: `${owner.id}.${s.name}`, kind, name: s.name, path: owner.path, line: s.line, end: s.end_line };
    if (options) Object.assign(node, { mods: options.toLowerCase().split(/[\s,]+/).filter(Boolean) });
    nodes.set(s.id, node);
    edges.push([owner.id, kind === "method" ? "DEFINES_METHOD" : "DEFINES", node.id]);
  }

  const refs = /** @type {{ file: number, caller: number | null, kind: string, name: string, target_file: number | null, target_symbol: number | null }[]} */ (
    db.prepare("SELECT r.file, r.caller, r.kind, r.name, l.target_file, l.target_symbol FROM refs r LEFT JOIN links l ON l.ref = r.id /* full scan */").all());
  /** @type {Map<number, Set<string>>} */
  const unresolved = new Map();
  const seen = new Set();
  for (const r of refs) {
    const from = (r.caller !== null && nodes.get(r.caller)) || modules.get(r.file);
    let edge;
    if (r.kind === "include" && r.target_file !== null) edge = [from.id, "IMPORTS", modules.get(r.target_file).id];
    else if (CALL_KINDS.has(r.kind) && r.target_symbol !== null && nodes.has(r.target_symbol)) edge = [from.id, "CALLS", nodes.get(r.target_symbol).id];
    else if (CALL_KINDS.has(r.kind) && r.target_file === null) unresolved.set(r.file, (unresolved.get(r.file) ?? new Set()).add(r.name));
    if (edge && !seen.has(edge.join("\0"))) {
      seen.add(edge.join("\0"));
      edges.push(/** @type {[string, string, string]} */ (edge));
    }
  }
  for (const [file, names] of unresolved) modules.get(file).unresolved = [...names].sort();
  db.close();

  const all = [...modules.values(), ...nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  edges.sort((a, b) => (a.join("\0") < b.join("\0") ? -1 : 1));
  log(`graph for project ${project}: ${all.length} nodes, ${edges.length} edges`);
  return { project, nodes: all, edges };
}

/** @param {{ project: string }} graph */
export function renderPage(graph) {
  // `</` inside an inline script would end it early.
  const data = JSON.stringify(graph).replaceAll("</", "<\\/");
  const library = LIBRARIES.map((path) => readFileSync(path, "utf8")).join("\n;\n").replaceAll("</script", "<\\/script");
  return readFileSync(TEMPLATE, "utf8")
    .replaceAll("__PROJECT__", graph.project || "code graph")
    .replace("/*__CYTOSCAPE__*/", () => library)
    .replace("__GRAPH_JSON__", () => data);
}

/** @param {string[]} args @returns {Promise<number>} the exit code */
export async function main(args) {
  const at = args.indexOf("-o");
  const output = at >= 0 ? args[at + 1] : "graph.html";
  const json = args.includes("--json");
  const root = args.find((a, i) => !a.startsWith("-") && args[i - 1] !== "-o");
  if (!root) {
    console.error("usage: node viz/build-graph-site.mjs SOURCES [-o graph.html] [--json]");
    return 2;
  }
  try {
    const graph = await buildGraph(root);
    mkdirSync(dirname(resolve(output)), { recursive: true });
    writeFileSync(output, json ? JSON.stringify(graph) : renderPage(graph));
    log(`wrote ${output}`);
    return 0;
  } catch (error) {
    if (!(error instanceof SiteError)) throw error;
    console.error(`ERROR ${error.message}`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main(process.argv.slice(2));
