# Kartenbank nightly batch: the rules (gold set)

Hidden from the models. This is what an expert knows about the PL/I project in
`../repo`, written down once. `app.py` implements exactly this; the PL/I is
meant to. Every rule has an id the evaluation scores against.

Amounts in records are pictures with an implied decimal point:
`S99999999V99` is a sign (`+`/`-`) and 10 digits, the last two cents;
`99999999V99` the same without sign. Dates are `YYYYMMDD`. The run date is
the first 8 characters of CTLCARD. Rounding is half up to cents.

## Step POST (KBP00001): post the day's card transactions

Transaction types: `01` purchase, `02` payment, `03` refund/credit, `04` cash
advance. Each transaction of DALYTRAN, in file order, is checked; the first
failing check rejects it with this code and text (written to REJECTS):

| Rule | Check | Code | Text |
|---|---|---|---|
| P-01 | the transaction id was already seen in this run (accepted or not) | 110 | DOPPELTE TRANSAKTION |
| P-02 | amount is not above zero | 109 | BETRAG UNGUELTIG |
| P-03 | type is not 01-04 | 111 | TRANSAKTIONSTYP UNBEKANNT |
| P-04 | the card number is not in XREFFILE | 100 | KARTE UNBEKANNT |
| P-05 | the card's status is not `Y` | 101 | KARTE GESPERRT |
| P-06 | the card's account is not in ACCTFILE | 102 | KONTO UNBEKANNT |
| P-07 | the account's status is `C` (closed) or `X` (charged off) | 103 | KONTO GESCHLOSSEN |
| P-08 | the transaction date is after the account's expiry date | 105 | KARTE ABGELAUFEN |
| P-09 | purchase or cash advance on a delinquent account (status `D`) | 104 | KONTO IM VERZUG |
| P-10 | purchase with merchant category code 7995 (gambling) | 108 | HAENDLERKATEGORIE GESPERRT |
| P-11 | cash advance above the account's cash limit | 107 | BARGELDLIMIT UEBERSCHRITTEN |
| P-12 | purchase or cash advance that would bring the balance above the credit limit | 106 | KREDITLIMIT UEBERSCHRITTEN |

An accepted transaction:

- P-13 Purchase and cash advance add the amount to the balance and to the
  cycle debits; payment and refund subtract it from the balance and add it to
  the cycle credits. A payment also adds it to the payments of the cycle.
- P-14 The category balance of (account, type, category) is changed the same
  way (plus for 01/04, minus for 02/03), created at zero if missing. TCATOUT
  is sorted by account, type, category.
- P-15 Reward points: a purchase earns the whole currency units of its amount
  (cents dropped), twice that for MCC 5411 (groceries), three times for MCC
  5812 (restaurants). A refund takes the whole units off, never below zero.
  Payments and cash advances earn nothing.
- P-16 The accepted transaction is written to TRANOUT with its account and the
  run date.
- P-17 A cash advance costs a fee of 5 % of its amount, at least 10.00. It is
  added to the balance, the cycle debits and the category balance (account,
  05, 0001), without a limit check, and written to TRANOUT as transaction
  `CF` + the original id from its 3rd character, type 05, category 0001,
  source `SYSTEM`, text `BARGELDGEBUEHR`, merchant `000000000`, MCC `0000`,
  the same card, dated the run date.
- P-18 ACCTOUT holds every account in input order, changed or not.

## Step INTEREST (KBP00002): interest, fees and status at cycle end

For each account, in ACCTFILE order:

- I-01 Charged-off accounts (`X`) are left alone.
- I-02 Interest is charged on every category balance of the account above
  zero, except payment categories (type 02): balance × annual rate / 1200,
  rounded to cents per category, summed.
- I-03 The annual rate comes from DISCGRP for (the account's group, type,
  category); if there is none, for (`DEFAULT`, type, category); if there is
  none either, it is 0.
- I-04 Surcharges on a found rate (above 0): +3.00 percentage points for a
  delinquent account (`D`), +2.00 when the account's customer has a FICO score
  below 600. A missing customer gets no surcharge.
- I-05 A total interest below 1.00 is waived (not charged).
- I-06 Interest is added to the balance and the cycle debits and written to
  TRANOUT as `ZI` + account id + `000`, type 06, category 0001, source
  `ZINSLAUF`, text `SOLLZINSEN`, merchant `000000000`, MCC `0000`, no card,
  dated the run date.
- I-07 Fees only for active (`A`) and delinquent (`D`) accounts, not closed
  ones.
- I-08 Late fee: if a minimum payment was due (above 0) and the payments of
  the cycle are below it, the fee is 25.00, or 35.00 if a payment was missed
  before (missed count above 0); the missed count goes up by one (at most
  99). Written as `MG` + account + `000`, type 05, category 0002, text
  `MAHNGEBUEHR`. If the minimum was paid, the missed count goes back to 0.
- I-09 Overlimit fee: if the balance (after interest and late fee) is above
  the credit limit, 29.00, written as `UL` + account + `000`, type 05,
  category 0003, text `UEBERZIEHUNGSGEBUEHR`.
- I-10 Fees are added to the balance and the cycle debits; they are written
  after the interest, late fee first.
- I-11 Status: an active account with 2 or more missed payments becomes
  delinquent (`D`); a delinquent one with 6 or more becomes charged off
  (`X`), with 0 it becomes active again. Closed accounts keep their status.

## Step STATEMENT (KBP00003): statements and the new cycle

For each account, in ACCTFILE order, except charged-off ones (`X`, left
unchanged):

- S-01 The new minimum payment: 0 for a balance of 0 or less; the balance if
  it is below 25.00; else 2 % of the balance (rounded), at least 25.00, plus
  the amount over the credit limit, at most the balance.
- S-02 A statement is written (STMTFILE) when the balance or the cycle debits
  or the cycle credits are not zero: account, the customer's first and last
  name trimmed and joined by a blank (`UNBEKANNT` without customer), balance,
  the new minimum payment, the due date (run date + 25 days), reward points,
  status, cycle debits, cycle credits.
- S-03 The account starts a new cycle: cycle debits, cycle credits and
  payments of the cycle are set to 0, the minimum payment due to the new
  one.

## Things that look like rules but are not

- D-01 `KBP00004` is an old interest program; no job runs it.
- D-02 The euro conversion in `KBU00020` is never active: its switch is
  initialized off and never set.
- D-03 Job `KBJ00002` is an old job not scheduled any more.
- D-04 The interest program sets the rate to 0 for group `AKTION2010` only
  for run dates in 2010-2011; that window is over, so it never applies.
- D-05 `KBP00005` (dunning letters) and its job `KBJ00003` are no longer
  scheduled.
- D-06 The plausibility checks (`KBU00021`), the control totals list
  (`KBU00026`), the trace switch and the checkpoints only write to the log
  (SYSPRINT); they never change an output file or reject a record.
