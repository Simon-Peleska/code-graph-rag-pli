# Legacy System Documentation: KARTENBANK Batch Processing

This document provides the technical specifications for the KARTENBANK batch system. This documentation is intended for the Python reconstruction team. **Note: Do not rebuild programs or jobs marked as "DECOMMISSIONED" or "DEAD".**

---

## 1. System Overview

The system consists of three primary batch jobs:
1.  **KBJ00001**: Daily Night Processing (Transactions, Balances, and Totals).
2.  **KBJ00002**: Interest Rate Adjustment (Scheduled/Manual).
3.  **KBJ00003**: **DECOMMISSIONED**. (Do not rebuild).

---

## 2. Job Specifications

### JCL/KBJ00001: KARTENBANK NACHTVERARBEITUNG
**Schedule:** Daily at 23:30.

#### STEP010: KBP00001 (Transaction Processing)
Processes daily transactions, updates account balances, applies fees, and manages points.

**Inputs:**
*   `CTLCARD`: Control file. Contains processing date (`W_LAUFDT`) in positions 1-8.
*   `XREFFILE`: Cross-reference card data (`XRF_SATZ` format).
*   `ACCTFILE`: Account master records (`KTO_SATZ` format).
*   `DALYTRAN`: Daily transactions (`TRN_SATZ` format).
*   `P_PARM`: Program parameters (Supports `TRACE` and `CHKP=xxxx`).

**Outputs:**
*   `ACCTOUT`: Updated account master records (`KTO_SATZ` format).
*   `TCATOUT`: Updated category totals (`TCA_SATZ` format).
*   `TRANOUT`: Processed transaction history (`BUC_SATZ` format).
*   `REJECTS`: Rejected transactions (`ABW_SATZ` format).
*   `SYSPRINT`: Statistical reports and logs.

**Business Rules & Processing Order:**
1.  **Initialization**: Extract processing date from `CTLCARD`. Validate date is numeric.
2.  **Load Reference Data**: Load `XREFFILE` into memory. If a card/account string is non-numeric, increment error counter `Z_GESCHR`.
3.  **Load Account Data**: Load `ACCTFILE` into memory. Validate each record via `KBU00022` (checks numeric integrity, status codes 'A/D/C/X', date ranges, and limits). If errors found, terminate.
4.  **Transaction Loop**: For each record in `DALYTRAN`:
    *   Validate structural integrity (`KBU00023`).
    *   Check for duplicates using `GS` list. If duplicate, mark `@DOPSB`.
    *   Determine if Debit (`@SOLL`) or Credit based on type: `01` (KAUF) or `04` (BAR) are Debit; others are Credit.
    *   **Validation (`PRUEFEN`)**:
        *   Return `110` if duplicate.
        *   Return `109` if amount $\le 0$.
        *   Return `111` if type is Fee or Interest.
        *   Return `100` if card not found in `XREFFILE`.
        *   Return `101` if card status $\neq$ 'Y'.
        *   Return `102` if account not found in `ACCTFILE`.
        *   Return `103` if account status is 'C' or 'X'.
        *   Return `105` if transaction date > card expiry date.
        *   Return `104` if account status is 'D' and transaction is Debit.
        *   Return `108` if purchase and MCC is blocked.
        *   Return `107` if cash transaction exceeds cash limit.
        *   Return `106` if debit causes balance to exceed credit limit.
    *   **If Valid (Booking `BUCHEN`)**:
        *   **Debit**: Increase `KTO_SLD` and `KTO_ZYK_SOL`.
        *   **Credit**: Decrease `KTO_SLD` and increase `KTO_ZYK_SOL`.
        *   **Points Calculation**: For purchases, calculate `integer(amount) * factor`. Factor is `2` for MCC `5411`, `3` for `5812`, else `1`. Update `KTO_PKT` (capped at max). For credits, decrease points (min 0).
        *   **Output**: Write `BUC_SATZ` to `TRANOUT`.
    *   **If Cash (`04`)**: Apply `GEBUEHR` (Fee). Fee = `max(calculated_fee, min_fee)`. `calculated_fee` = `amount * (percentage/100)` rounded to 2 decimal places. Update `KTO_SLD` and `KTO_ZYK_SOL`. Generate `TRN_SATZ` record.
    *   **If Rejected**: Map reason code to text and write to `REJECTS`.
