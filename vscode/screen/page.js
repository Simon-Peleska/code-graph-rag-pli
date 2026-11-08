// The 3270 screen page: an MFS format drawn on tn3270's canvas, with
// tn3270's LocalHost as the host behind it, so it is typed into and tabbed
// through like the real screen. The sidebar holds the input fields' contents;
// typing in either place shows in the other. build.mjs bundles this file.

import "@vscode-elements/elements/dist/vscode-split-layout/index.js";
import "@vscode-elements/elements/dist/vscode-textfield/index.js";
import "@vscode-elements/elements/dist/vscode-button/index.js";
import { Screen } from "./vendor/tn3270/canvas.js";
import { LocalHost } from "./vendor/tn3270/local-host.js";

/** @typedef {import("../src/mfs.js").MfsFormat} MfsFormat */
/** @typedef {import("../src/mfs.js").MfsField} MfsField */

// @ts-ignore provided by the webview
const vscode = acquireVsCodeApi();

// tn3270's default theme, IBM Host On-Demand's: a 3270's colors are made for black.
const THEME = {
  background: "#000000",
  foreground: "#00ff00",
  cursor: "#00ff00",
  cursorAccent: "#000000",
  selectionBackground: "#ffffff",
  selectionForeground: "#000000",
  field: "#1c1c1c",
  black: "#000000",
  red: "#ff0000",
  green: "#00ff00",
  yellow: "#ffff00",
  blue: "#7890F0",
  magenta: "#c000ff",
  cyan: "#00ffff",
  white: "#ffffff",
  brightBlack: "#808080",
  brightRed: "#ff8000",
  brightGreen: "#80ff80",
  brightYellow: "#ffff80",
  brightBlue: "#7890F0",
  brightMagenta: "#ff00ff",
  brightCyan: "#80ffff",
  brightWhite: "#ffffff",
};

const KEYS = {
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "FieldEnd",
  Insert: "ToggleInsert",
  Escape: "Reset",
  PageUp: "PA1",
  PageDown: "PA2",
};

/** @type {{ format: MfsFormat, file: string }} */
let shown = JSON.parse(/** @type {HTMLElement} */ (document.getElementById("initial")).textContent ?? "");
/** @type {Map<string, string>} what each field holds, by name, kept across edits of the source */
const values = new Map();
let lastAid = "";

/** The fields typed into, and the one the cursor starts in. */
let inputs = shown.format.fields.filter((field) => !field.protected);
let cursorField = startField();
/** @type {Map<string, any>} the sidebar's text field of each input field */
const sidebar = new Map();

function startField() {
  const at = shown.format.cursor;
  return inputs.find((f) => at && f.row === at.row && f.col === at.col)?.name;
}

const host = new LocalHost({
  screen: () => ({
    texts: shown.format.texts,
    // Output fields are shown blank, as the program has sent nothing yet.
    fields: inputs.map((field) => ({
      name: field.name,
      row: field.row,
      col: field.col,
      width: field.width,
      value: values.get(field.name) ?? "",
      hidden: field.hidden,
      fgByPosition: Array(field.width).fill(field.fg),
    })),
    cursor: cursorField,
    color: true,
  }),
  aid: (aid, typed) => {
    for (const [name, value] of Object.entries(typed)) values.set(name, value);
    lastAid = aid;
    vscode.postMessage({ type: "aid", aid, values: typed });
  },
});

const terminal = /** @type {HTMLElement} */ (document.getElementById("terminal"));
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("canvas"));
const fieldList = /** @type {HTMLElement} */ (document.getElementById("fields"));
const error = /** @type {HTMLElement} */ (document.getElementById("error"));
const font = getComputedStyle(document.body).getPropertyValue("--vscode-editor-font-family").trim() || "monospace";
const screen = new Screen({ canvas, theme: THEME, fieldBackground: true, redraw: () => draw() });
screen.cursorStyle = "underline";

/** The field's text as the terminal has it, typed or not. @param {MfsField} field */
const textOf = (field) => host.chars({ ...field, value: values.get(field.name) ?? "" }).join("").trimEnd();

/** Puts what the terminal's fields hold into the sidebar after typing on the terminal. */
function syncSidebar() {
  for (const field of inputs) sidebar.get(field.name).value = textOf(field);
}

