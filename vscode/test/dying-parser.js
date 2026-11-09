// Stands in for src/parser.js in a thread that dies on one file, as a
// crash in the grammar or running out of memory would.
import { parentPort, workerData } from "node:worker_threads";
import { createIndexer, readAndParse } from "../src/indexer.js";

const port = /** @type {import("node:worker_threads").MessagePort} */ (parentPort);
const ready = createIndexer(workerData.grammars);
port.on("message", async (/** @type {{ id: number, root: string, path: string }} */ { id, root, path }) => {
  if (path.endsWith("DOOMED")) process.exit(3);
  port.postMessage({ id, ...readAndParse(await ready, root, path) });
});
