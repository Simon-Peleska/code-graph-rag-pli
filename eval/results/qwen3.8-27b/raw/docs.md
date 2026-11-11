# Kartenbank Nightly Batch System Documentation

This document describes the production batch job `KBJ00001` ("KARTENBANK NACHT") and its constituent steps. It details the data layouts, business rules, and processing logic for the Python rebuild team.

**Scope:**
*   **Active Production:** Job `KBJ00001` (Steps 010, 020, 030).
*   **Dead/Deprecated:** Job `KBJ00002` (KBP00004), Job `KBJ00003` (KBP00005).
*   **Utility Routines:** KBU00001, KBU00004, KBU00007-00011, KBU00012-00015, KBU00018-00021, KBU00026.

---

## 1. Data Record Layouts

All files are Fixed Block (FB) format. Positions are 1-based.

### 1.1 Control Card (CTLCARD)
*   **File:** `KB.PROD.CTLCARD`
*   **Usage:** Input to all steps.
*   **Layout:**
    *   `1-8`: **LAUFDATUM** (Run Date). Format: `YYYYMMDD` (8 chars).
    *   `9-12`: **ZINSSATZ** (Interest Rate). Format: `99V99` (4 chars). *Note: Only used by deprecated KBP00004. Ignored by active steps.*
    *   `13-80`: Filler/Unused.

### 1.2 Account Record (ACCTFILE / ACCTOUT)
*   **File:** `KB.PROD.ACCTFILE` (Input), `KB.PROD.ACCTOUT` (Output)
*   **LRECL:** 140
*   **Layout:**
    *   `1-11`: **KTO_NR** (Account Number). `CHAR(11)`.
    *   `12`: **KTO_ST** (Status). `CHAR(1)`. Values: `A` (Active), `D` (Delinquent/Verzug), `C` (Closed), `X` (Written off/Abgeschrieben).
    *   `13-23`: **KTO_SLD** (Balance). `PIC 'S99999999V99'`. Signed, implied decimal at pos 22. Range: -99,999,999.99 to +99,999,999.99.
    *   `24-33`: **KTO_KLIM** (Credit Limit). `PIC '99999999V99'`. Unsigned, implied decimal at pos 32.
    *   `34-43`: **KTO_BLIM** (Cash Withdrawal Limit). `PIC '99999999V99'`. Unsigned, implied decimal at pos 42.
    *   `44-51`: **KTO_ERDT** (Creation Date). `CHAR(8)`. `YYYYMMDD`.
    *   `52-59`: **KTO_ABDT** (Card Expiry Date). `CHAR(8)`. `YYYYMMDD`.
    *   `60-70`: **KTO_ZYK_HAB** (Cycle Credit). `PIC 'S99999999V99'`. Signed, implied decimal at pos 69.
    *   `71-81`: **KTO_ZYK_SOL** (Cycle Debit). `PIC 'S99999999V99'`. Signed, implied decimal at pos 80.
    *   `82-91`: **KTO_GRP** (Group). `CHAR(10)`.
    *   `92-93`: **KTO_MAHN** (Dunning Level). `PIC '99'`. Unsigned integer.
    *   `94-104`: **KTO_MINZ** (Minimum Payment). `PIC 'S99999999V99'`. Signed, implied decimal at pos 103.
    *   `105-115`: **KTO_ZYK_ZAHL** (Cycle Payments). `PIC 'S99999999V99'`. Signed, implied decimal at pos 114.
    *   `116-124`: **KTO_PKT** (Bonus Points). `PIC '(9)9'`. Unsigned integer.
    *   `125-133`: **KTO_KDNR** (Customer Number). `CHAR(9)`.
    *   `134-140`: **FILLER**. `CHAR(7)`.

### 1.3 Card Cross-Reference (XREFFILE)
*   **File:** `KB.PROD.XREFFILE`
*   **LRECL:** 50
*   **Layout:**
    *   `1-16`: **XRF_KARTE** (Card Number). `CHAR(16)`.
    *   `17-25`: **XRF_KDNR** (Customer Number). `CHAR(9)`.
    *   `26-36`: **XRF_KTO** (Account Number). `CHAR(11)`.
    *   `37`: **XRF_ST** (Card Status). `CHAR(1)`. `Y` = Active, anything else = Blocked.
    *   `38-50`: **FILLER**. `CHAR(13)`.

