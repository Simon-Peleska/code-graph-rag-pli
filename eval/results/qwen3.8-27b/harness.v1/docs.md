# Legacy PL/I Batch System Documentation: KARTENBANK

This document describes the production batch processing system for the "Kartenbank" (Card Bank). The system is implemented in PL/I and runs on a mainframe environment.

**Production Job:** `KBJ00001` (KARTENBANK NACHT)
**Dead/Decommissioned Jobs:** `KBJ00002`, `KBJ00003`

---

## 1. Production Job: KBJ00001 (KARTENBANK NACHT)

**Schedule:** Daily at 23:30, after `KBJ00090` (Data Intake).
**Purpose:** Nightly processing of credit card transactions, interest/fee calculation, and statement generation.

### Step 010: UMSAETZE BUCHEN (Post Transactions)
**Program:** `KBP00001`
**Condition:** Runs unconditionally.

#### Input Files (DD Names)
| DD Name | DSN | Description | Record Layout |
| :--- | :--- | :--- | :--- |
| `CTLCARD` | `KB.PROD.CTLCARD` | Control Card | `W_LDT` (8 chars): YYYYMMDD |
| `ACCTFILE` | `KB.PROD.ACCTFILE(0)` | Account Master (Input) | `KTO_SATZ` (140 chars) |
| `XREFFILE` | `KB.PROD.XREFFILE` | Card Cross-Reference | `XRF_SATZ` (50 chars) |
| `TCATFILE` | `KB.PROD.TCATFILE(0)` | Category Balances (Input) | `TCA_SATZ` (30 chars) |
| `DALYTRAN` | `KB.PROD.DALYTRAN(0)` | Daily Transactions | `TRN_SATZ` (120 chars) |

#### Output Files (DD Names)
| DD Name | DSN | Description | Record Layout |
| :--- | :--- | :--- | :--- |
| `ACCTOUT` | `KB.PROD.ACCTFILE(+1)` | Account Master (Output) | `KTO_SATZ` (140 chars) |
| `TCATOUT` | `KB.PROD.TCATFILE(+1)` | Category Balances (Output) | `TCA_SATZ` (30 chars) |
| `TRANOUT` | `KB.PROD.TRANHIST(+1)` | Transaction History | `BUC_SATZ` (130 chars) |
| `REJECTS` | `KB.PROD.REJECTS(+1)` | Rejected Transactions | `ABW_SATZ` (50 chars) |
| `SYSPRINT` | `SYSOUT=*` | System Log | Text |

#### Record Layouts (Exact Positions)

**KTO_SATZ (Account Record, 140 chars)**
| Pos | Len | Field | Format/Type | Description |
| :--- | :--- | :--- | :--- | :--- |
| 1-11 | 11 | `KTO_NR` | CHAR(11) | Account Number |
| 12 | 1 | `KTO_ST` | CHAR(1) | Status: A (Active), D (Delinquent), C (Closed), X (Written-off) |
| 13-23 | 11 | `KTO_SLD` | PIC 'S99999999V99' | Balance (Signed, 2 decimals) |
| 24-33 | 10 | `KTO_KLIM` | PIC '99999999V99' | Credit Limit (Unsigned, 2 decimals) |
| 34-43 | 10 | `KTO_BLIM` | PIC '99999999V99' | Cash Limit (Unsigned, 2 decimals) |
| 44-51 | 8 | `KTO_ERDT` | CHAR(8) | Creation Date (YYYYMMDD) |
| 52-59 | 8 | `KTO_ABDT` | CHAR(8) | Card Expiry Date (YYYYMMDD) |
| 60-70 | 11 | `KTO_ZYK_HAB` | PIC 'S99999999V99' | Cycle Credit Total |
| 71-81 | 11 | `KTO_ZYK_SOL` | PIC 'S99999999V99' | Cycle Debit Total |
| 82-91 | 10 | `KTO_GRP` | CHAR(10) | Discount Group |
| 92-93 | 2 | `KTO_MAHN` | PIC '99' | Dunning Counter |
| 94-104 | 11 | `KTO_MINZ` | PIC 'S99999999V99' | Minimum Payment Amount |
| 105-115 | 11 | `KTO_ZYK_ZAHL` | PIC 'S99999999V99' | Cycle Payment Total |
| 116-124 | 9 | `KTO_PKT` | PIC '(9)9' | Points Balance |
| 125-133 | 9 | `KTO_KDNR` | CHAR(9) | Customer Number |
| 134-140 | 7 | `FILLER` | CHAR(7) | Padding |

