"""The Kartenbank nightly batch as REGELN.md describes it: the reference a
rebuilt application is tested against. Hidden from the models.

    python3 app.py POST|INTEREST|STATEMENT <in_dir> <out_dir>
"""
import os
import sys
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

ZERO = Decimal("0")


def records(directory, name, length):
    path = os.path.join(directory, name)
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return [line.rstrip("\n").ljust(length)[:length] for line in f if line.strip()]


def write(directory, name, lines):
    with open(os.path.join(directory, name), "w") as f:
        f.writelines(line.rstrip() + "\n" for line in lines)


def text(value, length):
    return value.ljust(length)[:length]


def amount(field):
    value = Decimal(int(field[1:])) / 100
    return -value if field[0] == "-" else value


def unsigned(field):
    return Decimal(int(field)) / 100


def signed_field(value):
    cents = int((abs(value) * 100).to_integral_value())
    return ("-" if value < 0 else "+") + str(cents).zfill(10)


def unsigned_field(value, digits):
    return str(int((value * 100).to_integral_value())).zfill(digits)


def cents(value):
    return value.quantize(Decimal("0.01"), ROUND_HALF_UP)


def run_date(directory):
    return records(directory, "CTLCARD", 80)[0][:8]


def read_accounts(directory):
    accounts = []
    for r in records(directory, "ACCTFILE", 140):
        accounts.append({
            "id": r[0:11], "status": r[11], "balance": amount(r[12:23]),
            "credit_limit": unsigned(r[23:33]), "cash_limit": unsigned(r[33:43]),
            "opened": r[43:51], "expires": r[51:59],
            "cycle_credit": amount(r[59:70]), "cycle_debit": amount(r[70:81]),
            "group": r[81:91], "missed": int(r[91:93]), "min_due": amount(r[93:104]),
            "paid": amount(r[104:115]), "points": int(r[115:124]), "customer": r[124:133],
        })
    return accounts


def account_record(a):
    return text(
        a["id"] + a["status"] + signed_field(a["balance"])
        + unsigned_field(a["credit_limit"], 10) + unsigned_field(a["cash_limit"], 10)
        + a["opened"] + a["expires"] + signed_field(a["cycle_credit"]) + signed_field(a["cycle_debit"])
        + a["group"] + str(a["missed"]).zfill(2) + signed_field(a["min_due"]) + signed_field(a["paid"])
        + str(a["points"]).zfill(9) + a["customer"], 140)


def read_customers(directory):
    customers = {}
    for r in records(directory, "CUSTFILE", 60):
        customers[r[0:9]] = {"first": r[9:29].strip(), "last": r[29:54].strip(), "fico": int(r[54:57])}
    return customers


def read_category_balances(directory):
    return {(r[0:11], r[11:13], r[13:17]): amount(r[17:28]) for r in records(directory, "TCATFILE", 30)}


def category_record(key, balance):
    return text(key[0] + key[1] + key[2] + signed_field(balance), 30)


def transaction_record(tran_id, type_code, category, source, description, value, merchant, mcc, card, day):
    return (text(tran_id, 16) + type_code + category + text(source, 10) + text(description, 30)
            + signed_field(value) + merchant + mcc + text(card, 16) + day)


def posted(transaction, account_id, day):
    return text(transaction[:110] + account_id + day, 130)


REJECT_TEXTS = {
    100: "KARTE UNBEKANNT", 101: "KARTE GESPERRT", 102: "KONTO UNBEKANNT", 103: "KONTO GESCHLOSSEN",
    104: "KONTO IM VERZUG", 105: "KARTE ABGELAUFEN", 106: "KREDITLIMIT UEBERSCHRITTEN",
    107: "BARGELDLIMIT UEBERSCHRITTEN", 108: "HAENDLERKATEGORIE GESPERRT", 109: "BETRAG UNGUELTIG",
    110: "DOPPELTE TRANSAKTION", 111: "TRANSAKTIONSTYP UNBEKANNT",
}


def post(in_dir, out_dir):
    day = run_date(in_dir)
    accounts = read_accounts(in_dir)
    by_id = {a["id"]: a for a in accounts}
    cards = {r[0:16]: {"account": r[25:36], "status": r[36]} for r in records(in_dir, "XREFFILE", 50)}
    balances = read_category_balances(in_dir)
    seen = set()
    tranout, rejects = [], []

    def reject(tran_id, code):
        rejects.append(text(tran_id + str(code).zfill(3) + REJECT_TEXTS[code], 50))

    for t in records(in_dir, "DALYTRAN", 120):
        tran_id, type_code, category = t[0:16], t[16:18], t[18:22]
        value, mcc, card_number, tran_date = amount(t[62:73]), t[82:86], t[86:102], t[102:110]
        duplicate = tran_id in seen
        seen.add(tran_id)
        card = cards.get(card_number)
        account = by_id.get(card["account"]) if card else None
        debit = type_code in ("01", "04")
        if duplicate:
            reject(tran_id, 110)
        elif value <= 0:
            reject(tran_id, 109)
        elif type_code not in ("01", "02", "03", "04"):
            reject(tran_id, 111)
        elif card is None:
            reject(tran_id, 100)
        elif card["status"] != "Y":
            reject(tran_id, 101)
        elif account is None:
            reject(tran_id, 102)
        elif account["status"] in ("C", "X"):
            reject(tran_id, 103)
        elif tran_date > account["expires"]:
            reject(tran_id, 105)
        elif debit and account["status"] == "D":
            reject(tran_id, 104)
        elif type_code == "01" and mcc == "7995":
            reject(tran_id, 108)
        elif type_code == "04" and value > account["cash_limit"]:
            reject(tran_id, 107)
        elif debit and account["balance"] + value > account["credit_limit"]:
            reject(tran_id, 106)
        else:
            key = (account["id"], type_code, category)
            if debit:
                account["balance"] += value
                account["cycle_debit"] += value
                balances[key] = balances.get(key, ZERO) + value
            else:
                account["balance"] -= value
                account["cycle_credit"] += value
                balances[key] = balances.get(key, ZERO) - value
            if type_code == "02":
                account["paid"] += value
            units = int(value)
            if type_code == "01":
                account["points"] = min(999999999, account["points"] + units * {"5411": 2, "5812": 3}.get(mcc, 1))
            if type_code == "03":
                account["points"] = max(0, account["points"] - units)
            tranout.append(posted(t, account["id"], day))
            if type_code == "04":
                fee = max(Decimal("10.00"), cents(value * 5 / 100))
                account["balance"] += fee
                account["cycle_debit"] += fee
                fee_key = (account["id"], "05", "0001")
                balances[fee_key] = balances.get(fee_key, ZERO) + fee
                fee_tran = transaction_record("CF" + tran_id[2:], "05", "0001", "SYSTEM", "BARGELDGEBUEHR",
                                              fee, "000000000", "0000", card_number, day)
                tranout.append(posted(fee_tran, account["id"], day))

    write(out_dir, "ACCTOUT", [account_record(a) for a in accounts])
    write(out_dir, "TCATOUT", [category_record(k, balances[k]) for k in sorted(balances)])
    write(out_dir, "TRANOUT", tranout)
    write(out_dir, "REJECTS", rejects)


