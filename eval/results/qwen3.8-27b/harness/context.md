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

# Named constants (initialized, never assigned)
- KO_TYP_KAUF = '01' (KBC00010)
- KO_TYP_ZAHL = '02' (KBC00010)
- KO_TYP_GUT = '03' (KBC00010)
- KO_TYP_BAR = '04' (KBC00010)
- KO_TYP_GEB = '05' (KBC00010)
- KO_TYP_ZINS = '06' (KBC00010)
- KO_ABW_TAB.KO_ABW.KO_ABW_CD = 100,101,102,103,104,105,106,107,108,109,110,111 (KBC00010)
- KO_ABW_TAB.KO_ABW.KO_ABW_TX = 'KARTE UNBEKANNT', 'KARTE GESPERRT', 'KONTO UNBEKANNT', 'KONTO GESCHLOSSEN', 'KONTO IM VERZUG', 'KARTE ABGELAUFEN', 'KREDITLIMIT UEBERSCHRITTEN', 'BARGELDLIMIT UEBERSCHRITTEN', 'HAENDLERKATEGORIE GESPERRT', 'BETRAG UNGUELTIG', 'DOPPELTE TRANSAKTION', 'TRANSAKTIONSTYP UNBEKANNT' (KBC00010)
- KO_MCC_SPERR = '7995' (KBC00010)
- KO_MCC_LEBM = '5411' (KBC00010)
- KO_MCC_REST = '5812' (KBC00010)
- KO_MCC_ATM = '6011' (KBC00010)
- KO_GEB_BAR_PROZ = 5.00 (KBC00010)
- KO_GEB_BAR_MIN = 10.00 (KBC00010)
- KO_MAHN_1 = 25.00 (KBC00010)
- KO_MAHN_2 = 35.00 (KBC00010)
- KO_UEBZ = 29.00 (KBC00010)
- KO_MINZ_MIN = 25.00 (KBC00010)
- KO_MINZ_PROZ = 2.00 (KBC00010)
- KO_ZINS_FREI = 1.00 (KBC00010)
- KO_AUFS_VERZ = 3.00 (KBC00010)
- KO_AUFS_FICO = 2.00 (KBC00010)
- KO_FICO_GRENZE = 600 (KBC00010)
- KO_FAELLIG_TG = 25 (KBC00010)
- KO_VERZ_AB = 2 (KBC00010)
- KO_ABSCHR_AB = 6 (KBC00010)
- KO_EURO_KURS = 1.95583 (KBC00010)
- KO_MAX_PKT = 999999999 (KBC00010)
- SW_EOF_KTO = '0'B (KBC00011)
- SW_EOF_TCA = '0'B (KBC00011)
- SW_EOF_KDS = '0'B (KBC00011)
- SW_EURO = 'N' (KBC00011)
- W_TGLIM = 2500.00 (KBP00001)
- $AKT_GRP = 'AKTION2010' (KBP00002)
- $AKT_VON = '20100101' (KBP00002)
- $AKT_BIS = '20111231' (KBP00002)
- $GRP_DEF = 'DEFAULT' (KBP00002)
- M_TXT = 'SEHR GEEHRTE KUNDIN, SEHR GEEHRTER KUNDE,', 'LEIDER KONNTEN WIR IHRE MINDESTZAHLUNG NICHT FESTSTELLEN.', 'BITTE UEBERWEISEN SIE DEN BETRAG BIS ZUM', 'MIT FREUNDLICHEN GRUESSEN, IHRE KARTENBANK', 'SEHR GEEHRTE KUNDIN, SEHR GEEHRTER KUNDE,', 'TROTZ UNSERER ERINNERUNG IST KEINE ZAHLUNG EINGEGANGEN.', 'WIR BITTEN SIE DRINGEND UM ZAHLUNG BIS ZUM', 'IHRE KARTE KANN BIS ZUR ZAHLUNG GESPERRT WERDEN.', 'SEHR GEEHRTE KUNDIN, SEHR GEEHRTER KUNDE,', 'DIES IST UNSERE LETZTE MAHNUNG VOR DER KUENDIGUNG.', 'OHNE ZAHLUNG BIS ZUM', 'GEBEN WIR DIE FORDERUNG AN EIN INKASSOBUERO ABK.' (KBP00005)
- TG#MON = 31,28,31,30,31,30,31,31,30,31,30,31 (KBU00001)
- D#ALT.D#ALT_JJ = '94' (KBU00001)
- D#ALT.D#ALT_JH = '19' (KBU00001)
- L#STUFE = 1 (KBU00007)
- E#KURS = 1.95583 (KBU00020)
- P#ZIFF = '0123456789' (KBU00021)
- P#VORZ = '+-' (KBU00021)
- P#MAXW = 50 (KBU00021)
- P#TMON = 31,29,31,30,31,30,31,31,30,31,30,31 (KBU00021)
- S#TXT = 'GEBUCHT', 'ABGEWIESEN', 'ERZEUGT' (KBU00026)

# Procedures, callees before their callers (explained one at a time; claims checked against the code)