**XRF_SATZ (Card Cross-Ref, 50 chars)**
| Pos | Len | Field | Format/Type | Description |
| :--- | :--- | :--- | :--- | :--- |
| 1-16 | 16 | `XRF_KARTE` | CHAR(16) | Card Number |
| 17-25 | 9 | `XRF_KDNR` | CHAR(9) | Customer Number |
| 26-36 | 11 | `XRF_KTO` | CHAR(11) | Account Number |
| 37 | 1 | `XRF_ST` | CHAR(1) | Status (Y/N) |
| 38-50 | 13 | `FILLER` | CHAR(13) | Padding |

**TCA_SATZ (Category Balance, 30 chars)**
| Pos | Len | Field | Format/Type | Description |
| :--- | :--- | :--- | :--- | :--- |
| 1-11 | 11 | `TCA_KTO` | CHAR(11) | Account Number |
| 12-13 | 2 | `TCA_TYP` | CHAR(2) | Transaction Type |
| 14-17 | 4 | `TCA_KAT` | CHAR(4) | Transaction Category |
| 18-28 | 11 | `TCA_SLD` | PIC 'S99999999V99' | Balance |
| 29-30 | 2 | `FILLER` | CHAR(2) | Padding |

**TRN_SATZ (Transaction Input, 120 chars)**
| Pos | Len | Field | Format/Type | Description |
| :--- | :--- | :--- | :--- | :--- |
| 1-16 | 16 | `TRN_ID` | CHAR(16) | Transaction ID |
| 17-18 | 2 | `TRN_TYP` | CHAR(2) | Type (01=Purchase, 02=Payment, 03=Credit, 04=Cash, 05=Fee, 06=Interest) |
| 19-22 | 4 | `TRN_KAT` | CHAR(4) | Category |
| 23-32 | 10 | `TRN_QUELLE` | CHAR(10) | Source |
| 33-62 | 30 | `TRN_TXT` | CHAR(30) | Text |
| 63-73 | 11 | `TRN_BTR` | PIC 'S99999999V99' | Amount (Signed) |
| 74-82 | 9 | `TRN_HDL` | CHAR(9) | Handle |
| 83-86 | 4 | `TRN_MCC` | CHAR(4) | Merchant Category Code |
| 87-102 | 16 | `TRN_KARTE` | CHAR(16) | Card Number |
| 103-110 | 8 | `TRN_DT` | CHAR(8) | Date (YYYYMMDD) |
| 111-120 | 10 | `FILLER` | CHAR(10) | Padding |

**BUC_SATZ (Transaction Output, 130 chars)**
| Pos | Len | Field | Format/Type | Description |
| :--- | :--- | :--- | :--- | :--- |
| 1-110 | 110 | `BUC_TRN` | CHAR(110) | First 110 chars of TRN_SATZ |
| 111-121 | 11 | `BUC_KTO` | CHAR(11) | Account Number |
| 122-129 | 8 | `BUC_DT` | CHAR(8) | Booking Date |
| 130 | 1 | `FILLER` | CHAR(1) | Padding |

**ABW_SATZ (Rejection Record, 50 chars)**
| Pos | Len | Field | Format/Type | Description |
| :--- | :--- | :--- | :--- | :--- |
| 1-16 | 16 | `ABW_TRN` | CHAR(16) | Transaction ID |
| 17-19 | 3 | `ABW_GRD` | PIC '999' | Rejection Code |
| 20-49 | 30 | `ABW_TXT` | CHAR(30) | Rejection Text |
| 50 | 1 | `FILLER` | CHAR(1) | Padding |

#### Processing Logic (KBP00001)

1.  **Initialization:**
    *   Read `CTLCARD`. Extract Run Date (`W_LAUFDT`) from positions 1-8. If non-numeric, abort (RC 16).
    *   Load `ACCTFILE` into memory (`KTAB`). Validate each record using `KBU00022`. If any validation errors exist, abort without writing output.
    *   Load `XREFFILE` into memory (`#XK`, `#XA`, `#XS`).
    *   Load `TCATFILE` into memory (`TC_KEY`, `TC_SLD`).

