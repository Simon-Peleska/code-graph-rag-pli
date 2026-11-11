# Jobs (JCL as written)

## JCL/KBJ00001
//KBJ00001 JOB (KB,4711),'KARTENBANK NACHT',CLASS=A,MSGCLASS=X,
//             NOTIFY=&SYSUID
//*********************************************************************
//* KARTENBANK NACHTVERARBEITUNG
//*   STEP010  KBP00001  UMSAETZE BUCHEN
//*   STEP020  KBP00002  ZINSEN / GEBUEHREN / STATUS
//*   STEP030  KBP00003  KONTOAUSZUG, NEUER ZYKLUS
//* PLANUNG: TAEGLICH 23:30 NACH KBJ00090 (DATENANNAHME)
//*********************************************************************
//STEP010  EXEC PGM=KBP00001
//STEPLIB  DD DSN=KB.PROD.LOADLIB,DISP=SHR
//CTLCARD  DD DSN=KB.PROD.CTLCARD,DISP=SHR
//ACCTFILE DD DSN=KB.PROD.ACCTFILE(0),DISP=SHR
//XREFFILE DD DSN=KB.PROD.XREFFILE,DISP=SHR
//TCATFILE DD DSN=KB.PROD.TCATFILE(0),DISP=SHR
//DALYTRAN DD DSN=KB.PROD.DALYTRAN(0),DISP=SHR
//ACCTOUT  DD DSN=KB.PROD.ACCTFILE(+1),DISP=(NEW,CATLG,DELETE),
//            SPACE=(TRK,(50,50),RLSE),
//            DCB=(RECFM=FB,LRECL=140,BLKSIZE=0)
//TCATOUT  DD DSN=KB.PROD.TCATFILE(+1),DISP=(NEW,CATLG,DELETE),
//            SPACE=(TRK,(50,50),RLSE),
//            DCB=(RECFM=FB,LRECL=30,BLKSIZE=0)
//TRANOUT  DD DSN=KB.PROD.TRANHIST(+1),DISP=(NEW,CATLG,DELETE),
//            SPACE=(CYL,(5,5),RLSE),
//            DCB=(RECFM=FB,LRECL=130,BLKSIZE=0)
//REJECTS  DD DSN=KB.PROD.REJECTS(+1),DISP=(NEW,CATLG,DELETE),
//            SPACE=(TRK,(5,5),RLSE),
//            DCB=(RECFM=FB,LRECL=50,BLKSIZE=0)
//SYSPRINT DD SYSOUT=*
//*
//STEP020  EXEC PGM=KBP00002,COND=(4,LT,STEP010)
//STEPLIB  DD DSN=KB.PROD.LOADLIB,DISP=SHR
//CTLCARD  DD DSN=KB.PROD.CTLCARD,DISP=SHR
//ACCTFILE DD DSN=KB.PROD.ACCTFILE(+1),DISP=SHR
//TCATFILE DD DSN=KB.PROD.TCATFILE(+1),DISP=SHR
//DISCGRP  DD DSN=KB.PROD.DISCGRP,DISP=SHR
//CUSTFILE DD DSN=KB.PROD.CUSTFILE,DISP=SHR
//ACCTOUT  DD DSN=KB.PROD.ACCTFILE(+2),DISP=(NEW,CATLG,DELETE),
//            SPACE=(TRK,(50,50),RLSE),
//            DCB=(RECFM=FB,LRECL=140,BLKSIZE=0)
//TRANOUT  DD DSN=KB.PROD.TRANZINS(+1),DISP=(NEW,CATLG,DELETE),
//            SPACE=(TRK,(10,10),RLSE),
//            DCB=(RECFM=FB,LRECL=130,BLKSIZE=0)
//SYSPRINT DD SYSOUT=*
//*
//STEP030  EXEC PGM=KBP00003,COND=(4,LT)
//STEPLIB  DD DSN=KB.PROD.LOADLIB,DISP=SHR
//CTLCARD  DD DSN=KB.PROD.CTLCARD,DISP=SHR
//ACCTFILE DD DSN=KB.PROD.ACCTFILE(+2),DISP=SHR
//CUSTFILE DD DSN=KB.PROD.CUSTFILE,DISP=SHR
//ACCTOUT  DD DSN=KB.PROD.ACCTFILE(+3),DISP=(NEW,CATLG,DELETE),
//            SPACE=(TRK,(50,50),RLSE),
//            DCB=(RECFM=FB,LRECL=140,BLKSIZE=0)
//STMTFILE DD DSN=KB.PROD.STMTFILE(+1),DISP=(NEW,CATLG,DELETE),
//            SPACE=(TRK,(20,20),RLSE),
//            DCB=(RECFM=FB,LRECL=120,BLKSIZE=0)
//SYSPRINT DD SYSOUT=*


## JCL/KBJ00002
//KBJ00002 JOB (KB,4711),'ALTER ZINSLAUF',CLASS=A,MSGCLASS=X
//*********************************************************************
//* ALTER ZINSLAUF - SEIT 1997 NICHT MEHR EINGEPLANT (SIEHE KBJ00001)
//*********************************************************************
//STEP010  EXEC PGM=KBP00004
//STEPLIB  DD DSN=KB.PROD.LOADLIB,DISP=SHR
//CTLCARD  DD DSN=KB.PROD.CTLCARD,DISP=SHR
//ACCTFILE DD DSN=KB.PROD.ACCTFILE(0),DISP=SHR
//ACCTOUT  DD DSN=KB.PROD.ACCTFILE(+1),DISP=(NEW,CATLG,DELETE),
//            SPACE=(TRK,(50,50),RLSE),
//            DCB=(RECFM=FB,LRECL=140,BLKSIZE=0)
//TRANOUT  DD DSN=KB.PROD.TRANZINS(+1),DISP=(NEW,CATLG,DELETE),
//            SPACE=(TRK,(10,10),RLSE),
//            DCB=(RECFM=FB,LRECL=130,BLKSIZE=0)
//SYSPRINT DD SYSOUT=*


## JCL/KBJ00003
//KBJ00003 JOB (KB,4711),'MAHNBRIEFE',CLASS=A,MSGCLASS=X
//*********************************************************************
//* MAHNBRIEFE - AUSGEPLANT 2016-01-31 (CHG0031415), BRIEFE KOMMEN
//* AUS DEM DOKUMENTENSYSTEM. NICHT WIEDER EINPLANEN.
//*********************************************************************
//STEP010  EXEC PGM=KBP00005
//STEPLIB  DD DSN=KB.PROD.LOADLIB,DISP=SHR
//CTLCARD  DD DSN=KB.PROD.CTLCARD,DISP=SHR
//ACCTFILE DD DSN=KB.PROD.ACCTFILE(0),DISP=SHR
//CUSTFILE DD DSN=KB.PROD.CUSTFILE,DISP=SHR
//BRIEFE   DD SYSOUT=(B,,MAHN)
//SYSPRINT DD SYSOUT=*


# Record layouts of the copybooks (positions from 1)