### 1.4 Daily Transactions (DALYTRAN)
*   **File:** `KB.PROD.DALYTRAN`
*   **LRECL:** 120
*   **Layout:**
    *   `1-16`: **TRN_ID** (Transaction ID). `CHAR(16)`.
    *   `17-18`: **TRN_TYP** (Type). `CHAR(2)`.
        *   `01`: Kauf (Purchase)
        *   `02`: Zahl (Payment)
        *   `03`: Gut (Credit)
        *   `04`: Bar (Cash Withdrawal)
        *   `05`: Geb (Fee)
        *   `06`: Zins (Interest)
    *   `19-22`: **TRN_KAT** (Category). `CHAR(4)`.
    *   `23-32`: **TRN_QUELLE** (Source). `CHAR(10)`.
    *   `33-62`: **TRN_TXT** (Text). `CHAR(30)`.
    *   `63-73`: **TRN_BTR** (Amount). `PIC 'S99999999V99'`. Signed, implied decimal at pos 72.
    *   `74-82`: **TRN_HDL** (Merchant ID). `CHAR(9)`.
    *   `83-86`: **TRN_MCC** (Merchant Category Code). `CHAR(4)`.
    *   `87-102`: **TRN_KARTE** (Card Number). `CHAR(16)`.
    *   `103-110`: **TRN_DT** (Date). `CHAR(8)`. `YYYYMMDD`.
    *   `111-120`: **FILLER**. `CHAR(10)`.

### 1.5 Booked Transaction Output (TRANOUT)
*   **File:** `KB.PROD.TRANHIST` (Step 010), `KB.PROD.TRANZINS` (Step 020)
*   **LRECL:** 130
*   **Layout:**
    *   `1-110`: **BUC_TRN**. `CHAR(110)`. Contains the first 110 chars of the input `TRN_SATZ`.
    *   `111-121`: **BUC_KTO**. `CHAR(11)`. Account Number.
    *   `122-129`: **BUC_DT**. `CHAR(8)`. Run Date (`W_LAUFDT`).
    *   `130`: **FILLER**. `CHAR(1)`.

### 1.6 Rejected Transactions (REJECTS)
*   **File:** `KB.PROD.REJECTS`
*   **LRECL:** 50
*   **Layout:**
    *   `1-16`: **ABW_TRN**. `CHAR(16)`. Transaction ID.
    *   `17-19`: **ABW_GRD**. `PIC '999'`. Rejection Code (see Section 3.2).
    *   `20-49`: **ABW_TXT**. `CHAR(30)`. Rejection Text.
    *   `50`: **FILLER**. `CHAR(1)`.

### 1.7 Category Balances (TCATFILE / TCATOUT)
*   **File:** `KB.PROD.TCATFILE` (Input), `KB.PROD.TCATOUT` (Output)
*   **LRECL:** 30
*   **Layout:**
    *   `1-11`: **TCA_KTO**. `CHAR(11)`.
    *   `12-13`: **TCA_TYP**. `CHAR(2)`.
    *   `14-17`: **TCA_KAT**. `CHAR(4)`.
    *   `18-28`: **TCA_SLD**. `PIC 'S99999999V99'`. Signed, implied decimal at pos 27.
    *   `29-30`: **FILLER**. `CHAR(2)`.

### 1.8 Interest Rates (DISCGRP)
*   **File:** `KB.PROD.DISCGRP`
*   **LRECL:** 20
*   **Layout:**
    *   `1-10`: **DSC_GRP**. `CHAR(10)`. Group Name.
    *   `11-12`: **DSC_TYP**. `CHAR(2)`. Transaction Type.
    *   `13-16`: **DSC_KAT**. `CHAR(4)`. Category.
    *   `17-20`: **DSC_ZINS**. `PIC '99V99'`. Annual Interest Rate (%). Implied decimal at pos 19.