2.  **Transaction Loop:**
    For each record in `DALYTRAN`:
    *   **Duplicate Check:** Check if `TRN_ID` exists in the in-memory seen-list. If yes, set `@DOPP` flag.
    *   **Direction Determination:**
        *   If `TRN_TYP` is '01' (Purchase) or '04' (Cash): Debit (`@SOLL` = True).
        *   Otherwise: Credit (`@SOLL` = False).
    *   **Validation (`PRUEFEN`):**
        *   *Note: The provided code snippet for `PRUEFEN` states it is "never called" in the context of the main flow description, but `UMSATZ` calls a validation routine. Based on `UMSATZ` logic, validation is performed inline or via a helper. The rules below are derived from the `PRUEFEN` description which lists the business rules.*
        *   **Rule Order:**
            1.  If Duplicate (`@DOPP`): Reject Code **110**.
            2.  If Amount (`TRN_BTR`) <= 0: Reject Code **109**.
            3.  If Type is '05' (Fee) or '06' (Interest): Reject Code **111** (Internal only).
            4.  If Type is not '01', '02', '03', '04': Reject Code **111**.
            5.  If Card Number not found in `XREFFILE`: Reject Code **100**.
            6.  If Card Status (`XRF_ST`) is not 'Y': Reject Code **101**.
            7.  If Account Number not found in `ACCTFILE`: Reject Code **102**.
            8.  If Account Status (`KTO_ST`) is 'C' or 'X': Reject Code **103**.
            9.  If Transaction Date > Card Expiry Date (`KTO_ABDT`): Reject Code **105**.
            10. If Debit AND Account Status is 'D': Reject Code **104**.
            11. If Type is '01' (Purchase) AND MCC is '7995': Reject Code **108**.
            12. If Type is '04' (Cash) AND Amount > Cash Limit (`KTO_BLIM`): Reject Code **107**.
            13. If Debit AND (Current Balance + Amount) > Credit Limit (`KTO_KLIM`): Reject Code **106**.
    *   **Rejection Handling:**
        *   If rejected, write `ABW_SATZ` to `REJECTS`.
        *   Map Code to Text (e.g., 100="KARTE UNBEKANNT", 101="KARTE GESPERRT", etc. *Note: Specific text mapping table `KO_ABW_TX` is referenced but not fully detailed in snippets; assume standard German banking texts*).
        *   Increment `Z_ABGEW` counter.
    *   **Booking Handling (`BUCHEN`):**
        *   If valid:
            *   **Debit:** `KTO_SLD` += Amount; `KTO_ZYK_SOL` += Amount.
            *   **Credit:** `KTO_SLD` -= Amount; `KTO_ZYK_HAB` += Amount.
            *   **Payment Specific:** If Type is '02' (Payment), `KTO_ZYK_ZAHL` += Amount.
            *   **Points Calculation:**
                *   If Type is '01' (Purchase):
                    *   Factor = 1.
                    *   If MCC is '5411' (Grocery): Factor = 2.
                    *   If MCC is '5812' (Restaurant): Factor = 3.
                    *   `KTO_PKT` += (Integer Part of Amount * Factor).
                    *   Cap `KTO_PKT` at 999,999,999.
                *   If Type is '03' (Credit):
                    *   `KTO_PKT` -= Integer Part of Amount.
                    *   Floor `KTO_PKT` at 0.
            *   **Cash Fee:**
                *   If Type is '04' (Cash):
                    *   Calculate Fee: `(Amount * 5.00) / 100`. Round to 2 decimals.
                    *   Minimum Fee: 10.00.
                    *   Final Fee = Max(Calculated, 10.00).
                    *   `KTO_SLD` += Final Fee.
                    *   `KTO_ZYK_SOL` += Final Fee.
                    *   Create new Transaction Record:
                        *   ID: 'CF' + Substr(Original ID, 3).
                        *   Type: '05'.
                        *   Cat: '0001'.
                        *   Text: 'BARGELDGEBUEHR'.
                        *   Amount: Final Fee.
                    *   Write Fee Transaction to `TRANOUT`.
            *   Write Original Transaction to `TRANOUT` (`BUC_SATZ`).
            *   Update `TCATFILE` in-memory table: Add Amount to `TC_SLD` for key (KTO, TYP, KAT).
            *   Increment `Z_GEBUCHT` counter.