5.  **Finalize**: Update `TCATOUT` with aggregated balances.

#### STEP020: KBP00002 (Interest & Fees)
Calculates interest and applies fees based on account status and customer credit scores.

**Inputs:**
*   `CTLCARD`: Contains processing date.
*   `ACCTFILE`: Account records.
*   `TCATFILE`: Transaction category data (`TCA_SATZ`).
*   `DISCGRP`: Interest rate configuration (`DSC_SATZ`).
*   `CUSTFILE`: Customer data (`KDS_SATZ`).

**Business Rules:**
1.  **Skip** accounts with status 'X'.
2.  **Interest Calculation**:
    *   Base rate: If account is in `AKTION2010` and date is between 2010-01-01 and 2011-12-31, rate = 0. Else, use rate from `DISCGRP`.
    *   Surcharge: Add `3.00` if status is 'D'. Add `2.00` if customer FICO score < 600.
    *   Amount: `(Category Balance * Interest Rate) / 1200`, rounded to 2 decimal places.
    *   Trigger: Generate `SOLLZINSEN` transaction if accumulated interest $\ge$ threshold.
3.  **Warning Fees**: For status 'A' or 'D', if `KTO_MAHN` (reminder count) is $> 0$ and $<$ minimum threshold, increment `KTO_MAHN` (cap at 99) and charge fee.
4.  **Overdraft**: If `KTO_SLD` > `KTO_KLIM`, generate `UEBERZIEHUNGSGEBUEHR` transaction.
5.  **Status Transitions**: 'A' $\to$ 'D' if `KTO_MAHN` $\ge$ threshold; 'D' $\to$ 'X' if `KTO_MAHN` $\ge$ threshold; 'D' $\to$ 'A' if `KTO_MAHN` = 0.

#### STEP030: KBP00003 (Statements & Cycle Reset)
**Status: ACTIVE (Note: Logic for generating letters in KBP00005 is decommissioned, but this step processes statements).**

**Business Rules:**
1.  Calculate due date: `Execution Date + 25 days`.
2.  For accounts not status 'X':
    *   Calculate minimum payment: If balance $\le 0$, payment = 0. If balance $<$ threshold, payment = balance. Else, `max(threshold, percentage_of_balance) + excess_over_limit`.
    *   **Generate Statement (`AUSZUG`)**: If balance or movements $\neq 0$, create `AZG_SATZ`. If Euro switch is 'J', convert balance from DM to EUR (Rate: 1.95583).
    *   **Reset Cycle (`NEUER_ZYKLUS`)**: Reset `KTO_ZYK_SOL`, `KTO_ZYK_HAB`, `KTO_ZYK_ZAHL`, and `KTO_MINZ` to starting values.

---

### JCL/KBJ00002: ALTER ZINSLAUF
**Status: MANUAL/SCHEDULED.**
**Program: KBP00004.**
Applies a monthly interest rate (default 18% or from `CTLCARD`) to positive balances for accounts with type 'A' at position 1/12. Generates `TRN_SATZ` (Type `06`, Category `0001`, Text `ZINSEN`).

---

### JCL/KBJ00003: MAHNBRIEFE
**Status: DECOMMISSIONED (Do not rebuild).**
**Program: KBP00005.**
(Note: Code indicates logic for generating letters is no longer active).

---

## 3. Data Layouts (Copybooks)