### 1.9 Customer Record (CUSTFILE)
*   **File:** `KB.PROD.CUSTFILE`
*   **LRECL:** 60
*   **Layout:**
    *   `1-9`: **KDS_NR**. `CHAR(9)`. Customer Number.
    *   `10-29`: **KDS_VORN**. `CHAR(20)`. First Name.
    *   `30-54`: **KDS_NACHN**. `CHAR(25)`. Last Name.
    *   `55-57`: **KDS_FICO**. `PIC '999'`. FICO Score.
    *   `58-60`: **FILLER**. `CHAR(3)`.

### 1.10 Statement Output (STMTFILE)
*   **File:** `KB.PROD.STMTFILE`
*   **LRECL:** 120
*   **Layout:**
    *   `1-11`: **AZG_KTO**. `CHAR(11)`.
    *   `12-57`: **AZG_NAME**. `CHAR(46)`. Customer Name (First + Space + Last).
    *   `58-68`: **AZG_SLD**. `PIC 'S99999999V99'`. Signed, implied decimal at pos 67.
    *   `69-79`: **AZG_MINZ**. `PIC 'S99999999V99'`. Signed, implied decimal at pos 78.
    *   `80-87`: **AZG_FAEL**. `CHAR(8)`. Due Date.
    *   `88-96`: **AZG_PKT**. `PIC '(9)9'`. Bonus Points.
    *   `97`: **AZG_ST**. `CHAR(1)`. Status.
    *   `98-108`: **AZG_SOL**. `PIC 'S99999999V99'`. Cycle Debit.
    *   `109-119`: **AZG_HAB**. `PIC 'S99999999V99'`. Cycle Credit.
    *   `120`: **FILLER**. `CHAR(1)`.

---

## 2. Job Flow & Dependencies

**Job:** `KBJ00001`
**Schedule:** Daily at 23:30, after `KBJ00090` (Data Intake).

1.  **STEP010 (KBP00001):** Books daily transactions.
    *   Input: `ACCTFILE(0)`, `XREFFILE`, `TCATFILE(0)`, `DALYTRAN(0)`.
    *   Output: `ACCTFILE(+1)`, `TCATFILE(+1)`, `TRANHIST(+1)`, `REJECTS(+1)`.
    *   **Condition:** If RC >= 4, subsequent steps are skipped.
2.  **STEP020 (KBP00002):** Calculates interest, fees, and updates status.
    *   Input: `ACCTFILE(+1)`, `TCATFILE(+1)`, `DISCGRP`, `CUSTFILE`.
    *   Output: `ACCTFILE(+2)`, `TRANZINS(+1)`.
    *   **Condition:** Runs only if STEP010 RC < 4.
3.  **STEP030 (KBP00003):** Generates statements and resets cycle counters.
    *   Input: `ACCTFILE(+2)`, `CUSTFILE`.
    *   Output: `ACCTFILE(+3)`, `STMTFILE(+1)`.
    *   **Condition:** Runs only if previous steps RC < 4.

---

## 3. Step 010: KBP00001 (Transaction Booking)

### 3.1 Initialization
1.  Read `CTLCARD`. Extract `W_LAUFDT` (pos 1-8). Validate as numeric. If invalid, abort (RC 16).
2.  Load Account Table (`KBU00012`) from `ACCTFILE` into memory array `KTAB_SATZ` (max 2000).
3.  Load Category Table (`KBU00015`) from `TCATFILE` into memory array `TC_TAB` (max 3000).
4.  Load Card Table (`XRF_LADEN`) from `XREFFILE` into arrays `#XK` (Card), `#XA` (Account), `#XS` (Status). Max 5000 cards.
5.  Initialize counters: `Z_GELESEN=0`, `Z_GEBUCHT=0`, `Z_ABGEW=0`.
6.  Initialize duplicate check array `#GS` (max 20000) and counter `#GN=0`.

### 3.2 Main Loop (Process Each Transaction in DALYTRAN)
For each record in `DALYTRAN`:

1.  **Plausibility Check:** Call `KBU00023`. If errors found, log warning (max 50 warnings per run). *Note: Does not reject transaction.*
2.  **Duplicate Check:**
    *   Search `#GS` array for `TRN_ID`.
    *   If found: Set `@DOPP = 1`.
    *   If not found: Add `TRN_ID` to `#GS`. If array full (>20000), abort (RC 16).