3.  **Finalization:**
    *   Write all `ACCTFILE` records to `ACCTOUT`.
    *   Write all `TCATFILE` records to `TCATOUT`.
    *   If `Z_ABGEW` > 0, set Return Code to 4.
    *   Print Summary Report (`KBU00026`) to `SYSPRINT`.

---

### Step 020: ZINSEN / GEBUEHREN / STATUS (Interest/Fees/Status)
**Program:** `KBP00002`
**Condition:** `COND=(4,LT,STEP010)` (Runs if Step 010 RC < 4).

#### Input Files (DD Names)
| DD Name | DSN | Description | Record Layout |
| :--- | :--- | :--- | :--- |
| `CTLCARD` | `KB.PROD.CTLCARD` | Control Card | `W_LDT` (8 chars) |
| `ACCTFILE` | `KB.PROD.ACCTFILE(+1)` | Account Master (from Step 010) | `KTO_SATZ` (140 chars) |
| `TCATFILE` | `KB.PROD.TCATFILE(+1)` | Category Balances (from Step 010) | `TCA_SATZ` (30 chars) |
| `DISCGRP` | `KB.PROD.DISCGRP` | Discount Groups | `DSC_SATZ` (20 chars) |
| `CUSTFILE` | `KB.PROD.CUSTFILE` | Customer Master | `KDS_SATZ` (60 chars) |

#### Output Files (DD Names)
| DD Name | DSN | Description | Record Layout |
| :--- | :--- | :--- | :--- |
| `ACCTOUT` | `KB.PROD.ACCTFILE(+2)` | Account Master (Output) | `KTO_SATZ` (140 chars) |
| `TRANOUT` | `KB.PROD.TRANZINS(+1)` | Interest/Fee Transactions | `BUC_SATZ` (130 chars) |
| `SYSPRINT` | `SYSOUT=*` | System Log | Text |

#### Record Layouts (Additional)

**DSC_SATZ (Discount Group, 20 chars)**
| Pos | Len | Field | Format/Type | Description |
| :--- | :--- | :--- | :--- | :--- |
| 1-10 | 10 | `DSC_GRP` | CHAR(10) | Group Code |
| 11-12 | 2 | `DSC_TYP` | CHAR(2) | Type |
| 13-16 | 4 | `DSC_KAT` | CHAR(4) | Category |
| 17-20 | 4 | `DSC_ZINS` | PIC '99V99' | Interest Rate (Annual %) |

**KDS_SATZ (Customer Master, 60 chars)**
| Pos | Len | Field | Format/Type | Description |
| :--- | :--- | :--- | :--- | :--- |
| 1-9 | 9 | `KDS_NR` | CHAR(9) | Customer Number |
| 10-29 | 20 | `KDS_VORN` | CHAR(20) | First Name |
| 30-54 | 25 | `KDS_NACHN` | CHAR(25) | Last Name |
| 55-57 | 3 | `KDS_FICO` | PIC '999' | FICO Score |
| 58-60 | 3 | `FILLER` | CHAR(3) | Padding |

#### Processing Logic (KBP00002)

1.  **Initialization:**
    *   Read Run Date from `CTLCARD`.
    *   Load `ACCTFILE` into memory.
    *   Load `TCATFILE` into memory.
    *   Load `DISCGRP` into memory (`ZS_SCHL`, `ZS_P`).
    *   Load `CUSTFILE` into memory (`KD_TAB`).

