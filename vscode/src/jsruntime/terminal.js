// A generated IMS transaction in the browser: its MFS screen on tn3270's terminal, the same one the
// extension's Show 3270 Screen draws. Enter, a PF or a PA key sends the input fields to server.js,
// which runs the program and answers with the screen of its reply. Clear blanks the screen.

import { Screen } from "./tn3270/canvas.js";
import { LocalHost } from "./tn3270/local-host.js";

/**
 * @typedef {{ name: string, row: number, col: number, width: number, protected: boolean, hidden: boolean, fg?: string }} Field
 * @typedef {{ name: string, rows: number, cols: number, cursor: { row: number, col: number } | null,
 *   texts: { row: number, col: number, text: string, fg: string | null, gr: string | null }[], fields: Field[] }} Format
 * @typedef {{ code: string, format: Format, values: Record<string, string>, error: string }} Shown
 */

// tn3270's default theme, IBM Host On-Demand's.
const THEME = {
  background: "#000000", foreground: "#00ff00", cursor: "#00ff00", cursorAccent: "#000000",
  selectionBackground: "#ffffff", selectionForeground: "#000000", field: "#1c1c1c",
  black: "#000000", red: "#ff0000", green: "#00ff00", yellow: "#ffff00", blue: "#7890F0", magenta: "#c000ff", cyan: "#00ffff", white: "#ffffff",
  brightBlack: "#808080", brightRed: "#ff8000", brightGreen: "#80ff80", brightYellow: "#ffff80", brightBlue: "#7890F0", brightMagenta: "#ff00ff",
  brightCyan: "#80ffff", brightWhite: "#ffffff",
};

/** @type {Record<string, string>} */
const KEYS = {
  Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Home: "Home", End: "FieldEnd", Insert: "ToggleInsert", Escape: "Reset", PageUp: "PA1", PageDown: "PA2", Pause: "Clear",
};

/** @type {Shown} */
let shown = JSON.parse(/** @type {HTMLElement} */ (document.getElementById("initial")).textContent ?? "");
let lastAid = "";
let waiting = false;

const host = new LocalHost({
  screen: () => {
    const { format, values } = shown;
    const outputs = format.fields.filter((f) => f.protected && !f.hidden && values[f.name]);
    const inputs = format.fields.filter((f) => !f.protected);
    const at = format.cursor;
    return {
      texts: [...format.texts, ...outputs.map((f) => ({ row: f.row, col: f.col, text: values[f.name].slice(0, f.width), fg: f.fg ?? "white", gr: null }))],
      fields: inputs.map((f) => ({ name: f.name, row: f.row, col: f.col, width: f.width, value: values[f.name] ?? "", hidden: f.hidden })),
      cursor: inputs.find((f) => at && f.row === at.row && f.col === at.col)?.name,
      color: true,
    };
  },
  aid: (aid, typed) => void send(aid, typed),
});

/** @param {string} aid @param {Record<string, string>} typed */
async function send(aid, typed) {
  lastAid = aid;
  if (aid === "Clear") {
    shown = { ...shown, values: {}, error: "" };
    fit();
    return;
  }
  waiting = true;
  draw();
  try {
    const response = await fetch(location.pathname, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ aid, values: typed }) });
    shown = await response.json();
  } catch (cause) {
    console.error("[PLG082E] The server did not answer", cause);
    shown = { ...shown, values: { ...shown.values, ...typed }, error: `[PLG082E] The server did not answer: ${cause}` };
  }
  waiting = false;
  host.restart();
  fit();
}

const terminal = /** @type {HTMLElement} */ (document.getElementById("terminal"));
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("canvas"));
const screen = new Screen({ canvas, theme: THEME, fieldBackground: true, redraw: () => draw() });
screen.cursorStyle = "underline";

function draw() {
  const { rows, cols } = shown.format;
  screen.applyHostPaint(host.paint(rows, cols));
  screen.overlay.clear();
  const status = shown.error || `${shown.code}  ${shown.format.name}  ${host.insert ? "INSERT" : "      "}  ${waiting ? "X SYSTEM" : lastAid}`;
  screen.overlay.put(screen.statusRow, 0, status.padEnd(cols).slice(0, cols), { fg: shown.error ? "#ff0000" : "#7890F0", bg: "#000000" });
  screen.render();
}

// The font is chosen for the screen's size, so a new size lays it out again.
function fit() {
  screen.resize(shown.format.cols, shown.format.rows);
  const box = terminal.getBoundingClientRect();
  screen.layout({ x: 0, y: 0, width: box.width, height: box.height }, "monospace");
  draw();
}

terminal.addEventListener("keydown", (event) => {
  if (waiting) return;
  /** @type {any} */
  let message = null;
  const pf = /^F(\d+)$/.exec(event.key);
  if (pf) message = { type: "action", action: "PF", args: [String(Number(pf[1]) + (event.shiftKey ? 12 : 0))] };
  else if (event.key === "Tab" && event.shiftKey) message = { type: "action", action: "BackTab" };
  else if (event.key === "Enter" && event.shiftKey) message = { type: "action", action: "Newline" };
  else if (event.key === "End" && event.ctrlKey) message = { type: "action", action: "EraseEOF" };
  else if (event.key in KEYS) {
    const action = KEYS[event.key];
    message = action.startsWith("PA") ? { type: "action", action: "PA", args: [action.slice(2)] } : { type: "action", action };
  } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) message = { type: "text", value: event.key };
  if (!message) return;
  event.preventDefault();
  host.receive(message);
  draw();
});

terminal.addEventListener("paste", (event) => {
  const text = event.clipboardData?.getData("text/plain");
  if (!text || waiting) return;
  event.preventDefault();
  host.receive({ type: "paste", text });
  draw();
});

canvas.addEventListener("mousedown", (event) => {
  const at = screen.cellAt(event.clientX, event.clientY);
  if (!at || at.row < 0 || at.row >= shown.format.rows || at.col < 0 || at.col >= shown.format.cols) return;
  host.receive({ type: "action", action: "MoveCursor1", args: [String(at.row + 1), String(at.col + 1)] });
  draw();
});

new ResizeObserver(fit).observe(terminal);
terminal.focus();