3.  **Determine Direction:**
    *   If `TRN_TYP` is `01` (Kauf) or `04` (Bar): `@SOLL = 1` (Debit).
    *   Else: `@SOLL = 0` (Credit).
4.  **Validation (`PRUEFEN`):**
    *   **Rule 110 (Duplicate):** If `@DOPP = 1`, Reject with Code 110.
    *   **Rule 109 (Invalid Amount):** If `TRN_BTR <= 0`, Reject with Code 109.
    *   **Rule 111 (Invalid Type):** If `TRN_TYP` is not `01, 02, 03, 04`, Reject with Code 111.
    *   **Card Lookup:** Search `#XK` for `TRN_KARTE`.
        *   **Rule 100 (Unknown Card):** If not found, Reject with Code 100.
        *   **Rule 101 (Blocked Card):** If found but `#XS(index) != 'Y'`, Reject with Code 101.
    *   **Account Lookup:** Search `KTAB_SATZ` for `#XA(index)` (Account linked to card).
        *   **Rule 102 (Unknown Account):** If not found, Reject with Code 102.
        *   **Rule 103 (Closed Account):** If `KTO_ST` is `C` or `X`, Reject with Code 103.
        *   **Rule 105 (Expired Card):** If `TRN_DT` > `KTO_ABDT`, Reject with Code 105.
        *   **Rule 104 (Delinquent Account):** If `@SOLL = 1` AND `KTO_ST = 'D'`, Reject with Code 104.
        *   **Rule 108 (Blocked MCC):** If `TRN_TYP = '01'` AND `TRN_MCC = '7995'`, Reject with Code 108.
        *   **Rule 107 (Cash Limit):** If `TRN_TYP = '04'` AND `TRN_BTR > KTO_BLIM`, Reject with Code 107.
        *   **Rule 106 (Credit Limit):** If `@SOLL = 1`:
            *   Calculate `NewBalance = KTO_SLD + TRN_BTR`.
            *   If `NewBalance > KTO_KLIM`, Reject with Code 106.

5.  **Rejection Handling:**
    *   If any rule triggered:
        *   Write to `REJECTS`: `TRN_ID`, Code, Text (from `KO_ABW_TAB`).
        *   Increment `Z_ABGEW`.
        *   Log to SYSPRINT.
        *   **Skip Booking.**

6.  **Booking (`BUCHEN`):**
    *   **Update Account Balance:**
        *   If `@SOLL = 1`: `KTO_SLD += TRN_BTR`; `KTO_ZYK_SOL += TRN_BTR`.
        *   If `@SOLL = 0`: `KTO_SLD -= TRN_BTR`; `KTO_ZYK_HAB += TRN_BTR`.
        *   If `TRN_TYP = '02'` (Payment): `KTO_ZYK_ZAHL += TRN_BTR`.
    *   **Update Category Balance (`KBU00016`):**
        *   Key: `KTO_NR || TRN_TYP || TRN_KAT`.
        *   If `@SOLL = 1`: Add `TRN_BTR` to category balance.
        *   If `@SOLL = 0`: Subtract `TRN_BTR` from category balance.
        *   *Note: `KBU00016` maintains sorted order of `TC_TAB`.*
    *   **Bonus Points:**
        *   If `TRN_TYP = '01'` (Purchase):
            *   Base Points = `TRUNC(TRN_BTR)`.
            *   Multiplier:
                *   If `TRN_MCC = '5411'` (Groceries): 2x.
                *   If `TRN_MCC = '5812'` (Restaurants): 3x.
                *   Else: 1x.
            *   `KTO_PKT += BasePoints * Multiplier`.
            *   Cap `KTO_PKT` at 999,999,999.
        *   If `TRN_TYP = '03'` (Credit):
            *   `KTO_PKT -= TRUNC(TRN_BTR)`.
            *   If `KTO_PKT < 0`, set to 0.
    *   **Write Output:**
        *   Write to `TRANOUT`: First 110 chars of `TRN_SATZ`, `KTO_NR`, `W_LAUFDT`.
        *   Increment `Z_GEBUCHT`.