2.  **Account Loop:**
    For each account in `ACCTFILE`:
    *   **Skip Condition:** If `KTO_ST` is 'X' (Written-off), skip.
    *   **Interest Calculation:**
        *   Iterate through `TCATFILE` entries for this account.
        *   **Filter:** Only process if `TC_SLD` > 0 AND `TCA_TYP` is not '02' (Payment).
        *   **Rate Lookup:**
            *   Look up rate in `DISCGRP` using Key = `KTO_GRP` + `TCA_TYP` + `TCA_KAT`.
            *   If not found, look up using Default Group (`$GRP_DEF`) + `TCA_TYP` + `TCA_KAT`.
            *   If still not found, Rate = 0.
        *   **Special Promo:** If `KTO_GRP` is 'AKTION2010' AND Run Date is between '20100101' and '20111231', Rate = 0.
        *   **Surcharges:**
            *   If `KTO_ST` is 'D' (Delinquent): Rate += 3.00.
            *   If Customer FICO < 600: Rate += 2.00.
        *   **Calculation:**
            *   Interest = `(TC_SLD * Rate) / 1200`.
            *   Round to 2 decimals.
        *   **Threshold:** Only charge if Total Interest >= 1.00.
        *   **Posting:**
            *   `KTO_SLD` += Interest.
            *   `KTO_ZYK_SOL` += Interest.
            *   Write Transaction to `TRANOUT`:
                *   ID: 'ZI' + `KTO_NR` + '000'.
                *   Type: '06'.
                *   Cat: '0001'.
                *   Text: 'ZINSEN'.
                *   Amount: Interest.
    *   **Dunning Fees:**
        *   **Condition:** `KTO_ST` is 'A' or 'D'.
        *   **Check:** If `KTO_MINZ` > 0 AND `KTO_ZYK_ZAHL` < `KTO_MINZ`.
        *   **Fee Amount:**
            *   If `KTO_MAHN` > 0: Fee = 35.00.
            *   Else: Fee = 25.00.
        *   **Posting:**
            *   `KTO_SLD` += Fee.
            *   `KTO_ZYK_SOL` += Fee.
            *   Write Transaction to `TRANOUT`:
                *   ID: 'MA' + `KTO_NR` + '000'.
                *   Type: '05'.
                *   Cat: '0001'.
                *   Text: 'MAHNGEBUEHR'.
                *   Amount: Fee.
            *   Increment `KTO_MAHN` by 1. Cap at 99.
        *   **Reset:** If `KTO_ZYK_ZAHL` >= `KTO_MINZ` (or `KTO_MINZ` is 0), reset `KTO_MAHN` to 0.
    *   **Overdraft Fee:**
        *   **Condition:** `KTO_SLD` > `KTO_KLIM`.
        *   **Fee Amount:** 29.00.
        *   **Posting:**
            *   `KTO_SLD` += 29.00.
            *   `KTO_ZYK_SOL` += 29.00.
            *   Write Transaction to `TRANOUT`:
                *   ID: 'UE' + `KTO_NR` + '000'.
                *   Type: '05'.
                *   Cat: '0001'.
                *   Text: 'UEBERZUGSGEBUEHR'.
                *   Amount: 29.00.
    *   **Status Update:**
        *   If `KTO_ST` is 'A' AND `KTO_MAHN` >= 2: Set `KTO_ST` to 'D'.
        *   If `KTO_ST` is 'D' AND `KTO_MAHN` >= 6: Set `KTO_ST` to 'X'.
        *   If `KTO_ST` is 'D' AND `KTO_MAHN` == 0: Set `KTO_ST` to 'A'.

3.  **Finalization:**
    *   Write all `ACCTFILE` records to `ACCTOUT`.
    *   Print Summary Report to `SYSPRINT`.

---

### Step 030: KONTOAUSZUG, NEUER ZYKLUS (Statement/New Cycle)
**Program:** `KBP00003`
**Condition:** `COND=(4,LT)` (Runs if previous steps RC < 4).

#### Input Files (DD Names)
| DD Name | DSN | Description | Record Layout |
| :--- | :--- | :--- | :--- |
| `CTLCARD` | `KB.PROD.CTLCARD` | Control Card | `W_LDT` (8 chars) |
| `ACCTFILE` | `KB.PROD.ACCTFILE(+2)` | Account Master (from Step 020) | `KTO_SATZ` (140 chars) |
| `CUSTFILE` | `KB.PROD.CUSTFILE` | Customer Master | `KDS_SATZ` (60 chars) |

#### Output Files (DD Names)
| DD Name | DSN | Description | Record Layout |
| :--- | :--- | :--- | :--- |
| `ACCTOUT` | `KB.PROD.ACCTFILE(+3)` | Account Master (Output) | `KTO_SATZ` (140 chars) |
| `STMTFILE` | `KB.PROD.STMTFILE(+1)` | Account Statements | `AZG_SATZ` (120 chars) |
| `SYSPRINT` | `SYSOUT=*` | System Log | Text |

#### Record Layouts (Additional)