## KBU00008 in KBU00008, lines 6-16
Runs in: job KBJ00001 STEP010, job KBJ00001 STEP020, job KBJ00001 STEP030, job KBJ00002 STEP010, job KBJ00003 STEP010
This procedure outputs a single protocol line to the system print file, including the program name, current time, and a text message. It acts as a no-op if the status parameter is zero.
Inputs: P#PGM (CHAR(8)); P#TXT (CHAR(*) VARYING); P#ST (FIXED BIN(15))
Outputs: SYSPRINT (STREAM OUTPUT PRINT file)
- If the status parameter P#ST is equal to 0, the procedure returns immediately without writing any output. (lines 12; fields P#ST; values 0)
- If P#ST is not 0, the current system time is retrieved and the first 6 characters are extracted for the output line. (lines 13, 14; fields Z#ZEIT; values 1, 6)
- A line is written to the SYSPRINT file containing the program name, a space, the 6-character time substring, a space, and the text message, all formatted as alphanumeric fields. (lines 14, 15; fields P#PGM, Z#ZEIT, P#TXT; values ' ', A)

## KBU00007 in KBU00007, lines 7-13
Runs in: job KBJ00001 STEP010, job KBJ00001 STEP020, job KBJ00001 STEP030, job KBJ00002 STEP010, job KBJ00003 STEP010
This procedure acts as a wrapper to log a message to the system print file. It passes the program name and text message to a downstream procedure (KBU00008) along with a static status level of 1, which ensures the message is written.
Inputs: P#PGM (CHAR(8)); P#TXT (CHAR(*) VARYING)
Outputs: System print file (via KBU00008)
- The procedure calls KBU00008 with the input program name, input text, and a static status level of 1. (lines 13; fields P#PGM, P#TXT, L#STUFE; values 1)
- The status level L#STUFE is statically initialized to 1, which prevents the downstream procedure from acting as a no-op (which occurs if status is zero). (lines 12; fields L#STUFE; values 1)
Calls as written:
- line 13: CALL KBU00008(P#PGM, P#TXT, L#STUFE); END KBU00007;

## KBU00011 in KBU00011, lines 8-25
Runs in: job KBJ00001 STEP010, job KBJ00001 STEP020, job KBJ00001 STEP030, job KBJ00003 STEP010
This procedure handles error reporting by logging a formatted error message with the program name, severity level, and description. It updates a global return code to the highest severity encountered and terminates the program if the severity level is 16 or higher.
Inputs: F#PGM (CHAR(8)); F#STUFE (FIXED BIN(31)); F#TXT (CHAR(*) VARYING)
Outputs: W_RC (FIXED BIN(31) EXTERNAL); Log entry via KBU00007
- Formats the severity level F#STUFE into a 4-character string F#Z using PIC 'ZZZ9' (zero-suppressed, right-justified). (lines 16; fields F#Z, F#STUFE; values 'ZZZ9')
- Logs an error message constructed as '*** FEHLER ' concatenated with the formatted severity F#Z, a colon, a space, and the error text F#TXT, using the program name F#PGM. (lines 17; fields F#PGM, F#Z, F#TXT; values '*** FEHLER ', ': ')
- Updates the external variable W_RC to the value of F#STUFE if F#STUFE is strictly greater than the current value of W_RC. (lines 18; fields F#STUFE, W_RC)
- If F#STUFE is greater than or equal to 16, logs the message '*** ABBRUCH' with the program name F#PGM. (lines 19, 21; fields F#STUFE, F#PGM; values 16, '*** ABBRUCH')
- If F#STUFE is greater than or equal to 16, calls PLIRETC with the current value of W_RC to return the code to the operating system. (lines 19, 22; fields F#STUFE, W_RC; values 16)
- If F#STUFE is greater than or equal to 16, executes STOP to terminate the program. (lines 19, 23; fields F#STUFE; values 16)
Calls as written:
- line 17: CALL KBU00007(F#PGM, '*** FEHLER ' || F#Z || ': ' || F#TXT);
- line 21: CALL KBU00007(F#PGM, '*** ABBRUCH');
- line 22: call PLIRETC(W_RC);

## P#NUMU in KBU00021, lines 53-56
Runs in: job KBJ00001 STEP010, job KBJ00001 STEP020, job KBJ00001 STEP030, job KBJ00003 STEP010
Validates whether a given character string consists exclusively of numeric digits (0-9). Returns true if the string is purely numeric, false otherwise.
Inputs: N#F (CHAR(*) parameter)
Outputs: BIT(1) return value
- Checks if the input string N#F contains only characters found in the set '0123456789'. If VERIFY returns 0 (meaning no invalid characters found), the procedure returns 1 (true); otherwise it returns 0 (false). (lines 55; fields N#F, P#ZIFF; values 0, '0123456789')

## P#WARNUNG in KBU00021, lines 30-41
Runs in: job KBJ00001 STEP010, job KBJ00001 STEP020, job KBJ00001 STEP030, job KBJ00003 STEP010
This procedure logs a warning message to the system print file, including the source location, description, and key. It enforces a limit on the number of warnings per run; once the limit is reached, it logs a single suppression notice and ignores all subsequent calls.
Inputs: W#WO (CHAR(8)): Source location identifier; W#WAS (CHAR(*) VARYING): Warning description text; W#SCHL (CHAR(*)): Key or identifier for the record causing the warning; P#MAXW (STATIC): Maximum allowed warnings (initialized to 50); P#WARN (STATIC): Current warning counter (initialized to 0)
Outputs: System print file: Warning message or suppression notice via KBU00007; P#WARN (STATIC): Incremented warning counter
- Increment the static warning counter P#WARN by 1. If the new value exceeds P#MAXW, return immediately without logging. (lines 34; fields P#WARN, P#MAXW; values 1)
- If the warning counter P#WARN equals P#MAXW, log the message 'WEITERE WARNUNGEN UNTERDRUECKT' (Further warnings suppressed) to the print file and return. (lines 35, 37; fields P#WARN, P#MAXW, W#WO; values 'WEITERE WARNUNGEN UNTERDRUECKT')
- If the warning counter is less than P#MAXW, log the message 'WARNUNG ' concatenated with W#WAS, ' SATZ ', and W#SCHL to the print file. (lines 40; fields W#WO, W#WAS, W#SCHL; values 'WARNUNG ', ' SATZ ')
Calls as written:
- line 37: call KBU00007(W#WO, 'WEITERE WARNUNGEN UNTERDRUECKT');
- line 40: CALL KBU00007(W#WO, 'WARNUNG ' || W#WAS || ' SATZ ' || W#SCHL);

## P#NUMS in KBU00021, lines 46-51
Runs in: job KBJ00001 STEP010, job KBJ00001 STEP020, job KBJ00001 STEP030, job KBJ00003 STEP010
Determines if a character string represents a signed numeric value. It validates that the string has a sign prefix and consists entirely of digits after the sign.
Inputs: N#F (CHAR(*))
Outputs: BIT(1) return value ('1'B for true, '0'B for false)
- If the length of the input string is less than 2, return false ('0'B). (lines 48; fields N#F; values 2, '0'B)
- If the first character of the input string is not found in the sign set ('+' or '-'), return false ('0'B). (lines 49; fields N#F, P#VORZ; values 1, 1, 0, '0'B)
- If any character in the substring starting from position 2 is not a digit (0-9), return false ('0'B). (lines 50; fields N#F, P#ZIFF; values 2, 0, '0'B)
- If all previous checks pass, return true ('1'B). (lines 50; values '1'B)

## KBU00025 in KBU00021, lines 59-71
Runs in: job KBJ00001 STEP010, job KBJ00001 STEP020, job KBJ00001 STEP030, job KBJ00003 STEP010
Validates a date string in YYYYMMDD format to ensure it represents a plausible calendar date. It checks that the input is purely numeric, the year is between 1900 and 2099, the month is between 1 and 12, and the day does not exceed the maximum days for that specific month. It does not validate leap years for February.
Inputs: D#DT (CHAR(8))
Outputs: Return value (BIT(1)): '1'B if valid, '0'B if invalid
- The input string must consist exclusively of numeric digits (0-9). If it contains any non-numeric character, the procedure returns '0'B. (lines 62; fields D#DT; values '0'B)
- The year (first 4 characters) must be greater than or equal to 1900 and less than or equal to 2099. If outside this range, the procedure returns '0'B. (lines 63, 66; fields D#J; values 1900, 2099, '0'B)
- The month (characters 5-6) must be greater than or equal to 1 and less than or equal to 12. If outside this range, the procedure returns '0'B. (lines 64, 67; fields D#M; values 1, 12, '0'B)
- The day (characters 7-8) must be greater than or equal to 1 and less than or equal to the maximum days for the given month (defined in P#TMON). If outside this range, the procedure returns '0'B. (lines 65, 68; fields D#T, P#TMON; values 1, '0'B)
- If all previous checks pass, the procedure returns '1'B indicating a valid date. Note: It does not check for leap years, so 29.02 in non-leap years is considered valid. (lines 70; values '1'B)
Calls as written:
- line 62: IF ^P#NUMU(D#DT) THEN RETURN('0'B);

## KBU00022 in KBU00021, lines 76-109
Runs in: job KBJ00001 STEP010, job KBJ00001 STEP020, job KBJ00001 STEP030, job KBJ00003 STEP010
Validates the structural integrity of a single customer account record (Kontosatz) by checking specific field positions for correct data types (numeric, signed numeric, date, or status code). It returns a count of validation errors found and logs a warning for each invalid field.
Inputs: K#S (CHAR(140)): The raw customer account record string containing all fields.
Outputs: Return value (FIXED BIN(15)): The total count of validation errors detected.; Log file: Warning messages via P#WARNUNG for each specific field failure.
- Extracts the first 11 characters as the Account Number (KTO-NR) for use in warning messages. (lines 80; fields K#NR, K#S; values 1, 11)
- Validates that the Account Number (positions 1-11) consists exclusively of numeric digits. If not, increments error count and logs warning 'KTO-NR'. (lines 81, 82; fields K#NR, K#F; values 'KBU00022', 'KTO-NR')
- Validates that the Status Code (position 12) is one of 'A', 'D', 'C', or 'X'. If not, increments error count and logs warning 'STATUS'. (lines 83, 84; fields K#S, K#F; values 'ADCX', 12, 1, 'KBU00022', 'STATUS')
- Validates that the Balance (SALDO, positions 13-23) is a signed numeric value. If not, increments error count and logs warning 'SALDO'. (lines 85, 86; fields K#S, K#F; values 13, 11, 'KBU00022', 'SALDO')
- Validates that the Credit Limit (KREDITLIM, positions 24-33) consists exclusively of numeric digits. If not, increments error count and logs warning 'KREDITLIM'. (lines 87, 88; fields K#S, K#F; values 24, 10, 'KBU00022', 'KREDITLIM')
- Validates that the Cash Limit (BARLIM, positions 34-43) consists exclusively of numeric digits. If not, increments error count and logs warning 'BARLIM'. (lines 90, 91; fields K#S, K#F; values 34, 10, 'KBU00022', 'BARLIM')
- Validates that the Creation Date (ERDT, positions 44-51) is a plausible calendar date in YYYYMMDD format. If not, increments error count and logs warning 'ERDT'. (lines 92, 93; fields K#S, K#F; values 44, 8, 'KBU00022', 'ERDT')
- Validates that the Deletion Date (ABDT, positions 52-59) is a plausible calendar date in YYYYMMDD format. If not, increments error count and logs warning 'ABDT'. (lines 94, 95; fields K#S, K#F; values 52, 8, 'KBU00022', 'ABDT')
- Validates that the Cycle Credit (ZYK-HAB, positions 60-70) is a signed numeric value. If not, increments error count and logs warning 'ZYK-HAB'. (lines 96, 97; fields K#S, K#F; values 60, 11, 'KBU00022', 'ZYK-HAB')
- Validates that the Cycle Debit (ZYK-SOL, positions 71-81) is a signed numeric value. If not, increments error count and logs warning 'ZYK-SOL'. (lines 98, 99; fields K#S, K#F; values 71, 11, 'KBU00022', 'ZYK-SOL')
- Validates that the Dunning Status (MAHNST, positions 92-93) consists exclusively of numeric digits. If not, increments error count and logs warning 'MAHNST'. (lines 100, 101; fields K#S, K#F; values 92, 2, 'KBU00022', 'MAHNST')
- Validates that the Minimum Amount (MINZ, positions 94-104) is a signed numeric value. If not, increments error count and logs warning 'MINZ'. (lines 102, 103; fields K#S, K#F; values 94, 11, 'KBU00022', 'MINZ')
- Validates that the Payment Amount (ZAHL, positions 105-115) is a signed numeric value. If not, increments error count and logs warning 'ZAHL'. (lines 104, 105; fields K#S, K#F; values 105, 11, 'KBU00022', 'ZAHL')
- Validates that the Points (PUNKTE, positions 116-124) consist exclusively of numeric digits. If not, increments error count and logs warning 'PUNKTE'. (lines 106, 107; fields K#S, K#F; values 116, 9, 'KBU00022', 'PUNKTE')
- Returns the total count of validation errors accumulated in K#F. (lines 108; fields K#F)
Calls as written:
- line 81: IF ^P#NUMU(K#NR) THEN DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','KTO-NR',K#NR); END;
- line 82: DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','KTO-NR',K#NR); END;
- line 84: DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','STATUS',K#NR); END;
- line 85: IF ^P#NUMS(SUBSTR(K#S,13,11)) THEN DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','SALDO',K#NR); END;
- line 86: DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','SALDO',K#NR); END;
- line 87: if ^P#NUMU(SUBSTR(K#S,24,10)) then DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','KREDITLIM',K#NR); END;
- line 88: DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','KREDITLIM',K#NR);
- line 90: IF ^P#NUMU(SUBSTR(K#S,34,10)) THEN DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','BARLIM',K#NR); END;
- line 91: DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','BARLIM',K#NR); END;
- line 92: IF ^KBU00025(SUBSTR(K#S,44,8)) THEN DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','ERDT',K#NR); END;
- line 93: DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','ERDT',K#NR); END;
- line 94: if ^KBU00025(SUBSTR(K#S,52,8)) then DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','ABDT',K#NR); END;
- line 95: DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','ABDT',K#NR); END;
- line 96: IF ^P#NUMS(SUBSTR(K#S,60,11)) THEN DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','ZYK-HAB',K#NR); END;
- line 97: DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','ZYK-HAB',K#NR); END;
- line 98: IF ^P#NUMS(SUBSTR(K#S,71,11)) THEN DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','ZYK-SOL',K#NR); END;
- line 99: DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','ZYK-SOL',K#NR); END;
- line 100: IF ^P#NUMU(SUBSTR(K#S,92,2)) THEN do; K#F = K#F + 1; call P#WARNUNG('KBU00022','MAHNST',K#NR); END;
- line 101: do; K#F = K#F + 1; call P#WARNUNG('KBU00022','MAHNST',K#NR); END;
- line 102: IF ^P#NUMS(SUBSTR(K#S,94,11)) THEN DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','MINZ',K#NR); END;
- line 103: DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','MINZ',K#NR); END;
- line 104: IF ^P#NUMS(SUBSTR(K#S,105,11)) THEN DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','ZAHL',K#NR); end;
- line 105: DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','ZAHL',K#NR); end;
- line 106: IF ^P#NUMU(SUBSTR(K#S,116,9)) THEN DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','PUNKTE',K#NR); END;
- line 107: DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','PUNKTE',K#NR); END;

## KBU00012 in KBU00012, lines 15-76
Runs in: job KBJ00001 STEP010, job KBJ00001 STEP020, job KBJ00001 STEP030, job KBJ00003 STEP010
Loads all account records from the ACCTFILE into an in-memory table, validating each record's structure. If any validation errors are found, the process aborts. Otherwise, it writes the loaded records to ACCTOUT in their original file order, preserving the sequence for downstream jobs.
Inputs: ACCTFILE (input file, 140-char records); KBU00022 (external validation routine)
Outputs: ACCTOUT (output file, 140-char records); KTAB_ANZ (global counter of loaded records); KTAB_SATZ (global array of loaded records)
- The in-memory table has a maximum capacity defined by the upper bound of the KTAB_SATZ array. If the number of loaded records (KTAB_ANZ) reaches or exceeds this bound before a new record is added, the system logs a 'KONTENTABELLE VOLL' error with severity 16 and terminates. (lines 37, 38; fields KTAB_ANZ, KTAB_SATZ; values 16, 'KONTENTABELLE VOLL')
- Each record read from ACCTFILE is validated by KBU00022. The return value (count of invalid fields) is accumulated into K@FEHL. If the total K@FEHL is greater than 0 after all records are processed, the procedure logs the count of 'UNPLAUSIBLE FELDER' and returns without writing to ACCTOUT. (lines 41, 46, 49, 50; fields K@FEHL, K@SATZ; values 0, 'UNPLAUSIBLE FELDER: ')
- Records are written to ACCTOUT in the exact order they were read from ACCTFILE (1 to KTAB_ANZ). No sorting is performed, as downstream jobs rely on this specific sequence. (lines 69, 70; fields KTAB_SATZ, KTAB_ANZ)
- The search entry point KBU00013 performs a linear scan of the in-memory table. It compares the first 11 characters of each stored record (KTAB_SATZ) against the input account number (K@NR). It returns the index of the first match or 0 if not found. (lines 53, 57, 58, 60; fields KTAB_SATZ, K@NR, K@IX; values 11, 0)
Calls as written:
- line 38: call KBU00011('KBU00012', 16, 'KONTENTABELLE VOLL');
- line 41: K@FEHL = K@FEHL + KBU00022(K@SATZ);
- line 45: CALL KBU00007('KBU00012', 'KONTEN GELADEN: ' || K@Z);
- line 49: CALL KBU00007('KBU00012', 'UNPLAUSIBLE FELDER: ' || K@Z);
- line 74: CALL KBU00007('KBU00014', 'KONTEN GESCHRIEBEN: ' || K@Z);

## KBU00015 in KBU00015, lines 15-80
Runs in: job KBJ00001 STEP010, job KBJ00001 STEP020
This procedure aggregates balance amounts by account, type, and category from an input file into an in-memory sorted table. It then writes the resulting balances to an output file, maintaining a sorted order by key throughout the process.
Inputs: TCATFILE (Input file containing records TCA_SATZ with fields TCA_KTO, TCA_TYP, TCA_KAT, TCA_SLD); TC_KEY (In-memory array of keys, CHAR(17)); TC_SLD (In-memory array of balances, FIXED DEC(15,2)); TC_ANZ (Counter for number of entries in the in-memory table)
Outputs: TCATOUT (Output file containing records TCA_SATZ with aggregated balances); TC_KEY (Updated in-memory array of keys); TC_SLD (Updated in-memory array of balances); TC_ANZ (Updated counter for number of entries)
- The composite key for aggregation is formed by concatenating TCA_KTO (11 chars), TCA_TYP (2 chars), and TCA_KAT (4 chars) to create a 17-character string. (lines 32; fields TCA_KTO, TCA_TYP, TCA_KAT, T@SCHL)
- The in-memory table is searched linearly to find an existing key or the insertion point. If the key is found, the balance is added to the existing entry. (lines 41, 42, 51, 54; fields TC_KEY, T@SCHL, TC_SLD, T@BTR)
- If the key is not found, the insertion point is determined by finding the first key greater than the new key. If no greater key is found, it is appended to the end. (lines 41, 45, 47, 48; fields TC_KEY, T@SCHL, T@P)
- If the table is full (TC_ANZ >= HBOUND(TC_KEY,1)), an error is logged with severity 16 and the program terminates. (lines 56, 57; fields TC_ANZ, TC_KEY; values 16)
- When inserting a new key, existing entries from the insertion point to the end are shifted one position to the right to make space. (lines 58, 59, 60; fields TC_KEY, TC_SLD, TC_ANZ, T@P)
- The new key is inserted at the determined position, and its balance is initialized to 0 before adding the input amount. (lines 63, 64, 65; fields TC_KEY, TC_SLD, T@SCHL, T@BTR; values 0)
- The output record is constructed by splitting the 17-character key back into TCA_KTO (positions 1-11), TCA_TYP (positions 12-13), and TCA_KAT (positions 14-17). (lines 72, 73, 74; fields TC_KEY, TCA_KTO, TCA_TYP, TCA_KAT; values 1, 11, 12, 2, 14, 4)
- The aggregated balance from the in-memory table is written to the TCA_SLD field of the output record. (lines 75; fields TC_SLD, TCA_SLD)
Calls as written:
- line 32: CALL KBU00016(TCA_KTO || TCA_TYP || TCA_KAT, TCA_SLD);
- line 57: call KBU00011('KBU00016', 16, 'SALDENTABELLE VOLL');

## KBU00024 in KBU00021, lines 140-156
Runs in: job KBJ00001 STEP010
Validates the card number and account number fields within a card record string. It counts and logs warnings for any field that is not purely numeric, returning the total count of validation errors.
Inputs: X#S (CHAR(50) card record string)
Outputs: Return value (FIXED BIN(15) error count); Warning log entries via P#WARNUNG
- Checks if the first 16 characters of the input string (positions 1-16) are not purely numeric. If they are not numeric, increments the error counter and logs a warning with key 'KARTE' and the first 16 characters of the input. (lines 143, 144, 145, 146, 147; fields X#S, X#F; values 16, 1, 'KBU00024', 'KARTE')
- Checks if the 11 characters starting at position 26 (positions 26-36) are not purely numeric. If they are not numeric, increments the error counter and logs a warning with key 'KONTO' and the first 16 characters of the input. (lines 148, 149, 150, 151, 152; fields X#S, X#F; values 26, 11, 1, 16, 'KBU00024', 'KONTO')
- Returns the total count of validation errors found in the card number and account number fields. (lines 155; fields X#F)
Calls as written:
- line 143: IF ^P#NUMU(SUBSTR(X#S,1,16)) THEN DO; X#F = X#F + 1; CALL P#WARNUNG('KBU00024', 'KARTE', SUBSTR(X#S,1,16)); END;
- line 146: CALL P#WARNUNG('KBU00024', 'KARTE', SUBSTR(X#S,1,16));
- line 148: IF ^P#NUMU(SUBSTR(X#S,26,11)) THEN DO; X#F = X#F + 1; CALL P#WARNUNG('KBU00024', 'KONTO', SUBSTR(X#S,1,16)); END;
- line 151: CALL P#WARNUNG('KBU00024', 'KONTO', SUBSTR(X#S,1,16));

## XRF_LADEN in KBP00001, lines 374-385
Runs in: job KBJ00001 STEP010
Loads all card cross-reference records from the XREFFILE into in-memory arrays for subsequent processing. It counts records where the card or account number fields contain non-numeric characters, flagging them as 'free' or misused fields.
Inputs: XREFFILE (KB.PROD.XREFFILE); XRF_SATZ record (XRF_KARTE, XRF_KTO, XRF_ST)
Outputs: #XN (record count); #XK (array of card numbers); #XA (array of account numbers); #XS (array of status flags); Z_GESCHR (count of records with validation errors)
- Reads records from XREFFILE until end-of-file is reached. (lines 376, 377, 383; fields XRF_SATZ, SW_EOF_XRF)
- If the external validation routine KBU00024 returns a value greater than 0 (indicating non-numeric characters in card or account fields), the global counter Z_GESCHR is incremented by 1. (lines 378, 379; fields KBU00024, XRF_SATZ, Z_GESCHR; values 0, 1)
- For every record read, the local index #XN is incremented by 1, and the card number, account number, and status flag are stored in the respective arrays at that index. (lines 380, 381, 382; fields #XN, #XK, #XA, #XS, XRF_KARTE, XRF_KTO, XRF_ST; values 1)
Calls as written:
- line 378: IF KBU00024(STRING(XRF_SATZ)) > 0 THEN Z_GESCHR = Z_GESCHR + 1; /* FELD IST FREI, WIRD MISSBRAUCHT */

## S#KOPF in KBU00026, lines 85-94
Runs in: job KBJ00001 STEP010, job KBJ00001 STEP020
Generates the header for a printed ballot list report. It increments the page counter, prints a title line with program and date information, and prints a column header line for the transaction types (Booked, Rejected, Produced).
Inputs: S#KOPF_PGM; S#KOPF_DT; S#SEITE; S#TXT
Outputs: SYSPRINT; S#SEITE; S#ZL
- Increment the page counter by 1 before printing the header. (lines 86; fields S#SEITE; values 1)
- Print the report title line to SYSPRINT with specific column positions: 'KARTENBANK  ABSTIMMLISTE' at col 2, S#KOPF_PGM at col 40, 'LAUF' at col 52, S#KOPF_DT at col 53, 'SEITE' at col 70, and S#SEITE at col 70 (formatted as F(4)). (lines 87, 88, 89, 90; fields S#KOPF_PGM, S#KOPF_DT, S#SEITE; values 'KARTENBANK  ABSTIMMLISTE', 'LAUF', 'SEITE', COL(2), COL(40), COL(52), COL(70), F(4))
- Print the column header line to SYSPRINT with specific column positions: 'TYP' at col 2, S#TXT(1) at col 10, S#TXT(2) at col 43, and S#TXT(3) at col 76. (lines 91, 92, 93; fields S#TXT; values 'TYP', COL(2), COL(10), COL(43), COL(76))
- Set the line counter S#ZL to 4 after printing the header. (lines 93; fields S#ZL; values 4)

## KBU00026 in KBU00026, lines 16-96
Runs in: job KBJ00001 STEP010, job KBJ00001 STEP020
This procedure accumulates transaction counts and sums by type and status (Booked, Rejected, Produced) during batch processing. It then prints a summary report to the SYSPRINT file for reconciliation with the general ledger, which does not affect the main processing flow.
Inputs: S#PGM (CHAR(8)); S#DT (CHAR(8)); S#TYP (CHAR(2)); S#BTR (FIXED DEC(15,2)); S#ART (CHAR(1))
Outputs: SYSPRINT (PRINT FILE)
- Initialize 9 rows of the static table S#TAB. Each row's type code S#Z_TYP is set to the digit 1-9 (e.g., '1', '2', ..., '9') by concatenating '0' with the row index and translating '0' to space. All counts and sums are initialized to 0. (lines 42, 43, 44, 45, 46; fields S#Z_TYP, S#Z_ANZ, S#Z_SUM; values '0', ' ')
- In entry KBU00027, determine the column index S#J based on S#ART. If S#ART is 'G', S#J=1; if 'A', S#J=2; if 'E', S#J=3. If S#ART is not one of these, the procedure returns without updating the table. (lines 52, 53; fields S#J, S#ART; values 'GAE')
- In entry KBU00027, convert the character string S#TYP to an integer S#I. If conversion fails or the result is outside the range 1 to 9, S#I is set to 9 (the 'Other' or overflow bucket). (lines 54, 55, 56, 57, 58; fields S#I, S#TYP; values 1, 9)
- In entry KBU00027, increment the count S#Z_ANZ(S#I, S#J) by 1 and add the amount S#BTR to the sum S#Z_SUM(S#I, S#J). (lines 59, 60; fields S#Z_ANZ, S#Z_SUM, S#BTR; values 1)
- In entry KBU00028, skip printing a row if the total count for that type (sum of all three statuses) is 0. (lines 68; fields S#Z_ANZ; values 0)
- In entry KBU00028, print a new header if the line counter S#ZL exceeds 50. S#ZL is initialized to 99, so the first call to KBU00028 will always print a header. (lines 69, 33; fields S#ZL; values 50, 99)
- In entry KBU00028, print the row data to SYSPRINT. The format includes the type code, followed by three pairs of count and sum. The sum is formatted with a pattern 'ZZZ.ZZZ.ZZZ.ZZ9V,99-' and a negative sign indicator '99-'. (lines 70, 71, 72, 73; fields S#Z_TYP, S#Z_ANZ, S#Z_SUM; values 'ZZZ.ZZZ.ZZZ.ZZ9V,99-')
- In entry KBU00028, accumulate the total counts and sums for each status column (1, 2, 3) into S#GES_ANZ and S#GES_SUM. (lines 75, 76, 77; fields S#GES_ANZ, S#GES_SUM, S#Z_ANZ, S#Z_SUM)
- In entry KBU00028, print a 'SUMME' line with the accumulated totals for each status column. The format is the same as the data rows. (lines 79, 80, 81; fields S#GES_ANZ, S#GES_SUM; values 'SUMME', 'ZZZ.ZZZ.ZZZ.ZZ9V,99-')
Calls as written:
- line 66: CALL S#KOPF;
- line 69: IF S#ZL > 50 THEN CALL S#KOPF;

## KBU00023 in KBU00021, lines 114-135
Runs in: job KBJ00001 STEP010
Validates the structure and content of a single transaction record (UMSATZSATZ) by checking specific fields for numeric integrity, signed values, and valid dates. It returns a count of validation errors found in the record.
Inputs: U#S (CHAR(120)): The raw transaction record string containing ID, Type, Category, Amount, MCC, Card, and Date fields.
Outputs: Return value (FIXED BIN(15)): The total count of validation errors detected in the record.
- Extracts the first 16 characters as the ID. If the ID is empty, increments the error count and logs a warning 'ID LEER'. (lines 118, 119, 120; fields U#ID, U#S, U#F; values '')
- Checks characters 17-18 (Type). If not purely numeric (0-9), increments the error count and logs a warning 'TYP'. (lines 121, 122; fields U#S, U#F; values 17, 2)
- Checks characters 19-22 (Category). If not purely numeric (0-9), increments the error count and logs a warning 'KATEGORIE'. (lines 123, 124, 125; fields U#S, U#F; values 19, 4)
- Checks characters 63-73 (Amount). If not a signed numeric value (sign prefix followed by digits), increments the error count and logs a warning 'BETRAG'. (lines 126, 127; fields U#S, U#F; values 63, 11)
- Checks characters 83-86 (MCC). If not purely numeric (0-9), increments the error count and logs a warning 'MCC'. (lines 128, 129; fields U#S, U#F; values 83, 4)
- Checks characters 87-102 (Card). If not purely numeric (0-9), increments the error count and logs a warning 'KARTE'. (lines 130, 131; fields U#S, U#F; values 87, 16)
- Checks characters 103-110 (Date). If not a valid YYYYMMDD date (year 1900-2099, month 1-12, valid day for month), increments the error count and logs a warning 'DATUM'. (lines 132, 133; fields U#S, U#F; values 103, 8)
Calls as written:
- line 120: DO; U#F = U#F + 1; CALL P#WARNUNG('KBU00023','ID LEER',U#ID); END;
- line 121: IF ^P#NUMU(SUBSTR(U#S,17,2)) THEN do; U#F = U#F + 1; call P#WARNUNG('KBU00023','TYP',U#ID); END;
- line 122: do; U#F = U#F + 1; call P#WARNUNG('KBU00023','TYP',U#ID); END;
- line 123: IF ^P#NUMU(SUBSTR(U#S,19,4)) THEN DO; U#F = U#F + 1; CALL P#WARNUNG('KBU00023','KATEGORIE',U#ID); END;
- line 124: DO; U#F = U#F + 1; CALL P#WARNUNG('KBU00023','KATEGORIE',U#ID);
- line 126: IF ^P#NUMS(SUBSTR(U#S,63,11)) THEN DO; U#F = U#F + 1; CALL P#WARNUNG('KBU00023','BETRAG',U#ID); END;
- line 127: DO; U#F = U#F + 1; CALL P#WARNUNG('KBU00023','BETRAG',U#ID); END;
- line 128: IF ^P#NUMU(SUBSTR(U#S,83,4)) THEN do; U#F = U#F + 1; call P#WARNUNG('KBU00023','MCC',U#ID); END;
- line 129: do; U#F = U#F + 1; call P#WARNUNG('KBU00023','MCC',U#ID); END;
- line 130: if ^P#NUMU(SUBSTR(U#S,87,16)) then DO; U#F = U#F + 1; CALL P#WARNUNG('KBU00023','KARTE',U#ID); END;
- line 131: DO; U#F = U#F + 1; CALL P#WARNUNG('KBU00023','KARTE',U#ID); END;
- line 132: IF ^KBU00025(SUBSTR(U#S,103,8)) THEN DO; U#F = U#F + 1; CALL P#WARNUNG('KBU00023','DATUM',U#ID); end;
- line 133: DO; U#F = U#F + 1; CALL P#WARNUNG('KBU00023','DATUM',U#ID); end;

## KBU00009 in KBU00009, lines 7-31
Runs in: job KBJ00001 STEP010
Performs a linear search through a key table to find the index of a specific key. Returns the 1-based index if found, or 0 if not found. Includes a legacy entry point for 9-character keys that searches in reverse order.
Inputs: T#TAB: Array of CHAR(16) keys; T#ANZ: Number of elements in the table; T#KEY: CHAR(16) key to search for; T#TAB9: Array of CHAR(9) keys (for legacy entry); T#KEY9: CHAR(9) key to search for (for legacy entry)
Outputs: T#IX: Index of the found key (1-based) or 0 if not found
- Initialize result index to 0 to indicate 'not found' by default. (lines 16; fields T#IX; values 0)
- Iterate through the table from index 1 to T#ANZ inclusive. (lines 17; fields T#I, T#ANZ; values 1)
- Compare each table entry T#TAB(T#I) with the search key T#KEY for exact match. (lines 18; fields T#TAB, T#I, T#KEY)
- If a match is found, set T#IX to the current index T#I and exit the search immediately. (lines 19, 20; fields T#IX, T#I)
- Legacy entry KBU00010 initializes result index to 0. (lines 26; fields T#IX; values 0)
- Legacy entry KBU00010 iterates through the table in reverse order from T#ANZ down to 1. (lines 27; fields T#I, T#ANZ; values 1)
- Legacy entry KBU00010 compares each table entry T#TAB9(T#I) with the search key T#KEY9 for exact match. (lines 28; fields T#TAB9, T#I, T#KEY9)
- Legacy entry KBU00010 updates T#IX to the current index T#I on every match, resulting in the lowest index (first occurrence) being returned because it iterates backwards. (lines 28; fields T#IX, T#I)

## KBU00003 in KBU00001, lines 91-111
Runs in: job KBJ00001 STEP010
Compares two 8-character date strings (YYYYMMDD) by comparing their year, month, and day components individually. Returns 1 if the first date is later, -1 if earlier, and 0 if they are identical.
Inputs: P#A (CHAR(8)); P#B (CHAR(8))
Outputs: Return value (FIXED BIN(15)): 1, -1, or 0
- Initialize comparison result to 0. (lines 99; fields I#; values 0)
- If the year component of A (positions 1-4) is greater than the year component of B (positions 1-4), set result to 1. (lines 100; fields A#J, B#J, I#; values 1)
- If the year component of A (positions 1-4) is less than the year component of B (positions 1-4), set result to -1. (lines 101; fields A#J, B#J, I#; values -1)
- If years are equal, compare month components (positions 5-6). If A's month is greater than B's month, set result to 1. (lines 103; fields A#M, B#M, I#; values 1)
- If years are equal and A's month is less than B's month, set result to -1. (lines 104; fields A#M, B#M, I#; values -1)
- If years and months are equal, compare day components (positions 7-8). If A's day is greater than B's day, set result to 1. (lines 106; fields A#T, B#T, I#; values 1)
- If years and months are equal and A's day is less than B's day, set result to -1. (lines 107; fields A#T, B#T, I#; values -1)
- Return the comparison result. (lines 110; fields I#)
Not backed by the code, treat with care: rule 3: value -1 is not in the code of KBU00003 or the declarations it uses; rule 5: value -1 is not in the code of KBU00003 or the declarations it uses; rule 7: value -1 is not in the code of KBU00003 or the declarations it uses

## PRUEFEN in KBP00001, lines 224-274
Runs in: job KBJ00001 STEP010
Validates a credit card transaction by checking for duplicates, positive amounts, and allowed transaction types. It verifies the card is active, the account is open and not expired, and ensures the transaction does not violate cash or credit limits based on the account status and transaction type.
Inputs: @DOPP; W_BTR; TRN_TYP; W_KARTE; TRN_DT; TRN_MCC; @SOLL; KTO_SATZ (via KBU00013)
Outputs: R# (Return code)
- If the duplicate flag @DOPP is set, reject with code 110. (lines 227; fields @DOPP, R#; values 110)
- If the transaction amount W_BTR is less than or equal to 0, reject with code 109. (lines 229; fields W_BTR, R#; values 0, 109)
- If the transaction type TRN_TYP is '05' (GEB) or '06' (ZINS), reject with code 111 as these are internal only. (lines 233, 236; fields TRN_TYP, R#; values KO_TYP_GEB, KO_TYP_ZINS, 111)
- If the transaction type TRN_TYP is not one of '01' (KAUF), '02' (ZAHL), '03' (GUT), or '04' (BAR), reject with code 111. (lines 232, 240; fields TRN_TYP, R#; values KO_TYP_KAUF, KO_TYP_ZAHL, KO_TYP_GUT, KO_TYP_BAR, 111)
- If the card number W_KARTE is not found in the card table (KBU00009 returns 0), reject with code 100. (lines 243, 244; fields W_KARTE, R#; values 0, 100)
- If the card status #XS(@XI) is not 'Y', reject with code 101. (lines 246; fields #XS, R#; values 'Y', 101)
- If the account number W_KTONR is not found in the account table (KBU00013 returns 0), reject with code 102. (lines 249, 250; fields W_KTONR, R#; values 0, 102)
- If the account status KTO_ST is 'C' or 'X', reject with code 103. (lines 252, 253; fields KTO_ST, R#; values 'C', 'X', 103)
- If the transaction date TRN_DT is later than the card expiry date KTO_ABDT (KBU00003 returns > 0), reject with code 105. (lines 254, 255; fields TRN_DT, KTO_ABDT, R#; values 0, 105)
- If the transaction is a debit (@SOLL is true) and the account status KTO_ST is 'D', reject with code 104. (lines 256, 257; fields @SOLL, KTO_ST, R#; values 'D', 104)
- If the transaction type is '01' (KAUF) and the MCC TRN_MCC is '7995' (KO_MCC_SPERR), reject with code 108. (lines 258, 259; fields TRN_TYP, TRN_MCC, R#; values KO_TYP_KAUF, KO_MCC_SPERR, 108)
- If the transaction type is '04' (BAR) and the amount W_BTR exceeds the cash limit KTO_BLIM, reject with code 107. (lines 260, 261; fields TRN_TYP, W_BTR, KTO_BLIM, R#; values KO_TYP_BAR, 107)
- If the transaction is a debit (@SOLL is true), calculate the new balance as KTO_SLD + W_BTR. If this exceeds the credit limit KTO_KLIM, reject with code 106. (lines 262, 264, 265, 266, 267; fields @SOLL, KTO_SLD, W_BTR, KTO_KLIM, R#; values 106)
Calls as written:
- line 243: call KBU00009(#XK, #XN, W_KARTE, @XI);
- line 249: CALL KBU00013(W_KTONR, @KI);
- line 254: ELSE IF KBU00003(TRN_DT, KTO_ABDT) > 0 THEN R# = 105; else if @SOLL & KTO_ST = 'D' THEN R# = 104; ELSE IF TRN_TYP = KO_TYP_KAUF & TRN_MCC = KO_MCC_SPERR THEN R# = 108; ELSE IF TRN_TYP = KO_TYP_BAR & W_BTR > KTO_BLIM THEN R# = 107; else if @SOLL then DO; W_HV1 = KTO_SLD; W_HV1 = W_HV1 + W_BTR; IF W_HV1 > KTO_KLIM THEN R# = 106; END; END;

## ABWEISEN in KBP00001, lines 279-290
Runs in: job KBJ00001 STEP010
The procedure records a rejected transaction by writing a fixed-length record to the REJECTS file. It maps a numeric rejection code to a human-readable German text description and increments a global counter for rejected transactions.
Inputs: A#GRD (Rejection Code); TRN_ID (Transaction ID); KO_ABW_CD (Rejection Code Table); KO_ABW_TX (Rejection Text Table)
Outputs: REJECTS file (Record ABW_SATZ); Z_ABGEW (Rejected Transaction Counter)
- Initialize the rejection record text field to a question mark if no matching code is found. (lines 284; fields ABW_TXT; values '?')
- Copy the current transaction ID to the rejection record's transaction ID field. (lines 283; fields ABW_TRN, TRN_ID)
- Copy the input rejection code to the rejection record's code field. (lines 284; fields ABW_GRD, A#GRD)
- Iterate through the rejection code table (indices 1 to 12) to find a matching code. (lines 285, 287; fields KO_ABW, A#I)
- If the table code matches the input code, replace the rejection text with the corresponding table text. (lines 286; fields KO_ABW_CD, A#GRD, ABW_TXT, KO_ABW_TX)
- Write the constructed rejection record to the REJECTS file. (lines 288; fields ABW_SATZ)
- Increment the global rejected transaction counter by 1. (lines 289; fields Z_ABGEW; values 1)

## BUCHEN in KBP00001, lines 295-342
Runs in: job KBJ00001 STEP010
Posts a transaction to the account record by updating the balance and cycle totals based on whether it is a debit or credit. It adjusts the account's points balance according to the transaction type (purchase or credit) and MCC code, then writes a formatted transaction history record to the output file.
Inputs: KTO_SATZ (Account record: KTO_NR, KTO_SLD, KTO_ZYK_SOL, KTO_ZYK_HAB, KTO_ZYK_ZAHL, KTO_PKT); TRN_SATZ (Transaction record: TRN_TYP, TRN_KAT, TRN_MCC); W_BTR (Transaction amount); W_TSATZ (Transaction text); W_LAUFDT (Current date); @SOLL (Debit/Credit flag)
Outputs: KTO_SATZ (Updated: KTO_SLD, KTO_ZYK_SOL, KTO_ZYK_HAB, KTO_ZYK_ZAHL, KTO_PKT); TRANOUT (File: KB.PROD.TRANHIST, Record: BUC_SATZ); Z_GEBUCHT (Counter); W_TGSUM (Total amount accumulator)
- Constructs a 17-character key for external aggregation by concatenating Account Number, Transaction Type, and Transaction Category. (lines 301; fields B#SCHL, KTO_NR, TRN_TYP, TRN_KAT)
- If the transaction is a debit (@SOLL is true), adds the amount to the account balance (KTO_SLD) and the cycle debit total (KTO_ZYK_SOL). (lines 303, 305, 306; fields @SOLL, KTO_SLD, W_BTR, KTO_ZYK_SOL)
- If the transaction is a debit, calls external procedure KBU00016 with the constructed key and the positive amount. (lines 306; fields B#SCHL, W_BTR)
- If the transaction is a credit (@SOLL is false), subtracts the amount from the account balance (KTO_SLD) and adds it to the cycle credit total (KTO_ZYK_HAB). (lines 308, 310, 311; fields @SOLL, KTO_SLD, W_BTR, KTO_ZYK_HAB)
- If the transaction is a credit, calls external procedure KBU00016 with the constructed key and the negative amount (W_HV2 = -W_BTR). (lines 312, 313; fields B#SCHL, W_HV2, W_BTR)
- If the transaction is a credit and the type is 'Payment' (KO_TYP_ZAHL = '02'), adds the amount to the cycle payment total (KTO_ZYK_ZAHL). (lines 314, 315; fields TRN_TYP, KO_TYP_ZAHL, KTO_ZYK_ZAHL, W_BTR; values '02')
- Calculates the integer part of the transaction amount (B#EINH) by truncating W_BTR. (lines 318; fields B#EINH, W_BTR)
- If the transaction type is 'Purchase' (KO_TYP_KAUF = '01'), determines a points factor (B#FAKT) based on the MCC code: 2 if MCC is '5411' (Grocery), 3 if MCC is '5812' (Restaurants), otherwise 1. (lines 320, 321, 322, 323, 324; fields TRN_TYP, KO_TYP_KAUF, TRN_MCC, KO_MCC_LEBM, KO_MCC_REST, B#FAKT; values '01', '5411', '5812', 2, 3, 1)
- For 'Purchase' transactions, adds the product of the truncated amount and the points factor to the current points balance (KTO_PKT). (lines 326; fields B#PKT, B#EINH, B#FAKT, KTO_PKT)
- For 'Purchase' transactions, caps the new points balance at the maximum limit (KO_MAX_PKT = 999999999). (lines 327; fields B#PKT, KO_MAX_PKT; values 999999999)
- If the transaction type is 'Credit' (KO_TYP_GUT = '03'), subtracts the truncated amount from the current points balance. (lines 329, 331; fields TRN_TYP, KO_TYP_GUT, B#PKT, B#EINH; values '03')
- For 'Credit' transactions, ensures the points balance does not go below 0. (lines 331; fields B#PKT; values 0)
- Updates the account record's points field (KTO_PKT) with the calculated value (B#PKT). (lines 333; fields KTO_PKT, B#PKT)
- Populates the transaction history record (BUC_SATZ) with the first 110 characters of the transaction text, the account number, and the current date. (lines 335, 336, 337, 338; fields BUC_SATZ, W_TSATZ, KTO_NR, W_LAUFDT; values 110)
- Writes the populated BUC_SATZ record to the TRANOUT file. (lines 339; fields BUC_SATZ)
- Increments the global counter for booked transactions (Z_GEBUCHT) by 1. (lines 340; fields Z_GEBUCHT; values 1)
- Adds the transaction amount to the global total sum accumulator (W_TGSUM). (lines 341; fields W_TGSUM, W_BTR)
Calls as written:
- line 306: KTO_ZYK_SOL = KTO_ZYK_SOL + W_BTR; CALL KBU00016(B#SCHL, W_BTR);
- line 313: CALL KBU00016(B#SCHL, W_HV2);

## KBU00005 in KBU00004, lines 13-21
Runs in: job KBJ00001 STEP010, job KBJ00001 STEP020, job KBJ00001 STEP030
Rounds a financial amount to two decimal places using standard PL/I rounding rules. The procedure assumes the input is positive, as negative values are not expected in this context.
Inputs: B#IN (FIXED DEC(31,10))
Outputs: Return value (FIXED DEC(15,2))
- Rounds the input value B#IN to 2 decimal places using the PL/I ROUND function. (lines 19; fields B#IN, B#HLF; values 2)
- Assigns the rounded value to B#OUT and returns it. (lines 20; fields B#HLF, B#OUT)

## KBU00006 in KBU00004, lines 23-28
Runs in: job KBJ00001 STEP010, job KBJ00001 STEP030
Returns the larger of two fixed-point decimal values. If the first argument is greater than or equal to the second, it returns the first; otherwise, it returns the second.
Inputs: B#1 (FIXED DEC(15,2)); B#2 (FIXED DEC(15,2))
Outputs: Return value (FIXED DEC(15,2))
- If B#1 is greater than or equal to B#2, return B#1. (lines 25, 26; fields B#1, B#2)
- If B#1 is less than B#2, return B#2. (lines 27, 28; fields B#1, B#2)

## GEBUEHR in KBP00001, lines 345-369
Runs in: job KBJ00001 STEP010
Calculates the cash withdrawal fee based on the transaction amount and a fixed percentage, enforcing a minimum fee. It posts the fee to the customer's account balance and cycle settlement, logs the transaction details, and writes the record to the transaction history file.
Inputs: W_BTR (Transaction Amount); KO_GEB_BAR_PROZ (Fee Percentage, default 5.00); KO_GEB_BAR_MIN (Minimum Fee, default 10.00); KO_TYP_GEB (Fee Type Code, default '05'); KTO_NR (Account Number); TRN_ID (Original Transaction ID); W_KARTE (Card Number); W_LAUFDT (Current Date)
Outputs: KTO_SLD (Account Balance); KTO_ZYK_SOL (Cycle Settlement Balance); TRANOUT (Transaction History File); KBU00016 Aggregation Table (via call); KBU00027 Statistics (via call)
- Calculate the raw fee by multiplying the transaction amount (W_BTR) by the fee percentage (KO_GEB_BAR_PROZ) and dividing by 100. The result is rounded to 2 decimal places using standard PL/I rounding rules (KBU00005). (lines 346; fields W_HV3, W_BTR, KO_GEB_BAR_PROZ; values 100)
- Determine the final fee (W_GEB) by taking the maximum of the calculated raw fee (W_HV3) and the minimum fee constant (KO_GEB_BAR_MIN). If the calculated fee is less than the minimum, the minimum is used. (lines 347; fields W_GEB, W_HV3, KO_GEB_BAR_MIN)
- Increase the account balance (KTO_SLD) by the final fee amount (W_GEB). (lines 349; fields KTO_SLD, W_GEB)
- Increase the cycle settlement balance (KTO_ZYK_SOL) by the final fee amount (W_GEB). (lines 350; fields KTO_ZYK_SOL, W_GEB)
- Call KBU00016 to aggregate the fee amount into the balance table using the key composed of Account Number (KTO_NR), Fee Type (KO_TYP_GEB), and Category '0001'. (lines 351; fields KTO_NR, KO_TYP_GEB, W_GEB; values '0001')
- Construct the new Transaction ID (TRN_ID) by prefixing 'CF' to the original ID (TRN_ID) starting from its 3rd character. This effectively replaces the first two characters of the original ID with 'CF'. (lines 353, 355; fields W_ORGID, TRN_ID; values 'CF')
- Set the Transaction Type (TRN_TYP) to the fee type code (KO_TYP_GEB). (lines 356; fields TRN_TYP, KO_TYP_GEB)
- Set the Transaction Category (TRN_KAT) to '0001'. (lines 357; fields TRN_KAT; values '0001')
- Set the Transaction Source (TRN_QUELLE) to 'SYSTEM'. (lines 358; fields TRN_QUELLE; values 'SYSTEM')
- Set the Transaction Text (TRN_TXT) to 'BARGELDGEBUEHR'. (lines 359; fields TRN_TXT; values 'BARGELDGEBUEHR')
- Set the Transaction Amount (TRN_BTR) to the final fee amount (W_GEB). (lines 360; fields TRN_BTR, W_GEB)
- Set the Transaction Handle (TRN_HDL) to '000000000'. (lines 361; fields TRN_HDL; values '000000000')
- Set the Transaction MCC (TRN_MCC) to '0000'. (lines 362; fields TRN_MCC; values '0000')
- Set the Transaction Card Number (TRN_KARTE) to the input card number (W_KARTE). (lines 363; fields TRN_KARTE, W_KARTE)
- Set the Transaction Date (TRN_DT) to the current date (W_LAUFDT). (lines 364; fields TRN_DT, W_LAUFDT)
- Prepare the output record BUC_SATZ by copying the first 110 characters of the transaction record (TRN_SATZ) into BUC_TRN, setting BUC_KTO to the account number (KTO_NR), and BUC_DT to the current date (W_LAUFDT). (lines 366, 367; fields BUC_TRN, TRN_SATZ, BUC_KTO, KTO_NR, BUC_DT, W_LAUFDT; values 1, 110)
- Write the BUC_SATZ record to the TRANOUT file. (lines 368; fields BUC_SATZ)
- Call KBU00027 to update statistics for the fee type (KO_TYP_GEB) and amount (W_GEB) with status 'E' (likely 'Erledigt' or similar internal status). (lines 369; fields KO_TYP_GEB, W_GEB; values 'E')
Calls as written:
- line 346: W_HV3 = KBU00005(DIVIDE(W_BTR * KO_GEB_BAR_PROZ, 100, 31, 10));
- line 347: W_GEB = KBU00006(W_HV3, KO_GEB_BAR_MIN);
- line 351: CALL KBU00016(KTO_NR || KO_TYP_GEB || '0001', W_GEB);
- line 369: CALL KBU00027(KO_TYP_GEB, W_GEB, 'E'); END GEBUEHR;

## UMSATZ in KBP00001, lines 192-221
Runs in: job KBJ00001 STEP010
Processes a single credit card transaction by checking for duplicates, validating business rules, and posting the amount to the account. If the transaction is a cash withdrawal, it additionally calculates and posts a fee. The procedure updates the account record and writes a transaction history entry.
Inputs: TRN_SATZ (Transaction record containing TRN_ID, TRN_TYP, TRN_BTR, TRN_KARTE); #GS (Array of already seen transaction IDs); #GN (Count of seen transaction IDs); KTO_SATZ (Account record)
Outputs: KTO_SATZ (Updated account record with new balance and cycle totals); KTAB_SATZ (Transaction history record written to output file); @DOPP (Duplicate flag); @SOLL (Debit/Credit flag); @GRD (Rejection code)
- Checks if the transaction ID already exists in the seen transactions array. If found, sets duplicate flag to '1'B; otherwise, adds the ID to the array if capacity allows, else logs error 'ZU VIELE UMSAETZE' and terminates. (lines 196, 197, 198, 199, 200, 201, 202; fields TRN_ID, #GS, #GN, @DOPP; values '1'B, '0'B, 16, 'ZU VIELE UMSAETZE')
- Sets the debit/credit flag (@SOLL) to '1'B if transaction type is Purchase ('01') or Cash ('04'), otherwise sets it to '0'B. (lines 205, 206, 208; fields TRN_TYP, @SOLL; values '01', '04', '1'B, '0'B)
- Calls validation procedure PRUEFEN. If a rejection code (@GRD) is non-zero, records the rejection, logs it, and returns without posting. (lines 210, 211, 212, 213, 214, 215; fields @GRD, TRN_TYP, W_BTR; values 0, 'A')
- If validation passes, posts the transaction to the account (BUCHEN) and logs it as successful ('G'). (lines 217, 218; fields TRN_TYP, W_BTR; values 'G')
- If the transaction type is Cash ('04'), calculates and posts a cash withdrawal fee (GEBUEHR). (lines 219, 220; fields TRN_TYP; values '04')
- Writes the updated account record to the transaction history table (KTAB_SATZ). (lines 221; fields KTAB_SATZ, KTO_SATZ, @KI)
Calls as written:
- line 196: CALL KBU00009(#GS, #GN, TRN_ID, @GI);
- line 201: CALL KBU00011(W_PGM, 16, 'ZU VIELE UMSAETZE');
- line 210: @GRD = PRUEFEN();
- line 213: CALL ABWEISEN(@GRD);
- line 214: CALL KBU00027(TRN_TYP, W_BTR, 'A');
- line 217: CALL BUCHEN;
- line 218: CALL KBU00027(TRN_TYP, W_BTR, 'G');
- line 220: CALL GEBUEHR;

## KBP00001 in KBP00001, lines 39-387
Runs in: job KBJ00001 STEP010
This procedure performs the daily batch processing of credit card transactions. It reads the day's transaction file, validates each record against business rules (including duplicate detection and card status), and posts valid transactions to customer accounts while rejecting invalid ones. Finally, it updates account balances, category summaries, and transaction history files, returning a specific code if any rejections occurred.
Inputs: CTLCARD (Control Card containing Run Date); DALYTRAN (Daily Transactions File); XREFFILE (Card Cross-Reference File); ACCTFILE (Account Master File); TCATFILE (Category Summary File); P_PARM (Parameter string for TRACE and CHECKPOINT settings)
Outputs: ACCTOUT (Updated Account Master File); TCATOUT (Updated Category Summary File); TRANOUT (Booked Transaction History); REJECTS (Rejected Transactions with reasons); SYSPRINT (Log and Summary Report)
- If the parameter string contains 'TRACE', the test mode switch is enabled to log detailed transaction processing steps. (lines 119; fields P_PARM, SW_TEST; values 'TRACE', '1'B)
- If the parameter string contains 'CHKP=', the checkpoint interval is set to the 4-digit number following the equals sign; otherwise, it defaults to 1000. (lines 120, 121, 86; fields P_PARM, W_CHKP_N; values 'CHKP=', 1000)
- The run date is extracted from the first 8 characters of the control card. If it contains any non-numeric characters, the program aborts with return code 16. (lines 140, 141, 142; fields W_STEU, W_LAUFDT; values '0123456789', 16)
- A checkpoint log message is written every time the transaction counter reaches the defined checkpoint interval (default 1000), and the counter resets to 0. (lines 165, 166, 168, 169; fields W_CHKP_Z, W_CHKP_N; values 0)
- If any transactions were rejected (Z_ABGEW > 0) and the current return code is less than 4, the return code is set to 4 to indicate rejections occurred. (lines 184; fields Z_ABGEW, W_RC; values 0, 4)
Calls as written:
- line 126: CALL KBU00011(W_PGM, 16, 'ON ERROR, ONCODE ' || ONCODE());
- line 132: CALL KBU00007(W_PGM, 'START');
- line 142: CALL KBU00011(W_PGM, 16, 'LAUFDATUM UNGUELTIG: ' || W_LAUFDT);
- line 143: CALL KBU00007(W_PGM, 'LAUFDATUM ' || W_LDT_TT || '.' || W_LDT_MM || '.' || W_LDT_JJJJ);
- line 149: CALL KBU00012;
- line 150: CALL KBU00015; call XRF_LADEN;
- line 151: CALL KBU00026(W_PGM, W_LAUFDT);
- line 161: W_PLAUS = KBU00023(W_TSATZ);
- line 163: CALL KBU00007(W_PGM, 'TRACE ' || TRN_ID || ' ' || TRN_TYP);
- line 164: CALL UMSATZ;
- line 168: CALL KBU00007(W_PGM, 'KONTROLLPUNKT ' || W_ZTXT);
- line 177: CALL KBU00014;
- line 178: CALL KBU00017;
- line 179: CALL KBU00028;
- line 181: W_ZTXT = Z_GELESEN; CALL KBU00007(W_PGM, 'GELESEN ' || W_ZTXT);
- line 182: W_ZTXT = Z_GEBUCHT; CALL KBU00007(W_PGM, 'GEBUCHT ' || W_ZTXT);
- line 183: W_ZTXT = Z_ABGEW; CALL KBU00007(W_PGM, 'ABGEWIESEN ' || W_ZTXT);
- line 185: CALL KBU00007(W_PGM, 'ENDE');
- line 186: CALL PLIRETC(W_RC);

## KBU00018 in KBU00018, lines 8-36
Runs in: job KBJ00001 STEP020, job KBJ00001 STEP030, job KBJ00003 STEP010
Loads the customer master file into an in-memory array for fast lookup. It constructs a full name field by concatenating first and last names with a single space. Provides a search entry point to find a customer index by their number.
Inputs: CUSTFILE (KDS_SATZ record: KDS_NR, KDS_VORN, KDS_NACHN, KDS_FICO)
Outputs: KD_TAB (KD_ANZ, KD_NR, KD_NAME, KD_FICO)
- Initializes the customer count to 0 before loading. (lines 17; fields KD_ANZ; values 0)
- Sets an end-of-file flag when the file read reaches the end. (lines 17; fields C@EOF; values '1'B)
- Continues reading records until the end-of-file flag is set. (lines 20; fields C@EOF; values '0'B)
- Checks if the in-memory array is full before adding a new record; if full, calls error procedure KBU00011 with severity 16 and message 'KUNDENTABELLE VOLL'. (lines 21, 22; fields KD_ANZ, KD_NR; values 16, 'KUNDENTABELLE VOLL')
- Increments the customer count if the array is not full. (lines 23; fields KD_ANZ)
- Stores the customer number from the file record into the array. (lines 24; fields KD_NR, KDS_NR)
- Constructs the full name by trimming the first name, adding a single space, and appending the trimmed last name. (lines 25; fields KD_NAME, KDS_VORN, KDS_NACHN; values ' ')
- Stores the FICO score (bonitaet) from the file record into the array. (lines 26; fields KD_FICO, KDS_FICO)
- Searches the in-memory array for a matching customer number; returns the 1-based index if found, or 0 if not found. (lines 32, 33, 34, 35; fields C@IX, C@I, KD_ANZ, KD_NR, C@NR; values 0)
Calls as written:
- line 22: CALL KBU00011('KBU00018', 16, 'KUNDENTABELLE VOLL');

## ZS_LADEN in KBP00002, lines 193-204
Runs in: job KBJ00001 STEP020
Loads all discount group interest rate definitions from the DISCGRP file into in-memory arrays for subsequent calculation use. It constructs a composite key from group, type, and category fields and stores the corresponding annual interest rate.
Inputs: DISCGRP file (DSN=KB.PROD.DISCGRP); DSC_SATZ record (DSC_GRP, DSC_TYP, DSC_KAT, DSC_ZINS)
Outputs: ZS_N (counter); ZS_SCHL array (composite keys); ZS_P array (interest rates)
- Sets end-of-file flag SW_EOF_DSC to '1'B when the DISCGRP file is exhausted. (lines 194; fields SW_EOF_DSC; values '1'B)
- Increments the index ZS_N by 1 for each record read. (lines 198; fields ZS_N; values 1)
- Constructs the composite key ZS_SCHL by concatenating DSC_GRP, DSC_TYP, and DSC_KAT. (lines 199; fields ZS_SCHL, DSC_GRP, DSC_TYP, DSC_KAT)
- Stores the annual interest rate DSC_ZINS into the ZS_P array at the current index. (lines 200; fields ZS_P, DSC_ZINS)

## ZINSSATZ in KBP00002, lines 153-169
Runs in: job KBJ00001 STEP020
Retrieves the interest rate for a specific group and transaction code from a lookup table. If a specific group code is not found, it falls back to a default group code to find the rate.
Inputs: Z#GRP (CHAR(10)); Z#TK (CHAR(6)); ZS_SCHL (CHAR(16)); ZS_P (FIXED DEC(5,2)); ZS_N (FIXED BIN(31)); $GRP_DEF (CHAR(10))
Outputs: $P (FIXED DEC(5,2)); $GEF (BIT(1))
- Initialize the found flag $GEF to 0 (false) and the rate $P to 0. (lines 156, 157; fields $GEF, $P; values '0'B, 0)
- Iterate through the lookup table ZS from index 1 to ZS_N. If the concatenated parameter Z#GRP and Z#TK matches the key ZS_SCHL, set $P to the corresponding ZS_P, set $GEF to 1 (true), and exit the loop. (lines 158, 159, 160; fields K, ZS_N, ZS_SCHL, Z#GRP, Z#TK, $P, ZS_P, $GEF; values 1, '1'B)
- If a specific match was found ($GEF is true), return immediately without checking the default. (lines 163; fields $GEF)
- If no specific match was found, iterate through the lookup table ZS again. If the concatenated default group $GRP_DEF and parameter Z#TK matches the key ZS_SCHL, set $P to the corresponding ZS_P and exit the loop. (lines 164, 165, 166; fields K, ZS_N, ZS_SCHL, $GRP_DEF, Z#TK, $P, ZS_P; values 1)

## BELASTEN in KBP00002, lines 174-190
Runs in: job KBJ00001 STEP020
The procedure debits a specified amount from the account balance and the cycle balance. It constructs a transaction record with a generated ID and writes it to the transaction output file, while also updating internal counters for reporting.
Inputs: B#PFX (CHAR(2)); B#TYP (CHAR(2)); B#KAT (CHAR(4)); B#TXT (CHAR(30)); B#BTR (FIXED DEC(15,2)); KTO_NR (CHAR(11)); W_LAUFDT (CHAR(8))
Outputs: KTO_SLD (PIC 'S99999999V99'); KTO_ZYK_SOL (PIC 'S99999999V99'); TRANOUT file (record BUC_SATZ); KBU00027 counters (via call)
- The account balance (KTO_SLD) is increased by the transaction amount (B#BTR). (lines 177; fields KTO_SLD, B#BTR)
- The cycle balance (KTO_ZYK_SOL) is increased by the transaction amount (B#BTR). (lines 178; fields KTO_ZYK_SOL, B#BTR)
- The transaction ID (TRN_ID) is constructed by concatenating the prefix (B#PFX), the account number (KTO_NR), and the literal string '000'. (lines 180; fields TRN_ID, B#PFX, KTO_NR; values '000')
- The transaction source (TRN_QUELLE) is set to the literal string 'ZINSLAUF'. (lines 181; fields TRN_QUELLE; values 'ZINSLAUF')
- The transaction handler (TRN_HDL) is set to the literal string '000000000'. (lines 182; fields TRN_HDL; values '000000000')
- The transaction MCC code (TRN_MCC) is set to the literal string '0000'. (lines 183; fields TRN_MCC; values '0000')
- The transaction card number (TRN_KARTE) is set to an empty string. (lines 183; fields TRN_KARTE; values '')
- The transaction date (TRN_DT) is set to the current run date (W_LAUFDT). (lines 183; fields TRN_DT, W_LAUFDT)
- The booking record (BUC_SATZ) is initialized to an empty string. (lines 184; fields BUC_SATZ; values '')
- The booking transaction field (BUC_TRN) is populated with the first 110 characters of the transaction record (TRN_SATZ). (lines 185; fields BUC_TRN, TRN_SATZ; values 1, 110)
- The booking account number (BUC_KTO) is set to the account number (KTO_NR). (lines 186; fields BUC_KTO, KTO_NR)
- The booking date (BUC_DT) is set to the current run date (W_LAUFDT). (lines 187; fields BUC_DT, W_LAUFDT)
- The booking record (BUC_SATZ) is written to the TRANOUT file. (lines 188; fields BUC_SATZ)
- The procedure KBU00027 is called with the transaction type (B#TYP), amount (B#BTR), and the literal status 'E'. (lines 189; fields B#TYP, B#BTR; values 'E')
Calls as written:
- line 189: call KBU00027(B#TYP, B#BTR, 'E');

## KBP00002 in KBP00002, lines 17-206
Runs in: job KBJ00001 STEP020
This procedure processes the end-of-cycle billing for credit accounts. It calculates and charges interest based on category balances, applies dunning fees and overdraft fees based on payment behavior and limits, and updates the account status (Active, Delinquent, Written-off) accordingly.
Inputs: CTLCARD (Control card containing run date); ACCTFILE (Account master records); TCATFILE (Transaction category balances); DISCGRP (Discount group interest rates); CUSTFILE (Customer master data)
Outputs: ACCTOUT (Updated account master records); TRANOUT (Transaction records for interest, dunning, and overdraft fees)
- Accounts with status 'X' (Written-off) are skipped and not processed for fees or status changes. (lines 85; fields KTO_ST; values 'X')
- Interest is calculated only for transaction categories where the balance (TC_SLD) is greater than 0 and the category type is not '02' (Payment). (lines 92, 93, 94; fields TC_SLD, TC_KEY, KO_TYP_ZAHL; values 0, '02')
- If the account group is 'AKTION2010' and the run date is between '20100101' and '20111231', the interest rate is set to 0. (lines 97, 98, 99; fields KTO_GRP, W_LAUFDT, $AKT_GRP, $AKT_VON, $AKT_BIS; values 'AKTION2010', '20100101', '20111231', 0)
- If the account status is 'D' (Delinquent), a surcharge of 3.00 is added to the interest rate. (lines 101; fields KTO_ST, KO_AUFS_VERZ; values 'D', 3.00)
- If the customer has a FICO score less than 600, a surcharge of 2.00 is added to the interest rate. (lines 102, 103, 104; fields $KD, KD_FICO, KO_FICO_GRENZE, KO_AUFS_FICO; values 600, 2.00)
- Interest amount is calculated as (Balance * Rate) / 1200, rounded to 2 decimal places. (lines 106; fields TC_SLD, $P; values 1200)
- Interest is charged only if the total calculated interest is greater than or equal to 1.00. (lines 111, 112; fields $SUM, KO_ZINS_FREI; values 1.00)
- Dunning fees are only processed for accounts with status 'A' (Active) or 'D' (Delinquent). (lines 115; fields KTO_ST; values 'A', 'D')
- A dunning fee is charged if the minimum payment (KTO_MINZ) is greater than 0 and the cycle payment (KTO_ZYK_ZAHL) is less than the minimum payment. (lines 116, 117; fields KTO_MINZ, KTO_ZYK_ZAHL; values 0)
- The dunning fee amount is 35.00 if the dunning counter (KTO_MAHN) is greater than 0, otherwise 25.00. (lines 119, 120; fields $MAHN, KO_MAHN_2, KO_MAHN_1; values 0, 35.00, 25.00)
- The dunning counter is incremented by 1 after a fee is charged, capped at a maximum of 99. (lines 121, 122, 123; fields $MAHN, KTO_MAHN; values 1, 99)
- If the cycle payment is not less than the minimum payment (or minimum is 0), the dunning counter is reset to 0. (lines 126; fields KTO_MAHN; values 0)
- An overdraft fee of 29.00 is charged if the account balance (KTO_SLD) exceeds the credit limit (KTO_KLIM). (lines 127, 128, 129; fields KTO_SLD, KTO_KLIM, KO_UEBZ; values 29.00)
- Account status changes from 'A' to 'D' if the dunning counter is greater than or equal to 2. (lines 134; fields KTO_ST, KTO_MAHN, KO_VERZ_AB; values 'A', 'D', 2)
- Account status changes from 'D' to 'X' if the dunning counter is greater than or equal to 6. (lines 135; fields KTO_ST, KTO_MAHN, KO_ABSCHR_AB; values 'D', 'X', 6)
- Account status changes from 'D' to 'A' if the dunning counter is 0. (lines 136; fields KTO_ST, KTO_MAHN; values 'D', 'A', 0)
Calls as written:
- line 67: CALL KBU00011(W_PGM, 16, 'ON ERROR ' || ONCODE());
- line 75: CALL KBU00012;
- line 76: call KBU00015;
- line 77: CALL KBU00018;
- line 78: CALL ZS_LADEN;
- line 79: CALL KBU00026(W_PGM, W_LAUFDT);
- line 87: CALL KBU00019(KTO_KDNR, $KD);
- line 96: CALL ZINSSATZ(KTO_GRP, SUBSTR(TC_KEY(J),12,6));
- line 106: $ZW = KBU00005(DIVIDE(TC_SLD(J) * $P, 1200, 31, 10));
- line 112: CALL BELASTEN('ZI', KO_TYP_ZINS, '0001', 'SOLLZINSEN', $SUM);
- line 124: CALL BELASTEN('MG', KO_TYP_GEB, '0002', 'MAHNGEBUEHR', $ZW);
- line 128: CALL BELASTEN('UL', KO_TYP_GEB, '0003', 'UEBERZIEHUNGSGEBUEHR', KO_UEBZ);
- line 145: call KBU00014;
- line 146: CALL KBU00028;
- line 147: CALL KBU00007(W_PGM, 'ENDE');
- line 148: CALL PLIRETC(W_RC);

## KBU0SJ in KBU00001, lines 29-37
Runs in: job KBJ00001 STEP030, job KBJ00003 STEP010
Determines whether a given year is a leap year based on the Gregorian calendar rules. Returns a binary flag indicating true for leap years and false for common years.
Inputs: J# (year number)
Outputs: BIT(1) return value ('1'B for leap year, '0'B for common year)
- If the year is divisible by 400, it is a leap year. (lines 31; fields J#; values 400, '1'B)
- If the year is divisible by 100 but not by 400, it is not a leap year. (lines 33; fields J#; values 100, '0'B)
- If the year is divisible by 4 but not by 100, it is a leap year. (lines 35; fields J#; values 4, '1'B)
- If the year is not divisible by 4, it is not a leap year. (lines 36; fields J#; values '0'B)

## KBU0TM in KBU00001, lines 42-49
Runs in: job KBJ00001 STEP030, job KBJ00003 STEP010
Calculates the number of days in a specific month for a given year. It retrieves the standard day count for the month and increments it by one if the month is February and the year is a leap year.
Inputs: J# (Year); M# (Month)
Outputs: Return value (Number of days in the month)
- Retrieve the standard number of days for the month M# from the static array TG#MON. (lines 45; fields R#, TG#MON, M#)
- If the month M# is 2 (February), check if the year J# is a leap year using KBU0SJ. If it is a leap year, add 1 to the day count R#. (lines 46, 47; fields M#, J#, R#; values 2, 1)
Calls as written:
- line 47: if KBU0SJ(J#) then R# = R# + 1;

## KBU00002 in KBU00001, lines 54-85
Runs in: job KBJ00001 STEP030, job KBJ00003 STEP010
Calculates a new date by adding a specified number of days to a given start date. It handles month and year rollovers, including leap years, and returns the result as an 8-character numeric string. If the day count is negative, it returns the original date unchanged.
Inputs: P#DT (CHAR(8)): Start date in YYYYMMDD format; P#TG (FIXED BIN(31)): Number of days to add
Outputs: Return value (CHAR(8)): Resulting date in YYYYMMDD format
- If the number of days to add (P#TG) is less than 0, the procedure immediately returns the original input date (P#DT) without modification. (lines 66, 68; fields P#TG, P#DT; values 0)
- The procedure iterates P#TG times, incrementing the day component (W#TT) by 1 in each iteration. (lines 71, 72; fields P#TG, W#TT; values 1)
- If the incremented day (W#TT) exceeds the number of days in the current month (determined by calling procedure KBU0TM with the current year W#JJ and month W#MM), the day is reset to 1 and the month is incremented by 1. (lines 73, 75, 76; fields W#TT, W#JJ, W#MM; values 1)
- If the incremented month (W#MM) exceeds 12, the month is reset to 1 and the year is incremented by 1. (lines 77; fields W#MM, W#JJ; values 12, 1)
- The final date is constructed by calculating W#JJ * 10000 + W#MM * 100 + W#TT and storing it in the 8-character result field W#ERG. (lines 81, 82, 83; fields W#JJ, W#MM, W#TT, W#ERG_P; values 10000, 100)
Calls as written:
- line 73: if W#TT > KBU0TM(W#JJ, W#MM) then do; W#TT = 1; W#MM = W#MM + 1; if W#MM > 12 then do; W#MM = 1; W#JJ = W#JJ + 1; end; END;

## MINDESTZAHLUNG in KBP00003, lines 83-99
Runs in: job KBJ00001 STEP030
Calculates the minimum payment amount for a credit account based on its balance. If the balance is positive, it applies a percentage-based minimum, enforces a floor amount, and adds any excess over the credit limit. If the balance is zero or negative, the minimum payment is zero.
Inputs: KTO_SLD (Account Balance); KTO_KLIM (Credit Limit); KO_MINZ_MIN (Minimum Payment Floor); KO_MINZ_PROZ (Minimum Payment Percentage)
Outputs: SLD (Local variable holding the calculated minimum payment)
- If the account balance (SLD) is less than or equal to 0, the minimum payment is set to 0. (lines 86, 87; fields SLD; values 0)
- If the account balance (SLD) is positive but less than the minimum payment floor (KO_MINZ_MIN), the minimum payment is set to the balance itself. (lines 89, 90; fields SLD, KO_MINZ_MIN)
- If the account balance (SLD) is greater than or equal to the minimum payment floor (KO_MINZ_MIN), the minimum payment is calculated as (SLD * KO_MINZ_PROZ) / 100, rounded to 2 decimal places. (lines 92; fields SLD, KO_MINZ_PROZ; values 100)
- The calculated minimum payment is then adjusted to be at least the minimum payment floor (KO_MINZ_MIN) by taking the maximum of the calculated value and the floor. (lines 93; fields SLD, KO_MINZ_MIN)
- If the account balance (SLD) exceeds the credit limit (KTO_KLIM), the excess amount (SLD - KTO_KLIM) is added to the minimum payment. (lines 94, 95, 96; fields SLD, KTO_KLIM)
- The final minimum payment cannot exceed the account balance (SLD). If it does, it is capped at the balance. (lines 97; fields SLD)
Calls as written:
- line 92: DO; Â§MIN = KBU00005(DIVIDE(Â§SLD * KO_MINZ_PROZ, 100, 31, 10));
- line 93: Â§MIN = KBU00006(Â§MIN, KO_MINZ_MIN);

## KBU00020 in KBU00020, lines 7-24
Runs in: job KBJ00001 STEP030
Converts a Deutsche Mark amount to Euros by dividing by a fixed exchange rate of 1.95583. The result is rounded to two decimal places using an external rounding routine, preserving the sign of the original amount.
Inputs: E#BTR (FIXED DEC(15,2))
Outputs: E#ERG (FIXED DEC(15,2))
- If the input amount E#BTR is exactly 0, the output E#ERG is set to 0 and the procedure returns immediately. (lines 15, 17, 18; fields E#BTR, E#ERG; values 0)
- The intermediate value E#ZW is calculated by dividing E#BTR by the static exchange rate E#KURS (1.95583) with a precision of 31 digits and 10 decimal places. (lines 19; fields E#ZW, E#BTR, E#KURS; values 31, 10)
- If E#BTR is negative, the absolute value of E#ZW is passed to KBU00005, and the result is negated to preserve the negative sign. (lines 20, 21; fields E#BTR, E#ERG, E#ZW)
- If E#BTR is positive, E#ZW is passed directly to KBU00005 to round the result to two decimal places. (lines 22, 23; fields E#ERG, E#ZW)
Calls as written:
- line 21: E#ERG = -KBU00005(-E#ZW);
- line 23: E#ERG = KBU00005(E#ZW);

## AUSZUG in KBP00003, lines 102-128
Runs in: job KBJ00001 STEP030
Generates a single account statement record for a customer if the account has a non-zero balance or cycle amounts. It resolves the customer name, converts the balance to Euros if the system is in Euro mode, and writes the formatted record to the statement output file.
Inputs: KTO_SATZ (Account record: KTO_NR, KTO_KDNR, KTO_SLD, KTO_PKT, KTO_ST, KTO_ZYK_SOL, KTO_ZYK_HAB); SW_EURO (System flag for Euro mode); KBU00019 (Customer lookup routine); KBU00020 (Currency conversion routine)
Outputs: STMTFILE (Output file containing AZG_SATZ records); Z_GESCHR (Counter incremented by 1 for each written record)
- The procedure exits immediately without writing any output if the account balance (KTO_SLD), cycle debit (KTO_ZYK_SOL), and cycle credit (KTO_ZYK_HAB) are all zero. (lines 104, 105; fields KTO_SLD, KTO_ZYK_SOL, KTO_ZYK_HAB; values 0)
- The customer name is set to 'UNBEKANNT' if the customer lookup (KBU00019) returns an index of 0; otherwise, it is set to the name retrieved from the customer table. (lines 108, 109, 110, 112; fields KD, AZG_NAME, KTO_KDNR; values 0, 'UNBEKANNT')
- If the Euro switch (SW_EURO) is 'J', the account balance (KTO_SLD) is converted to Euros using KBU00020 and stored in AZG_SLD; otherwise, the original balance is copied directly to AZG_SLD. (lines 113, 116, 117, 118, 121; fields SW_EURO, KTO_SLD, AZG_SLD, SLD, EUR; values 'J')
- The account number (KTO_NR) is copied to the statement record field AZG_KTO. (lines 108; fields KTO_NR, AZG_KTO)
- The global variables MINZ and FAEL are copied to the statement record fields AZG_MINZ and AZG_FAEL respectively. (lines 122; fields MINZ, FAEL, AZG_MINZ, AZG_FAEL)
- The account package number (KTO_PKT), status (KTO_ST), cycle debit (KTO_ZYK_SOL), and cycle credit (KTO_ZYK_HAB) are copied directly to the corresponding statement record fields. (lines 123, 124, 125, 126; fields KTO_PKT, KTO_ST, KTO_ZYK_SOL, KTO_ZYK_HAB, AZG_PKT, AZG_ST, AZG_SOL, AZG_HAB)
- The completed statement record (AZG_SATZ) is written to the STMTFILE, and the global counter Z_GESCHR is incremented by 1. (lines 127; fields AZG_SATZ, STMTFILE, Z_GESCHR; values 1)
Calls as written:
- line 108: AZG_KTO = KTO_NR; CALL KBU00019(KTO_KDNR, Â§KD);
- line 117: call KBU00020(Â§SLD, Â§EUR);
Not backed by the code, treat with care: rule 5: field MINZ is not declared anywhere

## NEUER_ZYKLUS in KBP00003, lines 131-136
Runs in: job KBJ00001 STEP030
Resets the account's cycle-specific financial counters to zero and initializes the minimum amount field to the system minimum value. This prepares the account record for a new billing or settlement cycle.
Inputs: -
Outputs: KTO_SATZ.KTO_ZYK_SOL; KTO_SATZ.KTO_ZYK_HAB; KTO_SATZ.KTO_ZYK_ZAHL; KTO_SATZ.KTO_MINZ
- Sets the cycle debit balance (KTO_ZYK_SOL) to 0. (lines 133; fields KTO_ZYK_SOL; values 0)
- Sets the cycle credit balance (KTO_ZYK_HAB) to 0. (lines 134; fields KTO_ZYK_HAB; values 0)
- Sets the cycle payment count (KTO_ZYK_ZAHL) to 0. (lines 135; fields KTO_ZYK_ZAHL; values 0)
- Sets the minimum amount (KTO_MINZ) to the system minimum value (§MIN). (lines 135; fields KTO_MINZ; values §MIN)

## KBP00003 in KBP00003, lines 18-138
Runs in: job KBJ00001 STEP030
This procedure processes active credit accounts to calculate minimum payments, generate account statements if there is activity or a balance, and reset cycle counters for the new billing period. It reads the control card for the run date, loads account and customer data, and writes updated account records and statement files.
Inputs: CTLCARD (control card with run date); ACCTFILE (account master records); CUSTFILE (customer master records)
Outputs: ACCTOUT (updated account records with reset cycle fields and calculated minimum payments); STMTFILE (generated account statements); SYSPRINT (log messages)
- The run date is extracted from the first 8 characters of the control card record. (lines 57; fields W_STEU, W_LAUFDT; values 1, 8)
- The due date is calculated by adding 25 days to the run date. (lines 58; fields W_LAUFDT, KO_FAELLIG_TG, FAEL; values 25)
- A log message is written indicating the calculated due date. (lines 59; fields W_PGM, FAEL; values FAELLIG AM )
- Account records are loaded from ACCTFILE into memory and written to ACCTOUT. (lines 61; fields KTAB_SATZ, KTAB_ANZ)
- Customer master data is loaded into memory for name lookup. (lines 62)
- The procedure iterates through all account records in the in-memory table. (lines 66; fields I, KTAB_ANZ; values 1)
- Processing is skipped if the account status (KTO_ST) is 'X'. (lines 68; fields KTO_ST; values 'X')
- Minimum payment is calculated for active accounts. (lines 70; fields KTO_SLD, KTO_KLIM, KTO_MINZ)
- An account statement is generated if there is movement or a balance. (lines 71; fields KTO_SLD, KTO_ZYK_HAB, KTO_ZYK_SOL)
- Cycle fields are reset for the new cycle. (lines 71; fields KTO_ZYK_HAB, KTO_ZYK_SOL, KTO_ZYK_ZAHL, KTO_MINZ)
- The updated account record is written back to the in-memory table. (lines 72; fields KTAB_SATZ, KTO_SATZ)
- The statement file is closed after processing all accounts. (lines 76; fields STMTFILE)
- The final account records are written to ACCTOUT. (lines 77; fields KTAB_SATZ, KTAB_ANZ)
- A log message is written with the count of statements generated. (lines 78; fields W_PGM, Z_GESCHR, W_ZTXT; values AUSZUEGE )
Calls as written:
- line 58: Â§FAEL = KBU00002(W_LAUFDT, KO_FAELLIG_TG);
- line 59: CALL KBU00007(W_PGM, 'FAELLIG AM ' || Â§FAEL);
- line 61: CALL KBU00012;
- line 62: CALL KBU00018;
- line 70: CALL MINDESTZAHLUNG;
- line 71: CALL AUSZUG; CALL NEUER_ZYKLUS;
- line 77: CALL KBU00014; W_ZTXT = Z_GESCHR;
- line 78: CALL KBU00007(W_PGM, 'AUSZUEGE ' || W_ZTXT);
- line 79: CALL PLIRETC(W_RC);

## KBP00004 in KBP00004, lines 13-60
Runs in: job KBJ00002 STEP010
This procedure calculates and posts monthly interest at a flat rate of 18% p.a. (or a rate specified in the control card) on positive account balances. It updates the account balance and generates a transaction record for the interest credit. The program is marked as obsolete, replaced by KBP00002 in 1997, but retained for audit purposes.
Inputs: CTLCARD (KB.PROD.CTLCARD): Control record containing run date (positions 1-8) and optional interest rate (positions 9-12).; ACCTFILE (KB.PROD.ACCTFILE): Input file of account master records (KTO_SATZ, LRECL=140).; KBU00007: External procedure for logging.
Outputs: ACCTOUT (KB.PROD.ACCTFILE): Output file of updated account master records.; TRANOUT (KB.PROD.TRANZINS): Output file of interest transaction records (TRN_SATZ, LRECL=120).; SYSPRINT: Log message 'ENDE ALTER ZINSLAUF'.
- The default interest rate is 18.00% per annum. (lines 23; fields A_PROZ; values 18.00)
- If the control card field at positions 9-12 is not blank, it overrides the default interest rate. (lines 32, 34, 35; fields W_STEU, A_PROZ_K, A_PROZ; values '    ')
- Interest is only calculated for accounts where the 12th character of KTO_ALT_SCHL is 'A'. (lines 42; fields KTO_ALT_SCHL; values 'A')
- Interest is only calculated if the account balance (KTO_SLD) is strictly greater than 0. (lines 43; fields KTO_SLD; values 0)
- Monthly interest is calculated as Balance * Rate / 1200. (lines 45; fields A_ZINS, KTO_SLD, A_PROZ; values 1200)
- The calculated interest is added to the account balance. (lines 46; fields KTO_SLD, A_ZINS)
- A transaction record is created with ID 'ZA' + Account Number + '000', Type '06', Category '0001', and Text 'ZINSEN'. (lines 48, 49, 50; fields TRN_ID, KTO_NR, TRN_TYP, TRN_KAT, TRN_TXT; values 'ZA', '000', '06', '0001', 'ZINSEN')
- The transaction amount is the calculated interest, and the date is the run date from the control card. (lines 51; fields TRN_BTR, A_ZINS, TRN_DT, W_LAUFDT)
- The program logs 'ENDE ALTER ZINSLAUF' upon completion. (lines 59; fields W_PGM; values 'ENDE ALTER ZINSLAUF')
Calls as written:
- line 59: CALL KBU00007(W_PGM, 'ENDE ALTER ZINSLAUF');

## BRIEF in KBP00005, lines 76-92
Runs in: job KBJ00003 STEP010
Generates a formatted dunning letter (reminder) for a credit card account. It selects the appropriate salutation based on whether a specific customer code exists, displays the outstanding minimum payment amount, and includes a deadline date and closing remarks based on the dunning stage.
Inputs: KTO_NR (Account Number); M_KD (Customer Code Index); M_STUFE (Dunning Stage); KTO_MINZ (Minimum Payment Amount); M_FRIST (Due Date); KD_NAME (Customer Name from KD_TAB)
Outputs: BRIEFE (Output File for Dunning Letters)
- Writes a header line with the bank name 'KARTENBANK' and the account number prefixed by 'KONTO '. (lines 77, 78; fields KTO_NR; values 'KARTENBANK', 'KONTO ')
- If the customer code index M_KD is greater than 0, the salutation line uses the customer name from the KD_NAME table at index M_KD. (lines 79, 80; fields M_KD, KD_NAME; values 0)
- If the customer code index M_KD is not greater than 0, the salutation line defaults to the generic text 'AN DEN KONTOINHABER' (To the account holder). (lines 81, 82; fields M_KD; values 'AN DEN KONTOINHABER')
- Writes the first line of the dunning message body corresponding to the current dunning stage (M_STUFE) from the M_TXT array. (lines 83; fields M_TXT, M_STUFE; values 1)
- Writes the second line of the dunning message body corresponding to the current dunning stage (M_STUFE) from the M_TXT array. (lines 84; fields M_TXT, M_STUFE; values 2)
- Assigns the minimum payment amount KTO_MINZ to the display variable M_BTR. (lines 85; fields M_BTR, KTO_MINZ)
- Writes the outstanding amount line with the label 'OFFENER BETRAG: ', the formatted amount M_BTR, and the currency ' EUR'. (lines 86, 87; fields M_BTR; values 'OFFENER BETRAG: ', ' EUR')
- Writes the third line of the dunning message body, followed by the due date formatted as DD.MM.YYYY extracted from M_FRIST (positions 7-8 for day, 5-6 for month, 1-4 for year). (lines 88, 89, 90; fields M_TXT, M_STUFE, M_FRIST; values 3, 7, 2, 5, 2, 1, 4)
- Writes the fourth line of the dunning message body corresponding to the current dunning stage (M_STUFE) from the M_TXT array. (lines 91; fields M_TXT, M_STUFE; values 4)

## KBP00005 in KBP00005, lines 13-94
Runs in: job KBJ00003 STEP010
This procedure generates dunning letters for credit card accounts that are in arrears. It iterates through the account master, filters for active accounts with a positive balance, determines the dunning stage based on the current reminder count, and writes a formatted letter to the output file. Note: The program is marked as decommissioned since 2016.
Inputs: CTLCARD (control card file, read for run date); ACCTFILE (account master file, loaded into memory via KBU00012); CUSTFILE (customer master file, loaded into memory via KBU00018)
Outputs: BRIEFE (print output file containing the dunning letters); SYSPRINT (log message via KBU00007)
- The program is decommissioned and no longer runs in production; letters are now generated by the document management system. (lines 12)
- The run date is extracted from the first 8 characters of the control card record. (lines 51; fields W_STEU, W_LAUFDT)
- The payment deadline (M_FRIST) is calculated by adding 14 days to the run date. (lines 52; fields W_LAUFDT, M_FRIST; values 14)
- Only accounts with status 'D' (in arrears) are processed; all other statuses are skipped. (lines 59; fields KTO_ST; values 'D')
- Only accounts with a balance (KTO_SLD) greater than 0 are processed; zero or negative balances are skipped. (lines 60; fields KTO_SLD; values 0)
- Dunning stage 1 is assigned if the reminder count (KTO_MAHN) is less than or equal to 2. (lines 62; fields KTO_MAHN, M_STUFE; values 2, 1)
- Dunning stage 2 is assigned if the reminder count (KTO_MAHN) is greater than 2 and less than or equal to 4. (lines 63; fields KTO_MAHN, M_STUFE; values 4, 2)
- Dunning stage 3 is assigned if the reminder count (KTO_MAHN) is greater than 4. (lines 64; fields KTO_MAHN, M_STUFE; values 3)
- The customer index (M_KD) is retrieved using the customer number (KTO_KDNR) from the account record. (lines 66; fields KTO_KDNR, M_KD)
- A counter (M_ANZ) is incremented for each letter generated to track the total number of outputs. (lines 68; fields M_ANZ; values 1)
- A log message is written to the system print file containing the program name and the count of generated letters. (lines 73; fields W_PGM, W_ZTXT; values 'BRIEFE ')
Calls as written:
- line 52: M_FRIST = KBU00002(W_LAUFDT, 14);
- line 54: CALL KBU00012;
- line 55: call KBU00018;
- line 66: CALL KBU00019(KTO_KDNR, M_KD);
- line 67: call BRIEF;
- line 73: CALL KBU00007(W_PGM, 'BRIEFE ' || W_ZTXT);
Not backed by the code, treat with care: rule 1: line 12 is not in KBP00005 (lines 13-94)

## KBU0Y2 in KBU00001, lines 114-119
Runs in: no JCL step reaches it (never called)
Converts a 6-character date string (JJMMTT) into an 8-character format (JJJJMMTT) by prepending a century prefix. It prepends '19' if the year part is 94 or higher, otherwise it prepends '20'. The routine is marked as unused since the year 2000.
Inputs: P#D6 (CHAR(6))
Outputs: Return value (CHAR(8))
- If the first two characters of the input date (SUBSTR(P#D6,1,2)) are greater than or equal to the constant D#ALT_JJ ('94'), the function returns the concatenation of D#ALT_JH ('19') and the input P#D6. (lines 116, 117; fields P#D6, D#ALT_JJ, D#ALT_JH; values '94', '19')
- If the first two characters of the input date are less than D#ALT_JJ ('94'), the function returns the concatenation of the literal string '20' and the input P#D6. (lines 118; fields P#D6; values '20')