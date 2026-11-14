// Fills KB.KONTO in a SQLite database from a Kartenbank account master (layout KBC00001),
// as the nightly load would: node seed.mjs <generated dir> <database> [ACCTFILE]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [generated, database, acctfile = join(import.meta.dirname, "../cases/case01/POST/in/ACCTFILE")] = process.argv.slice(2);
if (!generated || !database) {
  console.error("usage: node seed.mjs <generated dir> <database> [ACCTFILE]");
  process.exit(1);
}
const db = new DatabaseSync(database);
db.exec(readFileSync(join(generated, "sqlite.sql"), "utf-8"));
db.exec('DELETE FROM "KB.KONTO"; DELETE FROM "KB.LIMIT_HIST"');
const insert = db.prepare('INSERT INTO "KB.KONTO" VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const cents = (/** @type {string} */ text) => Number(text) / 100;
let count = 0;
for (const record of readFileSync(acctfile, "utf-8").split("\n")) {
  if (!record.trim()) continue;
  insert.run(
    record.slice(0, 11), // KTO_NR
    record.slice(11, 12), // KTO_ST
    cents(record.slice(12, 23)), // KTO_SLD  S9(8)V99
    cents(record.slice(23, 33)), // KTO_KLIM 9(8)V99
    cents(record.slice(33, 43)), // KTO_BLIM 9(8)V99
    record.slice(51, 59), // KTO_ABDT
    Number(record.slice(91, 93)), // KTO_MAHN
    record.slice(124, 133), // KTO_KDNR
  );
  count++;
}
console.log(`${count} accounts loaded into ${database}`);