KBC00001: KTO_SATZ (record length 140):
     1-11   KTO_NR         CHAR(11)  /* KONOTNUMMER */
    12-12   KTO_ST         CHAR(1)  /* A/D/C/X */
    13-23   KTO_SLD        PIC 'S99999999V99'  /* SALDO */
    24-33   KTO_KLIM       PIC '99999999V99'  /* KREDITLIMIT */
    34-43   KTO_BLIM       PIC '99999999V99'  /* BARGELDLIMIT */
    44-51   KTO_ERDT       CHAR(8)  /* ERDT */
    52-59   KTO_ABDT       CHAR(8)  /* ABLAUF KARTE */
    60-70   KTO_ZYK_HAB    PIC 'S99999999V99'
    71-81   KTO_ZYK_SOL    PIC 'S99999999V99'
    82-91   KTO_GRP        CHAR(10)
    92-93   KTO_MAHN       PIC '99'
    94-104  KTO_MINZ       PIC 'S99999999V99'
   105-115  KTO_ZYK_ZAHL   PIC 'S99999999V99'
   116-124  KTO_PKT        PIC '(9)9'
   125-133  KTO_KDNR       CHAR(9)
   134-140  FILLER         CHAR(7)

KBC00001: KTO_ALT (record length 140):
     1-12   KTO_ALT_SCHL   CHAR(12)
    13-140  KTO_ALT_REST   CHAR(128)

KBC00003: XRF_SATZ (record length 50):
     1-16   XRF_KARTE      CHAR(16)
    17-25   XRF_KDNR       CHAR(9)
    26-36   XRF_KTO        CHAR(11)
    37-37   XRF_ST         CHAR(1)
    38-50   FILLER         CHAR(13)

KBC00004: TRN_SATZ (record length 120):
     1-16   TRN_ID         CHAR(16)
    17-18   TRN_TYP        CHAR(2)
    19-22   TRN_KAT        CHAR(4)
    23-32   TRN_QUELLE     CHAR(10)
    33-62   TRN_TXT        CHAR(30)
    63-73   TRN_BTR        PIC 'S99999999V99'
    74-82   TRN_HDL        CHAR(9)
    83-86   TRN_MCC        CHAR(4)
    87-102  TRN_KARTE      CHAR(16)
   103-110  TRN_DT         CHAR(8)
   111-120  FILLER         CHAR(10)

KBC00004: BUC_SATZ (record length 130):
     1-110  BUC_TRN        CHAR(110)
   111-121  BUC_KTO        CHAR(11)
   122-129  BUC_DT         CHAR(8)
   130-130  FILLER         CHAR(1)

KBC00005: TCA_SATZ (record length 30):
     1-11   TCA_KTO        CHAR(11)
    12-13   TCA_TYP        CHAR(2)
    14-17   TCA_KAT        CHAR(4)
    18-28   TCA_SLD        PIC 'S99999999V99'
    29-30   FILLER         CHAR(2)

KBC00006: DSC_SATZ (record length 20):
     1-10   DSC_GRP        CHAR(10)
    11-12   DSC_TYP        CHAR(2)
    13-16   DSC_KAT        CHAR(4)
    17-20   DSC_ZINS       PIC '99V99'

KBC00007: KDS_SATZ (record length 60):
     1-9    KDS_NR         CHAR(9)
    10-29   KDS_VORN       CHAR(20)
    30-54   KDS_NACHN      CHAR(25)
    55-57   KDS_FICO       PIC '999'
    58-60   FILLER         CHAR(3)

KBC00008: AZG_SATZ (record length 120):
     1-11   AZG_KTO        CHAR(11)
    12-57   AZG_NAME       CHAR(46)
    58-68   AZG_SLD        PIC 'S99999999V99'
    69-79   AZG_MINZ       PIC 'S99999999V99'
    80-87   AZG_FAEL       CHAR(8)
    88-96   AZG_PKT        PIC '(9)9'
    97-97   AZG_ST         CHAR(1)
    98-108  AZG_SOL        PIC 'S99999999V99'
   109-119  AZG_HAB        PIC 'S99999999V99'
   120-120  FILLER         CHAR(1)

KBC00009: ABW_SATZ (record length 50):
     1-16   ABW_TRN        CHAR(16)
    17-19   ABW_GRD        PIC '999'
    20-49   ABW_TXT        CHAR(30)
    50-50   FILLER         CHAR(1)

KBC00011: W_LDT (record length 8):
     1-4    W_LDT_JJJJ     CHAR(4)
     5-6    W_LDT_MM       CHAR(2)
     7-8    W_LDT_TT       CHAR(2)

# Procedures, callees before their callers (explained one at a time; claims checked against the code)

## KBU00008 in KBU00008, lines 6-16
This procedure logs a specific message to the system print file with a timestamp, provided the status flag is non-zero.
Inputs: P#PGM: Program identifier (8 characters); P#TXT: Message text (variable length); P#ST: Status flag (15-bit integer)
Outputs: SYSPRINT: A log entry containing the program name, the first 6 characters of the current time, and the message text
- If the status flag P#ST is exactly 0, the procedure terminates without performing any logging. (lines 12)
- If P#ST is not 0, write a line to SYSPRINT formatted as: P#PGM, a space, the first 6 characters of the current time, a space, and P#TXT. (lines 14)

## KBU00007 in KBU00007, lines 7-13
This procedure acts as a wrapper that invokes the logging procedure KBU00008 with a predefined execution level.
Inputs: P#PGM (CHAR 8): Program identifier; P#TXT (CHAR varying): Message text
Outputs: Calls KBU00008 with the provided parameters and a static level constant.
- The procedure calls KBU00008 using the input program name, the input text, and a static level value of 1. (lines 13)

## KBU00011 in KBU00011, lines 8-25
This error handling procedure logs error messages and updates the global return code with the highest error level encountered. If the error level reaches or exceeds 16, the system terminates the execution.
Inputs: F#PGM: Program identifier (CHAR 8); F#STUFE: Current error level/stage (FIXED BIN 31); F#TXT: Error description text (VARYING CHAR); W_RC: Global return code (FIXED BIN 31, External)
Outputs: W_RC: Updated global return code (FIXED BIN 31, External)
- Log the error message formatted with the program name, a formatted error level, and the error text. (lines 17)
- If the current error level is greater than the existing global return code, update the global return code to the current error level. (lines 18)
- If the error level is 16 or higher, log an 'ABBRUCH' (abort) message, trigger the return code error trap, and stop the program. (lines 19, 21, 22, 23)

## P#NUMU in KBU00021, lines 53-56
Validates whether a given string consists entirely of numeric digits.
Inputs: N#F (CHAR string to be validated)
Outputs: BIT(1) (True if numeric, False otherwise)
- The input string is valid if every character in it is contained within the set of digits '0123456789'. (lines 55)

## P#WARNUNG in KBU00021, lines 30-41
This procedure manages the logging of warning messages, ensuring that the number of warnings issued does not exceed a predefined maximum limit per run.
Inputs: W#WO (CHAR 8): Work area identifier; W#WAS (CHAR * VARYING): Warning description; W#SCHL (CHAR *): Record key/identifier; P#MAXW (FIXED BIN 31): Maximum allowed warnings per run; P#WARN (FIXED BIN 31): Current warning counter
Outputs: P#WARN (FIXED BIN 31): Incremented warning counter; KBU00007: Logged message
- Increment the warning counter and terminate the procedure if the counter exceeds the maximum allowed warnings. (lines 34)
- If the warning counter reaches the maximum allowed limit, log a suppression message and terminate the procedure. (lines 35, 37)
- If the limit has not been reached, log a warning message containing the description and the record key. (lines 40)

