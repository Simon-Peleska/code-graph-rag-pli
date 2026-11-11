// Runs the indexer off the extension host's thread: a full sync of 20,000
// files takes seconds, which would freeze every extension. Takes one sync
// request at a time, in the order they come, and answers each with progress
// messages and then its result or error.

import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { createIndexer, grammarsIn, openGraph, sync } from "./indexer.js";

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
      db = openGraph(request.graph);
      graphs.set(request.graph, db);
    }
    if (request.rebuild) {
      db.exec("DELETE FROM files");
    }
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
    reply({ id: request.id, error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
  }
}
