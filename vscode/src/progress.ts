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
// what to call it. Measured on a first sync of 20,000 members (29 s): parsing
// 1.9 s, definitions 11.5 s, linking 4.8 s, calls 8.5 s, writing 2.5 s.
const PHASES: Record<string, { start: number; weight: number; label: string }> = {
  parse: { start: 0, weight: 6, label: "Parsing" },
  definitions: { start: 6, weight: 40, label: "Reading definitions" },
  link: { start: 46, weight: 16, label: "Linking definitions" },
  calls: { start: 62, weight: 29, label: "Resolving calls" },
  write: { start: 91, weight: 9, label: "Writing the graph" },
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
