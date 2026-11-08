// Runs the indexer off the extension host's thread: a full sync of 20,000
// files takes seconds, which would freeze every extension. Takes one sync
// request at a time, in the order they come, and answers each with progress
// messages and then its result or error.

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
 * @typedef {{ id: number, progress: import("./indexer.js").Progress }
 *   | { id: number, result: import("./indexer.js").SyncResult }
 *   | { id: number, error: string }} SyncReply
 */

const port = /** @type {import("node:worker_threads").MessagePort} */ (parentPort);
const ready = createIndexer(grammarsIn(workerData.grammars));
/** @type {Map<string, import("node:sqlite").DatabaseSync>} */
const graphs = new Map();

/** @param {SyncReply} reply */
const reply = (reply) => port.postMessage(reply);

port.on("message", async (/** @type {SyncRequest} */ request) => {
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
    const result = sync(db, request.root, indexer, {
      paths: request.paths,
      members: request.members,
      onProgress: (progress) => reply({ id: request.id, progress }),
    });
    reply({ id: request.id, result });
  } catch (error) {
    reply({ id: request.id, error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
  }
});
