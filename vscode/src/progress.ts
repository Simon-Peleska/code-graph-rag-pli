// How far a cgr sync has got, from the `CGR_PROGRESS {...}` lines cgr writes
// to stderr when CGR_PROGRESS=1 (codebase_rag/progress_report.py). Knows
// nothing about VS Code, so tests can use it.

export interface Progress {
  phase: string;
  done: number;
  total: number;
}

const PREFIX = "CGR_PROGRESS ";

// The share of the whole sync each phase starts at and takes, in percent, and
// what to call it. Measured on 20,000 members: a first sync (30 s) parses in
// 2 s, reads definitions in 11, links in 5, resolves calls in 8, writes in 3;
// a re-index of every file (145 s) also clears the old entries first (33 s)
// and reads definitions in 90. A first sync has nothing to clear and jumps
// past that share.
const PHASES: Record<string, { start: number; weight: number; label: string }> = {
  parse: { start: 0, weight: 5, label: "Parsing" },
  clear: { start: 5, weight: 20, label: "Removing old entries" },
  definitions: { start: 25, weight: 35, label: "Reading definitions" },
  link: { start: 60, weight: 10, label: "Linking definitions" },
  calls: { start: 70, weight: 23, label: "Resolving calls" },
  write: { start: 93, weight: 7, label: "Writing the graph" },
};

// The progress a line of cgr's output carries, if it is a progress line.
export function progressLine(line: string): Progress | undefined {
  if (!line.startsWith(PREFIX)) {
    return undefined;
  }
  try {
    const value = JSON.parse(line.slice(PREFIX.length));
    if (typeof value.phase === "string" && typeof value.done === "number" && typeof value.total === "number") {
      return value;
    }
  } catch {
    // Not one of cgr's; shown like any other output.
  }
  return undefined;
}

// The whole sync's percentage and what it is doing, or undefined once done.
export function describe(progress: Progress): { percent: number; message: string } | undefined {
  const phase = PHASES[progress.phase];
  if (!phase) {
    return undefined;
  }
  const share = progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;
  const percent = Math.floor(phase.start + phase.weight * share);
  const message =
    progress.phase === "write" || progress.phase === "link"
      ? phase.label
      : `${phase.label}: ${progress.done.toLocaleString("en-US")} of ${progress.total.toLocaleString("en-US")} files`;
  return { percent, message };
}