function draw() {
  try {
    const { rows, cols } = shown.format;
    screen.applyHostPaint(host.paint(rows, cols));
    screen.overlay.clear();
    const status = `${shown.format.name}  ${host.insert ? "INSERT" : "      "}  ${lastAid}`;
    screen.overlay.put(screen.statusRow, 0, status.padEnd(cols).slice(0, cols), { fg: "#7890F0", bg: "#000000" });
    screen.render();
    error.hidden = true;
  } catch (cause) {
    console.error("[PLG018E] Drawing the screen failed", cause);
    error.textContent = `[PLG018E] Drawing the screen failed: ${cause}`;
    error.hidden = false;
  }
}

// The font is chosen for the screen's size, so a new size lays it out again.
function fit() {
  screen.resize(shown.format.cols, shown.format.rows);
  const box = terminal.getBoundingClientRect();
  screen.layout({ x: 0, y: 0, width: box.width, height: box.height }, font);
  draw();
}

/** The sidebar: one text field per input field, in screen order. */
function listFields() {
  fieldList.replaceChildren();
  sidebar.clear();
  for (const field of [...inputs].sort((a, b) => a.row - b.row || a.col - b.col)) {
    const label = document.createElement("label");
    label.htmlFor = `field-${field.name}`;
    label.title = "Click to show its DFLD";
    label.append(field.name, Object.assign(document.createElement("span"), { textContent: `${field.row + 1},${field.col + 1} · ${field.width}${field.numeric ? " · NUM" : ""}` }));
    label.addEventListener("click", () => vscode.postMessage({ type: "open", line: field.line }));
    const input = /** @type {any} */ (document.createElement("vscode-textfield"));
    input.id = `field-${field.name}`;
    input.maxLength = field.width;
    if (field.hidden) input.type = "password";
    input.value = textOf(field);
    input.addEventListener("input", () => {
      values.set(field.name, input.value.slice(0, field.width));
      host.typed.delete(field.name);
      draw();
    });
    input.addEventListener("focus", () => {
      host.cursor = { row: field.row, col: field.col };
      draw();
    });
    sidebar.set(field.name, input);
    fieldList.append(label, input);
  }
  if (inputs.length === 0) fieldList.textContent = "This format has no input fields.";
  /** @type {HTMLElement} */ (document.getElementById("title")).textContent = shown.format.name;
  /** @type {HTMLElement} */ (document.getElementById("where")).textContent = `${shown.file} · ${shown.format.rows}×${shown.format.cols}`;
}

terminal.addEventListener("keydown", (event) => {
  /** @type {any} */
  let message = null;
  const pf = /^F(\d+)$/.exec(event.key);
  if (pf) message = { type: "action", action: "PF", args: [String(Number(pf[1]) + (event.shiftKey ? 12 : 0))] };
  else if (event.key === "Tab" && event.shiftKey) message = { type: "action", action: "BackTab" };
  else if (event.key === "Enter" && event.shiftKey) message = { type: "action", action: "Newline" };
  else if (event.key === "End" && event.ctrlKey) message = { type: "action", action: "EraseEOF" };
  else if (event.key in KEYS) {
    const action = KEYS[/** @type {keyof KEYS} */ (event.key)];
    message = action.startsWith("PA") ? { type: "action", action: "PA", args: [action.slice(2)] } : { type: "action", action };
  } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) message = { type: "text", value: event.key };
  if (!message) return;
  event.preventDefault();
  host.receive(message);
  syncSidebar();
  draw();
});

terminal.addEventListener("paste", (event) => {
  const text = event.clipboardData?.getData("text/plain");
  if (!text) return;
  event.preventDefault();
  host.receive({ type: "paste", text });
  syncSidebar();
  draw();
});

canvas.addEventListener("mousedown", (event) => {
  const at = screen.cellAt(event.clientX, event.clientY);
  if (!at || at.row < 0 || at.row >= shown.format.rows || at.col < 0 || at.col >= shown.format.cols) return;
  host.receive({ type: "action", action: "MoveCursor1", args: [String(at.row + 1), String(at.col + 1)] });
  draw();
});

/** @type {HTMLElement} */ (document.getElementById("clear")).addEventListener("click", () => {
  values.clear();
  host.typed.clear();
  lastAid = "";
  syncSidebar();
  draw();
});

window.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.type === "format") {
    shown = message;
    inputs = shown.format.fields.filter((field) => !field.protected);
    cursorField = startField();
    listFields();
    fit();
  } else if (message?.type === "missing") {
    error.textContent = `[PLG019E] ${message.text}`;
    error.hidden = false;
  }
});

listFields();
new ResizeObserver(fit).observe(terminal);
// The split layout measures itself before the page is laid out.
requestAnimationFrame(() => {
  /** @type {any} */ (document.getElementById("split")).handlePosition = `${Math.max(200, document.body.clientWidth - 280)}px`;
  terminal.focus();
});
