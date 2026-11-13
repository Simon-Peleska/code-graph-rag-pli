#!/usr/bin/env python3
# Generates a synthetic IMS / MVS z/OS repository of 20,000 extensionless
# members that link PL/I, JCL, IMS MFS and Db2 DDL to each other.
#
#   python3 gen.py [out_dir]          (default: ./repo; its libraries are rebuilt)
#
# Member names are 8 characters: a 2-letter application, a type letter and a
# 5-digit number. The third character picks the language, as in
# code-graph-rag-pli (CGR_PLI_EXTENSIONLESS_MEMBERS): J JCL, F MFS, T Db2,
# anything else PL/I (P programs, C copybooks).
import random
import shutil
import sys
from pathlib import Path

APPS = [a + b for a in "ABCDEFGH" for b in "AEIMQ"]  # 40 applications
PER_APP = {"P": 225, "C": 75, "J": 75, "F": 50, "T": 75}  # 500 per app
FIXED_FORMAT_SHARE = 0.2

rng = random.Random(20000)
out = Path(sys.argv[1] if len(sys.argv) > 1 else "repo")


def member(app: str, kind: str, n: int) -> str:
    return f"{app}{kind}{n:05d}"


def pick(app: str, kind: str, k: int, foreign_share: float = 0.1) -> list[str]:
    names = []
    for _ in range(k):
        owner = rng.choice(APPS) if rng.random() < foreign_share else app
        names.append(member(owner, kind, rng.randint(1, PER_APP[kind])))
    return sorted(set(names))


def table(app: str, file_n: int, i: int) -> str:
    return f"{app}TB{file_n:03d}{i}"


def any_table(app: str) -> str:
    return table(app, rng.randint(1, PER_APP["T"]), 1)


def mfs_format(app: str, n: int) -> str:
    return f"{app}{n:04d}"


def write(library: str, name: str, lines: list[str]) -> None:
    path = out / library / name
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def fixed_format(name: str, lines: list[str]) -> list[str]:
    # Card images: column 1 carriage control (blank), code in 2-72,
    # sequence number in 73-80.
    return [f" {line[1:]:<71}{name[:3]}{(i + 1) * 10:05d}" for i, line in enumerate(lines)]


def record(copybook_name: str) -> tuple[str, list[tuple[str, str]]]:
    # Seeded by the member, so programs know the layout of any copybook.
    r = random.Random(copybook_name)
    types = [r.choice(["CHAR(8)", "FIXED BIN(31)", "FIXED DEC(9,2)", "BIT(1)"]) for _ in range(r.randint(3, 12))]
    return f"R{copybook_name[:2]}{copybook_name[3:]}", [(f"F{i:02d}", t) for i, t in enumerate(types)]


def copybook(app: str, n: int) -> list[str]:
    name, fields = record(member(app, "C", n))
    lines = [f"   2 {field} {type_}" for field, type_ in fields]
    return [
        f" /* {member(app, 'C', n)}: record layout */",
        f" DCL P{name[1:]} PTR;",
        f" DCL 1 {name} BASED(P{name[1:]}),",
        *[f"{line}," for line in lines[:-1]],
        f"{lines[-1]};",
    ]


