// The progress bar of a sync: its share of the whole and what it is doing.
// Measured on 20,000 members: reading the files takes 3.3 s, linking 0.8.
// Knows nothing about VS Code, so tests can use it.

/** @type {Record<import("./indexer.js").Progress["phase"], { start: number, weight: number }>} */
const PHASES = {
  parse: { start: 0, weight: 85 },
  link: { start: 85, weight: 15 },
};

/**
 * @param {import("./indexer.js").Progress} progress
 * @returns {{ percent: number, message: string }}
 */
export function describe(progress) {
  const phase = PHASES[progress.phase];
  const share = progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;
  const percent = Math.floor(phase.start + phase.weight * share);
  const message =
    progress.phase === "parse"
      ? `Reading files: ${progress.done.toLocaleString("en-US")} of ${progress.total.toLocaleString("en-US")}`
      : "Linking references";
  return { percent, message };
}
