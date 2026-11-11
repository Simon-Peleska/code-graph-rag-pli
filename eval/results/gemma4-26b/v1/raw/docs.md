# Legacy System Documentation: KARTENBANK Batch Processing

This document provides the technical specifications for the KARTENBANK batch system. This documentation is intended for the development of a Python-based replacement.

---

## 1. Overview of Job Streams

### **KBJ00001: KARTENBANK NACHTVERARBEITUNG (Night Processing)**
The primary daily batch job. It processes daily transactions, calculates interest/fees, and updates account statuses.
- **Step 010 (KBP00001):** Processes daily transactions (UMSAETZE BUCHEN).
- **Step 020 (KBP00002):** Calculates interest, fees, and updates account status (ZINSEN / GEBUEHREN / STATUS).
- **Step 030 (KBP00003):** Generates account statements and resets cycles (KONTOAUSZUG, NEUER ZYKLUS).

### **KBJ00002: ALTER ZINSLAUF (Legacy Interest)**
- **Status:** **DEAD/DEPRECATED**. 
- **Note:** Replaced by KBP00002 since 1997. Maintained only for audit purposes.

### **KBJ00003: MAHNBRIEFE (Dunning Letters)**
- **Status:** **DEAD/DEPRECATED**. 
- **Note:** Decommissioned as of 2016-01-31. Letter generation moved to an external document management system.

---

## 2. Program Specifications

### **KBP00001: Daily Transaction Processing**

#### **Input Files**
| DD Name | Description | Record Layout |
| :--- | :--- | :--- |
| **CTLCARD** | Control Card | `CHAR(80)`: First 8 chars = `LAUFDATUM` (YYYYMMDD). |
| **ACCTFILE** | Account Master | `LRECL=140`. See **KTO_SATZ** layout. |
| **XREFFILE** | Card Cross-Ref | `LRECL=50`. See **XRF_SATZ** layout. |
| **DALYTRAN** | Daily Transactions | `LRECL=120`. See **TRN_SATZ** layout. |

#### **Output Files**
| DD Name | Description | Record Layout |
| :--- | :--- | :--- |
| **ACCTOUT** | Updated Accounts | `LRECL=140`. See **KTO_SATZ** layout. |
| **TCATOUT** | Updated Balances | `LRECL=30`. See **TCA_SATZ** layout. |
| **TRANOUT** | Posted Transactions | `LRECL=130`. See **BUC_SATZ** layout. |
| **REJECTS** | Rejected Transactions | `LRECL=50`. See **ABW_SATZ** layout. |

#### **Record Layouts**
**KTO_SATZ (Account Master) - 140 bytes**
- `01-11`: `KTO_NR` (Account Number)
- `12-12`: `KTO_ST` (Status: A=Active, D=Delinquent, C=Closed, X=Written-off)
- `13-22`: `K13_SLD` (Balance, Signed, 10 digits, 2 decimal implied)
- `23-32`: `KTO_KLIM` (Credit Limit, 10 digits, 2 decimal implied)
- `33-42`: `KTO_BLIM` (Cash Limit, 10 digits, 2 decimal implied)
- `43-50`: `KTO_ERDT` (Creation Date, YYYYMMDD)
- `51-58`: `KTO_ABDT` (Card Expiry, YYYYMMDD)
- `59-70`: `KTO_ZYK_HAB` (Debit Cycle Balance, 12 digits, 2 decimal implied)
- `71-82`: `KTO_ZYK_SOL` (Credit Cycle Balance, 12 digits, 2 decimal implied)
- `83-92`: `KTO_GRP` (Group ID, 10 chars)
- `93-94`: `KTO_MAHN` (Dunning Level, 2 digits)
- `95-105`: `KTO_MINZ` (Min Payment, 11 digits, 2 decimal implied)
- `106-116`: `K2_ZYK_ZAHL` (Payment Cycle, 11 digits, 2 decimal implied)
- `117-125`: `KTO_PKT` (Points, 9 digits, 1 digit)
- `126-134`: `KTO_KDNR` (Customer ID, 9 chars)
- `135-140`: `FILLER` (6 chars)

