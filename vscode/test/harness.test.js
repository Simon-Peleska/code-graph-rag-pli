import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { calls, client, constants, explain, pack, units, verify } from "../src/harness.js";
import { indexed } from "./indexed.js";

// The Kartenbank batch of the evaluation: obscure names, nested procedures,
// ENTRY points, packages, copybooks and carriage control in column 1.
const root = join(import.meta.dirname, "../../eval/kartenbank/repo");
const db = await indexed(root);
const all = units(db);
const unit = (/** @type {string} */ name) => {
  const found = all.find((u) => u.name === name);
  assert.ok(found, name);
  return found;
};
const kbp00001 = readFileSync(join(root, "PLI/KBP00001"), "latin1").split("\n");
const lineOf = (/** @type {string} */ text, from = 0) => kbp00001.findIndex((l, i) => i >= from && l.includes(text)) + 1;
const start = lineOf("-PRUEFEN: PROC"), end = lineOf("END PRUEFEN;");
const recorded = JSON.parse(readFileSync(join(import.meta.dirname, "recorded/PRUEFEN.gemma4-26b.json"), "utf8"));

test("calls link to ENTRY points and package procedures of other members", () => {
  const unlinked = db.prepare(
    `SELECT DISTINCT r.name FROM refs r LEFT JOIN links l ON l.ref = r.id
     WHERE r.kind = 'call' AND r.name LIKE 'KB%' AND l.ref IS NULL`).all();
  assert.deepEqual(unlinked, []);
  const target = db.prepare(
    `SELECT f.member FROM refs r JOIN links l ON l.ref = r.id JOIN files f ON f.id = l.target_file WHERE r.name = ? LIMIT 1`);
  assert.equal(target.get("KBU00019")?.member, "KBU00018");
  assert.equal(target.get("KBU00022")?.member, "KBU00021");
});

test("a function called with empty parentheses is a call", () => {
  const found = db.prepare(
    `SELECT r.kind, c.name AS caller, t.name AS target FROM refs r JOIN symbols c ON c.id = r.caller
     JOIN links l ON l.ref = r.id JOIN symbols t ON t.id = l.target_symbol WHERE r.name = 'PRUEFEN'`).all().map((r) => ({ ...r }));
  assert.deepEqual(found, [{ kind: "invoke", caller: "UMSATZ", target: "PRUEFEN" }]);
});

test("named constants are the initialized variables nothing writes", () => {
  const found = constants(db);
  assert.ok(found.includes("- KO_MCC_SPERR = '7995' (KBC00010)"), found.join("\n"));
  assert.ok(found.includes("- KO_TYP_GEB = '05' (KBC00010)"));
  assert.equal(found.some((c) => c.startsWith("- KTO_SLD ")), false);
});

test("calls are listed with their arguments as written", () => {
  const found = calls(db, root, unit("KBP00002"));
  assert.ok(found.includes("- line 124: CALL BELASTEN('MG', KO_TYP_GEB, '0002', 'MAHNGEBUEHR', $ZW);"), found.join("\n"));
  assert.ok(found.includes("- line 128: CALL BELASTEN('UL', KO_TYP_GEB, '0003', 'UEBERZIEHUNGSGEBUEHR', KO_UEBZ);"));
  assert.ok(calls(db, root, unit("UMSATZ")).some((c) => /^- line \d+: @GRD = PRUEFEN\(\);$/.test(c)));
});

test("procedures come bottom-up, without their ENTRY points", () => {
  const at = (/** @type {string} */ name) => all.indexOf(unit(name));
  assert.ok(at("KBU00003") < at("PRUEFEN"));
  assert.ok(at("PRUEFEN") < at("KBP00001"));
  assert.ok(at("KBU00012") < at("KBP00001"));
  assert.ok(at("KBU00018") < at("KBP00002"));
  assert.equal(all.some((u) => u.name === "KBU00013"), false);
});

