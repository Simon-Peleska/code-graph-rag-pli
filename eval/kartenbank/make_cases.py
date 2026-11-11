"""Generate the test cases of the Kartenbank batch: seeded random input that
hits every rule of REGELN.md, and the expected output from the reference.

    python3 make_cases.py [cases_dir] [count]

Writes <cases_dir>/<case>/<STEP>/in/* and .../out/*. The inputs of INTEREST
are POST's expected outputs, those of STATEMENT INTEREST's, so a wrong step
does not spoil the cases of the next one.
"""
import os
import random
import shutil
import subprocess
import sys
from datetime import date, timedelta
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
REFERENCE = os.path.join(HERE, "reference", "app.py")


def money(rng, low, high):
    return Decimal(rng.randint(int(low * 100), int(high * 100))) / 100


def signed(value):
    cents = int(abs(value) * 100)
    return ("-" if value < 0 else "+") + str(cents).zfill(10)


def unsigned(value, digits=10):
    return str(int(value * 100)).zfill(digits)


def day(d):
    return d.strftime("%Y%m%d")


def make_case(seed):
    rng = random.Random(seed)
    run = date(2026, rng.randint(1, 12), rng.randint(1, 28))
    groups = ["GOLD", "STANDARD", "PLATIN", "AKTION2010", "OHNEZINS"]

    customers = []
    for n in range(rng.randint(15, 30)):
        customers.append({
            "id": str(100000000 + n * 7 + seed),
            "first": rng.choice(["ANNA", "BERND", "CARLA", "DIETER", "EVA", "FRANZ", "GERDA", "HANS", "INGE"]),
            "last": rng.choice(["MUELLER", "SCHMIDT", "SCHNEIDER", "FISCHER", "WEBER", "MEYER", "WAGNER", "BECKER"]),
            "fico": rng.choice([520, 580, 599, 600, 640, 710, 780, 820]),
        })

    accounts = []
    for n in range(rng.randint(20, 40)):
        credit_limit = Decimal(rng.choice([500, 1000, 2500, 5000, 10000]))
        status = rng.choices("ADCX", weights=[70, 15, 8, 7])[0]
        balance = rng.choice([Decimal(0), money(rng, -300, -1), money(rng, 1, 24.99),
                              money(rng, 25, float(credit_limit)), credit_limit + money(rng, 0.01, 200),
                              credit_limit - money(rng, 0, 50)])
        min_due = rng.choice([Decimal(0), Decimal(0), Decimal("25.00"), money(rng, 25, 300)])
        paid = rng.choice([Decimal(0), min_due, min_due + money(rng, 0, 100), min_due / 2 if min_due else Decimal(0)])
        expires = run + timedelta(days=rng.choice([-40, -1, 0, 30, 400, 900]))
        customer = rng.choice(customers)["id"] if rng.random() > 0.1 else str(900000000 + n)
        accounts.append({
            "id": str(40000000000 + n * 13 + seed * 1000),
            "status": status, "balance": balance, "credit_limit": credit_limit,
            "cash_limit": (credit_limit * rng.choice([Decimal("0.2"), Decimal("0.5")])).quantize(Decimal(1)),
            "opened": day(run - timedelta(days=rng.randint(100, 4000))), "expires": day(expires),
            "cycle_credit": money(rng, 0, 300), "cycle_debit": money(rng, 0, 900),
            "group": rng.choice(groups), "missed": rng.choice([0, 0, 0, 1, 2, 5, 6, 98, 99]),
            "min_due": min_due, "paid": paid, "points": rng.choice([0, 10, 1234, 999999990]),
            "customer": customer,
        })

    cards = []
    for n, a in enumerate(accounts):
        for k in range(rng.choice([1, 1, 2])):
            cards.append({"card": str(4000000000000000 + seed * 100000 + n * 10 + k), "customer": a["customer"],
                          "account": a["id"], "status": "Y" if rng.random() > 0.1 else rng.choice("NS ")})
    cards.append({"card": str(4999000000000000 + seed), "customer": "000000000",
                  "account": "49999999999", "status": "Y"})

    categories = {}
    for a in accounts:
        for type_code, category in rng.sample([("01", "0001"), ("01", "0002"), ("02", "0001"), ("03", "0001"),
                                               ("04", "0001"), ("05", "0001"), ("05", "0002")], rng.randint(0, 4)):
            categories[(a["id"], type_code, category)] = rng.choice(
                [Decimal(0), money(rng, -100, -0.01), money(rng, 0.01, 30), money(rng, 30, 3000)])

    rates = {}
    for group in groups + ["DEFAULT"]:
        for type_code, category in [("01", "0001"), ("01", "0002"), ("04", "0001"), ("05", "0001"), ("02", "0001")]:
            if rng.random() < 0.7:
                rates[(group, type_code, category)] = rng.choice([Decimal(0), Decimal("9.90"), Decimal("14.75"),
                                                                  Decimal("19.99"), Decimal("23.50")])
    rates[("OHNEZINS", "01", "0001")] = Decimal(0)

    transactions = []
    ids = []
    for n in range(rng.randint(60, 120)):
        tran_id = f"T{seed:03d}{n:012d}"
        if ids and rng.random() < 0.05:
            tran_id = rng.choice(ids)
        ids.append(tran_id)
        card = rng.choice(cards)["card"] if rng.random() > 0.05 else str(4111000000000000 + n)
        type_code = rng.choices(["01", "02", "03", "04", "05", "07"], weights=[50, 15, 10, 15, 2, 2])[0]
        value = rng.choice([money(rng, 0.01, 99.99), money(rng, 100, 900), money(rng, 900, 6000)])
        if rng.random() < 0.04:
            value = rng.choice([Decimal(0), -money(rng, 1, 50)])
        mcc = rng.choice(["5411", "5812", "7995", "5999", "4111", "6011"])
        tran_date = day(run - timedelta(days=rng.choice([0, 1, 2, 3])))
        transactions.append(
            tran_id.ljust(16) + type_code + rng.choice(["0001", "0002"]) + rng.choice(["POS", "ONLINE", "ATM"]).ljust(10)
            + rng.choice(["EINKAUF", "TANKSTELLE", "RESTAURANT", "ZAHLUNG DANKE", "GUTSCHRIFT"]).ljust(30)
            + signed(value) + str(rng.randint(100000000, 999999999)) + mcc + card + tran_date)

    files = {
        "CTLCARD": [day(run) + " KARTENBANK NACHTLAUF"],
        "ACCTFILE": [
            a["id"] + a["status"] + signed(a["balance"]) + unsigned(a["credit_limit"]) + unsigned(a["cash_limit"])
            + a["opened"] + a["expires"] + signed(a["cycle_credit"]) + signed(a["cycle_debit"]) + a["group"].ljust(10)
            + str(a["missed"]).zfill(2) + signed(a["min_due"]) + signed(a["paid"]) + str(a["points"]).zfill(9)
            + a["customer"] for a in accounts],
        "XREFFILE": [c["card"] + c["customer"] + c["account"] + c["status"] for c in cards],
        "CUSTFILE": [c["id"] + c["first"].ljust(20) + c["last"].ljust(25) + str(c["fico"]).zfill(3) for c in customers],
        "TCATFILE": [k[0] + k[1] + k[2] + signed(v) for k, v in sorted(categories.items())],
        "DISCGRP": [k[0].ljust(10) + k[1] + k[2] + unsigned(v, 4) for k, v in rates.items()],
        "DALYTRAN": transactions,
    }
    return files