def record_logic(includes: list[str], tables: list[str], helper: str) -> list[str]:
    # What a program does with its records: fills them from Db2, decides on
    # their fields, moves fields between them, passes them on and writes back.
    lines = []
    previous_char = None
    for include in includes:
        rec, fields = record(include)
        of = lambda type_: [f"{rec}.{field}" for field, t in fields if t == type_]
        chars, decs, bins, bits = of("CHAR(8)"), of("FIXED DEC(9,2)"), of("FIXED BIN(31)"), of("BIT(1)")
        lines.append(f"   ALLOCATE {rec};")
        if chars:
            lines.append(f"   {chars[0]} = KEY;")
        if tables and decs:
            lines += [f"   EXEC SQL SELECT AMOUNT INTO :{decs[0]}", f"            FROM PROD.{tables[0]} WHERE ID = :KEY;"]
        if decs and bits:
            lines += [f"   IF {decs[0]} > {rng.choice([100, 500, 1000, 5000])} THEN {bits[0]} = '1'B;",
                      f"   ELSE {bits[0]} = '0'B;"]
        if len(decs) > 1:
            lines.append(f"   {decs[1]} = {decs[0]} * {rng.choice(['1.19', '0.07', '12'])};")
        if bins:
            lines.append(f"   {bins[0]} = {bins[0]} + CNT;")
        if len(chars) > 1:
            codes = rng.sample("ABCDEFGX", 3)
            lines += [
                f"   SELECT (SUBSTR({chars[1]}, 1, 1));",
                f"     WHEN ('{codes[0]}') RC = 0;",
                f"     WHEN ('{codes[1]}', '{codes[2]}') RC = 4;",
                "     OTHERWISE RC = 8;",
                "   END;",
            ]
        if chars and previous_char:
            lines.append(f"   {chars[-1]} = {previous_char};")
        if chars:
            lines.append(f"   CALL {helper}({chars[0]});")
            previous_char = chars[0]
        if tables and decs:
            lines += [f"   EXEC SQL UPDATE PROD.{tables[0]} SET AMOUNT = :{decs[-1]}", "            WHERE ID = :KEY;"]
    return lines


def program(app: str, n: int) -> list[str]:
    name = member(app, "P", n)
    includes = pick(app, "C", rng.randint(1, 3), foreign_share=0.05)
    callees = [c for c in pick(app, "P", rng.randint(0, 4)) if c != name]
    tables = sorted({any_table(app) for _ in range(rng.randint(0, 3))})
    screen = rng.randint(1, PER_APP["F"]) if rng.random() < 0.4 else None
    helpers = [f"{name[:3]}H{n:03d}{i}"[:8] for i in range(rng.randint(1, 3))]

    lines = [
        f" {name}: PROC OPTIONS(MAIN);",
        *[f"   %INCLUDE {inc};" for inc in includes],
        "   DCL RC FIXED BIN(31) INIT(0);",
        "   DCL KEY CHAR(8);",
        "   DCL CNT FIXED BIN(31);",
    ]
    if screen:
        lines.append(f"   DCL OUTMSG CHAR(8) INIT('{mfs_format(app, screen)}O ');")
    for t in tables:
        lines += [f"   EXEC SQL SELECT COUNT(*) INTO :CNT", f"            FROM PROD.{t} WHERE ID = :KEY;"]
    lines += record_logic(includes, tables, helpers[0])
    for helper in helpers:
        lines.append(f"   CALL {helper}(KEY);")
    for callee in callees:
        if rng.random() < 0.1:
            lines.append(f"   FETCH {callee};")
        lines.append(f"   CALL {callee}(KEY, RC);")
    lines.append("   IF RC > 0 THEN PUT SKIP LIST('RC', RC);")
    for i, helper in enumerate(helpers):
        lines += [
            f" {helper}: PROC(K);",
            "   DCL K CHAR(8);",
            "   DCL I FIXED BIN(31);",
            "   DO I = 1 TO 10;",
            "     IF SUBSTR(K, 1, 1) = 'X' THEN LEAVE;",
            "   END;",
        ]
        if tables and i == 0:
            lines += [f"   EXEC SQL UPDATE PROD.{tables[0]}", "            SET ID = ID WHERE ID = :K;"]
        if i + 1 < len(helpers):
            lines.append(f"   CALL {helpers[i + 1]}(K);")
        lines.append(f" END {helper};")
    lines.append(f" END {name};")
    return lines


