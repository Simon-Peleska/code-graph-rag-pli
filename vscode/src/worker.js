// Runs the indexer off the extension host's thread: a full sync of 20,000
// files takes seconds, which would freeze every extension. Takes one sync
// request at a time, in the order they come, and answers each with progress
// messages and then its result or error.

import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { createIndexer, emptyGraph, grammarsIn, openGraph, sync } from "./indexer.js";

/**
 * @typedef {object} SyncRequest
 * @property {number} id
 * @property {string} graph the SQLite file
 * @property {string} root
 * @property {string[]} [paths] only these files and folders; all when absent
 * @property {boolean} members
 * @property {boolean} [rebuild] forget everything and read all files again
 */

/**
 * @typedef {object} FocusRequest the file open in the editor, read first
 * @property {string} root
 * @property {string} focus relative, with forward slashes
 */

/**
 * @typedef {{ id: number, progress: import("./indexer.js").Progress }
 *   | { id: number, focused: true }
 *   | { id: number, log: string }
 *   | { id: number, warn: string }
 *   | { id: number, result: import("./indexer.js").SyncResult }
 *   | { id: number, error: string }} SyncReply
 */

const port = /** @type {import("node:worker_threads").MessagePort} */ (parentPort);
const grammars = grammarsIn(workerData.grammars);
const ready = createIndexer(grammars);
const parsers = { script: join(workerData.grammars, "parser.cjs"), grammars };
/** @type {Map<string, import("node:sqlite").DatabaseSync>} */
const graphs = new Map();

/** @param {SyncReply} reply */
const reply = (reply) => port.postMessage(reply);

/** @type {Map<string, string>} the focused file by root */
const focus = new Map();

// A sync waits for its parser threads; the next request waits for it. A
// focus arrives meanwhile and steers the running sync.
let queue = Promise.resolve();
port.on("message", (/** @type {SyncRequest | FocusRequest} */ request) => {
  if ("focus" in request) {
    focus.set(request.root, request.focus);
    return;
  }
  queue = queue.then(() => handle(request));
});

/** @param {SyncRequest} request */
async function handle(request) {
  try {
    const indexer = await ready;
    let db = graphs.get(request.graph);
    if (!db) {
      const started = performance.now();
      db = openGraph(request.graph);
      graphs.set(request.graph, db);
      const mode = /** @type {{ journal_mode: string }} */ (db.prepare("PRAGMA journal_mode").get()).journal_mode;
      reply({ id: request.id, log: `graph ${request.graph} opened in ${Math.round(performance.now() - started)} ms, journal mode ${mode}` });
      // Without WAL, every read blocks the indexer's writes and the other way round.
      if (mode !== "wal") reply({ id: request.id, warn: `[PLG047W] The graph ${request.graph} is not in WAL mode (${mode}); its folder may be on a network drive. Reading and indexing will block each other.` });
    }
    if (request.rebuild) emptyGraph(db);
    const result = await sync(db, request.root, indexer, {
      paths: request.paths,
      members: request.members,
      parsers,
      focus: () => focus.get(request.root),
      onFocus: () => reply({ id: request.id, focused: true }),
      onProgress: (progress) => reply({ id: request.id, progress }),
    });
    reply({ id: request.id, result });
  } catch (error) {
    reply({ id: request.id, error: `${request.graph}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}` });
  }
}