test("a pack holds the source, declarations, record layouts and callees", () => {
  const text = pack(db, root, unit("PRUEFEN"), new Map([[unit("KBU00009").id, { summary: "Finds a card in the card table.", inputs: [], outputs: [], rules: [] }]]));
  const load = lineOf("STRING(KTO_SATZ) = KTAB_SATZ(@KI)", start);
  assert.match(text, new RegExp(`^ {0,4}${load}  .*STRING\\(KTO_SATZ\\) = KTAB_SATZ\\(@KI\\);$`, "m"));
  assert.match(text, /KO_MCC_SPERR: CHAR\(4\) STATIC INIT\('7995'\)/);
  assert.match(text, / 13-23 {3}KTO_SLD {8}PIC 'S99999999V99'/);
  assert.ok(text.includes(`KBU00009 in KBU00009 (line ${lineOf("KBU00009(", start)}): Finds a card in the card table.`));
  assert.ok(text.includes(`KBU00013 in KBU00012 (line ${lineOf("KBU00013(W_KTONR", start)}): not explained yet`));
  assert.ok(text.includes(`line ${lineOf("TRN_MCC = KO_MCC_SPERR")}: TRN_MCC = KO_MCC_SPERR`));

  const main = pack(db, root, unit("KBP00001"), new Map());
  assert.ok(main.includes(`(nested procedure PRUEFEN, lines ${start}-${end}: see called procedures)`));
  assert.doesNotMatch(main, new RegExp(`^ {0,4}${load}  `, "m"));
  assert.match(main, /job KBJ00001 step STEP010: DD ACCTOUT DSN=KB\.PROD\.ACCTFILE DISP=NEW,CATLG,DELETE/);
  assert.doesNotMatch(main, /^ +\d+  [-+0]/m);
});

// The model's real answer: right but for one field it made up (the code has @DOPP).
const corrected = { ...recorded, rules: recorded.rules.map((/** @type {{ fields: string[] }} */ r) => ({ ...r, fields: r.fields.map((f) => f === "@DOPX" ? "@DOPP" : f) })) };

test("verify names what a recorded answer claims without backing", () => {
  assert.deepEqual(verify(db, root, unit("PRUEFEN"), recorded), ["rule 1: field @DOPX is not declared anywhere"]);
  assert.deepEqual(verify(db, root, unit("PRUEFEN"), corrected), []);
  const made_up = { ...recorded, rules: [{ text: "Rejects lottery.", lines: [lineOf("TRN_MCC = KO_MCC_SPERR"), 999], fields: ["TRN_MCC", "TRN_LOTTO"], values: ["'7995'", "'7996'", "112"] }] };
  assert.deepEqual(verify(db, root, unit("PRUEFEN"), made_up), [
    `rule 1: line 999 is not in PRUEFEN (lines ${start}-${end})`,
    "rule 1: field TRN_LOTTO is not declared anywhere",
    "rule 1: value '7996' is not in the code of PRUEFEN or the declarations it uses",
    "rule 1: value 112 is not in the code of PRUEFEN or the declarations it uses",
  ]);
});

test("explain retries once with the errors and caches the answer", async () => {
  const cache = mkdtempSync(join(tmpdir(), "pli-harness-"));
  /** @type {string[][]} */
  const asked = [];
  const replies = [JSON.stringify(recorded), JSON.stringify(corrected), "not json", "still not json"];
  const ask = async (/** @type {{ role: string, content: string }[]} */ messages) => {
    asked.push(messages.map((m) => m.content));
    return /** @type {string} */ (replies.shift());
  };
  const only = (/** @type {{ name: string }} */ u) => u.name === "PRUEFEN";

  const [fixed] = await explain(db, root, { ask, model: "test", cache, only });
  assert.equal(fixed.attempts, 2);
  assert.deepEqual(fixed.errors, []);
  assert.match(asked[1].at(-1) ?? "", /^These claims are not backed by the source[^]*field @DOPX is not declared/);

  const [broken] = await explain(db, root, { ask, model: "other", cache, only });
  assert.equal(broken.answer, null);
  assert.match(broken.errors[0], /^PLG031E The answer is not JSON/);

  const [cached] = await explain(db, root, { ask: async () => assert.fail("asked again"), model: "test", cache, only });
  assert.equal(cached.attempts, 0);
  assert.equal(cached.answer?.summary, recorded.summary);
});

test("the client reads a streamed reply and names a model it cannot reach", async () => {
  const replies = [
    ['{"message":{"content":"{\\"sum', 'mary\\""}}\n{"message":{"content":": 1}"}}\n', '{"done":true}\n'],
    ['{"message":{"content":"half"}}\n{"error":"model ran out of memory"}\n'],
  ];
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/x-ndjson" });
    for (const chunk of replies.shift() ?? []) response.write(chunk);
    response.end();
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", () => done(null)));
  const url = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
  const ask = client({ url, model: "test" });
  try {
    assert.equal(await ask([{ role: "user", content: "hi" }]), '{"summary": 1}');
    await assert.rejects(ask([{ role: "user", content: "hi" }]), /^Error: PLG030E .*ran out of memory/);
  } finally {
    server.close();
  }
  await assert.rejects(client({ url: "http://127.0.0.1:9", model: "test" })([]), /^Error: PLG032E The model at http:\/\/127\.0\.0\.1:9 is not reachable/);
});