**TRN_SATZ (Daily Transaction) - 120 bytes**
- `01-16`: `TRN_ID` (Transaction ID)
- `17-18`: `TRN_TYP` (Type: 01=Purchase, 02=Payment, 03=Credit, 04=Cash, 05=Fee, 06=Interest)
- `19-22`: `TRN_KAT` (Category, 4 chars)
- `23-32`: `TRN_QUELLE` (Source, 10 chars)
- `33-62`: `TRN_TXT` (Text, 30 chars)
- `63-73`: `TRN_BTR` (Amount, Signed, 11 digits, 2 decimal implied)
- `74-82`: `TRN_HDL` (Handler, 9 chars)
- `83-86`: `TRN_MCC` (Merchant Category, 4 chars)
- `87-102`: `TRN_KARTE` (Card Number, 16 chars)
- `103-110`: `TRN_DT` (Date, YYYYMMDD)
- `111-120`: `FILLER` (10 chars)

**XRF_SATZ (Card Cross-Ref) - 50 bytes**
- `01-16`: `XRF_KARTE` (Card Number)
- `17-25`: `XRF_KDNR` (Customer ID)
- `26-36`: `XRF_KTO` (Account Number)
- `37-37`: `XRF_ST` (Status: 'Y' = Active, else Blocked)
- `38-50`: `FILLER`

**ABW_SATZ (Rejections) - 50 bytes**
- `01-16`: `ABW_TRN` (Transaction ID)
- `17-19`: `ABW_GRD` (Reason Code, 3 digits)
- `20-49`: `ABW_TXT` (Reason Text, 30 chars)
- `50-50`: `FILLER`

#### **Processing Logic (KBP00001)**
1.  **Initialization:** Load Account Master (`KBU00012`), Balance Summary (`KBU00015`), Card Cross-Ref (`XRF_LADEN`), and Interest Rates (`KBU00026`).
2.  **Transaction Loop:** For each record in `DALYTRAN`:
    *   Check for duplicate `TRN_ID` (using `#GS` array).
    *   **Validation (`PRUEFEN`):**
        *   If duplicate ID: Reject (Code 110).
        *   If Amount $\le$ 0: Reject (Code 109).
        *   If Type is 05 (Fee) or 06 (Interest): Reject (Code 111).
        *   Check Card in `XREFFILE`: If not found, Reject (Code 100). If found but Status $\neq$ 'Y', Reject (Code 101).
        *   Check Account in `KTAB`: If not found, Reject (Code 102).
        *   If Account Status is 'C' or 'X': Reject (Code 103).
        *   If Transaction Date > Account Expiry Date: Reject (Code 105).
        *   If Account Status is 'D' and Transaction is a Debit (Type 01/04): Reject (Code 104).
        *   If Merchant Category (MCC) is 7995 (Gambling): Reject (Code 108).
        *   If Cash Transaction (Type 04) exceeds Cash Limit: Reject (Code 107).
        *   If Type is Debit (01/04) and (Balance + Amount) > Credit Limit: Reject (Code 106).
    *   **Posting (`BUCHEN`):**
        *   If Type is 01 (Purchase) or 04 (Cash):
            *   Update `KTO_SLD` (Balance) and `KTO_ZYK_SOL` (Credit Cycle).
            *   Generate `TRANOUT` record.
            *   Update Points (`KTO_PKT`):
                *   If MCC is 5411 (Grocery): Add $Amount \times 2$.
                *   If MCC is 5812 (Restaurant): Add $Amount \times 3$.
                *   Otherwise: Add $Amount \times 1$.
                *   Cap at `KO_MAX_PKT`.
        *   If Type is 03 (Credit/Refund):
            *   Update `KTO_SLD` (Balance) and `KTO_ZYK_HAB` (Debit Cycle).
            *   Update `KTO_ZYK_ZAHL` (Payment Cycle).
        *   If Type is 04 (Cash): Trigger `GEBUEHR` (Fee calculation).
    *   **Fee Calculation (`GEBUEHR`):**
        *   Calculate Fee: $(Amount \times 5.00\%) / 100$, then round to 2 decimals.
        *   Add minimum fee of 10.00 if calculated fee is lower.
        *   Post fee as a new transaction (Type 05) to `TRANOUT`.