7.  **Cash Withdrawal Fee (`GEBUEHR`):**
    *   *Only if `TRN_TYP = '04'` (Bar).*
    *   Calculate Fee:
        *   `RawFee = (TRN_BTR * 5.00) / 100`.
        *   `Fee = MAX(RawFee, 10.00)`. (Min fee 10.00).
        *   Round to 2 decimals (Commercial rounding).
    *   **Update Account:**
        *   `KTO_SLD += Fee`.
        *   `KTO_ZYK_SOL += Fee`.
    *   **Update Category:**
        *   Key: `KTO_NR || '05' || '0001'`.
        *   Add `Fee` to category balance.
    *   **Write Fee Transaction:**
        *   Create new `TRN_SATZ`:
            *   `TRN_ID`: `'CF'` + Substr(Original ID, 3).
            *   `TRN_TYP`: `'05'`.
            *   `TRN_KAT`: `'0001'`.
            *   `TRN_QUELLE`: `'SYSTEM'`.
            *   `TRN_TXT`: `'BARGELDGEBUEHR'`.
            *   `TRN_BTR`: `Fee`.
            *   `TRN_HDL`: `'000000000'`.
            *   `TRN_MCC`: `'0000'`.
            *   `TRN_KARTE`: Original Card.
            *   `TRN_DT`: `W_LAUFDT`.
        *   Write to `TRANOUT`.
        *   Log to SYSPRINT.

### 3.3 Finalization
1.  Write updated Account Table to `ACCTOUT` (`KBU00014`).
2.  Write updated Category Table to `TCATOUT` (`KBU00017`).
3.  Print Reconciliation Report (`KBU00028`).
4.  Set Return Code:
    *   If `Z_ABGEW > 0`, RC = 4.
    *   Else RC = 0.
    *   If any abort occurred, RC = 16.

---

## 4. Step 020: KBP00002 (Interest & Fees)

### 4.1 Initialization
1.  Read `CTLCARD`. Extract `W_LAUFDT`.
2.  Load Account Table (`KBU00012`).
3.  Load Customer Table (`KBU00018`) from `CUSTFILE`.
4.  Load Interest Rates (`ZS_LADEN`) from `DISCGRP` into array `ZS` (max 500).
    *   Key: `GRP || TYP || KAT`.
    *   Value: `ZINS` (Annual %).

### 4.2 Main Loop (Process Each Account)
For each account in `KTAB_SATZ`:

1.  **Skip Written-off:** If `KTO_ST = 'X'`, skip.
2.  **Get Customer FICO:**
    *   Look up `KTO_KDNR` in Customer Table.
    *   If found, get `KD_FICO`. Else `FICO = 0`.

3.  **Calculate Interest:**
    *   Initialize `TotalInterest = 0`.
    *   Iterate through Category Table (`TC_TAB`):
        *   Match Account: `TC_KEY(1-11) == KTO_NR`.
        *   Skip if `TC_SLD <= 0`.
        *   Skip if `TC_KEY(12-13) == '02'` (Payments do not accrue interest).
        *   **Determine Rate:**
            *   Look up `ZS` for `KTO_GRP || TC_KEY(12-17)`.
            *   If not found, look up `DEFAULT || TC_KEY(12-17)`.
            *   If still not found, Rate = 0.
        *   **Apply Special Rules:**
            *   If `KTO_GRP == 'AKTION2010'` AND `W_LAUFDT` between `20100101` and `20111231`: Rate = 0.
            *   If Rate > 0:
                *   If `KTO_ST == 'D'`: Rate += 3.00 (Late Fee Surcharge).
                *   If `FICO > 0` AND `FICO < 600`: Rate += 2.00 (FICO Surcharge).
        *   **Calculate Amount:**
            *   `MonthlyInterest = (TC_SLD * Rate) / 1200`.
            *   Round to 2 decimals.
            *   `TotalInterest += MonthlyInterest`.
    *   **Post Interest:**
        *   If `TotalInterest >= 1.00`:
            *   Call `BELASTEN('ZI', '06', '0001', 'SOLLZINSEN', TotalInterest)`.