def screen(app: str, n: int) -> list[str]:
    fmt = mfs_format(app, n)
    fields = [f"F{i:02d}" for i in range(rng.randint(2, 8))]
    lines = [
        f"{fmt:<8} FMT",
        "         DEV   TYPE=(3270,2),FEAT=IGNORE",
        "         DIV   TYPE=INOUT",
        "         DPAGE CURSOR=((3,20))",
        *[f"{fld:<8} DFLD  POS=({3 + i},20),LTH=8" for i, fld in enumerate(fields)],
        "         FMTEND",
        f"{fmt + 'I':<8} MSG   TYPE=INPUT,SOR=({fmt},IGNORE),NXT={fmt}O",
        "         SEG",
        *[f"         MFLD  {fld},LTH=8" for fld in fields],
        "         MSGEND",
        f"{fmt + 'O':<8} MSG   TYPE=OUTPUT,SOR=({fmt},IGNORE)",
        "         SEG",
        *[f"         MFLD  {fld},LTH=8" for fld in fields],
        "         MSGEND",
        "         END",
    ]
    return lines


def ddl(app: str, n: int) -> list[str]:
    lines = []
    count = rng.randint(1, 3)
    for i in range(1, count + 1):
        cols = ["  ID INTEGER NOT NULL", "  NAME CHAR(20)", "  AMOUNT DECIMAL(9,2)"]
        if rng.random() < 0.3:
            cols.append(f"  PARENT INTEGER REFERENCES PROD.{any_table(app)}")
        lines += [f"CREATE TABLE PROD.{table(app, n, i)} (", ",\n".join(cols), ");"]
    if rng.random() < 0.3:
        lines.append(f"CREATE VIEW PROD.{app}VW{n:03d} AS SELECT ID, NAME FROM PROD.{table(app, n, 1)};")
    if rng.random() < 0.1:
        lines.append(f"CREATE ALIAS TEST.{table(app, n, 1)} FOR PROD.{table(app, n, 1)};")
    return lines


def jcl(app: str, n: int) -> list[str]:
    name = member(app, "J", n)
    if n % 5 == 0:
        lines = [f"//{name} PROC"]
        for i, prog in enumerate(pick(app, "P", rng.randint(1, 3), foreign_share=0)):
            lines.append(f"//P{i + 1:<7} EXEC PGM={prog}")
        lines.append("//         PEND")
        return lines

    lines = [f"//{name} JOB (ACCT),'{app} BATCH',CLASS=A,MSGCLASS=X"]
    for i in range(rng.randint(1, 4)):
        step = f"S{i + 1}"
        kind = rng.random()
        prog = pick(app, "P", 1)[0]
        if kind < 0.45:
            lines += [f"//{step:<8} EXEC PGM={prog}", f"//INPUT    DD DSN={app}.DATA.IN{i},DISP=SHR"]
        elif kind < 0.65:
            lines.append(f"//{step:<8} EXEC PGM=DFSRRC00,PARM='BMP,{prog},{app}PSB{i}'")
        elif kind < 0.8:
            lines += [
                f"//{step:<8} EXEC PGM=IKJEFT01",
                "//SYSTSIN  DD *",
                "  DSN SYSTEM(DB2P)",
                f"  RUN PROGRAM({prog}) PLAN({app}PLAN)",
                "  END",
                "/*",
            ]
        else:
            proc = member(app, "J", 5 * rng.randint(1, PER_APP["J"] // 5))
            lines.append(f"//{step:<8} EXEC {proc}")
    return lines


def main() -> None:
    # Only the libraries are rebuilt, so repo/.vscode settings survive.
    for library in ("SRC", "INCLUDE", "JCL", "MFS", "DDL"):
        shutil.rmtree(out / library, ignore_errors=True)
        (out / library).mkdir(parents=True)

    generators = {
        "P": ("SRC", program),
        "C": ("INCLUDE", copybook),
        "J": ("JCL", jcl),
        "F": ("MFS", screen),
        "T": ("DDL", ddl),
    }
    total = 0
    for app in APPS:
        for kind, count in PER_APP.items():
            library, generate = generators[kind]
            for n in range(1, count + 1):
                name = member(app, kind, n)
                lines = generate(app, n)
                if kind in "PC" and rng.random() < FIXED_FORMAT_SHARE:
                    lines = fixed_format(name, lines)
                write(library, name, lines)
                total += 1
    print(f"gen: wrote {total} members to {out}")


main()