**AZG_SATZ (Statement Record, 120 chars)**
| Pos | Len | Field | Format/Type | Description |
| :--- | :--- | :--- | :--- | :--- |
| 1-11 | 11 | `AZG_KTO` | CHAR(11) | Account Number |
| 12-57 | 46 | `AZG_NAME` | CHAR(46) | Customer Name |
| 58-68 | 11 | `AZG_SLD` | PIC 'S99999999V99' | Balance |
| 69-79 | 11 | `AZG_MINZ` | PIC 'S99999999V99' | Minimum Payment |
| 80-87 | 8 | `AZG_FAEL` | CHAR(8) | Due Date (YYYYMMDD) |
| 88-96 | 9 | `AZG_PKT` | PIC '(9)9' | Points |
| 97 | 1 | `AZG_ST` | CHAR(1) | Status |
| 98-108 | 11 | `AZG_SOL` | PIC 'S99999999V99' | Cycle Debit |
| 109-119 | 11 | `AZG_HAB` | PIC 'S99999999V99' | Cycle Credit |
| 120 | 1 | `FILLER` | CHAR(1) | Padding |

#### Processing Logic (KBP00003)

1.  **Initialization:**
    *   Read Run Date from `CTLCARD`.
    *   Calculate Due Date: Run Date + 25 days.
    *   Load `ACCTFILE` into memory.
    *   Load `CUSTFILE` into memory.

2.  **Account Loop:**
    For each account in `ACCTFILE`:
    *   **Skip Condition:** If `KTO_ST` is 'X', skip.
    *   **Minimum Payment Calculation (`MINDESTZAHLUNG`):**
        *   If `KTO_SLD` <= 0: Min Pay = 0.
        *   If `KTO_SLD` > 0:
            *   If `KTO_SLD` < `KO_MINZ_MIN` (Floor): Min Pay = `KTO_SLD`.
            *   Else: Min Pay = `Max( (KTO_SLD * KO_MINZ_PROZ) / 100, KO_MINZ_MIN )`.
            *   If `KTO_SLD` > `KTO_KLIM`: Min Pay += (`KTO_SLD` - `KTO_KLIM`).
            *   Cap Min Pay at `KTO_SLD`.
        *   Update `KTO_MINZ` with calculated Min Pay.
    *   **Statement Generation (`AUSZUG`):**
        *   **Condition:** If `KTO_SLD` != 0 OR `KTO_ZYK_SOL` != 0 OR `KTO_ZYK_HAB` != 0.
        *   **Name Lookup:** Get Customer Name from `CUSTFILE` using `KTO_KDNR`. If not found, use 'UNBEKANNT'.
        *   **Currency Conversion:**
            *   *Note: The code references `SW_EURO` and `KBU00020` (DM to EUR conversion). The material does not specify how `SW_EURO` is set. Assuming it is a system parameter or control card field not explicitly detailed in the snippets. If `SW_EURO` is 'J', convert `KTO_SLD` to EUR using rate 1.95583. Otherwise, keep original.*
        *   **Write Statement:**
            *   `AZG_KTO` = `KTO_NR`.
            *   `AZG_NAME` = Customer Name.
            *   `AZG_SLD` = Converted Balance.
            *   `AZG_MINZ` = `KTO_MINZ`.
            *   `AZG_FAEL` = Due Date.
            *   `AZG_PKT` = `KTO_PKT`.
            *   `AZG_ST` = `KTO_ST`.
            *   `AZG_SOL` = `KTO_ZYK_SOL`.
            *   `AZG_HAB` = `KTO_ZYK_HAB`.
            *   Write to `STMTFILE`.
    *   **Cycle Reset (`NEUER_ZYKLUS`):**
        *   `KTO_ZYK_SOL` = 0.
        *   `KTO_ZYK_HAB` = 0.
        *   `KTO_ZYK_ZAHL` = 0.
        *   `KTO_MINZ` = System Minimum (`§MIN`). *Note: `§MIN` is a system constant, likely defined in `CTLCARD` or a global config. The snippet says "system minimum value".*

3.  **Finalization:**
    *   Write all `ACCTFILE` records to `ACCTOUT`.
    *   Print Summary Report to `SYSPRINT`.

---

## 2. Dead/Decommissioned Jobs

### Job KBJ00002 (ALTER ZINSLAUF)
**Status:** **DEAD**. Not scheduled since 1997. Replaced by `KBP00002` in `KBJ00001`.
**Program:** `KBP00004`
**Description:** Calculates monthly interest at a flat rate of 18% p.a. on positive balances.
**Action:** Do not rebuild. Retained for audit purposes only.

### Job KBJ00003 (MAHNBRIEFE)
**Status:** **DEAD**. Decommissioned 2016-01-31. Letters are now generated by the Document Management System.
**Program:** `KBP00005`
**Description:** Generates dunning letters for accounts in arrears.
**Action:** Do not rebuild.