### KBC00001: KTO_SATZ (Account Master) - LRECL 140
| Pos | Length | Name | Format | Description |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 11 | KTO_NR | CHAR | Account Number |
| 12 | 1 | KTO_ST | CHAR | Status (A/D/C/X) |
| 13 | 11 | KTO_SLD | S99999999V99 | Balance (Signed, 2 dec) |
| 24 | 10 | KTO_KLIM | 99999999V99 | Credit Limit |
| 34 | 10 | KTO_BLIM | 99999999V99 | Cash Limit |
| 44 | 8 | KTO_ERDT | CHAR | Creation Date (YYYYMMDD) |
| 52 | 8 | KTO_ABDT | CHAR | Expiry Date (YYYYMMDD) |
| 60 | 11 | KTO_ZYK_HAB | S9999999*V99 | Credit Cycle Balance |
| 71 | 11 | KTO_ZYK_SOL | S9999999*V99 | Debit Cycle Balance |
| 82 | 10 | KTO_GRP | CHAR | Group ID |
| 92 | 2 | KTO_MAHN | 99 | Reminder Level |
| 94 | 11 | KTO_MINZ | S9999999*V99 | Min Payment Threshold |
| 105 | 11 | KTO_ZYK_ZAHL | S9999999*V99 | Payment Cycle Balance |
| 116 | 9 | KTO_PKT | (9)9 | Points (Signed) |
| 125 | 9 | KTO_KDNR | CHAR | Customer ID |
| 134 | 7 | FILLER | CHAR | Padding |

### KBC00004: TRN_SATZ (Transaction Input) - LRECL 120
| Pos | Length | Name | Format | Description |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 16 | TRN_ID | CHAR | Transaction ID |
| 17 | 2 | TRN_TYP | CHAR | Type (e.g., 01, 04) |
| 19 | 4 | TRN_KAT | CHAR | Category |
| 23 | 10 | TRN_QUELLE | CHAR | Source |
| 33 | 30 | TRN_TXT | CHAR | Text |
| 63 | 11 | TRN_BTR | S9999999*V99 | Amount (Signed, 2 dec) |
| 74 | 9 | TRN_HDL | CHAR | Handler |
| 83 | 4 | TRN_MCC | CHAR | Merchant Category Code |
| 87 | 16 | TRN_KARTE | CHAR | Card Number |
| 103 | 8 | TRN_DT | CHAR | Date (YYYYMMDD) |

### KBC00004: BUC_SATZ (Transaction Output) - LRECL 130
| Pos | Length | Name | Format | Description |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 110 | BUC_TRN | CHAR | Truncated Transaction String |
| 111 | 11 | BUC_KTO | CHAR | Account Number |
| 122 | 8 | BUC_DT | CHAR | Processing Date |

### KBC00005: TCA_SATZ (Category Totals) - LRECL 30
| Pos | Length | Name | Format | Description |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 11 | TCA_KTO | CHAR | Account Number |
| 12 | 2 | TCA_TYP | CHAR | Type |
| 14 | 4 | TCA_KAT | CHAR | Category |
| 18 | 11 | TCA_SLD | S9999999*V99 | Aggregated Balance |

### KBC00009: ABW_SATZ (Rejections) - LRECL 50
| Pos | Length | Name | Format | Description |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 16 | ABW_TRN | CHAR | Transaction ID |
| 17 | 3 | ABW_GRD | 999 | Rejection Reason Code |
| 20 | 30 | ABW_TXT | CHAR | Rejection Description |

---

## 4. Unclear/Undocumented Elements
*   **KBC00001 (KTO_ALT)**: The structure of `KTO_ALT_SCHL` and its relationship to the primary `KTO_SATZ` is not explicitly defined in the provided material.
*   **KBU00027**: The exact logic for the statistical summary report `KBU00027` is partially described via its inputs, but the internal aggregation logic for the "Type" index is not fully detailed.
*   **Constants**: The specific values for `KO_VERZ_AB` and `KO_ABSCHR_AB` (thresholds for status changes) are not provided.