def interest(in_dir, out_dir):
    day = run_date(in_dir)
    accounts = read_accounts(in_dir)
    customers = read_customers(in_dir)
    balances = read_category_balances(in_dir)
    rates = {(r[0:10], r[10:12], r[12:16]): unsigned(r[16:20]) for r in records(in_dir, "DISCGRP", 20)}
    tranout = []

    def charge(a, prefix, type_code, category, description, value):
        a["balance"] += value
        a["cycle_debit"] += value
        tranout.append(posted(transaction_record(prefix + a["id"] + "000", type_code, category, "ZINSLAUF",
                                                 description, value, "000000000", "0000", "", day), a["id"], day))

    for a in accounts:
        if a["status"] == "X":
            continue
        customer = customers.get(a["customer"])
        total = ZERO
        for (account_id, type_code, category), balance in sorted(balances.items()):
            if account_id != a["id"] or balance <= 0 or type_code == "02":
                continue
            rate = rates.get((a["group"], type_code, category))
            if rate is None:
                rate = rates.get(("DEFAULT".ljust(10), type_code, category), ZERO)
            if rate > 0 and a["status"] == "D":
                rate += 3
            if rate > 0 and customer is not None and customer["fico"] < 600:
                rate += 2
            total += cents(balance * rate / 1200)
        if total >= 1:
            charge(a, "ZI", "06", "0001", "SOLLZINSEN", total)
        if a["status"] in ("A", "D"):
            if a["min_due"] > 0 and a["paid"] < a["min_due"]:
                fee = Decimal("35.00") if a["missed"] > 0 else Decimal("25.00")
                a["missed"] = min(99, a["missed"] + 1)
                charge(a, "MG", "05", "0002", "MAHNGEBUEHR", fee)
            elif a["min_due"] > 0:
                a["missed"] = 0
            if a["balance"] > a["credit_limit"]:
                charge(a, "UL", "05", "0003", "UEBERZIEHUNGSGEBUEHR", Decimal("29.00"))
        if a["status"] == "A" and a["missed"] >= 2:
            a["status"] = "D"
        elif a["status"] == "D" and a["missed"] >= 6:
            a["status"] = "X"
        elif a["status"] == "D" and a["missed"] == 0:
            a["status"] = "A"

    write(out_dir, "ACCTOUT", [account_record(a) for a in accounts])
    write(out_dir, "TRANOUT", tranout)


def statement(in_dir, out_dir):
    day = run_date(in_dir)
    due = (date(int(day[0:4]), int(day[4:6]), int(day[6:8])) + timedelta(days=25)).strftime("%Y%m%d")
    accounts = read_accounts(in_dir)
    customers = read_customers(in_dir)
    statements = []
    for a in accounts:
        if a["status"] == "X":
            continue
        balance = a["balance"]
        if balance <= 0:
            minimum = ZERO
        elif balance < 25:
            minimum = balance
        else:
            minimum = max(Decimal("25.00"), cents(balance * 2 / 100))
            if balance > a["credit_limit"]:
                minimum += balance - a["credit_limit"]
            minimum = min(minimum, balance)
        if balance != 0 or a["cycle_debit"] != 0 or a["cycle_credit"] != 0:
            customer = customers.get(a["customer"])
            name = f'{customer["first"]} {customer["last"]}' if customer else "UNBEKANNT"
            statements.append(text(
                a["id"] + text(name, 46) + signed_field(balance) + signed_field(minimum) + due
                + str(a["points"]).zfill(9) + a["status"] + signed_field(a["cycle_debit"])
                + signed_field(a["cycle_credit"]), 120))
        a["cycle_debit"] = ZERO
        a["cycle_credit"] = ZERO
        a["paid"] = ZERO
        a["min_due"] = minimum

    write(out_dir, "ACCTOUT", [account_record(a) for a in accounts])
    write(out_dir, "STMTFILE", statements)


if __name__ == "__main__":
    step, in_dir, out_dir = sys.argv[1:4]
    {"POST": post, "INTEREST": interest, "STATEMENT": statement}[step](in_dir, out_dir)