---

## 3. Utility Procedures (Shared)

*   **KBU00007/KBU00008:** Logging to `SYSPRINT`.
*   **KBU00011:** Error reporting and termination (RC 16+).
*   **KBU00012:** Load Account File into memory.
*   **KBU00015:** Aggregate Category Balances.
*   **KBU00018:** Load Customer File into memory.
*   **KBU00020:** Convert DM to EUR (Rate 1.95583).
*   **KBU00021:** Validation routines (`P#NUMU`, `P#NUMS`, `KBU00025`, `KBU00022`, `KBU00023`, `KBU00024`).
*   **KBU00026/KBU00027/KBU00028:** Statistics and Reporting.
*   **KBU00001:** Date utilities (`KBU00002`, `KBU0SJ`, `KBU0TM`, `KBU00003`, `KBU0Y2`).
*   **KBU00004:** Math utilities (`KBU00005` Round, `KBU00006` Max).
*   **KBU00009/KBU00010:** Linear Search.

---

## 4. Notes on Unclear Items

1.  **`SW_EURO` Flag:** In `KBP00003`, the variable `SW_EURO` determines if currency conversion is applied. The source of this flag (Control Card field? System Parameter?) is not explicitly defined in the provided snippets.
2.  **`§MIN` Constant:** In `KBP00003`, the minimum payment is reset to `§MIN`. The value of this constant is not provided.
3.  **Rejection Texts:** The mapping of rejection codes (100-111) to specific German text strings is referenced via `KO_ABW_TX` but the actual text values are not listed in the snippets.
4.  **`KO_MINZ_PROZ` and `KO_MINZ_MIN`:** These constants used in `KBP00003` for minimum payment calculation are not defined in the snippets.
5.  **`KO_GEB_BAR_PROZ` and `KO_GEB_BAR_MIN`:** These constants used in `KBP00001` for cash fees are not defined in the snippets (defaults 5.00% and 10.00 are mentioned in the logic description).
6.  **`KO_AUFS_VERZ` and `KO_AUFS_FICO`:** These surcharge constants (3.00 and 2.00) are mentioned in the logic description for `KBP00002` but not defined as variables in the snippets.
7.  **`KO_VERZ_AB` and `KO_ABSCHR_AB`:** These thresholds (2 and 6) for status changes are mentioned in the logic description for `KBP00002` but not defined as variables in the snippets.
8.  **`KO_FAELLIG_TG`:** This constant (25 days) for due date calculation is mentioned in the logic description for `KBP00003` but not defined as a variable in the snippets.
9.  **`KO_MCC_LEBM`, `KO_MCC_REST`, `KO_MCC_SPERR`:** These MCC codes ('5411', '5812', '7995') are mentioned in the logic description but not defined as variables in the snippets.
10. **`KO_TYP_KAUF`, `KO_TYP_ZAHL`, `KO_TYP_GUT`, `KO_TYP_BAR`, `KO_TYP_GEB`, `KO_TYP_ZINS`:** These type codes ('01', '02', '03', '04', '05', '06') are mentioned in the logic description but not defined as variables in the snippets.
11. **`KO_MAX_PKT`:** This constant (999,999,999) for points cap is mentioned in the logic description but not defined as a variable in the snippets.
12. **`KO_ZINS_FREI`:** This constant (1.00) for interest threshold is mentioned in the logic description but not defined as a variable in the snippets.
13. **`KO_MAHN_1`, `KO_MAHN_2`:** These constants (25.00 and 35.00) for dunning fees are mentioned in the logic description but not defined as variables in the snippets.
14. **`KO_UEBZ`:** This constant (29.00) for overdraft fee is mentioned in the logic description but not defined as a variable in the snippets.
15. **`$GRP_DEF`:** This default group code for interest rate lookup is mentioned in the logic description but not defined in the snippets.
16. **`$AKT_GRP`, `$AKT_VON`, `$AKT_BIS`:** These constants for the 2010 promo are mentioned in the logic description but not defined in the snippets.
17. **`KO_FICO_GRENZE`:** This constant (600) for FICO threshold is mentioned in the logic description but not defined in the snippets.

**Recommendation:** When rebuilding in Python, these constants should be externalized to a configuration file or database table, as their values are not hardcoded in the provided PL/I snippets but are referenced in the logic descriptions.