4.  **Calculate Fees (Only if Status A or D):**
    *   **Dunning Fee:**
        *   If `KTO_MINZ > 0` AND `KTO_ZYK_ZAHL < KTO_MINZ`:
            *   If `KTO_MAHN > 0`: Fee = 35.00.
            *   Else: Fee = 25.00.
            *   Increment `KTO_MAHN`. Cap at 99.
            *   Call `BELASTEN('MG', '05', '0002', 'MAHNGEBUEHR', Fee)`.
        *   Else: Reset `KTO_MAHN = 0`.
    *   **Overdraft Fee:**
        *   If `KTO_SLD > KTO_KLIM`:
            *   Call `BELASTEN('UL', '05', '0003', 'UEBERZIEHUNGSGEBUEHR', 29.00)`.

5.  **Update Status:**
    *   If `KTO_ST == 'A'` AND `KTO_MAHN >= 2`: Set `KTO_ST = 'D'`.
    *   If `KTO_ST == 'D'` AND `KTO_MAHN >= 6`: Set `KTO_ST = 'X'`.
    *   If `KTO_ST == 'D'` AND `KTO_MAHN == 0`: Set `KTO_ST = 'A'`.

6.  **Save Account:** Update `KTAB_SATZ` with new values.

### 4.3 Helper: BELASTEN
1.  Update Account: `KTO_SLD += Amount`; `KTO_ZYK_SOL += Amount`.
2.  Create Transaction Record:
    *   `TRN_ID`: `Prefix || KTO_NR || '000'`.
    *   `TRN_TYP`: Type.
    *   `TRN_KAT`: Category.
    *   `TRN_QUELLE`: `'ZINSLAUF'`.
    *   `TRN_TXT`: Text.
    *   `TRN_BTR`: Amount.
    *   `TRN_HDL`: `'000000000'`.
    *   `TRN_MCC`: `'0000'`.
    *   `TRN_KARTE`: `''`.
    *   `TRN_DT`: `W_LAUFDT`.
3.  Write to `TRANOUT`.
4.  Log to SYSPRINT.

### 4.4 Finalization
1.  Write updated Account Table to `ACCTOUT`.
2.  Print Reconciliation Report.
3.  RC = 0 (unless abort).

---

## 5. Step 030: KBP00003 (Statements & Cycle Reset)

### 5.1 Initialization
1.  Read `CTLCARD`. Extract `W_LAUFDT`.
2.  Calculate Due Date: `W_LAUFDT + 25 days` (`KBU00002`).
3.  Load Account Table (`KBU00012`).
4.  Load Customer Table (`KBU00018`).

### 5.2 Main Loop (Process Each Account)
For each account in `KTAB_SATZ`:

1.  **Skip Written-off:** If `KTO_ST == 'X'`, skip.
2.  **Calculate Minimum Payment (`MINDESTZAHLUNG`):**
    *   If `KTO_SLD <= 0`: `MinPay = 0`.
    *   Else if `KTO_SLD < 25.00`: `MinPay = KTO_SLD`.
    *   Else:
        *   `BaseMin = (KTO_SLD * 2.00) / 100`.
        *   `MinPay = MAX(BaseMin, 25.00)`.
        *   If `KTO_SLD > KTO_KLIM`:
            *   `Overdraft = KTO_SLD - KTO_KLIM`.
            *   `MinPay += Overdraft`.
        *   If `MinPay > KTO_SLD`: `MinPay = KTO_SLD`.
3.  **Generate Statement (`AUSZUG`):**
    *   Condition: `KTO_SLD != 0` OR `KTO_ZYK_SOL != 0` OR `KTO_ZYK_HAB != 0`.
    *   If condition met:
        *   Get Customer Name from `KTO_KDNR`. If unknown, use `'UNBEKANNT'`.
        *   **Euro Conversion:**
            *   *Note: `SW_EURO` is initialized to `'N'` and never set to `'J'` in this code path. The Euro conversion block is effectively dead code in this version.*
            *   If `SW_EURO == 'J'`: `DisplayBalance = KTO_SLD / 1.95583`.
            *   Else: `DisplayBalance = KTO_SLD`.
        *   Write to `STMTFILE`:
            *   `AZG_KTO`: `KTO_NR`.
            *   `AZG_NAME`: Customer Name.
            *   `AZG_SLD`: `DisplayBalance`.
            *   `AZG_MINZ`: `MinPay`.
            *   `AZG_FAEL`: Due Date.
            *   `AZG_PKT`: `KTO_PKT`.
            *   `AZG_ST`: `KTO_ST`.
            *   `AZG_SOL`: `KTO_ZYK_SOL`.
            *   `AZG_HAB`: `KTO_ZYK_HAB`.
