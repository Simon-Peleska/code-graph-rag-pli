// Runs the generated IMS transactions from their MFS screens on tn3270's terminal (terminal.js):
// GET /<code> shows the input screen, POST /<code> with { aid, values } builds the input message
// from the typed fields, runs the program, and answers with the screen of its reply as JSON.
// `node server.js` listens on PORT, 8080 by default.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transactions } from "./transactions.js";

/** @param {unknown} text */
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * @typedef {{ dfld: string | null, length: number | null, literal: string | null }} MessageField
 * @typedef {{ kind: string | null, format: string | null, next: string | null, fields: MessageField[] }} Message
 * @typedef {{ name: string, rows: number, cols: number, cursor: { row: number, col: number } | null,
 *   texts: { row: number, col: number, text: string }[],
 *   fields: { name: string, row: number, col: number, width: number, protected: boolean, hidden: boolean }[] }} Format
 * @typedef {{ formats: Record<string, Format>, messages: Record<string, Message> }} Screens
 * @typedef {{ code: string, format: Format, values: Record<string, string>, error: string }} Shown what the terminal shows
 * @typedef {{ status: number, type: string, body: string }} Reply
 */

/** @param {number} status @param {Shown} shown @returns {Reply} */
const json = (status, shown) => ({ status, type: "application/json", body: JSON.stringify(shown) });

/** @param {number} status @param {string} html @returns {Reply} */
const html = (status, html) => ({ status, type: "text/html; charset=utf-8", body: `<!doctype html><meta charset="utf-8">${html}` });

/** The terminal page, showing `shown` first. @param {Shown} shown */
const terminalPage = (shown) =>
  html(
    200,
    `<title>${escape(shown.code)}</title>
<style>html, body { margin: 0; height: 100%; overflow: hidden; background: #000; } #terminal { position: relative; height: 100%; outline: none; } canvas { position: absolute; display: block; }</style>
<main id="terminal" tabindex="0"><canvas id="canvas"></canvas></main>
<script id="initial" type="application/json">${JSON.stringify(shown).replaceAll("</", "<\\/")}</script>
<script type="module" src="/terminal.js"></script>`,
  );

/**
 * @param {string} method
 * @param {string} path
 * @param {{ aid?: string, values?: Record<string, string> }} [request] what the terminal sent
 * @returns {Promise<Reply>}
 */
export async function handle(method, path, request = {}) {
  if (method === "GET" && /^\/(terminal\.js|tn3270\/[a-z0-9-]+\.js)$/.test(path)) {
    return { status: 200, type: "text/javascript; charset=utf-8", body: readFileSync(join(import.meta.dirname, path), "utf-8") };
  }
  const code = decodeURIComponent(path.replace(/^\/+/, "")).toUpperCase();
  if (!code) {
    const list = Object.keys(transactions).map((c) => `<li><a href="/${escape(c)}">${escape(c)}</a></li>`);
    return html(200, `<title>Transactions</title><ul>${list.join("")}</ul>`);
  }
  const transaction = /** @type {Record<string, { program: () => Promise<any>, entry: string, screens: Screens | null, input: string | null }>} */ (transactions)[code];
  if (!transaction) {
    console.error(`[PLG055E] No transaction ${code}`);
    return html(404, `<p>[PLG055E] No transaction ${escape(code)}</p>`);
  }
  const input = transaction.screens && transaction.input ? transaction.screens.messages[transaction.input] : undefined;
  const format = input?.format ? transaction.screens?.formats[input.format] : undefined;
  if (!transaction.screens || !input || !format) {
    console.error(`[PLG056E] ${code} has no input screen`);
    return html(500, `<p>[PLG056E] ${escape(code)} has no input screen</p>`);
  }
  if (method !== "POST") return terminalPage({ code, format, values: {}, error: "" });

  const typed = request.values ?? {};
  const message = input.fields.map((f) => (f.literal ?? (f.dfld ? typed[f.dfld] ?? "" : "")).padEnd(f.length ?? 0).slice(0, f.length ?? undefined)).join("");
  const pcb = { input: message, output: /** @type {string[]} */ ([]), LTERM: "TERM0001", STATUS: "  " };
  console.log(`${code} ${request.aid ?? "Enter"}: ${JSON.stringify(message)}`);
  try {
    const program = await transaction.program();
    await program[transaction.entry](pcb);
  } catch (error) {
    if (!(error instanceof Error && error.name === "Stop")) {
      console.error(`[PLG057E] ${code} failed:\n`, error);
      return json(500, { code, format, values: typed, error: `[PLG057E] ${code} failed: ${error instanceof Error ? error.message : String(error)}` });
    }
    console.log(`${code} ended with STOP`);
  }
  const reply = pcb.output[0];
  console.log(`${code} replied: ${JSON.stringify(reply ?? null)}`);
  const output =
    (input.next ? transaction.screens.messages[input.next] : undefined) ??
    Object.values(transaction.screens.messages).find((m) => m.kind === "OUTPUT" && m.format === input.format);
  if (reply === undefined || !output) return json(200, { code, format, values: typed, error: reply === undefined ? "The program sent no reply" : "" });
  // The reply rewrites the screen: a field it does not fill is blank, as on the terminal.
  /** @type {Record<string, string>} */
  const values = {};
  let at = 0;
  for (const f of output.fields) {
    const length = f.length ?? 0;
    if (f.dfld) values[f.dfld] = reply.slice(at, at + length).trimEnd();
    at += length;
  }
  return json(200, { code, format: (output.format && transaction.screens.formats[output.format]) || format, values, error: "" });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.PORT) || 8080;
  createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    /** @type {Reply} */
    let reply;
    try {
      reply = await handle(request.method ?? "GET", new URL(request.url ?? "/", "http://localhost").pathname, body ? JSON.parse(body) : {});
    } catch (error) {
      console.error("[PLG083E] The request failed:\n", error);
      reply = { status: 400, type: "text/plain; charset=utf-8", body: `[PLG083E] The request failed: ${error}` };
    }
    response.writeHead(reply.status, { "content-type": reply.type });
    response.end(reply.body);
  }).listen(port, () => console.log(`Transactions on http://localhost:${port}/`));
}