3.  **Finalization:** Write updated accounts to `ACCTOUT` and updated balances to `TCATOUT`.

---

### **KBP00002: Interest and Fees**

#### **Input Files**
| DD Name | Description |
| :--- | :--- |
| **CTLCARD** | Control Card |
| **ACCTFILE** | Account Master |
| **TCATFILE** | Balance Summary |
| **DISCGRP** | Interest Rate Groups |
| **CUSTFILE** | Customer Master |

#### **Processing Logic**
1.  **Initialization:** Load Accounts, Balances, Customers, and Interest Groups.
2.  **Interest Calculation:** For each account:
    *   Skip if Status is 'X' (Written-off).
    *   For each balance category in `TCATFILE` matching this account:
        *   If Balance $\le$ 0 or Type is 02 (Payment): Skip.
        *   Lookup Interest Rate ($P$) based on Group and Category.
        *   **Special Rule (Promotion):** If Group is 'AKTION2010' and Date is between 2010-01-01 and 2011-12-31:
            *   If Customer FICO score < 600, add 2.00% surcharge to $P$.
        *   Calculate Interest: $Interest = (Balance \times P) / 1200$.
        *   If Total Interest for account $\ge$ 1.00: Post as Type 06 (Interest) to `TRANOUT`.
3.  **Fee Calculation:**
    *   If Status is 'A' or 'D':
        *   **Dunning Fee:** If `KTO_ZYK_ZAHL` < 25.00:
            *   Calculate fee based on `KTO_MAHN` level (Level 1: 25.00, Level 2: 35.00).
            *   Increment `KTO_MAHN` (Max 99).
            *   Post as Type 05 (Fee) to `TRANOUT`.
        *   **Overdraft Fee:** If `KTO_SLD` > `KTO_KLIM`: Post Type 05 (Fee) of 29.00 to `TRANOUT`.
4.  **Status Update:**
    *   If Status 'A' and Dunning $\ge$ 2 $\rightarrow$ Status 'D'.
    *   If Status 'D' and Dunning $\ge$ 6 $\rightarrow$ Status 'X'.
    *   If Status 'D' and Dunning = 0 $\rightarrow$ Status 'A'.

---

### **KBP00003: Statements and Cycle Reset**

#### **Input Files**
| DD Name | Description |
| :--- | :--- |
| **ACCTFILE** | Account Master |
| **CUSTFILE** | Customer Master |

#### **Processing Logic**
1.  **Initialization:** Load Accounts and Customers.
2.  **Account Loop:** For each account:
    *   Skip if Status is 'X'.
    *   **Minimum Payment Calculation:**
        *   If Balance $\le$ 0: Min Payment = 0.
        *   If Balance < 25.00: Min Payment = Balance.
        *   Else: Calculate $2.00\%$ of Balance, round to 2 decimals, ensure it is at least 25.00.
        *   If Balance > Credit Limit: Add (Balance - Credit Limit) to Min Payment.
        *   Cap Min Payment at current Balance.
    *   **Statement Generation (`AUSZUG`):**
        *   Trigger only if Balance $\neq$ 0 OR Credit Cycle Balance $\neq$ 0 OR Debit Cycle Balance $\neq$ 0.
        *   Output to `STMTFILE` with Customer Name, Balance, Min Payment, Expiry, and Cycle Balances.
    *   **Cycle Reset:** Reset `KTO_ZYK_SOL`, `KTO_ZYK_HAB`, and `KTO_ZYK_ZAHL` to 0. Set `KTO_MINZ` to the calculated Min Payment.