## P#NUMS in KBU00021, lines 46-51
Validates whether a given string represents a numeric value that may optionally include a leading sign (+ or -).
Inputs: N#F: A character string representing the number to be validated.
Outputs: BIT(1): Returns '1'B (true) if the string is a valid signed number, otherwise '0'B (false).
- The input string must have a length of at least 2 characters. (lines 48)
- The first character of the string must be a valid sign found in the predefined sign set (P#VORZ). (lines 49)
- All characters following the first character must consist only of digits found in the predefined digit set (P#ZIFF). (lines 50)

## KBU00025 in KBU00021, lines 59-71
Validates if a provided date string represents a valid calendar date within the range of years 1900 to 2099. It checks for numeric integrity, valid month ranges, and valid day ranges based on the specific month.
Inputs: D#DT: CHAR(8) - The date string to be validated.
Outputs: BIT(1) - Returns '1'B if the date is valid, otherwise returns '0'B.
- If the input string is not purely numeric, the date is invalid. (lines 62)
- Extract year, month, and day from the input string: Year (chars 1-4), Month (chars 5-6), Day (chars 7-8). (lines 63, 64, 65)
- The year must be between 1900 and 2099 inclusive; otherwise, the date is invalid. (lines 66)
- The month must be between 1 and 12 inclusive; otherwise, the date is invalid. (lines 67)
- The day must be between 1 and the maximum days allowed for that specific month; otherwise, the date is invalid. Note: Leap years are not handled for February. (lines 68)

## KBU00022 in KBU00021, lines 76-109
This procedure validates the structural and data integrity of an account record string. It checks for correct numeric formats, valid status codes, and valid date ranges, incrementing an error counter and logging warnings for every failed validation.
Inputs: K#S (CHAR 140): The raw account record string containing account number, status, balance, limits, dates, and other attributes.
Outputs: K#F (FIXED BIN 15): The total count of validation errors/warnings found in the record.
- Extract the account number from the first 11 characters of the record. (lines 80)
- If the account number is not purely numeric, increment error count and log a warning for 'KTO-NR'. (lines 81, 82)
- If the status character at position 12 is not one of 'A', 'D', 'C', or 'X', increment error count and log a warning for 'KTO-NR'. (lines 83, 84)
- If the balance field (positions 13-23) is not a signed numeric value, increment error count and log a warning for 'KTO-NR'. (lines 85, 86)
- If the credit limit field (positions 24-33) is not purely numeric, increment error count and log a warning for 'KTO-NR'. (lines 87, 88)
- If the bar limit field (positions 34-43) is not purely numeric, increment error count and log a warning for 'KTO-NR'. (lines 90, 91)
- If the opening date field (positions 44-51) is not a valid date, increment error count and log a warning for 'KTO-NR'. (lines 92, 93)
- If the closing date field (positions 52-59) is not a valid date, increment error count and log a warning for 'KTO-NR'. (lines 94, 95)
- If the debit cycle field (positions 60-70) is not a signed numeric value, increment error count and log a warning for 'KTO-NR'. (lines 96, 97)
- If the credit cycle field (positions 71-81) is not a signed numeric value, increment error count and log a warning for 'KTO-NR'. (lines 98, 99)
- If the reminder level field (positions 92-93) is not purely numeric, increment error count and log a warning for 'KTO-NR'. (lines 100, 101)
- If the minimum interest field (positions 94-104) is not a signed numeric value, increment error count and log a warning for 'KTO-NR'. (lines 102, 103)
- If the payment field (positions 105-115) is not a signed numeric value, increment error count and log a warning for 'KTO-NR'. (lines 104, 105)
- If the points field (positions 116-124) is not purely numeric, increment error count and log a warning for 'KTO-NR'. (lines 106, 107)

## KBU00012 in KBU00012, lines 15-76
This procedure loads account records from a source file into an internal memory table, validates each record for integrity, and writes the valid records to an output file. It also provides a lookup mechanism to find the index of a specific account number within the loaded table.
Inputs: ACCTFILE: Input file containing account records (CHAR 140)
Outputs: ACCTOUT: Output file containing the loaded and validated account records (CHAR 140)
- Initialize error counter and end-of-file flag. (lines 31, 32, 33)
- Read all records from ACCTFILE into the internal table KTAB_SATZ until EOF. (lines 35, 36, 42)
- If the internal table reaches its maximum bound, trigger an error via KBU00011. (lines 37, 38)
- Increment the record counter KTAB_ANZ for every record read. (lines 39)
- Validate each record using KBU00022 and accumulate the error count in K@FEHL. (lines 41)
- Log the total number of loaded records. (lines 45)
- If any validation errors were found (K@FEHL > 0), log the error count and terminate the procedure. (lines 46, 48, 49, 50)
- Lookup function (KBU00013): Search for the first occurrence where the first 11 characters of a table record match the input account number (K@NR). (lines 54, 57, 58, 60)
- Write all loaded records from the internal table to ACCTOUT in the same order they were read. (lines 69, 70)
- Log the total number of records written to the output file. (lines 73, 74)

## KBU00015 in KBU00015, lines 15-80
This procedure aggregates balances for account/type/category combinations by reading an input file and maintaining a sorted in-memory table. It updates existing balances or inserts new entries into the table, then writes the final sorted results to an output file.
Inputs: TCATFILE: contains TCA_SATZ records (TCA_KTO, TCA_TYP, TCA_KAT, TCA_SLD)
Outputs: TCATOUT: contains TCA_SATZ records (TCA_KTO, TCA_TYP, TCA_KAT, TCA_SLD)
- Initialize balance counter to zero. (lines 27)
- For each record in TCATFILE, update the in-memory table using the key formed by concatenating TCA_KTO, TCA_TYP, and TCA_KAT. (lines 32)
- If the key exists in the table, add the incoming balance (TCA_SLD) to the existing balance. (lines 42, 54)
- If the key does not exist, find the correct insertion position to maintain alphabetical order by TC_KEY. (lines 45, 47)
- If the table is full (TC_ANZ reaches HBOUND), log an error via KBU00011. (lines 56, 57)
- When inserting a new key, shift existing records in the table one position to the right to make space. (lines 58, 59, 60)
- Initialize the new entry's balance to zero before adding the incoming balance. (lines 64, 65)
- Write the final table to TCATOUT, reconstructing the TCA_SATZ record from the split components of TC_KEY. (lines 72, 73, 74, 75, 76)

## KBU00024 in KBU00021, lines 140-156
Validates the numeric integrity of the card and account segments within a data string. It tracks the count of validation errors and logs warnings for non-numeric values found in specific positions.
Inputs: X#S: A 50-character string containing the card and account data.
Outputs: X#F: An integer representing the total count of validation errors encountered.; P#WARNUNG: A log entry containing the procedure name, the error type (KARTE or KONTO), and the extracted substring.
- If the first 16 characters of the input string are not numeric, increment the error counter and log a warning for 'KARTE' using the first 16 characters. (lines 143, 145, 146)
- If the characters from position 26 to 36 (length 11) of the input string are not numeric, increment the error counter and log a warning for 'KONTO' using the first 16 characters. (lines 148, 150, 151)

## XRF_LADEN in KBP00001, lines 374-385
Loads cross-reference card data from an external file into internal memory arrays for processing. It also tracks the number of records that fail a specific validation check.
Inputs: XREFFILE (XRF_SATZ: XRF_KARTE, XRF_KTO, XRF_ST)
Outputs: #XN (counter); #XK (array of card IDs); #XA (array of account IDs); #XS (array of card statuses); Z_GESCHR (error counter)
- Iterate through XREFFILE until the end-of-file flag SW_EOF_XRF is true. (lines 377)
- If the validation function KBU00024 returns a value greater than 0 for the current record string, increment the error counter Z_GESCHR. (lines 378, 379)
- For every record read, increment the array index counter #XN, then store the card ID, account ID, and status in the corresponding array positions. (lines 380, 381, 382)

## S#KOPF in KBU00026, lines 85-94
This procedure generates the header section for the 'KARTENBANK ABSTIMMLISTE' report, incrementing the page counter and printing the report metadata and column headers.
Inputs: S#KOPF_DT (Date); S#KOPF_PGM (Program Name); S#SEITE (Current Page Number); S#TXT (Header Labels: 'GEBUCHT', 'ABGEWIESEN', 'ERZEUGT')
Outputs: SYSPRINT (Report Output); S#SEITE (Incremented Page Number); S#ZL (Current Line Counter)
- Increment the page counter by 1 for every header call. (lines 86)
- Print the report header containing the title, program name, status 'LAUF', date, and the current page number. (lines 87, 88, 90)
- Print the column headers for 'GEBUCHT', 'ABGEWIESEN', and 'ERZEUGT' with a 2-line skip above them. (lines 91, 92)
- Reset the current line counter to 4 after printing the header. (lines 93)

## KBU00026 in KBU00026, lines 16-96
Generates a statistical summary report (SYSPRINT) for reconciliation purposes, aggregating counts and amounts for different transaction types (booked, allocated, generated). The report provides a breakdown by type and a final total, used for reconciliation with the general ledger.
Inputs: S#PGM (Program ID); S#DT (Date); S#TYP (Type Index); S#BTR (Amount); S#ART (Transaction Category: 'G', 'A', or 'E')
Outputs: SYSPRINT (Report containing aggregated counts and sums)
- Initialize the internal table with 9 rows, setting type labels to '01' through '09' and all counts and sums to zero. (lines 42, 43, 44, 45, 46)
- Identify the transaction category index (J) by searching for the character S#ART within the string 'GAE'. (lines 52)
- If the transaction category is not 'G', 'A', or 'E', the entry is ignored. (lines 53)
- Convert the input S#TYP to a numeric index S#I; if conversion fails or the index is outside the range 1-9, default the index to 9. (lines 56, 58)
- Increment the count (S#Z_ANZ) and add the amount (S#BTR) to the corresponding type and category cell. (lines 59, 60)
- Reset global totals (S#GES_ANZ and S#GES_SUM) to zero before processing the print loop. (lines 65)
- During report generation, skip any type row where the total count for all categories is zero. (lines 68)
- If the line counter (S#ZL) exceeds 50, trigger a new page header via S#KOPF. (lines 69)
- Print the detailed rows for each type, formatting the amount with a specific numeric mask (ZZZ.ZZZ.ZZZ.ZZ9V,99-). (lines 70, 71, 72, 73)
- Increment the line counter (S#ZL) after printing a row. (lines 74)
- Accumulate the totals for the final summary row by summing counts and amounts across all categories for the current type. (lines 75, 76, 77)
- Print the final summary row containing the grand totals for all categories. (lines 79, 80, 81)

## KBU00023 in KBU00021, lines 114-135
Validates the structural and data integrity of a sales record string by checking for empty IDs, numeric formats, and valid date ranges. It counts the total number of validation errors found within the input string.
Inputs: U#S: CHAR(120) - The raw input record string containing sales data.
Outputs: U#F: FIXED BIN(15) - The total count of validation errors detected.
- Extract the ID from the first 16 characters of the input string. (lines 118)
- If the extracted ID is empty, increment the error counter and log a warning with message 'ID LEER'. (lines 119, 120)
- Validate that characters 17-18 of the input string are numeric; if not, increment the error counter and log a warning with message 'TYP'. (lines 121, 122)
- Validate that characters 19-22 of the input string are numeric; if not, increment the error counter and log a warning with message 'KATEGORIE'. (lines 123, 124)
- Validate that characters 63-73 of the input string represent a signed numeric value; if not, increment the error counter and log a warning with message 'BETRAG'. (lines 126, 127)
- Validate that characters 83-86 of the input string are numeric; if not, increment the error counter and log a warning with message 'MCC'. (lines 128, 129)
- Validate that characters 87-102 of the input string are numeric; if not, increment the error counter and log a warning with message 'KARTE'. (lines 130, 131)
- Validate that characters 103-110 of the input string represent a valid date (via KBU00025); if invalid, increment the error counter and log a warning with message 'DATUM'. (lines 132, 133)

## KBU00009 in KBU00009, lines 7-31
Performs a linear search in a key table to find the index of a specific key. It provides two distinct search modes: a forward search for 16-character keys and a reverse search for 9-character keys.
Inputs: T#TAB: Array of 16-character strings to be searched; T#ANZ: Total number of elements in the table; T#KEY: 16-character string to match in the 16-character table; T#TAB9: Array of 9-character strings to be searched; T#KEY9: 9-character string to match in the 9-character table
Outputs: T#IX: The index of the found key, or 0 if no match is found
- Initialize the result index to 0. (lines 16)
- Iterate through the 16-character table from the first element to the last element (T#ANZ) and return the index of the first occurrence of T#KEY. (lines 17, 18, 19)
- Iterate through the 9-character table in reverse order from T#ANZ down to 1, and return the index of the last occurrence of T#KEY9. (lines 26, 27, 28)

## ABWEISEN in KBP00001, lines 279-290
This procedure logs rejected transactions by mapping a rejection reason code to a descriptive text and writing the record to the rejects file. It also increments a global counter for the total number of rejected transactions.
Inputs: A#GRD (rejection reason code); TRN_ID (transaction identifier); KO_ABW_CD (lookup table of rejection codes); KO_ABW_TX (lookup table of rejection descriptions); Z_ABGEW (running total of rejected transactions)
Outputs: ABW_SATZ (rejected transaction record written to REJECTS file); Z_ABGEW (incremented rejection counter)
- Initialize the rejection record string to empty. (lines 282)
- Map the current transaction ID to the rejection record. (lines 283)
- Set the rejection reason code and default the description to a question mark. (lines 284)
- If the provided rejection code matches a code in the lookup table, update the description with the corresponding text. (lines 286)
- Write the completed rejection record to the REJECTS file. (lines 288)
- Increment the global rejected transaction counter. (lines 289)

## BUCHEN in KBP00001, lines 295-342
Processes financial transactions to update account balances, credit limits, and transaction history. It handles debit and credit entries, calculates point adjustments for purchases based on merchant category codes, and generates transaction output records.
Inputs: KTO_SATZ: KTO_NR, KTO_SLD, KTO_ZYK_SOL, KTO_ZYK_HAB, KTO_ZYK_ZAHL, KTO_PKT; TRN_SATZ: TRN_TYP, TRN_KAT, TRN_MCC, W_BTR; @SOLL: BIT(1) indicator for debit/credit; W_LAUFDT: Current processing date; W_TSATZ: Raw transaction string for output
Outputs: TRANOUT: BUC_SATZ record containing transaction details, account number, and date; KTO_SATZ: Updated KTO_SLD, KTO_ZYK_SOL, KTO_ZYK_HAB, KTO_ZYK_ZAHL, and KTO_PKT; W_TGSUM: Running total of transaction amounts; Z_GECTBUCHT: Counter of processed transactions; KBU00016: Updated aggregate balances for the key (KTO_NR + TRN_TYP + TRN_KAT)
- Create a unique key for aggregation by concatenating account number, transaction type, and transaction category. (lines 301)
- If transaction is a debit (@SOLL is true), increase account balance and debit cycle balance, then call aggregation procedure. (lines 305, 306)
- If transaction is a credit (@SOLL is false), decrease account balance and increase credit cycle balance; also update aggregation with negative amount. (lines 310, 311, 312, 313)
- If transaction is a payment type, increase the payment cycle balance. (lines 314, 315)
- Calculate the integer part of the transaction amount for point calculation. (lines 318)
- For purchase transactions, adjust points based on Merchant Category Code (MCC): MCC '5411' uses factor 2, MCC '5812' uses factor 3, others use factor 1. (lines 320, 322, 323, 324)
- For purchases, update points: new points = current points + (integer amount * factor), capped at maximum allowed points. (lines 326, 327)
- For credit transactions, decrease points by the integer amount, ensuring points do not drop below zero. (lines 329, 331)
- Finalize the transaction output record with truncated transaction string, account number, and processing date. (lines 336, 337, 338)
- Increment the total processed amount and the transaction counter. (lines 340, 341)

## KBU00005 in KBU00004, lines 13-21
This procedure performs a commercial rounding of a numeric input value to two decimal places. It is designed specifically for positive amounts.
Inputs: B#IN (FIXED DEC(31,10))
Outputs: B#OUT (FIXED DEC(15,2))
- Round the input value B#IN to 2 decimal places using commercial rounding and assign it to B#OUT. (lines 19, 20)

## KBU00006 in KBU00004, lines 23-28
This procedure determines the maximum value between two numeric inputs.
Inputs: B#1: FIXED DEC(15,2); B#2: FIXED DEC(15,2)
Outputs: Return value: FIXED DEC(15,2)
- If the first input is greater than or equal to the second input, return the first input; otherwise, return the second input. (lines 25, 26, 27, 28)

## GEBUEHR in KBP00001, lines 345-369
Calculates and applies a cash fee based on a percentage of the transaction amount, ensuring it meets a minimum threshold. The procedure updates account balances, logs a transaction record to the transaction history file, and updates statistical summaries.
Inputs: W_BTR (Transaction amount); KO_GEB_BAR_PROZ (Fee percentage); KO_GEB_BAR_MIN (Minimum fee); KTO_NR (Account number); TRN_ID (Original transaction ID); W_KARTE (Card number); W_LAUFDT (Current processing date)
Outputs: KTO_SLD (Updated account balance); KTO_ZYK_SOL (Updated account cumulative debit); TRANOUT (Transaction history record); KBU00016 (Updated balance aggregation table); KBU00027 (Statistical summary report)
- Calculate the fee by multiplying the transaction amount by the fee percentage (divided by 100) and applying commercial rounding to 2 decimal places. (lines 346)
- The fee must be at least the minimum fee amount; select the maximum between the calculated fee and the minimum fee. (lines 347)
- Increase the account balance (KTO_SLD) and the cumulative debit (KTO_ZYK_SOL) by the calculated fee amount. (lines 349, 350)
- Update the balance aggregation table using a key composed of the account number, fee type, and a constant suffix '0001'. (lines 351)
- Generate a new transaction ID by prefixing 'CF' to the substring of the original transaction ID starting from the 3rd character. (lines 353, 355)
- Construct the transaction history record (TRN_SATZ) with fixed values: type is the fee type, category is '0001', source is 'SYSTEM', text is 'BARGELDGEBUEHR', handler is '000000000', MCC is '0000', and include the card number and processing date. (lines 356, 357, 358, 359, 360, 361, 362, 363, 364)
- Write the transaction record to the TRANOUT file as a BUC_SATZ record, containing the truncated transaction string, account number, and processing date. (lines 366, 367, 368)

## UMSATZ in KBP00001, lines 192-221
Processes a financial transaction by checking for duplicates, determining the debit/credit nature, and validating the transaction against business rules. If valid, it updates the account balance and applies fees for cash transactions; otherwise, it rejects the transaction.
Inputs: TRN_ID (CHAR 16); TRN_TYP (CHAR 2); TRN_BTR (DEC 15,2); TRN_KARTE (CHAR 16); #GS (CHAR 16 array); #GN (Integer); KTO_SATZ (CHAR 140)
Outputs: W_BTR (DEC 15,2); W_KARTE (CHAR 16); @DOPP (BIT 1); @SOLL (BIT 1); KTAB_SATZ (CHAR 140 array)
- Initialize working amount and card number from transaction record. (lines 193, 194)
- Check if transaction ID already exists in the seen transactions list (#GS). If found, mark as duplicate (@DOPSB = '1'B). (lines 196, 197, 198)
- If transaction ID is not a duplicate, add it to the list (#GS) and increment the counter (#GN), provided the list is not full. If full, log error 'ZU VIELE UMSAETZE'. (lines 199, 200, 201, 202)
- Set transaction as debit (@SOLL = '1'B) if type is '01' (KAUF) or '04' (BAR); otherwise, set as credit (@SOLL = '0'B). (lines 205, 206, 207, 208)
- Perform business rule validation via PRUEFEN(). If validation fails (result != 0), reject the transaction, log it as type 'A', and exit the procedure. (lines 210, 211, 213, 214)
- If validation passes, execute the booking process and log the transaction as type 'G'. (lines 217, 218)
- If the transaction type is '04' (BAR), calculate and apply the transaction fee. (lines 219, 220)
- Update the account table (KTAB_SATZ) with the updated account record (KTO_SATZ) at the index specified by @KI. (lines 221)

## KBU00003 in KBU00001, lines 91-111
Compares two date strings (YYYYMMDD) part-by-part (Year, then Month, then Day) to determine chronological order. Returns 1 if the first date is later, -1 if the first date is earlier, and 0 if they are equal.
Inputs: P#A: CHAR(8) (Date 1: YYYYMMDD); P#B: CHAR(8) (Date 2: YYYYMMDD)
Outputs: FIXED BIN(15): Comparison result (1, -1, or 0)
- Initialize comparison result to 0. (lines 99)
- If Year of A is greater than Year of B, set result to 1. (lines 100)
- If Year of A is less than Year of B, set result to -1. (lines 101)
- If Years are equal and Month of A is greater than Month of B, set result to 1. (lines 103)
- If Years are equal and Month of A is less than Month of B, set result to -1. (lines 104)
- If Years and Months are equal and Day of A is greater than Day of B, set result to 1. (lines 106)
- If Years and Months are equal and Day of A is less than Day of B, set result to -1. (lines 107)
Not backed by the code, treat with care: rule 3: value -1 is not in the code of KBU00003 or the declarations it uses; rule 5: value -1 is not in the code of KBU00003 or the declarations it uses; rule 7: value -1 is not in the code of KBU00003 or the declarations it uses

## PRUEFEN in KBP00001, lines 224-274
This procedure validates financial transactions against card and account status, checking for duplicate flags, transaction type restrictions, card validity, and account limits (cash and credit). It returns a specific error code (R#) representing the reason for failure or success.
Inputs: @DOPP (BIT); W_BTR (FIXED DEC(15,2)); TRN_TYP (CHAR(2)); TRN_DT (CHAR(8)); TRN_MCC (CHAR(4)); W_KARTE (CHAR(16)); #XS (CHAR(1)); KTO_ST (CHAR(1)); KTO_ABDT (CHAR(8)); KTO_BLIM (FIXED DEC(15,2)); KTO_KLIM (FIXED DEC(15,2)); KTO_SLD (FIXED DEC(15,2)); @SOLL (BIT)
Outputs: R# (FIXED BIN(15)); W_KTONR (CHAR(11)); W_HV1 (FIXED DEC(15,2))
- If duplicate flag is set, return error 110. (lines 227)
- If transaction amount is zero or negative, return error 109. (lines 229)
- If transaction type is fee (KO_TYP_GEB) or interest (KO_TYP_ZINS), return error 111. (lines 233)
- If transaction type is not purchase, payment, credit, or cash, return error 111. (lines 232)
- If card lookup returns no index, return error 100. (lines 244)
- If card status is not 'Y', return error 101. (lines 246)
- If account lookup returns no index, return error 102. (lines 250)
- If account status is 'C' or 'X', return error 103. (lines 252)
- If transaction date is later than card expiry date, return error 105. (lines 254)
- If account status is 'D' and debit flag is set, return error 104. (lines 256)
- If transaction is a purchase and MCC is blocked, return error 108. (lines 258)
- If transaction is cash and amount exceeds cash limit, return error 107. (lines 260)
- If debit flag is '1', check if new balance (current balance + transaction amount) exceeds credit limit; if so, return error 106. (lines 262, 265, 266)
- The check for daily total limit (W_TGSUM + W_BTR > W_TGLIM) is abolished. (lines 270)

## KBP00001 in KBP00001, lines 39-387
This procedure processes daily transaction files to update account balances and category totals. It validates each transaction, checks for duplicates, applies business rules (such as fees or point adjustments), and outputs both processed transactions and rejected ones.
Inputs: CTLCARD: Control file containing the processing date (W_LAUFDT) in the first 8 characters.; XREFFILE: Cross-reference file containing card data.; DALYTRAN: Input file containing daily transactions (TRN_SATZ).; P_PARM: Program parameter string used for 'TRACE' and 'CHKP=' configuration.
Outputs: TRANOUT: File containing successfully processed transactions.; REJECTS: File containing rejected transactions with reason codes.; ACCTOUT: Updated account balances.; TCATOUT: Updated category totals.; SYSPRINT: Statistical summary reports and logs.
- The processing date is extracted from the first 8 characters of the CTLCARD record. (lines 140)
- If the extracted processing date contains non-numeric characters, the program logs an error and terminates. (lines 141, 142)
- If the 'TRACE' keyword is present in the program parameters, the test mode is enabled. (lines 119)
- If the 'CHKP=' parameter is provided, the checkpoint interval is set to the 4 characters following the '=' sign. (lines 120, 121)
- Every transaction is validated for structural integrity using KBU00023. (lines 161)
- A checkpoint log is generated every time the transaction counter reaches the defined interval. (lines 166, 167, 168)
- If any transactions are rejected (Z_ABGEW > 0), the program return code is set to 4 if it is not already 4. (lines 184)

## KBU00018 in KBU00018, lines 8-36
This procedure loads customer data from a flat file into an in-memory indexed table for fast searching. It constructs a full name by concatenating first and last names and provides a lookup mechanism to find a customer's index by their ID.
Inputs: CUSTFILE: Input file containing customer records (KDS_NR, KDS_VORN, KDS_NACHN, KDS_FICO)
Outputs: KD_TAB: Global table containing indexed customer IDs (KD_NR), formatted names (KD_NAME), and credit scores (KD_FICO); C@IX: The index position of the found customer (returned via KBU00019)
- Initialize customer counter to zero. (lines 17)
- If the customer table is full, log an error message 'KBU00018 KUNDENTABELLE VOLL' with error level 16. (lines 21, 22)
- Increment the customer counter when a record is added. (lines 23)
- Store the customer ID from the file into the table. (lines 24)
- Construct the full name by trimming leading/trailing spaces from the first name and last name, then joining them with a single space. (lines 25)
- Store the credit score from the file into the table. (lines 26)
- Search for the customer ID (C@NR) in the loaded table and return its index (C@IX). (lines 33, 34, 35)

## ZS_LADEN in KBP00002, lines 193-204
This procedure loads interest rate configuration data from the DISCGRP file into internal memory arrays. It builds a composite key for each group and stores the corresponding annual interest rate.
Inputs: File DISCGRP: DSC_GRP (CHAR 10), DSC_TYP (CHAR 2), DSC_KAT (CHAR 4), DSC_ZINS (DEC 99V99)
Outputs: ZS_SCHL: Array of composite keys (CHAR 16); ZS_P: Array of interest rates (DEC 5,2); ZS_N: Counter for number of records loaded
- Initialize EOF flag to false. (lines 194)
- For each record in DISCGRP, increment the record counter. (lines 198)
- Create a composite key by concatenating Group, Type, and Category. (lines 199)
- Store the interest rate from the current record into the interest rate array. (lines 200)

## ZINSSATZ in KBP00002, lines 153-169
Determines the applicable interest rate by searching for a specific group and account type combination in a table, falling back to a default group if no match is found.
Inputs: Z#GRP: Group identifier (CHAR 10); Z#TK: Account type identifier (CHAR 6); ZS_N: Number of entries in the interest rate table; ZS_SCHL: Table key (CHAR 16); ZS_P: Table interest rate (DEC 5,2); $GRP_DEF: Default group identifier (CHAR 10)
Outputs: $P: The determined interest rate (DEC 5,2)
- Initialize search flags and rate to zero/false. (lines 156, 157)
- Iterate through the table to find a record where the table key matches the concatenation of the input group and account type. (lines 158, 159, 160)
- If a match was found in the first loop, exit the procedure without further searching. (lines 163)
- If no match was found, iterate through the table to find a record where the table key matches the concatenation of the default group and the input account type. (lines 164, 165, 166)

## BELASTEN in KBP00002, lines 174-190
This procedure updates account balances and records a financial transaction to the transaction output file. It specifically handles debit/credit entries by increasing the account balance and cycle balance, then generates a transaction record for auditing.
Inputs: B#PFX (CHAR 2); B#TYP (CHAR 2); B#KAT (CHAR 4); B#TXT (CHAR 30); B#BTR (FIXED DEC 15,2); KTO_NR (CHAR 11); KTO_SLD (FIXED DEC 15,2); KTO_ZYK_SOL (FIXED DEC 15,2); W_LAUFDT (CHAR 8)
Outputs: KTO_SLD (updated); KTO_ZYK_SOL (updated); TRANOUT (new record BUC_SATZ); KBU00027 (called with B#TYP, B#BTR, 'E')
- Update the account balance (KTO_SLD) by adding the transaction amount. (lines 177)
- Update the account cycle balance (KTO_ZYK_SOL) by adding the transaction amount. (lines 178)
- Construct the transaction ID by concatenating the prefix, account number, and suffix '000'. (lines 180)
- Set transaction metadata: type, category, source as 'ZINSLAUF', text, amount, and handler as '000000000'. (lines 181, 182)
- Set transaction card details: MCC as '0000', card number as empty, and date from the current processing date. (lines 183)
- Prepare the BUC_SATZ record for output: extract the first 110 characters of the transaction record string, set the account number, and set the date. (lines 185, 186, 187)
- Write the prepared BUC_SATZ record to the TRANOUT file. (lines 188)
- Call statistical summary procedure KBU00027 to log the transaction type and amount. (lines 189)

## KBP00002 in KBP00002, lines 17-206
This procedure calculates and applies interest charges, late fees, and overdraft fees to customer accounts based on account status, balances, and customer credit scores. It also manages account status transitions (e.g., from active to delinquent or written-off) based on the number of warning notices issued.
Inputs: CTLCARD: Control record containing the processing date (W_STEU); ACCTFILE: Account records (KTO_SATZ) including balance, status, group, and credit limit; TCATFILE: Transaction category data (TC_TAB) containing keys and balances; DISCGRP: Interest rate configuration data; CUSTFILE: Customer data including FICO scores
Outputs: TRANOUT: Financial transaction records for interest (ZI), warning fees (MG), and overdraft fees (UL)
- Skip accounts that are already written off (status 'X'). (lines 85)
- For each transaction category, if the category key does not match the account number, skip it. (lines 92)
- Skip transaction categories with a balance less than or equal to zero. (lines 93)
- If the account belongs to the 'AKTION2010' group and the processing date is between 2010-01-01 and 2011-12-31, the base interest rate is set to 0. (lines 97, 98, 99)
- If the base interest rate is greater than zero, add a surcharge of 3.00 if the account status is 'D' (delinquent). (lines 100, 101)
- If the customer has a valid ID and their FCTO score is below 600, add a surcharge of 2.00 to the interest rate. (lines 102, 103, 104)
- Calculate interest amount as (Category Balance * Interest Rate) / 1200, rounded to 2 decimal places. (lines 106)
- If the total accumulated interest for the account is at least the threshold KO_ZINS_FREI, generate a 'SOLLZINSEN' transaction. (lines 111, 112)
- For accounts with status 'A' (Active) or 'D' (Delinquent), if the minimum cycle count is greater than 0 and the current cycle count is less than the minimum, increment the warning count and charge a warning fee. (lines 115, 116, 117, 118, 119, 120, 121, 122, 123, 124)
- If the warning count exceeds 99, cap it at 99. (lines 122)
- If the account balance exceeds the credit limit, generate an 'UEBERZIEHUNGSGEBUEHR' transaction. (lines 127, 128, 129)
- Transition account status from 'A' to 'D' if the warning count is at least the threshold KO_VERZ_AB. (lines 134)
- Transition account status from 'D' to 'X' if the warning count is at least the threshold KO_ABSCHR_AB. (lines 135)
- Transition account status from 'D' to 'A' if the warning count is 0. (lines 136)
Not backed by the code, treat with care: rule 9: value 'MAHNGEBUEHR'] is not in the code of KBP00002 or the declarations it uses

## KBU0SJ in KBU00001, lines 29-37
Determines whether a given year is a leap year based on the Gregorian calendar rules.
Inputs: J#: The year to be evaluated (FIXED BIN(31))
Outputs: Return value: BIT(1) indicating true ('1'B) or false ('0'B)
- A year is a leap year if it is divisible by 400. (lines 31)
- If not divisible by 400, a year is not a leap year if it is divisible by 100. (lines 33)
- If not divisible by 100, a year is a leap year if it is divisible by 4. (lines 35)
- Otherwise, the year is not a leap year. (lines 36)

## KBU0TM in KBU00001, lines 42-49
Calculates the number of days in a specific month, adding an extra day if the month is February and the year is a leap year.
Inputs: J# (Year); M# (Month); TG#MON (Array of days per month)
Outputs: R# (Number of days in the month)
- Retrieve the base number of days for the given month from the TG#MON array. (lines 45)
- If the month is 2, increment the day count by 1 if the leap year check for the year J# returns true. (lines 46, 47)

## KBU00002 in KBU00001, lines 54-85
Calculates a future date by adding a specified number of days to a given starting date. The procedure only supports forward date arithmetic.
Inputs: P#DT: Starting date in YYYYMMDD format (CHAR(8)); P#TG: Number of days to add (FIXED BIN(31))
Outputs: W#ERG: The resulting date in YYYYMMDD format (CHAR(8))
- Extract year, month, and day from the input date string using fixed positions. (lines 62, 63, 64)
- If the number of days to add is negative, return the original input date. (lines 66, 68)
- Iteratively increment the day for each day in the count. (lines 71, 72)
- If the day exceeds the number of days in the current month (determined by KBU0TM), reset the day to 1 and increment the month. (lines 73, 75, 76)
- If the month exceeds 12, reset the month to 1 and increment the year. (lines 77)
- Construct the final date string by calculating (Year * 10000) + (Month * 100) + Day. (lines 81, 82, 83)

## MINDESTZAHLUNG in KBP00003, lines 83-99
Calculates the minimum required payment amount based on the current account balance, a fixed percentage, and credit limit thresholds. It ensures the calculated payment does not exceed the actual balance.
Inputs: KTO_SATZ.KTO_SLD; KTO_SATZ.KTO_KLIM; KO_MINZ_MIN; KO_MINZ_PROZ
Outputs: §MIN
- If the account balance is zero or negative, the minimum payment is set to zero. (lines 85, 86, 87)
- If the account-balance is less than the minimum threshold, the minimum payment is equal to the account balance. (lines 89, 90)
- If the account balance is at or above the minimum threshold, calculate the minimum payment as the maximum of the threshold and the calculated percentage of the balance, then add any amount by which the balance exceeds the credit limit. (lines 92, 93, 94, 95, 96)
- The final calculated minimum payment cannot exceed the account balance. (lines 97)
Not backed by the code, treat with care: rule 1: field §MIN is not declared anywhere; rule 2: field §MIN is not declared anywhere; rule 3: field §MIN is not declared anywhere; rule 3: field §UEB is not declared anywhere; rule 4: field §MIN is not declared anywhere

## KBU00020 in KBU00020, lines 7-24
Converts a given amount from Deutsche Marks (DM) to Euro (EUR) using a fixed exchange rate and applies commercial rounding via an external routine.
Inputs: E#BTR: The input amount in DM (FIXED DEC(15,2))
Outputs: E#ERG: The resulting converted amount in EUR (FIXED DEC(15,2))
- If the input amount is zero, the output amount is set to zero. (lines 15, 17)
- The intermediate conversion is calculated by dividing the input amount by the fixed exchange rate of 1.95583 with a precision of 10 decimal places. (lines 19)
- If the input amount is negative, the absolute value of the converted amount is passed to the rounding routine, and the result is negated. (lines 20, 21)
- If the input amount is positive, the converted amount is passed to the rounding routine. (lines 22, 23)

## AUSZUG in KBP00003, lines 102-128
Generates a bank account statement record if the account has a non-zero balance or specific credit/debit movements. The procedure retrieves customer names, performs currency conversion to Euro if required, and writes the formatted statement to the output file.
Inputs: KTO_SATZ (KTO_NR, KTO_SLD, KTO_ZYK_SOL, KTO_ZYK_HAB, KDO_PKT, KTO_ST, KTO_KDNR); SW_EURO (Currency switch); KBU00019 (Customer lookup by KTO_KDNR); KBU00020 (DM to EUR conversion)
Outputs: AZG_SATZ (Written to STMTFILE); Z_GESCHR (Incremented counter)
- Only process the account if the balance (KTO_SLD), debit movement (KTO_ZYK_SOL), or credit movement (KTO_ZYK_HAB) is non-zero. (lines 104, 105)
- If the customer ID lookup returns 0, set the statement name to 'UNBEKANNT'. (lines 109, 110)
- If the Euro switch is active ('J'), convert the balance from DM to EUR using the external routine. (lines 113, 116, 117, 118)
- If the Euro switch is not active, use the original balance as the statement balance. (lines 120, 121)
- Map all remaining account fields (Minimum amount, Due date, Pocket, Status, Debit, Credit) from the source record to the statement record. (lines 122, 123, 124, 125, 126)
- Increment the total number of statements processed. (lines 127)

## NEUER_ZYKLUS in KBP00003, lines 131-136
Resets the periodic accounting balances and the minimum threshold for a specific account to their starting values.
Inputs: KTO_SATZ record: KTO_MINZ (field KTO_MINZ)
Outputs: KTO_SATZ record: KTO_ZYK_SOL, KTO_ZYK_HAB, KTO_ZYK_ZAHL, KTO_MINZ
- Reset the debit periodic balance to zero. (lines 133)
- Reset the credit periodic balance to zero. (lines 134)
- Reset the payment periodic balance to zero. (lines 135)
- Reset the minimum threshold to the constant value §MIN. (lines 135)

## KBP00003 in KBP00003, lines 18-138
This procedure processes bank account records to calculate minimum payments, generate account statements, and reset periodic accounting cycles. It iterates through loaded accounts, performing financial calculations and writing statements for all accounts not marked with status 'X'.
Inputs: CTLCARD: Control file containing execution parameters (W_STEU).; ACCTFILE: Source file containing account records (KTO_SATZ).; CUSTFILE: Customer data file for name lookups.; KO_FAELLIG_TG: Constant value (25) used for date calculation.
Outputs: STMTFILE: Output file containing generated account statements.; W_RC: Return code for the job step.; W_LAUFDT: Execution date extracted from the control card.
- Extract the execution date from the first 8 characters of the control card record. (lines 57)
- Calculate a future due date by adding 25 days to the execution date. (lines 58)
- Iterate through all loaded accounts in the internal table (KTAB_ANZ). (lines 66)
- Only process accounts where the account status (KTO_ST) is not equal to 'X'. (lines 68)
- For eligible accounts, execute minimum payment calculation, statement generation, and cycle reset, then update the internal table with the modified record. (lines 70, 71, 72)
Not backed by the code, treat with care: rule 2: field §FAEL is not declared anywhere; rule 3: field §I is not declared anywhere

## KBP00004 in KBP00004, lines 13-60
Calculates and applies a monthly interest rate of 18% (or a value specified in the control card) to the positive balances of specific accounts. For eligible accounts, it generates an interest transaction record and updates the account balance.
Inputs: CTLCARD: contains the interest rate in positions 9-12; ACCTFILE: contains account master records (KTO_SATZ)
Outputs: ACCTOUT: updated account master records (KTO_SATZ); TRANOUT: generated interest transaction records (TRN_SATZ)
- The processing date (W_LAUFDT) is taken from the first 8 characters of the CTLCARD record. (lines 31)
- If the interest rate in CTLCARD positions 9-12 is not blank, use this value as the annual interest rate (A_PROZ). Otherwise, use the default 18.00%. (lines 32, 34, 35)
- An account is eligible for interest if its account type (KTO_ALT_SCHL) at position 12 is 'A' and its balance (KTO_SLD) is greater than 0. (lines 42, 43)
- The monthly interest amount (A_ZINS) is calculated as: Balance * Annual Rate / 1200. (lines 45)
- If interest is applied, the account balance (KTO_SLD) is increased by the interest amount (A_ZINS). (lines 46)
- If interest is applied, a transaction record (TRN_SATZ) is created with: ID = 'ZA' + Account Number + '000', Type = '06', Category = '0001', Text = 'ZINSEN', Amount = Interest Amount, and Date = Processing Date. (lines 48, 49, 50, 51)
- The updated account record is written to the output file (ACCTOUT) for every account processed. (lines 55)

## BRIEF in KBP00005, lines 76-92
Generates a formal notification letter for account holders regarding outstanding minimum payments. The letter includes the account number, customer name (or a generic salutation), a specific message based on the reminder level, the amount due, and a formatted deadline date.
Inputs: KTO_SATZ.KTO_NR; KTO_SATZ.KTO_MINZ; KD_TAB.KD_E.KD_NAME; M_KD; M_STUFE; M_TXT; M_FRIST
Outputs: BRIEFE (File)
- The letter header contains 'KARTENBANK' followed by the account number. (lines 77)
- If a customer index (M_KD) is greater than 0, the customer's name is printed; otherwise, the generic salutation 'AN DEN KONTOINHABER' is used. (lines 79, 80, 82)
- The letter displays the first line of text corresponding to the current reminder level (M_STUFE, 1) after a 3-line skip. (lines 83)
- The letter displays the second line of text corresponding to the current reminder level (M_STUFE, 2) after a 2-line skip. (lines 84)
- The outstanding amount (M_BTR) is set to the account's minimum payment amount (KTO_MINZ). (lines 85)
- The letter displays the text 'OFFENER BETRAG: ', the calculated amount (M_BTR), and ' EUR' after a 2-line skip. (lines 86)
- The letter displays the third line of text (M_STUFE, 3) followed by a date formatted as DD.MM.YYYY, extracted from M_FRIST (positions 7-8, 5-6, and 1-4). (lines 88, 89, 90)
- The letter displays the fourth line of text (M_STUFE, 4) after a 3-line skip. (lines 91)

## KBP00005 in KBP00005, lines 13-94
This procedure generates overdue payment reminder letters for accounts with a debit balance. It determines the reminder level (1, 2, or 3) based on the existing reminder count and produces a formatted letter for each eligible account.
Inputs: CTLCARD: Control card containing execution parameters; KTO_SATZ: Account records containing balance, status, and reminder level; KBU00012: Account data table; KBU00018: Customer data table
Outputs: BRIEFE: Output stream containing generated reminder letters; KBU00007: Log entry containing the total number of letters processed
- The execution date is extracted from the first 8 characters of the control card. (lines 51)
- The payment deadline (M_FRIST) is calculated by adding 14 days to the execution date. (lines 52)
- An account is skipped if the account status (KTO_ST) is not 'D' (Debit). (lines 59)
- An account is skipped if the balance (KTO_SLD) is less than or equal to zero. (lines 60)
- Reminder level 1 is assigned if the current reminder count (KTO_MAHN) is 2 or less. (lines 62)
- Reminder level 2 is assigned if the current reminder count (KTO_MAHN) is 4 or less. (lines 63)
- Reminder level 3 is assigned for any other reminder count. (lines 64)
- The program logs the total number of letters processed at the end of the run. (lines 72, 73)
- The program is considered decommissioned; the logic for generating letters is no longer active in the current production environment. (lines 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46)

## KBU0Y2 in KBU00001, lines 114-119
Converts a 6-digit date string (YYMMDD) into an 8-digit date string (YYYYMMDD) by determining the appropriate century prefix.
Inputs: P#D6 (CHAR(6)): A 6-digit date string in YYMMDD format.
Outputs: CHAR(8): The converted 8-digit date string in YYYYMMDD format.
- This routine is unused since the year 2000. (lines 114)
- If the first two digits of the input date are greater than or equal to '94', prefix the date with '19'. (lines 116, 117)
- Otherwise, prefix the date with '20'. (lines 118)