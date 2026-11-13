// Answers the Show Graph page's questions, and makes the coverage report, in
// a thread of its own, so seconds of SQL for a big graph never stall the editor.

import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";
import { coverageReport, keywordsIn } from "./coverage.js";
import { Graph } from "./graph.js";

/**
 * @typedef {object} PageQuestion
 * @property {number} id
 * @property {"summary" | "overview" | "module" | "procedure" | "dependencies" | "dependencyList" | "flow" | "dataFlow" | "dataModel" | "transactions" | "dataUse" | "deadCode" | "messages" | "batchChain" | "hotspots" | "screenInput" | "columnPath" | "details" | "search" | "list" | "coverage"} what
 * @property {any[]} args
 */
/** @typedef {{ id: number, result: unknown, ms: number } | { id: number, error: string }} PageAnswer */

const port = /** @type {import("node:worker_threads").MessagePort} */ (parentPort);
const db = new DatabaseSync(workerData.graph);
db.exec("PRAGMA busy_timeout = 2000");
const graph = new Graph(db, workerData.root);

/** @type {Record<PageQuestion["what"], (...args: any[]) => unknown>} */
const answers = {
  summary: () => graph.pageSummary(),
  overview: (folder, isolated) => graph.pageOverview(folder, isolated),
  module: (path) => graph.pageModule(path),
  procedure: (id, depth, direction) => graph.pageProcedure(id, depth, direction),
  dependencies: (path, direction) => graph.pageDependencies(path, direction),
  dependencyList: (id, direction) => graph.pageDependencyList(id, direction),
  flow: (id, depth) => graph.pageFlow(id, depth),
  dataFlow: (id) => graph.pageDataFlow(id),
  dataModel: (path, depth) => graph.pageDataModel(path, depth),
  transactions: (name) => graph.transactionCrud(name),
  dataUse: (id) => graph.procedureCrud(id),
  deadCode: (path) => graph.deadCode(path),
  messages: (path) => graph.messages(path),
  batchChain: (path) => graph.batchChain(path),
  hotspots: (path) => graph.hotspots(path),
  screenInput: (name) => graph.screenInput(name),
  columnPath: (/** @type {string} */ id) => graph.columnPath(id.slice(0, id.lastIndexOf(".")), id.slice(id.lastIndexOf(".") + 1)),
  details: (id) => graph.pageDetails(id),
  search: (query) => graph.pageSearch(query),
  list: (tab, filter) => graph.pageList(tab, filter),
  coverage: () => coverageReport(db, workerData.root, keywordsIn(workerData.grammars)),
};

port.on("message", (/** @type {PageQuestion} */ question) => {
  const started = performance.now();
  /** @type {PageAnswer} */
  let answer;
  try {
    const respond = answers[question.what];
    if (!respond) throw new Error(`no question ${question.what}`);
    answer = { id: question.id, result: respond(...question.args), ms: Math.round(performance.now() - started) };
  } catch (error) {
    answer = { id: question.id, error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
  }
  port.postMessage(answer);
});
