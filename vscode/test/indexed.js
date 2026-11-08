// Indexes a fixture folder into a fresh graph, as the extension does.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIndexer, grammarsIn, openGraph, sync } from "../src/indexer.js";

export const indexer = await createIndexer(grammarsIn(join(import.meta.dirname, "../grammars")));

/**
 * @param {string} root
 * @returns {import("node:sqlite").DatabaseSync}
 */
export function indexed(root) {
  const db = openGraph(join(mkdtempSync(join(tmpdir(), "pli-graph-")), "graph.sqlite"));
  sync(db, root, indexer);
  return db;
}