4.  **Reset Cycle (`NEUER_ZYKLUS`):**
    *   `KTO_ZYK_SOL = 0`.
    *   `KTO_ZYK_HAB = 0`.
    *   `KTO_ZYK_ZAHL = 0`.
    *   `KTO_MINZ = MinPay`.
5.  **Save Account:** Update `KTAB_SATZ`.

### 5.3 Finalization
1.  Write updated Account Table to `ACCTOUT`.
2.  Print Statement Count.
3.  RC = 0.

---

## 6. Dead/Deprecated Code

### 6.1 Job KBJ00002 (KBP00004)
*   **Status:** **DEAD**. Not scheduled since 1997.
*   **Description:** "Alter Zinslauf" (Old Interest Run). Calculated flat 18% interest.
*   **Action:** Do not rebuild.

### 6.2 Job KBJ00003 (KBP00005)
*   **Status:** **DEAD**. Unscheduled since 2016-01-31.
*   **Description:** "Mahnbriefe" (Dunning Letters). Generated physical letters.
*   **Action:** Do not rebuild. Letters are now handled by an external document system.

### 6.3 Routine KBU00020
*   **Status:** **DEAD CODE PATH**.
*   **Description:** Euro conversion.
*   **Action:** The switch `SW_EURO` is hardcoded to `'N'` in `KBC00011` and never changed. The conversion logic in `KBP00003` is never executed.

### 6.4 Routine KBU00010
*   **Status:** **DEAD**.
*   **Description:** Linear search for 9-char keys.
*   **Action:** Not called by any active production code.

### 6.5 Routine KBU0Y2
*   **Status:** **DEAD**.
*   **Description:** Y2K date conversion.
*   **Action:** Unused since 2000.

---

## 7. Utility Routines (Rebuild Requirements)

### 7.1 KBU00001 (Date Utilities)
*   **KBU00002:** Add N days to date.
    *   Input: `YYYYMMDD` (8 chars), N (Integer).
    *   Output: `YYYYMMDD` (8 chars).
    *   Logic: Increment day, handle month/year rollover. Leap year logic included.
*   **KBU00003:** Compare dates.
    *   Input: Two `YYYYMMDD` strings.
    *   Output: -1, 0, or 1.

### 7.2 KBU00004 (Money Utilities)
*   **KBU00005:** Round to 2 decimals.
    *   Input: High precision decimal.
    *   Output: 2 decimal places.
    *   Logic: Commercial rounding (half away from zero).
*   **KBU00006:** Max of two amounts.
    *   Input: Two decimals.
    *   Output: Larger value.

### 7.3 KBU00007/00008 (Logging)
*   **KBU00007:** Log message to SYSPRINT.
    *   Input: Program Name, Message.
    *   Output: Prints `PGM TIME MESSAGE` to SYSPRINT.
*   **KBU00008:** Low-level print.
    *   Input: Program Name, Message, Level.
    *   Output: Prints if Level > 0.

### 7.4 KBU00009 (Search)
*   **KBU00009:** Linear search in array.
    *   Input: Array of 16-char keys, Count, Key to find.
    *   Output: Index (1-based) or 0.

### 7.5 KBU00011 (Error Handling)
*   **KBU00011:** Log error and set RC.
    *   Input: Program Name, Severity (1-16), Message.
    *   Output: Logs `*** FEHLER [Severity]: [Message]`.
    *   If Severity >= 16: Logs `*** ABBRUCH`, sets RC to Severity, and terminates program (STOP).
    *   Else: Sets RC to max(current RC, Severity).

