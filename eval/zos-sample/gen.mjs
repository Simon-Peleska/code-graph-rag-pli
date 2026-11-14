// Generates a synthetic IMS / MVS z/OS repository of 20,000 extensionless
// members that link PL/I, JCL, IMS MFS and Db2 DDL to each other.
//
//   node gen.mjs [out_dir]          (default: ./repo; its libraries are rebuilt)
//
// Member names are 8 characters: a 2-letter application, a type letter and a
// 5-digit number. The third character picks the language, as the extension's
// pliGraph.extensionlessMembers does: J JCL, F MFS, T Db2, anything else PL/I
// (P programs, C copybooks).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const APPS = [..."ABCDEFGH"].flatMap((a) => [..."AEIMQ"].map((b) => a + b)); // 40 applications
const PER_APP = { P: 225, C: 75, J: 75, F: 50, T: 75 }; // 500 per app
const FIXED_FORMAT_SHARE = 0.2;

/** A seeded generator (mulberry32), so every run writes the same repository. */
function random(seed) {
  let state = typeof seed === "number" ? seed : [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (low, high) => low + Math.floor(next() * (high - low + 1));
  const choice = (items) => items[int(0, items.length - 1)];
  const sample = (items, k) => {
    const rest = [...items];
    return Array.from({ length: k }, () => rest.splice(int(0, rest.length - 1), 1)[0]);
  };
  return { next, int, choice, sample };
}

const rng = random(20000);
const out = process.argv[2] ?? "repo";
const pad = (n, width) => String(n).padStart(width, "0");

const member = (app, kind, n) => `${app}${kind}${pad(n, 5)}`;

function pick(app, kind, k, foreignShare = 0.1) {
  const names = new Set();
  for (let i = 0; i < k; i++) {
    const owner = rng.next() < foreignShare ? rng.choice(APPS) : app;
    names.add(member(owner, kind, rng.int(1, PER_APP[kind])));
  }
  return [...names].sort();
}

const table = (app, fileN, i) => `${app}TB${pad(fileN, 3)}${i}`;
const anyTable = (app) => table(app, rng.int(1, PER_APP.T), 1);
const mfsFormat = (app, n) => `${app}${pad(n, 4)}`;

// Card images: column 1 carriage control (blank), code in 2-72, sequence
// number in 73-80.
const fixedFormat = (name, lines) => lines.map((line, i) => ` ${line.slice(1).padEnd(71)}${name.slice(0, 3)}${pad((i + 1) * 10, 5)}`);

/** A copybook's record and its fields, seeded by the member, so programs know the layout of any copybook. */
function record(copybookName) {
  const r = random(copybookName);
  const types = Array.from({ length: r.int(3, 12) }, () => r.choice(["CHAR(8)", "FIXED BIN(31)", "FIXED DEC(9,2)", "BIT(1)"]));
  return { name: `R${copybookName.slice(0, 2)}${copybookName.slice(3)}`, fields: types.map((type, i) => ({ field: `F${pad(i, 2)}`, type })) };
}

function copybook(app, n) {
  const { name, fields } = record(member(app, "C", n));
  const lines = fields.map(({ field, type }) => `   2 ${field} ${type}`);
  return [
    ` /* ${member(app, "C", n)}: record layout */`,
    ` DCL P${name.slice(1)} PTR;`,
    ` DCL 1 ${name} BASED(P${name.slice(1)}),`,
    ...lines.slice(0, -1).map((line) => `${line},`),
    `${lines.at(-1)};`,
  ];
}

// What a program does with its records: fills them from Db2, decides on
// their fields, moves fields between them, passes them on and writes back.
function recordLogic(includes, tables, helper) {
  const lines = [];
  let previousChar;
  for (const include of includes) {
    const { name: rec, fields } = record(include);
    const of = (type) => fields.filter((f) => f.type === type).map((f) => `${rec}.${f.field}`);
    const [chars, decs, bins, bits] = [of("CHAR(8)"), of("FIXED DEC(9,2)"), of("FIXED BIN(31)"), of("BIT(1)")];
    lines.push(`   ALLOCATE ${rec};`);
    if (chars.length) lines.push(`   ${chars[0]} = KEY;`);
    if (tables.length && decs.length) lines.push(`   EXEC SQL SELECT AMOUNT INTO :${decs[0]}`, `            FROM PROD.${tables[0]} WHERE ID = :KEY;`);
    if (decs.length && bits.length) {
      lines.push(`   IF ${decs[0]} > ${rng.choice([100, 500, 1000, 5000])} THEN ${bits[0]} = '1'B;`, `   ELSE ${bits[0]} = '0'B;`);
    }
    if (decs.length > 1) lines.push(`   ${decs[1]} = ${decs[0]} * ${rng.choice(["1.19", "0.07", "12"])};`);
    if (bins.length) lines.push(`   ${bins[0]} = ${bins[0]} + CNT;`);
    if (chars.length > 1) {
      const codes = rng.sample([..."ABCDEFGX"], 3);
      lines.push(
        `   SELECT (SUBSTR(${chars[1]}, 1, 1));`,
        `     WHEN ('${codes[0]}') RC = 0;`,
        `     WHEN ('${codes[1]}', '${codes[2]}') RC = 4;`,
        "     OTHERWISE RC = 8;",
        "   END;",
      );
    }
    if (chars.length && previousChar) lines.push(`   ${chars.at(-1)} = ${previousChar};`);
    if (chars.length) {
      lines.push(`   CALL ${helper}(${chars[0]});`);
      previousChar = chars[0];
    }
    if (tables.length && decs.length) lines.push(`   EXEC SQL UPDATE PROD.${tables[0]} SET AMOUNT = :${decs.at(-1)}`, "            WHERE ID = :KEY;");
  }
  return lines;
}

function program(app, n) {
  const name = member(app, "P", n);
  const includes = pick(app, "C", rng.int(1, 3), 0.05);
  const callees = pick(app, "P", rng.int(0, 4)).filter((c) => c !== name);
  const tables = [...new Set(Array.from({ length: rng.int(0, 3) }, () => anyTable(app)))].sort();
  const screen = rng.next() < 0.4 ? rng.int(1, PER_APP.F) : undefined;
  const helpers = Array.from({ length: rng.int(1, 3) }, (_, i) => `${name.slice(0, 3)}H${pad(n, 3)}${i}`.slice(0, 8));

  const lines = [
    ` ${name}: PROC OPTIONS(MAIN);`,
    ...includes.map((inc) => `   %INCLUDE ${inc};`),
    "   DCL RC FIXED BIN(31) INIT(0);",
    "   DCL KEY CHAR(8);",
    "   DCL CNT FIXED BIN(31);",
  ];
  if (screen) lines.push(`   DCL OUTMSG CHAR(8) INIT('${mfsFormat(app, screen)}O ');`);
  for (const t of tables) lines.push("   EXEC SQL SELECT COUNT(*) INTO :CNT", `            FROM PROD.${t} WHERE ID = :KEY;`);
  lines.push(...recordLogic(includes, tables, helpers[0]));
  for (const helper of helpers) lines.push(`   CALL ${helper}(KEY);`);
  for (const callee of callees) {
    if (rng.next() < 0.1) lines.push(`   FETCH ${callee};`);
    lines.push(`   CALL ${callee}(KEY, RC);`);
  }
  lines.push("   IF RC > 0 THEN PUT SKIP LIST('RC', RC);");
  helpers.forEach((helper, i) => {
    lines.push(
      ` ${helper}: PROC(K);`,
      "   DCL K CHAR(8);",
      "   DCL I FIXED BIN(31);",
      "   DO I = 1 TO 10;",
      "     IF SUBSTR(K, 1, 1) = 'X' THEN LEAVE;",
      "   END;",
    );
    if (tables.length && i === 0) lines.push(`   EXEC SQL UPDATE PROD.${tables[0]}`, "            SET ID = ID WHERE ID = :K;");
    if (i + 1 < helpers.length) lines.push(`   CALL ${helpers[i + 1]}(K);`);
    lines.push(` END ${helper};`);
  });
  lines.push(` END ${name};`);
  return lines;
}

function screen(app, n) {
  const fmt = mfsFormat(app, n);
  const fields = Array.from({ length: rng.int(2, 8) }, (_, i) => `F${pad(i, 2)}`);
  return [
    `${fmt.padEnd(8)} FMT`,
    "         DEV   TYPE=(3270,2),FEAT=IGNORE",
    "         DIV   TYPE=INOUT",
    "         DPAGE CURSOR=((3,20))",
    ...fields.map((fld, i) => `${fld.padEnd(8)} DFLD  POS=(${3 + i},20),LTH=8`),
    "         FMTEND",
    `${(fmt + "I").padEnd(8)} MSG   TYPE=INPUT,SOR=(${fmt},IGNORE),NXT=${fmt}O`,
    "         SEG",
    ...fields.map((fld) => `         MFLD  ${fld},LTH=8`),
    "         MSGEND",
    `${(fmt + "O").padEnd(8)} MSG   TYPE=OUTPUT,SOR=(${fmt},IGNORE)`,
    "         SEG",
    ...fields.map((fld) => `         MFLD  ${fld},LTH=8`),
    "         MSGEND",
    "         END",
  ];
}

function ddl(app, n) {
  const lines = [];
  const count = rng.int(1, 3);
  for (let i = 1; i <= count; i++) {
    const cols = ["  ID INTEGER NOT NULL", "  NAME CHAR(20)", "  AMOUNT DECIMAL(9,2)"];
    if (rng.next() < 0.3) cols.push(`  PARENT INTEGER REFERENCES PROD.${anyTable(app)}`);
    lines.push(`CREATE TABLE PROD.${table(app, n, i)} (`, cols.join(",\n"), ");");
  }
  if (rng.next() < 0.3) lines.push(`CREATE VIEW PROD.${app}VW${pad(n, 3)} AS SELECT ID, NAME FROM PROD.${table(app, n, 1)};`);
  if (rng.next() < 0.1) lines.push(`CREATE ALIAS TEST.${table(app, n, 1)} FOR PROD.${table(app, n, 1)};`);
  return lines;
}

function jcl(app, n) {
  const name = member(app, "J", n);
  if (n % 5 === 0) {
    const programs = pick(app, "P", rng.int(1, 3), 0);
    return [`//${name} PROC`, ...programs.map((prog, i) => `//P${String(i + 1).padEnd(7)} EXEC PGM=${prog}`), "//         PEND"];
  }

  const lines = [`//${name} JOB (ACCT),'${app} BATCH',CLASS=A,MSGCLASS=X`];
  const steps = rng.int(1, 4);
  for (let i = 0; i < steps; i++) {
    const step = `S${i + 1}`.padEnd(8);
    const kind = rng.next();
    const prog = pick(app, "P", 1)[0];
    if (kind < 0.45) {
      lines.push(`//${step} EXEC PGM=${prog}`, `//INPUT    DD DSN=${app}.DATA.IN${i},DISP=SHR`);
    } else if (kind < 0.65) {
      lines.push(`//${step} EXEC PGM=DFSRRC00,PARM='BMP,${prog},${app}PSB${i}'`);
    } else if (kind < 0.8) {
      lines.push(`//${step} EXEC PGM=IKJEFT01`, "//SYSTSIN  DD *", "  DSN SYSTEM(DB2P)", `  RUN PROGRAM(${prog}) PLAN(${app}PLAN)`, "  END", "/*");
    } else {
      lines.push(`//${step} EXEC ${member(app, "J", 5 * rng.int(1, Math.floor(PER_APP.J / 5)))}`);
    }
  }
  return lines;
}

// Only the libraries are rebuilt, so repo/.vscode settings survive.
const generators = { P: ["SRC", program], C: ["INCLUDE", copybook], J: ["JCL", jcl], F: ["MFS", screen], T: ["DDL", ddl] };
for (const [library] of Object.values(generators)) {
  rmSync(join(out, library), { recursive: true, force: true });
  mkdirSync(join(out, library), { recursive: true });
}
let total = 0;
for (const app of APPS) {
  for (const [kind, count] of Object.entries(PER_APP)) {
    const [library, generate] = generators[kind];
    for (let n = 1; n <= count; n++) {
      const name = member(app, kind, n);
      let lines = generate(app, n);
      if ("PC".includes(kind) && rng.next() < FIXED_FORMAT_SHARE) lines = fixedFormat(name, lines);
      writeFileSync(join(out, library, name), lines.join("\n") + "\n");
      total++;
    }
  }
}
console.log(`gen: wrote ${total} members to ${out}`);
