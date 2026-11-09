// A thread of the parser pool a sync starts (startParsers in indexer.js):
// reads and parses the files it is sent and replies with their facts.

import { parentPort, workerData } from "node:worker_threads";
import { createIndexer, readAndParse } from "./indexer.js";

const port = /** @type {import("node:worker_threads").MessagePort} */ (parentPort);
const ready = createIndexer(workerData.grammars);

port.on("message", async (/** @type {{ id: number, root: string, path: string }} */ { id, root, path }) => {
  try {
    port.postMessage({ id, ...readAndParse(await ready, root, path) });
  } catch (error) {
    port.postMessage({ id, error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
  }
});