### 7.6 KBU00012 (Account Table)
*   **KBU00012:** Load accounts from `ACCTFILE` to memory.
*   **KBU00013:** Search account by number.
*   **KBU00014:** Write memory accounts to `ACCTOUT`.

### 7.7 KBU00015 (Category Table)
*   **KBU00015:** Load categories from `TCATFILE` to memory.
*   **KBU00016:** Update category balance.
    *   Input: Key (17 chars), Amount.
    *   Logic: Find key. If exists, add amount. If not, insert new entry maintaining sorted order.
*   **KBU00017:** Write memory categories to `TCATOUT`.

### 7.8 KBU00018 (Customer Table)
*   **KBU00018:** Load customers from `CUSTFILE` to memory.
*   **KBU00019:** Search customer by number.

### 7.9 KBU00021 (Plausibility)
*   **KBU00022:** Validate Account Record. Returns count of errors.
*   **KBU00023:** Validate Transaction Record. Returns count of errors.
*   **KBU00024:** Validate Card Record. Returns count of errors.
*   **KBU00025:** Validate Date. Returns 1 if valid, 0 if invalid.

### 7.10 KBU00026 (Reconciliation)
*   **KBU00026:** Initialize reconciliation counters.
*   **KBU00027:** Increment counters for transaction type/amount.
*   **KBU00028:** Print reconciliation report to SYSPRINT.

---

## 8. Constants (KBC00010)

| Constant | Value | Description |
| :--- | :--- | :--- |
| `KO_TYP_KAUF` | `'01'` | Purchase |
| `KO_TYP_ZAHL` | `'02'` | Payment |
| `KO_TYP_GUT` | `'03'` | Credit |
| `KO_TYP_BAR` | `'04'` | Cash Withdrawal |
| `KO_TYP_GEB` | `'05'` | Fee |
| `KO_TYP_ZINS` | `'06'` | Interest |
| `KO_MCC_SPERR` | `'7995'` | Blocked MCC (Gambling) |
| `KO_MCC_LEBM` | `'5411'` | Groceries (2x Points) |
| `KO_MCC_REST` | `'5812'` | Restaurants (3x Points) |
| `KO_GEB_BAR_PROZ` | `5.00` | Cash Fee % |
| `KO_GEB_BAR_MIN` | `10.00` | Cash Fee Min |
| `KO_MAHN_1` | `25.00` | Dunning Fee 1 |
| `KO_MAHN_2` | `35.00` | Dunning Fee 2 |
| `KO_UEBZ` | `29.00` | Overdraft Fee |
| `KO_MINZ_MIN` | `25.00` | Min Payment Floor |
| `KO_MINZ_PROZ` | `2.00` | Min Payment % |
| `KO_ZINS_FREI` | `1.00` | Interest Threshold |
| `KO_AUFS_VERZ` | `3.00` | Late Interest Surcharge |
| `KO_AUFS_FICO` | `2.00` | FICO Interest Surcharge |
| `KO_FICO_GRENZE` | `600` | FICO Threshold |
| `KO_FAELLIG_TG` | `25` | Days to Due Date |
| `KO_VERZ_AB` | `2` | Dunning Level for Status D |
| `KO_ABSCHR_AB` | `6` | Dunning Level for Status X |
| `KO_EURO_KURS` | `1.95583` | Euro Rate (Unused) |
| `KO_MAX_PKT` | `999999999` | Max Bonus Points |

### Rejection Codes (KO_ABW_TAB)

| Code | Text |
| :--- | :--- |
| 100 | KARTE UNBEKANNT |
| 101 | KARTE GESPERRT |
| 102 | KONTO UNBEKANNT |
| 103 | KONTO GESCHLOSSEN |
| 104 | KONTO IM VERZUG |
| 105 | KARTE ABGELAUFEN |
| 106 | KREDITLIMIT UEBERSCHRITTEN |
| 107 | BARGELDLIMIT UEBERSCHRITTEN |
| 108 | HAENDLERKATEGORIE GESPERRT |
| 109 | BETRAG UNGUELTIG |
| 110 | DOPPELTE TRANSAKTION |
| 111 | TRANSAKTIONSTYP UNBEKANNT |