STEPS = {
    "POST": ["CTLCARD", "ACCTFILE", "XREFFILE", "TCATFILE", "DALYTRAN"],
    "INTEREST": ["CTLCARD", "ACCTFILE", "TCATFILE", "DISCGRP", "CUSTFILE"],
    "STATEMENT": ["CTLCARD", "ACCTFILE", "CUSTFILE"],
}


def write_lines(path, lines):
    with open(path, "w") as f:
        f.writelines(line.rstrip() + "\n" for line in lines)


def main():
    cases_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "cases")
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    if os.path.isdir(cases_dir) and os.path.basename(cases_dir.rstrip("/")) == "cases":
        shutil.rmtree(cases_dir)
    for seed in range(1, count + 1):
        files = make_case(seed)
        case = os.path.join(cases_dir, f"case{seed:02d}")
        previous = None
        for step, inputs in STEPS.items():
            in_dir, out_dir = os.path.join(case, step, "in"), os.path.join(case, step, "out")
            os.makedirs(in_dir)
            os.makedirs(out_dir)
            for name in inputs:
                if previous and name == "ACCTFILE":
                    shutil.copy(os.path.join(previous, "ACCTOUT"), os.path.join(in_dir, name))
                elif previous and name == "TCATFILE":
                    shutil.copy(os.path.join(previous, "TCATOUT"), os.path.join(in_dir, name))
                else:
                    write_lines(os.path.join(in_dir, name), files[name])
            subprocess.run([sys.executable, REFERENCE, step, in_dir, out_dir], check=True)
            previous = out_dir
    print(f"{count} cases in {cases_dir}")


if __name__ == "__main__":
    main()
