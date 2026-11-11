# JCL/KBJ00001
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


# JCL/KBJ00002
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


# JCL/KBJ00003
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


# PLI/KBP00001
 /*******************************************************************/
 /*                                                                   */
 /*  PROGRAMM   KBP00001                                              */
 /*  SYSTEM     KB  KARTENBANK                                        */
 /*  JOB        KBJ00001  STEP010                                     */
 /*                                                                   */
 /*  TAGESVERARBEITUNG UMSAETZE                                       */
 /*                                                                   */
 /*  EINGAEB    CTLCARD   STEUERKARTE (LAUFDATUM SPALTE 1-8)          */
 /*             ACCTFILE  KONTEN                                      */
 /*             XREFFILE  KARTEN                                      */
 /*             TCATFILE  SADLEN JE KATEGORIE                         */
 /*             DALYTRAN  UMSAETZE DES TAGES                          */
 /*  AUSGABE    ACCTOUT   KONTEN NEU                                  */
 /*             TCATOUT   SADLEN NEU                                  */
 /*             TRANOUT   GEBUCHTE UMSAETZE                           */
 /*             REJECTS   ABGEWISENE UMSAETZE MIT GRUND              */
 /*                                                                   */
 /*  RC  0 OK   4 ABWEISUNGEN VORHANDEN   16 ABBRUCH                  */
 /*                                                                   */
 /*  AENDERUNGEN                                                      */
 /*  ---------------------------------------------------------------  */
 /*  1994-03-11 HKR ERSTELLT                                          */
 /*  1994-05-02 HKR KARTENSPERRE                                      */
 /*  1996-01-15 HKR KONTEN IM SPEICHER (KBU00012) STATT VSAM-READ     */
 /*  1997-08-02 HKR SADLEN JE KATEGORIE                               */
 /*  1999-11-30 WBE Y2K                                               */
 /*  2001-06-14 WBE BONUSPUNKTE                                       */
 /*  2001-07-30 WBE BONUSPUNKTE GUTSCHRIFT ABZIEHEN                   */
 /*  2002-12-01 ALM MCC / DOPPELTE PUNKTE LEBENSMITTEL                */
 /*  2004-02-09 ALM ZAHLNUGEN IM ZYKLUS (MAHNWESEN)                   */
 /*  2006-10-10 ALM BARGELDGEBUHER                                    */
 /*  2008-09-17 ALM KRATENSTATUS AUS XREF                             */
 /*  2011-02-02 ALM DREIFACHE PUNKTE RESTAURANT                       */
 /*  2013-07-01 ALM GLUECKSSPIEL GESPERRT (MCC 7995)                  */
 /*  2015-04-22 RFI DOPPELTE TRANSAKTOINEN ABWEISEN (INC0047113)      */
 /*                                                                   */
 /*******************************************************************/
 KBP00001: PROC(P_PARM) OPTIONS(MAIN) REORDER;

       DCL P_PARM CHAR(100) VARYING;

   %INCLUDE KBC00001;
   %INCLUDE KBC00002;
   %INCLUDE KBC00003;
       %INCLUDE KBC00004;
     %INCLUDE KBC00005;
   %INCLUDE KBC00009;
       %INCLUDE KBC00010;
   %INCLUDE KBC00011;

   DCL CTLCARD  FILE RECORD INPUT;
      DCL XREFFILE FILE RECORD INPUT;
   DCL DALYTRAN FILE RECORD INPUT;
   DCL TRANOUT  FILE RECORD OUTPUT;
   DCL REJECTS  FILE RECORD OUTPUT;

   dcl KBU00002 ENTRY(CHAR(8), FIXED BIN(31)) RETURNS(CHAR(8))
                   EXTERNAL;
  DCL KBU00003 ENTRY(CHAR(8), CHAR(8)) RETURNS(FIXED BIN(15))
                    EXTERNAL;
   DCL KBU00005 ENTRY(FIXED DEC(31,10)) RETURNS(FIXED DEC(15,2))
                EXTERNAL;
   DCL KBU00006 ENTRY(FIXED DEC(15,2), FIXED DEC(15,2))
                RETURNS(FIXED DEC(15,2)) EXTERNAL;
  DCL KBU00007 ENTRY(CHAR(8), CHAR(*) VARYING) EXTERNAL;
  DCL KBU00009 ENTRY((*) CHAR(16), FIXED BIN(31), CHAR(16),
                FIXED BIN(31)) EXTERNAL;
   DCL KBU00011 ENTRY(CHAR(8), FIXED BIN(31), CHAR(*) VARYING)
                EXTERNAL;
  dcl KBU00012 ENTRY EXTERNAL;
   dcl KBU00013 ENTRY(CHAR(11), FIXED BIN(31)) EXTERNAL;
   DCL KBU00014 ENTRY EXTERNAL;
   DCL KBU00015 ENTRY EXTERNAL;
  DCL KBU00016 ENTRY(CHAR(17), FIXED DEC(15,2)) EXTERNAL;
   DCL KBU00017 ENTRY EXTERNAL;
   DCL KBU00023 ENTRY(CHAR(120)) RETURNS(FIXED BIN(15)) EXTERNAL;
   DCL KBU00024 ENTRY(CHAR(50))  RETURNS(FIXED BIN(15)) EXTERNAL;
  dcl KBU00026 ENTRY(CHAR(8), CHAR(8)) EXTERNAL;
     DCL KBU00027 ENTRY(CHAR(2), FIXED DEC(15,2), CHAR(1)) EXTERNAL;
  DCL KBU00028 ENTRY EXTERNAL;

0  /* WIEDERANLAUF: ALLE N SAETZE EIN KONTROLLPUNKT (NUR PROTOKOLL,  */
   /* DER ECHTE WIEDERANLAUF WURDE 1996 MIT DER SPEICHERTABELE      */
+  /* AUSGEBAUT, WIEDERHOLUNG = GANZER STEP NOCHMAL)                 */
   DCL W_CHKP_N    FIXED DEC(7) INIT(1000);
   DCL W_CHKP_Z    FIXED DEC(7) INIT(0);
   DCL W_PLAUS     FIXED BIN(15);

0  /* KARTEN AUS XREFFILE                                            */
   DCL #XK(5000)   CHAR(16);
   dcl #XA(5000)   CHAR(11);
    dcl #XS(5000)   CHAR(1);
   DCL #XN         FIXED BIN(31) INIT(0);

0  /* SCHON GESEHENE TRANSAKTIONSNUMMERN (INC0047113)                */
   DCL #GS(20000)  CHAR(16);
   DCL #GN         FIXED BIN(31) INIT(0);

   DCL @XI         FIXED BIN(31);
   DCL @KI         FIXED BIN(31);
   DCL @GI         FIXED BIN(31);
   DCL @GRD        FIXED BIN(15);
   DCL @DOPP       BIT(1);
   DCL @SOLL       BIT(1);
   DCL W_BTR       FIXED DEC(15,2);
   dcl W_GEB       FIXED DEC(15,2);
   DCL W_KTONR     CHAR(11);
   DCL W_KARTE     CHAR(16);
   DCL W_ORGID     CHAR(16);
   DCL W_TSATZ     CHAR(120);

0  /* FRUEHER: TAGESLIMIT JE KARTE (1999 ABGESCHAFFT)                */
      DCL W_TGLIM     FIXED DEC(15,2) INIT(2500.00);
       dcl W_TGSUM     FIXED DEC(15,2) INIT(0);

   W_PGM = 'KBP00001';
   W_RC  = 0;
   IF INDEX(P_PARM, 'TRACE') > 0 THEN SW_TEST = '1'B;
   IF INDEX(P_PARM, 'CHKP=') > 0 THEN
+    W_CHKP_N = SUBSTR(P_PARM, INDEX(P_PARM, 'CHKP=') + 5, 4);

   ON ERROR
     BEGIN;
      ON ERROR SYSTEM;
         CALL KBU00011(W_PGM, 16, 'ON ERROR, ONCODE ' || ONCODE());
     END;

   ON ENDFILE(DALYTRAN) SW_EOF_TRN = '1'B;
   ON ENDFILE(XREFFILE) SW_EOF_XRF = '1'B;

   CALL KBU00007(W_PGM, 'START');

0/*------------------------------------------------------------------*/
 /* STEUERKARTE                                                       */
 /*------------------------------------------------------------------*/
   OPEN FILE(CTLCARD);
   READ FILE(CTLCARD) INTO(W_STEU);
   CLOSE FILE(CTLCARD);
    W_LAUFDT = SUBSTR(W_STEU, 1, 8);
  IF VERIFY(W_LAUFDT, '0123456789') ^= 0 THEN
     CALL KBU00011(W_PGM, 16, 'LAUFDATUM UNGUELTIG: ' || W_LAUFDT);
   CALL KBU00007(W_PGM, 'LAUFDATUM ' || W_LDT_TT || '.' || W_LDT_MM
                 || '.' || W_LDT_JJJJ);

0/*------------------------------------------------------------------*/
 /* TABELEN LAEDN                                                    */
 /*------------------------------------------------------------------*/
   CALL KBU00012;
   CALL KBU00015; call XRF_LADEN;
+  CALL KBU00026(W_PGM, W_LAUFDT);

0/*------------------------------------------------------------------*/
 /* HAUPTSCHLEIFE                                                     */
 /*------------------------------------------------------------------*/
   OPEN FILE(DALYTRAN), FILE(TRANOUT), FILE(REJECTS);
+  READ FILE(DALYTRAN) INTO(W_TSATZ);
   DO WHILE(^SW_EOF_TRN);
   Z_GELESEN = Z_GELESEN + 1;
     STRING(TRN_SATZ) = W_TSATZ;
     W_PLAUS = KBU00023(W_TSATZ);
     IF SW_TEST THEN
       CALL KBU00007(W_PGM, 'TRACE ' || TRN_ID || ' ' || TRN_TYP);
     CALL UMSATZ;
     W_CHKP_Z = W_CHKP_Z + 1;
     IF W_CHKP_Z >= W_CHKP_N THEN
       DO; W_ZTXT = Z_GELESEN;
           CALL KBU00007(W_PGM, 'KONTROLLPUNKT ' || W_ZTXT);
         W_CHKP_Z = 0; END;
     READ FILE(DALYTRAN) INTO(W_TSATZ);
      END;
   CLOSE FILE(DALYTRAN), FILE(TRANOUT), FILE(REJECTS);

0/*------------------------------------------------------------------*/
+/* AUSGABE                                                           */
 /*------------------------------------------------------------------*/
   CALL KBU00014;
   CALL KBU00017;
  CALL KBU00028;

+  W_ZTXT = Z_GELESEN;  CALL KBU00007(W_PGM, 'GELESEN    ' || W_ZTXT);
   W_ZTXT = Z_GEBUCHT;  CALL KBU00007(W_PGM, 'GEBUCHT    ' || W_ZTXT);
   W_ZTXT = Z_ABGEW;    CALL KBU00007(W_PGM, 'ABGEWIESEN ' || W_ZTXT);
   IF Z_ABGEW > 0 THEN IF W_RC < 4 THEN W_RC = 4;
      CALL KBU00007(W_PGM, 'ENDE');
   CALL PLIRETC(W_RC);
   RETURN;

0/*==================================================================*/
 /* EINEN UMSATZ VERABEITEN                                          */
 /*==================================================================*/
-UMSATZ: PROC;
   W_BTR = TRN_BTR;
   W_KARTE = TRN_KARTE;

   CALL KBU00009(#GS, #GN, TRN_ID, @GI);
     IF @GI > 0 THEN
     @DOPP = '1'B;
   ELSE DO; @DOPP = '0'B;
         if #GN >= HBOUND(#GS,1) then
      CALL KBU00011(W_PGM, 16, 'ZU VIELE UMSAETZE');
         #GN = #GN + 1; #GS(#GN) = TRN_ID;
   end;

   IF TRN_TYP = KO_TYP_KAUF | TRN_TYP = KO_TYP_BAR THEN
+    @SOLL = '1'B;
+  ELSE
    @SOLL = '0'B;

   @GRD = PRUEFEN();
      IF @GRD ^= 0 THEN
     DO;
       CALL ABWEISEN(@GRD);
       CALL KBU00027(TRN_TYP, W_BTR, 'A');
       RETURN; END;

  CALL BUCHEN;
   CALL KBU00027(TRN_TYP, W_BTR, 'G');
   IF TRN_TYP = KO_TYP_BAR THEN
     CALL GEBUEHR;
   KTAB_SATZ(@KI) = STRING(KTO_SATZ); END UMSATZ;

0/*==================================================================*/
-PRUEFEN: PROC RETURNS(FIXED BIN(15));
  DCL R# FIXED BIN(15) INIT(0);

      IF @DOPP THEN DO; R# = 110; GOTO P#X; END;

   IF W_BTR <= 0 THEN DO; R# = 109; GOTO P#X; END;

  SELECT(TRN_TYP);
     WHEN(KO_TYP_KAUF, KO_TYP_ZAHL, KO_TYP_GUT, KO_TYP_BAR) ;
     WHEN(KO_TYP_GEB, KO_TYP_ZINS)
           do;
         /* NUR INTERN ERZEUGT, DUERFEN NICHT VON AUSSEN KOMMEN      */
         R# = 111;
         GOTO P#X;
           END;
       otherwise
       DO; R# = 111; GOTO P#X; END;
  END;

   call KBU00009(#XK, #XN, W_KARTE, @XI);
       IF @XI = 0 THEN R# = 100;
   ELSE
      IF #XS(@XI) ^= 'Y' THEN R# = 101;
   ELSE DO;
     W_KTONR = #XA(@XI);
     CALL KBU00013(W_KTONR, @KI);
     IF @KI = 0 THEN R# = 102;
     ELSE DO; STRING(KTO_SATZ) = KTAB_SATZ(@KI);
       IF KTO_ST = 'C' | KTO_ST = 'X'
         then R# = 103;
        ELSE IF KBU00003(TRN_DT, KTO_ABDT) > 0
         THEN R# = 105;
           else if @SOLL & KTO_ST = 'D'
+          THEN R# = 104;
       ELSE IF TRN_TYP = KO_TYP_KAUF & TRN_MCC = KO_MCC_SPERR
         THEN R# = 108;
       ELSE IF TRN_TYP = KO_TYP_BAR & W_BTR > KTO_BLIM
         THEN R# = 107;
       else if @SOLL then
           DO;
           W_HV1 = KTO_SLD;
            W_HV1 = W_HV1 + W_BTR;
           IF W_HV1 > KTO_KLIM THEN R# = 106;
         END; END;
   END;

0/* IF W_TGSUM + W_BTR > W_TGLIM THEN R# = 112;     ABGESCHAFFT 1999 */

 P#X:
  RETURN(R#);
 END PRUEFEN;

0/*==================================================================*/
 /* ABWEISEN                                                          */
 /*==================================================================*/
-ABWEISEN: PROC(A#GRD);
   DCL A#GRD FIXED BIN(15);
   DCL A#I   FIXED BIN(15);
   STRING(ABW_SATZ) = '';
   ABW_TRN = TRN_ID;
   ABW_GRD = A#GRD; ABW_TXT = '?';
    DO A#I = LBOUND(KO_ABW,1) TO HBOUND(KO_ABW,1);
         IF KO_ABW_CD(A#I) = A#GRD THEN ABW_TXT = KO_ABW_TX(A#I);
+ END;
   WRITE FILE(REJECTS) FROM(ABW_SATZ);
      Z_ABGEW = Z_ABGEW + 1;
+end ABWEISEN;

0/*==================================================================*/
 /* BUCHEN                                                            */
 /*==================================================================*/
-BUCHEN: PROC;
   dcl B#SCHL  CHAR(17);
   dcl B#EINH  FIXED DEC(11);
    DCL B#FAKT  FIXED DEC(1);
   DCL B#PKT   FIXED DEC(11);

      B#SCHL = KTO_NR || TRN_TYP || TRN_KAT;

   IF @SOLL THEN
     DO;
      KTO_SLD     = KTO_SLD     + W_BTR;
        KTO_ZYK_SOL = KTO_ZYK_SOL + W_BTR; CALL KBU00016(B#SCHL, W_BTR);
         END;
   ELSE
    DO;
           KTO_SLD     = KTO_SLD     - W_BTR;
       KTO_ZYK_HAB = KTO_ZYK_HAB + W_BTR;
        W_HV2 = -W_BTR;
     CALL KBU00016(B#SCHL, W_HV2);
       if TRN_TYP = KO_TYP_ZAHL then
             KTO_ZYK_ZAHL = KTO_ZYK_ZAHL + W_BTR;
      END;

   B#EINH = TRUNC(W_BTR);
  B#PKT  = KTO_PKT;
   IF TRN_TYP = KO_TYP_KAUF THEN
     DO; SELECT(TRN_MCC);
         WHEN(KO_MCC_LEBM)  B#FAKT = 2;
            WHEN(KO_MCC_REST)  B#FAKT = 3;
         OTHERWISE          B#FAKT = 1;
       END;
       B#PKT = B#PKT + B#EINH * B#FAKT;
       if B#PKT > KO_MAX_PKT then B#PKT = KO_MAX_PKT;
        end;
   ELSE IF TRN_TYP = KO_TYP_GUT THEN
     DO;
       B#PKT = B#PKT - B#EINH; IF B#PKT < 0 THEN B#PKT = 0;
     END;
   KTO_PKT = B#PKT;

   STRING(BUC_SATZ) = '';
   BUC_TRN = SUBSTR(W_TSATZ, 1, 110);
   BUC_KTO = KTO_NR;
   BUC_DT  = W_LAUFDT;
      WRITE FILE(TRANOUT) FROM(BUC_SATZ);
   Z_GEBUCHT = Z_GEBUCHT + 1;
   W_TGSUM = W_TGSUM + W_BTR;
 END BUCHEN;

0/*==================================================================*/
-GEBUEHR: PROC;
   W_HV3 = KBU00005(DIVIDE(W_BTR * KO_GEB_BAR_PROZ, 100, 31, 10));
   W_GEB = KBU00006(W_HV3, KO_GEB_BAR_MIN);

   KTO_SLD     = KTO_SLD     + W_GEB;
  KTO_ZYK_SOL = KTO_ZYK_SOL + W_GEB;
    CALL KBU00016(KTO_NR || KO_TYP_GEB || '0001', W_GEB);

   W_ORGID = TRN_ID;
   STRING(TRN_SATZ) = '';
       TRN_ID     = 'CF' || SUBSTR(W_ORGID, 3);
   TRN_TYP    = KO_TYP_GEB;
       TRN_KAT    = '0001';
   TRN_QUELLE = 'SYSTEM';
   TRN_TXT    = 'BARGELDGEBUEHR';
+  TRN_BTR    = W_GEB;
   TRN_HDL    = '000000000';
   TRN_MCC    = '0000';
+  TRN_KARTE  = W_KARTE;
   TRN_DT     = W_LAUFDT;

     STRING(BUC_SATZ) = ''; BUC_TRN = SUBSTR(STRING(TRN_SATZ), 1, 110);
   BUC_KTO = KTO_NR; BUC_DT  = W_LAUFDT;
       WRITE FILE(TRANOUT) FROM(BUC_SATZ);
   CALL KBU00027(KO_TYP_GEB, W_GEB, 'E'); END GEBUEHR;

0/*==================================================================*/
 /* KARTEN LADEN                                                      */
 /*==================================================================*/
- XRF_LADEN: PROC;
   OPEN FILE(XREFFILE);
   READ FILE(XREFFILE) INTO(XRF_SATZ);
   DO WHILE(^SW_EOF_XRF);
     IF KBU00024(STRING(XRF_SATZ)) > 0 THEN
       Z_GESCHR = Z_GESCHR + 1;      /* FELD IST FREI, WIRD MISSBRAUCHT */
     #XN = #XN + 1; #XK(#XN) = XRF_KARTE;
     #XA(#XN) = XRF_KTO;
     #XS(#XN) = XRF_ST;
     READ FILE(XREFFILE) INTO(XRF_SATZ);
   END; CLOSE FILE(XREFFILE);
  END XRF_LADEN;

  END KBP00001;


# PLI/KBP00002
 /*******************************************************************/  00000100
 /*  PROGRAMM   KBP00002                                              */00000200
 /*  JOB        KBJ00001  STEP020                                     */00000300
 /*                                                                   */00000400
 /*  ZYKLUSENDE: SOLLZINSEN, MAHNGEBUHER, UEBERZIEHUNGSGEBUEHR,       */00000500
 /*              KONTOSTATUS                                          */00000600
 /*                                                                   */00000700
 /*  EINGAEB    CTLCARD ACCTFILE TCATFILE DISCGRP CUSTFILE            */00000800
 /*  AUSGBAE    ACCTOUT TRANOUT                                       */00000900
 /*                                                                   */00001000
 /*  ERSETZT KBP00004 (ALTER ZINSLAUF, PAUSCHAL 18 %)                 */00001100
 /*                                                                   */00001200
 /*  1997-08-02 HKR ERSTELLT                                          */00001300
 /*  2004-02-09 ALM MAHNWESEN, STAUTS D / X                           */00001400
 /*  2009-04-01 ALM FICO-AUFSCHLAG                                    */00001500
 /*******************************************************************/  00001800
    KBP00002: PROC OPTIONS(MAIN);                                       00001900
 %INCLUDE KBC00001;                                                     00002000
 %INCLUDE KBC00002;                                                     00002100
 %INCLUDE KBC00004;                                                     00002200
 %INCLUDE KBC00005;                                                     00002300
 %INCLUDE KBC00006;                                                     00002400
 %INCLUDE KBC00007;                                                     00002500
  %INCLUDE KBC00010;                                                    00002600
 %INCLUDE KBC00011;                                                     00002700
                                                                        00002800
+ DCL CTLCARD FILE RECORD INPUT,                                        00002900
     DISCGRP FILE RECORD INPUT,                                         00003000
+    TRANOUT FILE RECORD OUTPUT;                                        00003100
                                                                        00003200
 DCL (KBU00012, KBU00014, KBU00015, KBU00018) ENTRY EXTERNAL;           00003300
 dcl KBU00013 ENTRY(CHAR(11), FIXED BIN(31)) EXTERNAL;                  00003400
 DCL KBU00019 ENTRY(CHAR(9), FIXED BIN(31)) EXTERNAL;                   00003500
 DCL KBU00005 ENTRY(FIXED DEC(31,10)) RETURNS(FIXED DEC(15,2))          00003600
              EXTERNAL;                                                 00003700
 dcl KBU00007 ENTRY(CHAR(8), CHAR(*) VARYING) EXTERNAL;                 00003800
 DCL KBU00011 ENTRY(CHAR(8), FIXED BIN(31), CHAR(*) VARYING)            00003900
                 EXTERNAL;                                              00004000
  DCL KBU00026 ENTRY(CHAR(8), CHAR(8)) EXTERNAL;                        00004100
 DCL KBU00027 ENTRY(CHAR(2), FIXED DEC(15,2), CHAR(1)) EXTERNAL;        00004200
 DCL KBU00028 ENTRY EXTERNAL;                                           00004300
                                                                        00004400
 /* AKTION 2010: NEUKUNDEN DER GRUPPE AKTION2010 ZAHLEN BIS ENDE    */  00004500
 /* 2011 KEINE ZINSEN. (MARKETING, M. KOLB, 2009-12-01)             */  00004600
    DCL $AKT_GRP    CHAR(10) INIT('AKTION2010');                        00004700
    DCL $AKT_VON    CHAR(8)  INIT('20100101');                          00004800
 DCL $AKT_BIS    CHAR(8)  INIT('20111231');                             00004900
                                                                        00005000
 DCL 1 ZS(500),                                                         00005100
       3 ZS_SCHL CHAR(16),                                              00005200
        3 ZS_P    FIXED DEC(5,2);                                       00005300
 DCL ZS_N        FIXED BIN(31) INIT(0);                                 00005400
                                                                        00005500
 DCL (I, J, K)   FIXED BIN(31);                                         00005600
 DCL $KD         FIXED BIN(31);                                         00005700
 DCL $GEF        BIT(1);                                                00005800
 DCL $P          FIXED DEC(5,2);                                        00005900
 DCL $SUM        FIXED DEC(15,2);                                       00006000
 DCL $ZW         FIXED DEC(15,2);                                       00006100
 DCL $MAHN       FIXED BIN(15);                                         00006200
 DCL $GRP_DEF    CHAR(10) INIT('DEFAULT');                              00006300
                                                                        00006400
 W_PGM = 'KBP00002';                                                    00006500
 W_RC  = 0;                                                             00006600
   ON ERROR BEGIN;                                                      00006700
   ON ERROR SYSTEM;                                                     00006800
  CALL KBU00011(W_PGM, 16, 'ON ERROR ' || ONCODE());                    00006900
 END;                                                                   00007000
                                                                        00007100
 OPEN FILE(CTLCARD);                                                    00007200
 READ FILE(CTLCARD) INTO(W_STEU);                                       00007300
 CLOSE FILE(CTLCARD);                                                   00007400
     W_LAUFDT = SUBSTR(W_STEU,1,8);                                     00007500
+                                                                       00007600
 CALL KBU00012;                                                         00007700
 call KBU00015;                                                         00007800
 CALL KBU00018;                                                         00007900
  CALL ZS_LADEN;                                                        00008000
  CALL KBU00026(W_PGM, W_LAUFDT);                                       00008100
+                                                                       00008200
 OPEN FILE(TRANOUT);                                                    00008300
                                                                        00008400
 DO I = 1 TO KTAB_ANZ;                                                  00008500
    STRING(KTO_SATZ) = KTAB_SATZ(I);                                    00008600
+  IF KTO_ST = 'X' THEN GOTO WEITER;          /* ABGESCHRIEBEN   */     00008700
                                                                        00008800
       CALL KBU00019(KTO_KDNR, $KD);                                    00008900
                                                                        00009000
   /*--- ZINSEN JE KATEGORIE -------------------------------------*/    00009100
       $SUM = 0;                                                        00009200
       DO J = 1 TO TC_ANZ;                                              00009300
     IF SUBSTR(TC_KEY(J),1,11) ^= KTO_NR THEN GOTO NAECHSTE_KAT;        00009400
     IF TC_SLD(J) <= 0 THEN GOTO NAECHSTE_KAT;                          00009500
     IF SUBSTR(TC_KEY(J),12,2) = KO_TYP_ZAHL THEN                       00009600
          GOTO NAECHSTE_KAT;                                            00009700
         CALL ZINSSATZ(KTO_GRP, SUBSTR(TC_KEY(J),12,6));                00009800
     IF KTO_GRP = $AKT_GRP THEN                                         00009900
        IF W_LAUFDT >= $AKT_VON & W_LAUFDT <= $AKT_BIS THEN             00010000
         $P = 0;                                                        00010100
     IF $P > 0 THEN DO;                                                 00010200
           IF KTO_ST = 'D' THEN $P = $P + KO_AUFS_VERZ;                 00010300
          IF $KD > 0 THEN                                               00010400
         IF KD_FICO($KD) < KO_FICO_GRENZE THEN                          00010500
           $P = $P + KO_AUFS_FICO;                                      00010600
     END;                                                               00010700
     $ZW  = KBU00005(DIVIDE(TC_SLD(J) * $P, 1200, 31, 10));             00010800
     $SUM = $SUM + $ZW;                                                 00010900
    NAECHSTE_KAT:                                                       00011000
   END;                                                                 00011100
                                                                        00011200
  IF $SUM >= KO_ZINS_FREI THEN                                          00011300
     CALL BELASTEN('ZI', KO_TYP_ZINS, '0001', 'SOLLZINSEN', $SUM);      00011400
                                                                        00011500
   /*--- GEBUEHREN NUR A UND D -----------------------------------*/    00011600
      IF KTO_ST = 'A' | KTO_ST = 'D' THEN DO;                           00011700
     IF KTO_MINZ > 0 THEN                                               00011800
       IF KTO_ZYK_ZAHL < KTO_MINZ THEN DO;                              00011900
             $MAHN = KTO_MAHN;                                          00012000
         IF $MAHN > 0 THEN $ZW = KO_MAHN_2;                             00012100
                     ELSE $ZW = KO_MAHN_1;                              00012200
         $MAHN = $MAHN + 1;                                             00012300
         IF $MAHN > 99 THEN $MAHN = 99;                                 00012400
         KTO_MAHN = $MAHN;                                              00012500
         CALL BELASTEN('MG', KO_TYP_GEB, '0002', 'MAHNGEBUEHR', $ZW);   00012600
           END;                                                         00012700
       else KTO_MAHN = 0;                                               00012800
+    IF KTO_SLD > KTO_KLIM THEN                                         00012900
       CALL BELASTEN('UL', KO_TYP_GEB, '0003',                          00013000
                   'UEBERZIEHUNGSGEBUEHR', KO_UEBZ);                    00013100
   END;                                                                 00013200
                                                                        00013300
   /*--- STAUTS ---------------------------------------------------*/   00013400
    SELECT;                                                             00013500
     WHEN(KTO_ST = 'A' & KTO_MAHN >= KO_VERZ_AB)   KTO_ST = 'D';        00013600
     WHEN(KTO_ST = 'D' & KTO_MAHN >= KO_ABSCHR_AB) KTO_ST = 'X';        00013700
     WHEN(KTO_ST = 'D' & KTO_MAHN = 0)             KTO_ST = 'A';        00013800
     OTHERWISE;                                                         00013900
   END;                                                                 00014000
                                                                        00014100
      KTAB_SATZ(I) = STRING(KTO_SATZ);                                  00014200
   WEITER:                                                              00014300
 END;                                                                   00014400
                                                                        00014500
 CLOSE FILE(TRANOUT);                                                   00014600
 call KBU00014;                                                         00014700
 CALL KBU00028;                                                         00014800
 CALL KBU00007(W_PGM, 'ENDE');                                          00014900
 CALL PLIRETC(W_RC);                                                    00015000
  RETURN;                                                               00015100
                                                                        00015200
 /*================================================================*/   00015300
 /*================================================================*/   00015500
-ZINSSATZ: PROC(Z#GRP, Z#TK);                                           00015600
   DCL Z#GRP CHAR(10);                                                  00015700
+  DCL Z#TK  CHAR(6);                                                   00015800
     $GEF = '0'B;                                                       00015900
     $P   = 0;                                                          00016000
    DO K = 1 TO ZS_N;                                                   00016100
     IF ZS_SCHL(K) = Z#GRP || Z#TK THEN DO;                             00016200
       $P = ZS_P(K); $GEF = '1'B; LEAVE;                                00016300
     END;                                                               00016400
   END;                                                                 00016500
     IF $GEF THEN RETURN;                                               00016600
   DO K = 1 TO ZS_N;                                                    00016700
     if ZS_SCHL(K) = $GRP_DEF || Z#TK then do;                          00016800
     $P = ZS_P(K); LEAVE;                                               00016900
     END;                                                               00017000
   END;                                                                 00017100
  END ZINSSATZ;                                                         00017200
+                                                                       00017300
 /*================================================================*/   00017400
 /* BELASTEN: BETRAG AUF KONTO, UMSATZ NACH TRANOUT                 */  00017500
 /*================================================================*/   00017600
-  BELASTEN: PROC(B#PFX, B#TYP, B#KAT, B#TXT, B#BTR);                   00017700
   DCL B#PFX CHAR(2), B#TYP CHAR(2), B#KAT CHAR(4);                     00017800
     DCL B#TXT CHAR(30), B#BTR FIXED DEC(15,2);                         00017900
   KTO_SLD     = KTO_SLD     + B#BTR;                                   00018000
   KTO_ZYK_SOL = KTO_ZYK_SOL + B#BTR;                                   00018100
   STRING(TRN_SATZ) = '';                                               00018200
   TRN_ID = B#PFX || KTO_NR || '000';                                   00018300
   TRN_TYP = B#TYP; TRN_KAT = B#KAT; TRN_QUELLE = 'ZINSLAUF';           00018400
   TRN_TXT = B#TXT; TRN_BTR = B#BTR; TRN_HDL = '000000000';             00018500
   TRN_MCC = '0000'; TRN_KARTE = ''; TRN_DT = W_LAUFDT;                 00018600
   STRING(BUC_SATZ) = '';                                               00018700
  BUC_TRN = SUBSTR(STRING(TRN_SATZ),1,110);                             00018800
   BUC_KTO = KTO_NR;                                                    00018900
   BUC_DT  = W_LAUFDT;                                                  00019000
   WRITE FILE(TRANOUT) FROM(BUC_SATZ);                                  00019100
   call KBU00027(B#TYP, B#BTR, 'E');                                    00019200
  END BELASTEN;                                                         00019300
                                                                        00019400
+/*================================================================*/   00019500
-ZS_LADEN: PROC;                                                        00019600
+  ON ENDFILE(DISCGRP) SW_EOF_DSC = '1'B;                               00019700
  OPEN FILE(DISCGRP);                                                   00019800
  READ FILE(DISCGRP) INTO(DSC_SATZ);                                    00019900
   DO WHILE(^SW_EOF_DSC);                                               00020000
     ZS_N = ZS_N + 1;                                                   00020100
     ZS_SCHL(ZS_N) = DSC_GRP || DSC_TYP || DSC_KAT;                     00020200
        ZS_P(ZS_N) = DSC_ZINS;                                          00020300
     READ FILE(DISCGRP) INTO(DSC_SATZ);                                 00020400
+ END;                                                                  00020500
     CLOSE FILE(DISCGRP);                                               00020600
 END ZS_LADEN;                                                          00020700
                                                                        00020800
  END KBP00002;                                                         00020900


# PLI/KBP00003
 /*******************************************************************/
 /*  PROGRAMM   KBP00003                                              */
 /*  JOB        KBJ00001  STEP030                                     */
 /*                                                                   */
 /*  KONTOAUSZUG + NEUER ZYKLUS                                       */
 /*    - MINDESTZAHLNUG BERECHENN                                     */
 /*    - AUSZUG SCHRIEBEN WENN BEWEGUNG ODER SALDO                    */
 /*    - ZYKLUSFELDER ZURUECKSETZEN                                   */
 /*                                                                   */
 /*  EINGAEB    CTLCARD ACCTFILE CUSTFILE                             */
 /*  AUSGABE    ACCTOUT STMTFILE                                      */
 /*                                                                   */
 /*  1995-02-20 HKR ERSTELLT                                          */
 /*  2001-06-14 WBE EURO-DOPPELAUSWEIS (KBU00020)                     */
 /*  2002-03-01 WBE DOPPELAUSWEIS ENDE - SCHALTER BLEIBT 'N'          */
 /*  2009-04-01 ALM NAME AUS KBU00018                                 */
 /*******************************************************************/
 KBP00003:
   PROCEDURE OPTIONS(MAIN);

  %INCLUDE KBC00001;
      %INCLUDE KBC00002;
      %INCLUDE KBC00007;
   %INCLUDE KBC00008;
   %INCLUDE KBC00010;
   %INCLUDE KBC00011;

   DECLARE CTLCARD  FILE RECORD INPUT;
   DECLARE STMTFILE FILE RECORD OUTPUT;

   DECLARE KBU00002 ENTRY(CHAR(8), FIXED BIN(31)) RETURNS(CHAR(8))
                    EXTERNAL;
   DECLARE KBU00005 ENTRY(FIXED DEC(31,10)) RETURNS(FIXED DEC(15,2))
                    EXTERNAL;
   DECLARE KBU00006 ENTRY(FIXED DEC(15,2), FIXED DEC(15,2))
                        RETURNS(FIXED DEC(15,2)) EXTERNAL;
   DECLARE KBU00007 ENTRY(CHAR(8), CHAR(*) VARYING) EXTERNAL;
   DECLARE KBU00011 ENTRY(CHAR(8), FIXED BIN(31), CHAR(*) VARYING)
                    EXTERNAL;
   DECLARE (KBU00012, KBU00014, KBU00018) ENTRY EXTERNAL;
   DECLARE KBU00019 ENTRY(CHAR(9), FIXED BIN(31)) EXTERNAL;
   DECLARE KBU00020 ENTRY(FIXED DEC(15,2), FIXED DEC(15,2)) EXTERNAL;

   DECLARE Â§I       FIXED BIN(31);
      DECLARE Â§KD      FIXED BIN(31);
   DECLARE Â§FAEL    CHAR(8);
      DECLARE Â§MIN     FIXED DEC(15,2);
   DECLARE Â§SLD     FIXED DEC(15,2); DECLARE Â§UEB     FIXED DEC(15,2);
   DECLARE Â§EUR     FIXED DEC(15,2); DECLARE Â§AUSZUG  BIT(1);

     W_PGM = 'KBP00003';
       W_RC  = 0;

   OPEN FILE(CTLCARD);
   READ FILE(CTLCARD) INTO(W_STEU);
  CLOSE FILE(CTLCARD);
   W_LAUFDT = SUBSTR(W_STEU,1,8);
   Â§FAEL = KBU00002(W_LAUFDT, KO_FAELLIG_TG);
    CALL KBU00007(W_PGM, 'FAELLIG AM ' || Â§FAEL);

   CALL KBU00012;
   CALL KBU00018;

   OPEN FILE(STMTFILE);

    do Â§I = 1 TO KTAB_ANZ;
     STRING(KTO_SATZ) = KTAB_SATZ(Â§I);
     IF KTO_ST ^= 'X' THEN
       DO;
           CALL MINDESTZAHLUNG;
         CALL AUSZUG; CALL NEUER_ZYKLUS;
         KTAB_SATZ(Â§I) = STRING(KTO_SATZ);
       END;
   END;

  CLOSE FILE(STMTFILE);
   CALL KBU00014; W_ZTXT = Z_GESCHR;
   CALL KBU00007(W_PGM, 'AUSZUEGE ' || W_ZTXT);
   CALL PLIRETC(W_RC);
   RETURN;

 /*------------------------------------------------------------------*/
    MINDESTZAHLUNG:
  PROCEDURE;
   Â§SLD = KTO_SLD;
    IF Â§SLD <= 0 THEN
     Â§MIN = 0;
   ELSE
   IF Â§SLD < KO_MINZ_MIN THEN
     Â§MIN = Â§SLD;
   else
     DO; Â§MIN = KBU00005(DIVIDE(Â§SLD * KO_MINZ_PROZ, 100, 31, 10));
       Â§MIN = KBU00006(Â§MIN, KO_MINZ_MIN);
       IF Â§SLD > KTO_KLIM THEN
       DO; Â§UEB = Â§SLD - KTO_KLIM;
         Â§MIN = Â§MIN + Â§UEB; END;
      IF Â§MIN > Â§SLD THEN Â§MIN = Â§SLD;
     end;
  END MINDESTZAHLUNG;

 /*------------------------------------------------------------------*/
 AUSZUG:
   PROCEDURE;
   Â§AUSZUG = (KTO_SLD ^= 0) | (KTO_ZYK_SOL ^= 0) | (KTO_ZYK_HAB ^= 0);
   if ^Â§AUSZUG then return;

      STRING(AZG_SATZ) = '';
   AZG_KTO = KTO_NR; CALL KBU00019(KTO_KDNR, Â§KD);
   IF Â§KD = 0 THEN
     AZG_NAME = 'UNBEKANNT';
       ELSE
      AZG_NAME = KD_NAME(Â§KD);
  IF SW_EURO = 'J' THEN
     DO;
       /* DM-BETARG ZUSAETZLICH (2001) - AUSGBAE ENTFERNT 2002       */
       Â§SLD = KTO_SLD;
       call KBU00020(Â§SLD, Â§EUR);
       AZG_SLD = Â§EUR;
     END;
   ELSE
     AZG_SLD = KTO_SLD;
   AZG_MINZ = Â§MIN; AZG_FAEL = Â§FAEL;
   AZG_PKT  = KTO_PKT;
    AZG_ST   = KTO_ST;
   AZG_SOL  = KTO_ZYK_SOL;
   AZG_HAB  = KTO_ZYK_HAB;
   WRITE FILE(STMTFILE) FROM(AZG_SATZ); Z_GESCHR = Z_GESCHR + 1;
   END AUSZUG;

 /*------------------------------------------------------------------*/
 NEUER_ZYKLUS:
   PROCEDURE;
   KTO_ZYK_SOL  = 0;
       KTO_ZYK_HAB  = 0;
   KTO_ZYK_ZAHL = 0; KTO_MINZ     = Â§MIN;
      END NEUER_ZYKLUS;

  END KBP00003;


# PLI/KBP00004
 /*******************************************************************/
 /*  PROGRAMM   KBP00004   ALTER ZINSLAUF                             */
 /*                                                                   */
 /*  PAUSCHAL 18 % P.A. AUF DEN POSITIVEN SALDO, MONATLICH.           */
 /*  KEINE GEBUEHREN, KEIN STATUS.                                    */
 /*                                                                   */
 /*  !!! ABGELOEST DURCH KBP00002 (1997). NICHT LOESCHEN, WIRD VON     */
 /*  !!! DER REVISION ALS NACHWEIS DER ALTEN BERECHNUNG GEBRAUCHT.     */
 /*                                                                   */
 /*  1994-03-11 HKR ERSTELLT                                          */
 /*  1996-01-15 HKR ZINSSATZ AUS STEUERKARTE SPALTE 9-12              */
 /*******************************************************************/
 KBP00004: PROC OPTIONS(MAIN);
   %INCLUDE KBC00001;
   %INCLUDE KBC00004;
   %INCLUDE KBC00011;
   DCL CTLCARD  FILE RECORD INPUT;
   DCL ACCTFILE FILE RECORD INPUT;
   DCL ACCTOUT  FILE RECORD OUTPUT;
   DCL TRANOUT  FILE RECORD OUTPUT;
  DCL KBU00007 ENTRY(CHAR(8), CHAR(*) VARYING) EXTERNAL;
   DCL A_SATZ   CHAR(140);
    dcl A_PROZ   FIXED DEC(5,2) INIT(18.00);
   DCL A_PROZ_K PIC '99V99';
   DCL A_ZINS   FIXED DEC(15,2);
   DCL A_EOF    BIT(1) INIT('0'B);

       W_PGM = 'KBP00004';
   OPEN FILE(CTLCARD);
  READ FILE(CTLCARD) INTO(W_STEU);
   CLOSE FILE(CTLCARD); W_LAUFDT = SUBSTR(W_STEU,1,8);
    IF SUBSTR(W_STEU,9,4) ^= '    ' THEN
         DO;
       STRING(A_PROZ_K) = SUBSTR(W_STEU,9,4);
       A_PROZ = A_PROZ_K;
     END;

     ON ENDFILE(ACCTFILE) A_EOF = '1'B;
       OPEN FILE(ACCTFILE), FILE(ACCTOUT), FILE(TRANOUT);
   READ FILE(ACCTFILE) INTO(A_SATZ);
   DO WHILE(^A_EOF); STRING(KTO_SATZ) = A_SATZ;
     IF SUBSTR(KTO_ALT_SCHL,12,1) = 'A' THEN
       IF KTO_SLD > 0 THEN
         DO;
           A_ZINS = KTO_SLD * A_PROZ / 1200;
           KTO_SLD = KTO_SLD + A_ZINS;
           STRING(TRN_SATZ) = '';
               TRN_ID  = 'ZA' || KTO_NR || '000'; TRN_TYP = '06';
           TRN_KAT = '0001';
           TRN_TXT = 'ZINSEN';
           TRN_BTR = A_ZINS; TRN_DT  = W_LAUFDT;
             WRITE FILE(TRANOUT) FROM(TRN_SATZ);
         END;
     A_SATZ = STRING(KTO_SATZ);
     WRITE FILE(ACCTOUT) FROM(A_SATZ);
     READ FILE(ACCTFILE) INTO(A_SATZ);
   end;
   CLOSE FILE(ACCTFILE), FILE(ACCTOUT), FILE(TRANOUT);
   CALL KBU00007(W_PGM, 'ENDE ALTER ZINSLAUF');
 END KBP00004;


# PLI/KBP00005
 /*******************************************************************/
 /*  PROGRAMM   KBP00005   MAHNBRIEFE                                 */
 /*  JOB        KBJ00003   (MONATLICH, SEIT 2016 AUSGEPLANT)          */
 /*                                                                   */
 /*  SCHREIBT FUER JEDES KONOT IM VERZUG (D) EINEN BRIEF NACH         */
 /*  BRIEFE. DIE BRIEFE KOMMEN SEIT 2016 AUS DEM OUTPUT-MANAGEMENT    */
 /*  (DOKUMENTENSYSTEM), DIESES PROGRAMM LAEUFT NICHT MEHR.           */
 /*                                                                   */
 /*  1999-02-01 WBE ERSTELT                                          */
 /*  2004-02-09 ALM 2. UND 3. MAHNSTUFE                               */
 /*  2016-01-31 RFI AUSGEPLANT (CHG0031415)                           */
 /*******************************************************************/
 KBP00005: PROC OPTIONS(MAIN);
   %INCLUDE KBC00001;
   %INCLUDE KBC00002;
      %INCLUDE KBC00007;
    %INCLUDE KBC00011;

   DCL CTLCARD  FILE RECORD INPUT;
   DCL BRIEFE   FILE STREAM OUTPUT PRINT;
  DCL (KBU00012, KBU00018) ENTRY EXTERNAL;
     DCL KBU00019 ENTRY(CHAR(9), FIXED BIN(31)) EXTERNAL;
   DCL KBU00002 ENTRY(CHAR(8), FIXED BIN(31)) RETURNS(CHAR(8))
                EXTERNAL;
   DCL KBU00007 ENTRY(CHAR(8), CHAR(*) VARYING) EXTERNAL;

   DCL M_I      FIXED BIN(31);
       DCL M_KD     FIXED BIN(31);
  DCL M_STUFE  FIXED BIN(15);
   DCL M_FRIST  CHAR(8);
   DCL M_BTR    PIC 'ZZZ.ZZZ.ZZ9V,99';
   dcl M_ANZ    FIXED BIN(31) INIT(0);

   dcl M_TXT(3,4) CHAR(60) VARYING STATIC INIT(
   'SEHR GEEHRTE KUNDIN, SEHR GEEHRTER KUNDE,',
     'LEIDER KONNTEN WIR IHRE MINDESTZAHLUNG NICHT FESTSTELLEN.',
     'BITTE UEBERWEISEN SIE DEN BETRAG BIS ZUM',
     'MIT FREUNDLICHEN GRUESSEN, IHRE KARTENBANK',
     'SEHR GEEHRTE KUNDIN, SEHR GEEHRTER KUNDE,',
     'TROTZ UNSERER ERINNERUNG IST KEINE ZAHLUNG EINGEGANGEN.',
     'WIR BITTEN SIE DRINGEND UM ZAHLUNG BIS ZUM',
      'IHRE KARTE KANN BIS ZUR ZAHLUNG GESPERRT WERDEN.',
      'SEHR GEEHRTE KUNDIN, SEHR GEEHRTER KUNDE,',
     'DIES IST UNSERE LETZTE MAHNUNG VOR DER KUENDIGUNG.',
     'OHNE ZAHLUNG BIS ZUM',
      'GEBEN WIR DIE FORDERUNG AN EIN INKASSOBUERO ABK.');

   W_PGM = 'KBP00005';
   OPEN FILE(CTLCARD); READ FILE(CTLCARD) INTO(W_STEU);
   CLOSE FILE(CTLCARD);
   W_LAUFDT = SUBSTR(W_STEU,1,8);
       M_FRIST = KBU00002(W_LAUFDT, 14);

   CALL KBU00012;
   call KBU00018;
   OPEN FILE(BRIEFE);

   DO M_I = 1 TO KTAB_ANZ;
     STRING(KTO_SATZ) = KTAB_SATZ(M_I); IF KTO_ST ^= 'D' THEN ITERATE;
     IF KTO_SLD <= 0 THEN ITERATE;
     select;
     WHEN(KTO_MAHN <= 2) M_STUFE = 1;
       WHEN(KTO_MAHN <= 4) M_STUFE = 2;
       OTHERWISE           M_STUFE = 3;
     END;
     CALL KBU00019(KTO_KDNR, M_KD);
     call BRIEF;
     M_ANZ = M_ANZ + 1;
   END;

     CLOSE FILE(BRIEFE);
   W_ZTXT = M_ANZ;
   CALL KBU00007(W_PGM, 'BRIEFE ' || W_ZTXT);
   RETURN;

 BRIEF: PROC;
   PUT FILE(BRIEFE) PAGE EDIT('KARTENBANK', 'KONTO ' || KTO_NR)
       (COL(5), A, COL(50), A);
   IF M_KD > 0 THEN
     PUT FILE(BRIEFE) SKIP(3) EDIT(KD_NAME(M_KD)) (COL(5), A);
   ELSE
     PUT FILE(BRIEFE) SKIP(3) EDIT('AN DEN KONTOINHABER') (COL(5), A);
   PUT FILE(BRIEFE) SKIP(4) EDIT(M_TXT(M_STUFE,1)) (COL(5), A);
   PUT FILE(BRIEFE) SKIP(2) EDIT(M_TXT(M_STUFE,2)) (COL(5), A);
       M_BTR = KTO_MINZ;
   PUT FILE(BRIEFE) SKIP(2) EDIT('OFFENER BETRAG: ', M_BTR, ' EUR')
          (COL(5), A, P'ZZZ.ZZZ.ZZ9V,99', A);
   PUT FILE(BRIEFE) SKIP(2) EDIT(M_TXT(M_STUFE,3), ' ',
          SUBSTR(M_FRIST,7,2), '.', SUBSTR(M_FRIST,5,2), '.',
       SUBSTR(M_FRIST,1,4)) (COL(5), 7 A);
       PUT FILE(BRIEFE) SKIP(3) EDIT(M_TXT(M_STUFE,4)) (COL(5), A);
   END BRIEF;

  END KBP00005;


# PLI/KBU00001
 /*******************************************************************/  00000100
 /*                                                                   */00000200
 /*  KBU00001   DATUMSROUTINEN (PAKET)                                */00000300
 /*                                                                   */00000400
 /*  KBU00002  DATUM + N TAGE          (CHAR(8), FIXED BIN(31))       */00000500
 /*  KBU00003  DATUMSVERGLEICH  -1/0/1 (CHAR(8), CHAR(8))             */00000600
 /*                                                                   */00000700
 /*  AENDERUNGEN                                                      */00000800
 /*  ---------------------------------------------------------------  */00000900
 /*  1994-03-11 HKR ERSTELLT (JJMMTT)                                 */00001000
 /*  1999-10-04 WBE Y2K: AUF JJJJMMTT UMGESTELLT, SCHALTJAHR 2000 !!  */00001100
 /*  2003-01-20 ALM KBU00003 NEU, VORHER INLINE IN JEDEM PROGRAMM     */00001200
 /*  2012-05-30 ALM TAGESSCHLEIFE STATT LILIAN (CEEDAYS GIBT ES IM    */00001300
 /*                 TESTSYSTEM NICHT)                                 */00001400
 /*                                                                   */00001500
 /*******************************************************************/  00001600
 KBU00001: PACKAGE EXPORTS(KBU00002, KBU00003);                         00001700
                                                                        00001800
    DCL TG#MON(12) FIXED BIN(15) STATIC                                 00001900
       INIT(31,28,31,30,31,30,31,31,30,31,30,31);                       00002000
                                                                        00002100
   DCL 1 D#ALT STATIC,                     /* JJMMTT VON 1994       */  00002200
         3 D#ALT_JJ  CHAR(2) INIT('94'),                                00002300
             3 D#ALT_JH  CHAR(2) INIT('19');                            00002400
                                                                        00002500
 /*-------------------------------------------------------------------*/00002600
 /* SCHALTJAHR ?                                                      */00002700
 /*-------------------------------------------------------------------*/00002800
  KBU0SJ: PROC(J#) RETURNS(BIT(1));                                     00002900
   DCL J# FIXED BIN(31);                                                00003000
  if MOD(J#,400) = 0 then return('1'B);                                 00003100
       ELSE                                                             00003200
     IF MOD(J#,100) = 0 THEN RETURN('0'B);                              00003300
     ELSE                                                               00003400
       IF MOD(J#,4) = 0 THEN RETURN('1'B);                              00003500
   RETURN('0'B);                                                        00003600
  end KBU0SJ;                                                           00003700
                                                                        00003800
 /*-------------------------------------------------------------------*/00003900
 /* TAGE IM MONAT                                                     */00004000
 /*-------------------------------------------------------------------*/00004100
  KBU0TM: PROC(J#, M#) RETURNS(FIXED BIN(15));                          00004200
    DCL (J#, M#) FIXED BIN(31);                                         00004300
   DCL R# FIXED BIN(15);                                                00004400
   R# = TG#MON(M#);                                                     00004500
   IF M# = 2 THEN                                                       00004600
      if KBU0SJ(J#) then R# = R# + 1;                                   00004700
   RETURN(R#);                                                          00004800
 END KBU0TM;                                                            00004900
                                                                        00005000
 /*-------------------------------------------------------------------*/00005100
 /* DATUM + ANZAHL TAGE (NUR VORWAERTS!)                              */00005200
 /*-------------------------------------------------------------------*/00005300
  KBU00002: PROC(P#DT, P#TG) RETURNS(CHAR(8));                          00005400
  DCL P#DT CHAR(8);                                                     00005500
      DCL P#TG FIXED BIN(31);                                           00005600
   DCL (W#JJ, W#MM, W#TT, W#I) FIXED BIN(31);                           00005700
   DCL W#ERG     CHAR(8);                                               00005800
   dcl W#ERG_P   PIC '(8)9' DEFINED(W#ERG);                             00005900
   DCL W#ZW      PIC '(4)9';                                            00006000
                                                                        00006100
  W#ZW = SUBSTR(P#DT,1,4);  W#JJ = W#ZW;                                00006200
   W#MM = SUBSTR(P#DT,5,2);                                             00006300
   W#TT = SUBSTR(P#DT,7,2);                                             00006400
                                                                        00006500
     IF P#TG < 0 THEN DO;                                               00006600
      /* RUECKWAERTS WAR NIE GEFORDERT                              */  00006700
      RETURN(P#DT);                                                     00006800
      END;                                                              00006900
                                                                        00007000
      DO W#I = 1 TO P#TG;                                               00007100
     W#TT = W#TT + 1;                                                   00007200
     if W#TT > KBU0TM(W#JJ, W#MM) then                                  00007300
       do;                                                              00007400
       W#TT = 1;                                                        00007500
         W#MM = W#MM + 1;                                               00007600
         if W#MM > 12 then do; W#MM = 1; W#JJ = W#JJ + 1; end;          00007700
         END;                                                           00007800
       END;                                                             00007900
                                                                        00008000
   W#ERG_P = W#JJ * 10000                                               00008100
               + W#MM * 100                                             00008200
           + W#TT;                                                      00008300
   RETURN(W#ERG);                                                       00008400
 END KBU00002;                                                          00008500
                                                                        00008600
 /*-------------------------------------------------------------------*/00008700
 /* VERGLEICH. JJJJMMTT IST ALS ZEICHENKETTE SORTIERBAR, ABER WIR     */00008800
 /* PRUEFEN TROTZDEM TEIL FUER TEIL (ALTE JJMMTT-LOGIK)               */00008900
 /*-------------------------------------------------------------------*/00009000
  KBU00003: PROC(P#A, P#B) RETURNS(FIXED BIN(15));                      00009100
     DCL (P#A, P#B) CHAR(8);                                            00009200
   DCL I# FIXED BIN(15);                                                00009300
   DCL 1 A# DEFINED(P#A),                                               00009400
         3 A#J CHAR(4), 3 A#M CHAR(2), 3 A#T CHAR(2);                   00009500
  DCL 1 B# DEFINED(P#B),                                                00009600
             3 B#J CHAR(4), 3 B#M CHAR(2), 3 B#T CHAR(2);               00009700
                                                                        00009800
   I# = 0;                                                              00009900
   IF A#J > B#J THEN I# = 1;                                            00010000
   ELSE IF A#J < B#J THEN I# = -1;                                      00010100
   ELSE DO;                                                             00010200
      IF A#M > B#M THEN I# = 1;                                         00010300
        ELSE IF A#M < B#M THEN I# = -1;                                 00010400
     ELSE DO;                                                           00010500
       IF A#T > B#T THEN I# = 1;                                        00010600
           ELSE IF A#T < B#T THEN I# = -1;                              00010700
      END;                                                              00010800
   END;                                                                 00010900
    RETURN(I#);                                                         00011000
   END KBU00003;                                                        00011100
                                                                        00011200
 /* ALTE ROUTINE JJMMTT -> JJJJMMTT, SEIT 2000 UNBENUTZT              */00011300
 KBU0Y2: PROC(P#D6) RETURNS(CHAR(8));                                   00011400
   DCL P#D6 CHAR(6);                                                    00011500
   IF SUBSTR(P#D6,1,2) >= D#ALT_JJ THEN                                 00011600
         RETURN(D#ALT_JH || P#D6);                                      00011700
  RETURN('20' || P#D6);                                                 00011800
 END KBU0Y2;                                                            00011900
                                                                        00012000
 end KBU00001;                                                          00012100


# PLI/KBU00004
 /*******************************************************************/
 /*  KBU00004   BETARGSROUTINEN (PAKET)                               */
 /*                                                                   */
 /*  KBU00005  KAUFMAENNISCH RUNDEN AUF 2 STELLEN                     */
 /*  KBU00006  GROESSERER VON ZWEI BETRAEGEN                          */
 /*                                                                   */
 /*  1995-06-02 HKR ERSTELLT                                          */
 /*  2001-12-28 WBE EURO: RUNDUNG GEPRUEFT, BLEIBT KAUFMAENNISCH      */
 /*  2007-03-14 ALM KBU00006 (MAX-BUILTIN WAR "ZU UNSICHER")          */
 /*******************************************************************/
  KBU00004: PACKAGE EXPORTS(KBU00005, KBU00006);

 KBU00005: PROC(B#IN) RETURNS(FIXED DEC(15,2));
   DCL B#IN  FIXED DEC(31,10);
   DCL B#OUT FIXED DEC(15,2);
      DCL B#HLF FIXED DEC(31,10);
   /* ROUND RUNDET IN PL/I VOM NULLPUNKT WEG; FUER POSITIVE BETRAEGE */
   /* IST DAS KAUFMAENNISCH. NEGATIVE KOMMEN HIER NICHHT VOR.         */
   B#HLF = ROUND(B#IN, 2);
       B#OUT = B#HLF; RETURN(B#OUT);
 END KBU00005;

 KBU00006: PROC(B#1, B#2) RETURNS(FIXED DEC(15,2));
     DCL (B#1, B#2) FIXED DEC(15,2);
   IF B#1 >= B#2 THEN
      RETURN(B#1);
     ELSE
      RETURN(B#2); END KBU00006;

 end KBU00004;


# PLI/KBU00007
 /*******************************************************************/
 /*  KBU00007   PROTOKOL (SYSPRINT)                                  */
 /*             RUFT KBU00008, DAS SCHREIBT WIRKLICH                  */
 /*  1994-03-11 HKR ERSTELLT                                          */
 /*  1998-09-09 HKR UMLEITUNG UEBER KBU00008 (FUER SPAETER: DB2-LOG)  */
 /*******************************************************************/
 KBU00007: PROC(P#PGM, P#TXT);
   dcl P#PGM CHAR(8);
     dcl P#TXT CHAR(*) VARYING;
   DCL KBU00008 ENTRY(CHAR(8), CHAR(*) VARYING, FIXED BIN(15))
                EXTERNAL;
   DCL L#STUFE FIXED BIN(15) STATIC INIT(1);
   CALL KBU00008(P#PGM, P#TXT, L#STUFE); END KBU00007;


# PLI/KBU00008
 /*******************************************************************/
 /*  KBU00008   PROTOKOLZEILE AUSGEBEN                               */
 /*  1998-09-09 HKR ERSTELLT                                          */
 /*  2005-11-11 ALM STUFE 0 = NICHTS AUSGEBEN (NIE BENUTZT)           */
 /*******************************************************************/
 KBU00008: PROC(P#PGM, P#TXT, P#ST);
   DCL P#PGM CHAR(8);
   DCL P#TXT CHAR(*) VARYING;
   DCL P#ST  FIXED BIN(15);
   DCL SYSPRINT FILE STREAM OUTPUT PRINT;
    DCL Z#ZEIT CHAR(9);
   IF P#ST = 0 THEN RETURN;
       Z#ZEIT = TIME();
   PUT FILE(SYSPRINT) SKIP EDIT(P#PGM, ' ', SUBSTR(Z#ZEIT,1,6), ' ',
       P#TXT) (A, A, A, A, A);
 END KBU00008;


# PLI/KBU00009
 /*******************************************************************/
 /*  KBU00009   LINEARE SUCHE IN EINER SCHLUESSELTABELLE              */
 /*             ERGEBNIS: INDEX ODER 0                                */
 /*  KBU00010   DASSELBE FUER 9-STELLIGE SCHLUESSEL (ALT)             */
 /*  1996-01-15 HKR ERSTELT                                          */
 /*******************************************************************/
 KBU00009: PROC(T#TAB, T#ANZ, T#KEY, T#IX);
   DCL T#TAB(*) CHAR(16);
     dcl T#ANZ    FIXED BIN(31);
  DCL T#KEY    CHAR(16);
  dcl T#IX     FIXED BIN(31);
   DCL T#I      FIXED BIN(31);
      DCL T#TAB9(*) CHAR(9);
   DCL T#KEY9   CHAR(9);

   T#IX = 0;
   DO T#I = 1 TO T#ANZ;
         IF T#TAB(T#I) = T#KEY THEN
       DO; T#IX = T#I;
         GOTO T#ENDE; END;
   END;
 T#ENDE:
   RETURN;

 KBU00010: ENTRY(T#TAB9, T#ANZ, T#KEY9, T#IX);
   T#IX = 0;
   do T#I = T#ANZ TO 1 BY -1;
     IF T#TAB9(T#I) = T#KEY9 THEN T#IX = T#I;
   END;
   RETURN;
 END KBU00009;


# PLI/KBU00011
 /*******************************************************************/
 /*  KBU00011   FEHLERBEHANDLUNG                                      */
 /*             SETZT W_RC (EXTERNAL) AUF DEN HOECHSTEN WERT,         */
 /*             SCHREIBT PROTOKOLL. BEI STUFE >= 16 ABBRUCH.          */
 /*  1994-03-11 HKR ERSTELT                                          */
 /*  2000-02-14 WBE ABBRUCH MIT STOP STATT SIGNAL ERROR               */
 /*******************************************************************/
  KBU00011: PROC(F#PGM, F#STUFE, F#TXT);
  DCL F#PGM   CHAR(8);
   dcl F#STUFE FIXED BIN(31);
   DCL F#TXT   CHAR(*) VARYING;
   DCL W_RC    FIXED BIN(31) EXTERNAL;
       DCL KBU00007 ENTRY(CHAR(8), CHAR(*) VARYING) EXTERNAL;
   DCL F#Z     PIC 'ZZZ9';

   F#Z = F#STUFE;
   CALL KBU00007(F#PGM, '*** FEHLER ' || F#Z || ': ' || F#TXT);
   IF F#STUFE > W_RC THEN W_RC = F#STUFE;
  IF F#STUFE >= 16 THEN
     DO;
       CALL KBU00007(F#PGM, '*** ABBRUCH');
       call PLIRETC(W_RC);
       STOP;
     END;
 END KBU00011;


# PLI/KBU00012
 /*******************************************************************/
 /*  KBU00012   KONTENTABELE (KBC00002)                              */
 /*                                                                   */
 /*    CALL KBU00012;                  LAEDN AUS ACCTFILE             */
 /*    CALL KBU00013(KONTONR, INDEX);  SUCHEN, INDEX 0 = FEHLT        */
 /*    CALL KBU00014;                  SCHREIBEN NACH ACCTOUT         */
 /*                                                                   */
 /*  REIHENFOLGE DER TABELLE = REIHENFOLGE IN ACCTFILE. NICHT          */
 /*  SORTIEREN, DIE NACHFOLGEJOBS VERLASSEN SICH DARAUF.              */
 /*                                                                   */
 /*  1996-01-15 HKR ERSTELLT                                          */
 /*  2003-05-05 ALM 2000 KONTEN, PRUEFUNG UEBERLAUF                   */
 /*  2010-08-19 ALM KBU00013: ERSTER TREFFER ZAEHLT                   */
 /*******************************************************************/
 KBU00012: PROC;
  %INCLUDE KBC00002;
   DCL ACCTFILE FILE RECORD INPUT;
   DCL ACCTOUT  FILE RECORD OUTPUT;
   dcl KBU00011 ENTRY(CHAR(8), FIXED BIN(31), CHAR(*) VARYING)
                   EXTERNAL;
   DCL KBU00007 ENTRY(CHAR(8), CHAR(*) VARYING) EXTERNAL;
   DCL KBU00022 ENTRY(CHAR(140)) RETURNS(FIXED BIN(15)) EXTERNAL;
   DCL K@FEHL   FIXED BIN(31) INIT(0);
  DCL K@SATZ   CHAR(140);
   DCL K@EOF    BIT(1);
   DCL K@I      FIXED BIN(31);
   DCL K@NR     CHAR(11);
       DCL K@IX     FIXED BIN(31);
  DCL K@Z      PIC 'ZZZZZ9';

   K@EOF    = '0'B;
   KTAB_ANZ = 0;
   ON ENDFILE(ACCTFILE) K@EOF = '1'B;
       OPEN FILE(ACCTFILE);
   READ FILE(ACCTFILE) INTO(K@SATZ);
   DO WHILE(^K@EOF);
     IF KTAB_ANZ >= HBOUND(KTAB_SATZ,1) THEN
       call KBU00011('KBU00012', 16, 'KONTENTABELLE VOLL');
      KTAB_ANZ = KTAB_ANZ + 1;
     KTAB_SATZ(KTAB_ANZ) = K@SATZ;
     K@FEHL = K@FEHL + KBU00022(K@SATZ);
     READ FILE(ACCTFILE) INTO(K@SATZ); END;
   CLOSE FILE(ACCTFILE);
    K@Z = KTAB_ANZ;
   CALL KBU00007('KBU00012', 'KONTEN GELADEN: ' || K@Z);
   IF K@FEHL > 0 THEN
   DO;
      K@Z = K@FEHL;
        CALL KBU00007('KBU00012', 'UNPLAUSIBLE FELDER: ' || K@Z);
         END; RETURN;

0/*-------------------------------------------------------------------*/
 KBU00013: ENTRY(K@NR, K@IX);
      K@IX = 0;
   K@I  = 1;
 K@SUCH:
   IF K@I > KTAB_ANZ THEN RETURN;
   IF SUBSTR(KTAB_SATZ(K@I),1,11) = K@NR THEN
     DO;
          K@IX = K@I;
        RETURN;
     END;
   K@I = K@I + 1;
   GOTO K@SUCH;

0/*-------------------------------------------------------------------*/
 KBU00014: ENTRY;
   OPEN FILE(ACCTOUT);
   DO K@I = 1 TO KTAB_ANZ;
      WRITE FILE(ACCTOUT) FROM(KTAB_SATZ(K@I));
   end;
   CLOSE FILE(ACCTOUT);
  K@Z = KTAB_ANZ;
   CALL KBU00007('KBU00014', 'KONTEN GESCHRIEBEN: ' || K@Z);
       return;
 END KBU00012;


# PLI/KBU00015
 /*******************************************************************/
 /*  KBU00015   SALDEN JE KONTO/TYP/KATEGORIE (KBC00005, TC_TAB)      */
 /*                                                                   */
 /*    CALL KBU00015;              LAEDN AUS TCATFILE                 */
 /*    CALL KBU00016(SCHL, BTR);   BETARG ZUBUCHEN (NEG = ABBUCHEN),  */
 /*                                FEHLT DER SCHLUESSEL: NEU MIT 0    */
 /*    CALL KBU00017;              SCHRIEBEN NACH TCATOUT             */
 /*                                                                   */
 /*  DIE TABELLE IST IMMER NACH TC_KEY SORTIERT (EINFUEGEN AN DER      */
 /*  RICHTIGEN STELLE), DESHALB IST TCATOUT SORTIERT.                 */
 /*                                                                   */
 /*  1997-08-02 HKR ERSTELLT                                          */
 /*  1997-09-15 HKR SORTIERT EINFUEGEN STATT SORT-STEP                */
 /*******************************************************************/
 KBU00015: PROC;
   %INCLUDE KBC00005;
    dcl TCATFILE FILE RECORD INPUT;
   DCL TCATOUT  FILE RECORD OUTPUT;
   DCL KBU00011 ENTRY(CHAR(8), FIXED BIN(31), CHAR(*) VARYING)
                EXTERNAL;
   dcl T@EOF    BIT(1);
     dcl (T@I, T@J, T@P) FIXED BIN(31);
   DCL T@SCHL   CHAR(17);
   DCL T@BTR    FIXED DEC(15,2);
   DCL T@GEF    BIT(1);

       TC_ANZ = 0;
   T@EOF  = '0'B;
   ON ENDFILE(TCATFILE) T@EOF = '1'B; OPEN FILE(TCATFILE);
   READ FILE(TCATFILE) INTO(TCA_SATZ);
       do WHILE(^T@EOF);
     CALL KBU00016(TCA_KTO || TCA_TYP || TCA_KAT, TCA_SLD);
     READ FILE(TCATFILE) INTO(TCA_SATZ);
   END;
   CLOSE FILE(TCATFILE);
       RETURN;

 /*-------------------------------------------------------------------*/
 KBU00016: ENTRY(T@SCHL, T@BTR);
   T@GEF = '0'B;
   T@P   = TC_ANZ + 1; DO T@I = 1 TO TC_ANZ WHILE(^T@GEF);
     IF TC_KEY(T@I) = T@SCHL THEN
       T@GEF = '1'B;
         else
       if TC_KEY(T@I) > T@SCHL then
         DO;
           T@P = T@I;
           LEAVE;
          END;
  END;
  if T@GEF then
     DO;
           T@I = T@I - 1;           /* DO-SCHLEIFE HAT SCHON ERHOEHT */
       TC_SLD(T@I) = TC_SLD(T@I) + T@BTR;
       RETURN; END;
    IF TC_ANZ >= HBOUND(TC_KEY,1) THEN
     call KBU00011('KBU00016', 16, 'SALDENTABELLE VOLL');
      DO T@J = TC_ANZ TO T@P BY -1;
     TC_KEY(T@J + 1) = TC_KEY(T@J);
         TC_SLD(T@J + 1) = TC_SLD(T@J);
   END;
       TC_ANZ = TC_ANZ + 1;
   TC_KEY(T@P) = T@SCHL;
     TC_SLD(T@P) = 0;
   TC_SLD(T@P) = TC_SLD(T@P) + T@BTR;
   RETURN;

 /*-------------------------------------------------------------------*/
  KBU00017: ENTRY;
  OPEN FILE(TCATOUT);
       DO T@I = 1 TO TC_ANZ;
      STRING(TCA_SATZ) = ''; TCA_KTO = SUBSTR(TC_KEY(T@I), 1, 11);
      TCA_TYP = SUBSTR(TC_KEY(T@I), 12, 2);
     TCA_KAT = SUBSTR(TC_KEY(T@I), 14, 4);
        TCA_SLD = TC_SLD(T@I);
        WRITE FILE(TCATOUT) FROM(TCA_SATZ);
   END;
   CLOSE FILE(TCATOUT);
    return;
 end KBU00015;


# PLI/KBU00018
 /*******************************************************************/
 /*  KBU00018   KUNDENTABELLE (KBC00007, KD_TAB)                      */
 /*    CALL KBU00018;               LADEN AUS CUSTFILE                */
 /*    CALL KBU00019(KDNR, INDEX);  SUCHEN, 0 = UNBEKANNT             */
 /*  KD_NAME = VORNAME + ' ' + NACHNAME, BEIDE OHNE LEERZEICHEN       */
 /*  2009-04-01 ALM ERSTELLT (VORHER CUSTFILE JE PROGRAMM GELESEN)    */
 /*******************************************************************/
     KBU00018: PROC;
      %INCLUDE KBC00007;
       DCL CUSTFILE FILE RECORD INPUT;
   DCL KBU00011 ENTRY(CHAR(8), FIXED BIN(31), CHAR(*) VARYING)
                EXTERNAL;
   DCL C@EOF BIT(1) INIT('0'B);
   DCL C@NR  CHAR(9);
  DCL (C@IX, C@I) FIXED BIN(31);

   KD_ANZ = 0; ON ENDFILE(CUSTFILE) C@EOF = '1'B;
   OPEN FILE(CUSTFILE);
   READ FILE(CUSTFILE) INTO(KDS_SATZ);
   DO WHILE(C@EOF = '0'B);
        IF KD_ANZ = HBOUND(KD_NR,1) THEN
       CALL KBU00011('KBU00018', 16, 'KUNDENTABELLE VOLL');
         KD_ANZ = KD_ANZ + 1;
        KD_NR(KD_ANZ)   = KDS_NR;
     KD_NAME(KD_ANZ) = TRIM(KDS_VORN) || ' ' || TRIM(KDS_NACHN);
     KD_FICO(KD_ANZ) = KDS_FICO;
     READ FILE(CUSTFILE) INTO(KDS_SATZ);
   END;
   CLOSE FILE(CUSTFILE);
   RETURN;

   KBU00019: ENTRY(C@NR, C@IX);
+  C@IX = 0;
   do C@I = 1 TO KD_ANZ UNTIL(C@IX > 0);
   if KD_NR(C@I) = C@NR then C@IX = C@I;
   END; END KBU00018;


# PLI/KBU00020
 /*******************************************************************/
 /*  KBU00020   EURO-UMRECHNUNG DM -> EUR FUER KONOTAUSZUG            */
 /*             AUFRUF NUR WENN SW_EURO = 'J'                         */
 /*  2001-06-14 WBE ERSTELT FUER DOPPELTE AUSWEISUNG 2001            */
 /*  2002-03-01 WBE DOPPELTE AUSWEISUNG BEENDET, SCHALTER AUS         */
 /*******************************************************************/
 KBU00020: PROC(E#BTR, E#ERG);
      DCL E#BTR  FIXED DEC(15,2);
   DCL E#ERG  FIXED DEC(15,2);
   DCL E#KURS FIXED DEC(7,5) STATIC INIT(1.95583);
     DCL E#ZW   FIXED DEC(31,10);
   DCL KBU00005 ENTRY(FIXED DEC(31,10)) RETURNS(FIXED DEC(15,2))
                EXTERNAL;

   IF E#BTR = 0 THEN
     DO;
           E#ERG = 0;
           RETURN; END;
  E#ZW  = DIVIDE(E#BTR, E#KURS, 31, 10);
   IF E#BTR < 0 THEN
     E#ERG = -KBU00005(-E#ZW);
  ELSE
    E#ERG = KBU00005(E#ZW);
     END KBU00020;


# PLI/KBU00021
 /*******************************************************************/
 /*  KBU00021   PLAUSIBILITAETSPRUFEUNG DER SAETZE (PAKET)            */
 /*                                                                   */
 /*  KBU00022  KONOTSATZ        (CHAR(140)) -> ANZAHL FEHLER          */
 /*  KBU00023  UMSATZSATZ       (CHAR(120)) -> ANZAHL FEHLER          */
 /*  KBU00024  KARTENSATZ       (CHAR(50))  -> ANZAHL FEHLER          */
 /*  KBU00025  DATUM GUELTIG ?  (CHAR(8))   -> '1'B / '0'B            */
 /*                                                                   */
 /*  ACHTUNG: DIE PRUEFUNGEN PROTOKOLLIEREN NUR (WARNUNG). ES WIRD    */
 /*  KEIN SATZ DESHALB ABGEWIESEN ODER GEAENDERT. BESCHLUSS FACHBE-   */
 /*  REICH 2006-05-10: "LIEBER BUCHEN ALS LIEGEN LASSEN".             */
 /*                                                                   */
 /*  1998-04-01 HKR ERSTELLT                                          */
 /*  2006-05-10 ALM NUR NOCH WARNUNG, VORHER RC 8                     */
 /*  2008-09-17 ALM KARTENSATZ                                        */
 /*******************************************************************/
 KBU00021: PACKAGE EXPORTS(KBU00022, KBU00023, KBU00024, KBU00025);

 DCL KBU00007 ENTRY(CHAR(8), CHAR(*) VARYING) EXTERNAL;
 DCL P#ZIFF   CHAR(10) STATIC INIT('0123456789');
  DCL P#VORZ   CHAR(2)  STATIC INIT('+-');
 DCL P#MAXW   FIXED BIN(31) STATIC INIT(50);
 DCL P#WARN   FIXED BIN(31) STATIC INIT(0);
 DCL P#TMON(12) FIXED BIN(15) STATIC
     INIT(31,29,31,30,31,30,31,31,30,31,30,31);

 /*-------------------------------------------------------------------*/
 /* WARNUNG AUSGEBEN, HOECHSTENS P#MAXW STUECK JE LAUF                */
 /*-------------------------------------------------------------------*/
   P#WARNUNG: PROC(W#WO, W#WAS, W#SCHL);
   DCL W#WO   CHAR(8);
   DCL W#WAS  CHAR(*) VARYING;
   DCL W#SCHL CHAR(*);
       P#WARN = P#WARN + 1; IF P#WARN > P#MAXW THEN RETURN;
   IF P#WARN = P#MAXW THEN
     do;
       call KBU00007(W#WO, 'WEITERE WARNUNGEN UNTERDRUECKT');
       return;
       end;
   CALL KBU00007(W#WO, 'WARNUNG ' || W#WAS || ' SATZ ' || W#SCHL);
 END P#WARNUNG;

 /*-------------------------------------------------------------------*/
 /* NUMERISCH MIT VORZEICHEN ?                                        */
 /*-------------------------------------------------------------------*/
 P#NUMS: PROC(N#F) RETURNS(BIT(1));
   DCL N#F CHAR(*);
       IF LENGTH(N#F) < 2 THEN RETURN('0'B);
   IF INDEX(P#VORZ, SUBSTR(N#F,1,1)) = 0 THEN RETURN('0'B);
  IF VERIFY(SUBSTR(N#F,2), P#ZIFF) ^= 0 THEN RETURN('0'B); RETURN('1'B);
 END P#NUMS;

 P#NUMU: PROC(N#F) RETURNS(BIT(1));
   DCL N#F CHAR(*);
   RETURN(VERIFY(N#F, P#ZIFF) = 0);
 end P#NUMU;

 /*-------------------------------------------------------------------*/
 KBU00025: PROC(D#DT) RETURNS(BIT(1));
   DCL D#DT CHAR(8);
   DCL (D#J, D#M, D#T) FIXED BIN(31);
  IF ^P#NUMU(D#DT) THEN RETURN('0'B);
   D#J = SUBSTR(D#DT,1,4);
   D#M = SUBSTR(D#DT,5,2);
   D#T = SUBSTR(D#DT,7,2);
  if D#J < 1900 | D#J > 2099 then return('0'B);
    IF D#M < 1 | D#M > 12 THEN RETURN('0'B);
   IF D#T < 1 | D#T > P#TMON(D#M) THEN RETURN('0'B);
   /* 29.02. IN NICHT-SCHALTJAHREN WIRD HIER NICHT ERKANNT (BEKANNT) */
      RETURN('1'B);
 END KBU00025;

 /*-------------------------------------------------------------------*/
 /* KONTOSATZ                                                         */
 /*-------------------------------------------------------------------*/
 KBU00022: PROC(K#S) RETURNS(FIXED BIN(15));
   DCL K#S CHAR(140);
   DCL K#F FIXED BIN(15) INIT(0);
  DCL K#NR CHAR(11);
   K#NR = SUBSTR(K#S,1,11);
   IF ^P#NUMU(K#NR) THEN
     DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','KTO-NR',K#NR); END;
    IF INDEX('ADCX', SUBSTR(K#S,12,1)) = 0 THEN
     DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','STATUS',K#NR); END;
   IF ^P#NUMS(SUBSTR(K#S,13,11)) THEN
     DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','SALDO',K#NR); END;
  if ^P#NUMU(SUBSTR(K#S,24,10)) then
     DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','KREDITLIM',K#NR);
     END;
   IF ^P#NUMU(SUBSTR(K#S,34,10)) THEN
     DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','BARLIM',K#NR); END;
   IF ^KBU00025(SUBSTR(K#S,44,8)) THEN
     DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','ERDT',K#NR); END;
  if ^KBU00025(SUBSTR(K#S,52,8)) then
     DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','ABDT',K#NR); END;
   IF ^P#NUMS(SUBSTR(K#S,60,11)) THEN
     DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','ZYK-HAB',K#NR); END;
   IF ^P#NUMS(SUBSTR(K#S,71,11)) THEN
     DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','ZYK-SOL',K#NR); END;
   IF ^P#NUMU(SUBSTR(K#S,92,2)) THEN
     do; K#F = K#F + 1; call P#WARNUNG('KBU00022','MAHNST',K#NR); END;
    IF ^P#NUMS(SUBSTR(K#S,94,11)) THEN
         DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','MINZ',K#NR); END;
   IF ^P#NUMS(SUBSTR(K#S,105,11)) THEN
     DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','ZAHL',K#NR); end;
   IF ^P#NUMU(SUBSTR(K#S,116,9)) THEN
     DO; K#F = K#F + 1; CALL P#WARNUNG('KBU00022','PUNKTE',K#NR); END;
   RETURN(K#F);
 END KBU00022;

 /*-------------------------------------------------------------------*/
 /* UMSATZSATZ                                                        */
 /*-------------------------------------------------------------------*/
 KBU00023: PROC(U#S) RETURNS(FIXED BIN(15));
   DCL U#S  CHAR(120);
   DCL U#F  FIXED BIN(15) INIT(0);
   DCL U#ID CHAR(16);
   U#ID = SUBSTR(U#S,1,16);
   IF U#ID = '' THEN
     DO; U#F = U#F + 1; CALL P#WARNUNG('KBU00023','ID LEER',U#ID); END;
   IF ^P#NUMU(SUBSTR(U#S,17,2)) THEN
     do; U#F = U#F + 1; call P#WARNUNG('KBU00023','TYP',U#ID); END;
   IF ^P#NUMU(SUBSTR(U#S,19,4)) THEN
     DO; U#F = U#F + 1; CALL P#WARNUNG('KBU00023','KATEGORIE',U#ID);
   END;
   IF ^P#NUMS(SUBSTR(U#S,63,11)) THEN
     DO; U#F = U#F + 1; CALL P#WARNUNG('KBU00023','BETRAG',U#ID); END;
   IF ^P#NUMU(SUBSTR(U#S,83,4)) THEN
        do; U#F = U#F + 1; call P#WARNUNG('KBU00023','MCC',U#ID); END;
    if ^P#NUMU(SUBSTR(U#S,87,16)) then
     DO; U#F = U#F + 1; CALL P#WARNUNG('KBU00023','KARTE',U#ID); END;
  IF ^KBU00025(SUBSTR(U#S,103,8)) THEN
        DO; U#F = U#F + 1; CALL P#WARNUNG('KBU00023','DATUM',U#ID); end;
     RETURN(U#F);
 END KBU00023;

 /*-------------------------------------------------------------------*/
 /* KARTENSATZ                                                        */
 /*-------------------------------------------------------------------*/
 KBU00024: PROC(X#S) RETURNS(FIXED BIN(15));
   DCL X#S CHAR(50);
   DCL X#F FIXED BIN(15) INIT(0);
      IF ^P#NUMU(SUBSTR(X#S,1,16)) THEN
     DO;
       X#F = X#F + 1;
       CALL P#WARNUNG('KBU00024', 'KARTE', SUBSTR(X#S,1,16));
     END;
       IF ^P#NUMU(SUBSTR(X#S,26,11)) THEN
     DO;
           X#F = X#F + 1;
       CALL P#WARNUNG('KBU00024', 'KONTO', SUBSTR(X#S,1,16));
     END;
   /* STATUS: Y = AKTIV, ALLES ANDERE GILT ALS GESPERRT. FRUEHER      */
   /* GAB ES 'N' UND 'S' (STORNIERT), HEUTE KOMMT AUCH ' ' VOR.       */
   return(X#F);
    END KBU00024;

 END KBU00021;


# PLI/KBU00026
 /*******************************************************************/
 /*  KBU00026   ABSTIMMSUMMEN UND LAUFSTATISTIK (SYSPRINT-LISTE)      */
 /*                                                                   */
 /*    CALL KBU00026(PGM, DATUM);          LISTE ANFANGEN             */
 /*    CALL KBU00027(TYP, BETARG, ART);    ZAEHLEN, ART G/A/E         */
 /*                                        (GEBUCHT/ABGEWIESEN/ERZ.)  */
 /*    CALL KBU00028;                      LISTE DRUCKEN              */
 /*                                                                   */
 /*  DIE LISTE GEHT AN DIE FACHABTEILUNG (ABSTIMMUNG MIT DEM          */
 /*  HAUPTBUCH). SIE BEEINFLUSST DIE VERARBEITUNG NICHT.              */
 /*                                                                   */
 /*  1996-01-15 HKR ERSTELT                                          */
 /*  2006-10-10 ALM ART E (ERZEUGTE BUCHUNGEN, BARGELDGEBUEHR)        */
+/*  2014-11-03 RFI ZINSLAUF BENUTZT DIE LISTE AUCH                   */
 /*******************************************************************/
 KBU00026: PROC(S#PGM, S#DT);
      DCL S#PGM CHAR(8);
   DCL S#DT  CHAR(8);
    DCL S#TYP CHAR(2);
+ DCL S#BTR FIXED DEC(15,2);
  DCL S#ART CHAR(1);

   DCL SYSPRINT FILE STREAM OUTPUT PRINT;

   DCL 1 S#TAB STATIC,
             3 S#ZEILE(9),
           5 S#Z_TYP   CHAR(2),
           5 S#Z_ANZ   (3) FIXED DEC(9),
           5 S#Z_SUM   (3) FIXED DEC(17,2);
   dcl S#KOPF_PGM CHAR(8)  STATIC;
   DCL S#KOPF_DT  CHAR(8)  STATIC;
   DCL S#SEITE    FIXED BIN(15) STATIC INIT(0);
  DCL S#ZL       FIXED BIN(15) STATIC INIT(99);
   DCL (S#I, S#J) FIXED BIN(15);
   DCL S#GES_ANZ  (3) FIXED DEC(9);
     DCL S#GES_SUM  (3) FIXED DEC(17,2);
   DCL S#TXT(3)   CHAR(12) STATIC
      INIT('GEBUCHT', 'ABGEWIESEN', 'ERZEUGT');

   S#KOPF_PGM = S#PGM;
  S#KOPF_DT  = S#DT;
   DO S#I = 1 TO 9;
   S#Z_TYP(S#I) = '0' || CHAR(S#I);
         S#Z_TYP(S#I) = TRANSLATE(S#Z_TYP(S#I), '0', ' ');
       S#Z_ANZ(S#I,*) = 0;
     S#Z_SUM(S#I,*) = 0;
   END;
   RETURN;

0/*-------------------------------------------------------------------*/
 KBU00027: ENTRY(S#TYP, S#BTR, S#ART);
   S#J = INDEX('GAE', S#ART);
   if S#J = 0 then return;
   S#I = 0;
   ON CONVERSION S#I = 9;
   S#I = S#TYP;
   REVERT CONVERSION;
    IF S#I < 1 | S#I > 9 THEN S#I = 9;
+     S#Z_ANZ(S#I, S#J) = S#Z_ANZ(S#I, S#J) + 1;
       S#Z_SUM(S#I, S#J) = S#Z_SUM(S#I, S#J) + S#BTR;
   RETURN;

0/*-------------------------------------------------------------------*/
    KBU00028: ENTRY;
   S#GES_ANZ = 0; S#GES_SUM = 0;
   CALL S#KOPF;
    DO S#I = 1 TO 9;
     IF SUM(S#Z_ANZ(S#I,*)) = 0 THEN ITERATE;
     IF S#ZL > 50 THEN CALL S#KOPF;
     PUT FILE(SYSPRINT) SKIP EDIT
       (S#Z_TYP(S#I),
+       (S#Z_ANZ(S#I,S#J), S#Z_SUM(S#I,S#J) DO S#J = 1 TO 3))
       (COL(2), A(2), 3 (COL(10), F(9), X(2), P'ZZZ.ZZZ.ZZZ.ZZ9V,99-'));
     S#ZL = S#ZL + 1;
     DO S#J = 1 TO 3;
          S#GES_ANZ(S#J) = S#GES_ANZ(S#J) + S#Z_ANZ(S#I,S#J);
          S#GES_SUM(S#J) = S#GES_SUM(S#J) + S#Z_SUM(S#I,S#J);
     end; END;
   PUT FILE(SYSPRINT) SKIP(2) EDIT
     ('SUMME', (S#GES_ANZ(S#J), S#GES_SUM(S#J) DO S#J = 1 TO 3))
    (COL(2), A(5), 3 (COL(10), F(9), X(2), P'ZZZ.ZZZ.ZZZ.ZZ9V,99-'));
   RETURN;

0/*-------------------------------------------------------------------*/
-S#KOPF: PROC;
   S#SEITE = S#SEITE + 1;
    PUT FILE(SYSPRINT) PAGE EDIT
         ('KARTENBANK  ABSTIMMLISTE', S#KOPF_PGM, 'LAUF', S#KOPF_DT,
      'SEITE', S#SEITE)
     (COL(2), A, COL(40), A, COL(52), A, X(1), A, COL(70), A, F(4));
   PUT FILE(SYSPRINT) SKIP(2) EDIT
     ('TYP', S#TXT(1), S#TXT(2), S#TXT(3))
     (COL(2), A, COL(10), A, COL(43), A, COL(76), A); S#ZL = 4;
 END S#KOPF;

 end KBU00026;


# INCLUDE/KBC00001
 /*******************************************************************/
 /* KBC00001  KONTOSTAMMSATZ (ACCTFILE / ACCTOUT)   LRECL=140 FB      */
 /*                                                                   */
 /* AENDERUNGEN                                                       */
 /*   1994-03-11  HKR  ERSTELT                                       */
 /*   1997-08-02  HKR  KTO_GRP NEU (OFFENLEGUNGSGRUPPE)               */
 /*   1999-11-30  WBE  Y2K: ERDT/ABDT AUF 8 STELLEN                   */
 /*   2001-06-14  WBE  KTO_PKT BONUSPUNKTE                            */
 /*   2004-02-09  ALM  KTO_MAHN, KTO_MINZ, KTO_ZYK_ZAHL               */
 /*   2011-10-21  ALM  KTO_KDNR STATT XREF-SUCHE IM ZINSLAUF          */
 /*******************************************************************/
  DCL 1 KTO_SATZ,
           3 KTO_NR          CHAR(11),          /* KONOTNUMMER        */
        3 KTO_ST          CHAR(1),           /* A/D/C/X            */
        3 KTO_SLD         PIC 'S99999999V99',/* SALDO              */
         3 KTO_KLIM        PIC '99999999V99', /* KREDITLIMIT        */
        3 KTO_BLIM        PIC '99999999V99', /* BARGELDLIMIT       */
        3 KTO_ERDT        CHAR(8),           /* ERDT               */
        3 KTO_ABDT        CHAR(8),           /* ABLAUF KARTE       */
      3 KTO_ZYK_HAB     PIC 'S99999999V99',
        3 KTO_ZYK_SOL     PIC 'S99999999V99',
          3 KTO_GRP         CHAR(10),
         3 KTO_MAHN        PIC '99',
        3 KTO_MINZ        PIC 'S99999999V99',
        3 KTO_ZYK_ZAHL    PIC 'S99999999V99',
        3 KTO_PKT         PIC '(9)9',
        3 KTO_KDNR        CHAR(9),
        3 FILLER          CHAR(7);
 /* ALTE SICHT AUF DEN SATZ, NUR NOCH VON KBP00004 BENUTZT          */
  DCL 1 KTO_ALT DEFINED(KTO_SATZ),
        3 KTO_ALT_SCHL    CHAR(12),
        3 KTO_ALT_REST    CHAR(128);


# INCLUDE/KBC00002
 /*******************************************************************/
 /* KBC00002  KONTENTABELLE IM SPEICHER, GEMEINSAM FUER ALLE         */
 /*           PROGRAMME DES LAUFS (EXTERNAL). PFLEGE NUR UEBER       */
 /*           KBU00012 / KBU00013 / KBU00014 !!!                      */
 /*   1996-01-15  HKR  ERSTELLT (500 KONTEN)                          */
 /*   2003-05-05  ALM  AUF 2000 KONTEN ERWEITERT                      */
 /*******************************************************************/
    DCL 1 KTAB EXTERNAL,
      3 KTAB_ANZ        FIXED BIN(31),
        3 KTAB_SATZ(2000) CHAR(140);


# INCLUDE/KBC00003
 /*******************************************************************/
 /* KBC00003  KARTEN-QUERVERWEIS (XREFFILE)          LRECL=50  FB     */
 /*   1994-03-11  HKR  ERSTELLT                                       */
 /*   2008-09-17  ALM  XRF_ST KRATENSTAUTS (Y AKTIV, SONST GESPERRT)  */
 /*******************************************************************/
  DCL 1 XRF_SATZ,
        3 XRF_KARTE       CHAR(16),
        3 XRF_KDNR        CHAR(9),
        3 XRF_KTO         CHAR(11),
        3 XRF_ST          CHAR(1),
        3 FILLER          CHAR(13);


# INCLUDE/KBC00004
 /*******************************************************************/  00000100
 /* KBC00004  TAGESUMSATZ (DALYTRAN)                  LRECL=120 FB    */00000200
 /*           GEBUCHTER UMSATZ (TRANOUT)              LRECL=130 FB    */00000300
 /*                                                                   */00000400
 /*                                                                   */00000700
 /*   1994-03-11  HKR  ERSTELLT                                       */00000800
 /*   1999-11-30  WBE  Y2K TRN_DT                                     */00000900
 /*   2002-12-01  ALM  TRN_MCC HAENDLERKATEGORIE                      */00001000
 /*******************************************************************/  00001100
  DCL 1 TRN_SATZ,                                                       00001200
        3 TRN_ID          CHAR(16),                                     00001300
        3 TRN_TYP         CHAR(2),                                      00001400
        3 TRN_KAT         CHAR(4),                                      00001500
        3 TRN_QUELLE      CHAR(10),                                     00001600
        3 TRN_TXT         CHAR(30),                                     00001700
          3 TRN_BTR         PIC 'S99999999V99',                         00001800
        3 TRN_HDL         CHAR(9),                                      00001900
        3 TRN_MCC         CHAR(4),                                      00002000
        3 TRN_KARTE       CHAR(16),                                     00002100
        3 TRN_DT          CHAR(8),                                      00002200
      3 FILLER          CHAR(10);                                       00002300
  DCL 1 BUC_SATZ,                                                       00002400
        3 BUC_TRN         CHAR(110),                                    00002500
        3 BUC_KTO         CHAR(11),                                     00002600
           3 BUC_DT          CHAR(8),                                   00002700
        3 FILLER          CHAR(1);                                      00002800


# INCLUDE/KBC00005
 /*******************************************************************/
 /* KBC00005  SALDO JE KONOT/TYP/KATEGORIE (TCATFILE)  LRECL=30 FB    */
 /*           + TABELLE IM SPEICHER, SORTIERT NACH TC_KEY            */
 /*   1997-08-02  HKR  ERSTELLT                                       */
 /*******************************************************************/
  dcl 1 TCA_SATZ,
        3 TCA_KTO         CHAR(11),
      3 TCA_TYP         CHAR(2),
          3 TCA_KAT         CHAR(4),
        3 TCA_SLD         PIC 'S99999999V99',
        3 FILLER          CHAR(2);
  DCL 1 TC_TAB EXTERNAL,
        3 TC_ANZ          FIXED BIN(31),
        3 TC_E(3000),
          5 TC_KEY        CHAR(17),
          5 TC_SLD        FIXED DEC(15,2);


# INCLUDE/KBC00006
 /*******************************************************************/
 /* KBC00006  OFFENLEGUNGSGRUPPEN / ZINSSAETZE (DISCGRP) LRECL=20     */
 /*           DSC_ZINS = JAHRESZINS IN PROZENT, 2 NACHKOMMA           */
 /*           GRUPPE 'DEFAULT' GILT WENN NICHTS ANDERES DA            */
 /*   1997-08-02  HKR  ERSTELT                                       */
 /*******************************************************************/
  DCL 1 DSC_SATZ,
        3 DSC_GRP         CHAR(10),
        3 DSC_TYP         CHAR(2),
        3 DSC_KAT         CHAR(4),
        3 DSC_ZINS        PIC '99V99';


# INCLUDE/KBC00007
 /*******************************************************************/
 /* KBC00007  KUDNENSATZ (CUSTFILE)                   LRECL=60  FB    */
 /*   1994-03-11  HKR  ERSTELLT                                       */
 /*   2009-04-01  ALM  KDS_FICO (BONITAET)                            */
 /*******************************************************************/
  DCL 1 KDS_SATZ,
       3 KDS_NR          CHAR(9),
      3 KDS_VORN        CHAR(20),
        3 KDS_NACHN       CHAR(25),
        3 KDS_FICO        PIC '999',
        3 FILLER          CHAR(3);
  DCL 1 KD_TAB EXTERNAL,
          3 KD_ANZ          FIXED BIN(31),
         3 KD_E(2000),
          5 KD_NR         CHAR(9),
          5 KD_NAME       CHAR(46) VARYING,
          5 KD_FICO       FIXED BIN(15);


# INCLUDE/KBC00008
 /*******************************************************************/
 /* KBC00008  KONTOAUSZUG (STMTFILE)                  LRECL=120 FB    */
 /*   1995-02-20  HKR  ERSTELLT                                       */
 /*   2004-02-09  ALM  AZG_MINZ, AZG_FAEL                             */
 /*******************************************************************/
  DCL 1 AZG_SATZ,
        3 AZG_KTO         CHAR(11),
           3 AZG_NAME        CHAR(46),
            3 AZG_SLD         PIC 'S99999999V99',
         3 AZG_MINZ        PIC 'S99999999V99',
        3 AZG_FAEL        CHAR(8),
        3 AZG_PKT         PIC '(9)9',
        3 AZG_ST          CHAR(1),
        3 AZG_SOL         PIC 'S99999999V99',
        3 AZG_HAB         PIC 'S99999999V99',
      3 FILLER          CHAR(1);


# INCLUDE/KBC00009
 /*******************************************************************/
 /* KBC00009   ABGEWIESENER UMSATZ (REJECTS)           LRECL=50  FB    */
 /*******************************************************************/
  DCL 1 ABW_SATZ,
        3 ABW_TRN         CHAR(16),
        3 ABW_GRD         PIC '999',
        3 ABW_TXT         CHAR(30),
          3 FILLER          CHAR(1);


# INCLUDE/KBC00010
 /*******************************************************************/
 /* KBC00010  KONSTANTEN KRATENBANK                                   */
 /*   ACHTUNG: NICHT ALLE PROGRAMME BENUTZEN DIESE KONSTANTEN,        */
 /*   EINIGE WERTE STEHEN AUCH DIREKT IM CODE.                        */
 /*   1994-03-11  HKR  ERSTELT                                       */
 /*   2001-12-28  WBE  EURO-UMSTELLUNG (KO_EURO_KURS)                 */
 /*   2004-02-09  ALM  MAHNWESEN                                      */
 /*   2013-07-01  ALM  MCC SPERRE GLUECKSSPIEL                        */
 /*******************************************************************/
  dcl KO_TYP_KAUF      CHAR(2) STATIC INIT('01');
  DCL KO_TYP_ZAHL      CHAR(2) STATIC INIT('02');
  DCL KO_TYP_GUT       CHAR(2) STATIC INIT('03');
     DCL KO_TYP_BAR       CHAR(2) STATIC INIT('04');
     DCL KO_TYP_GEB       CHAR(2) STATIC INIT('05');
  DCL KO_TYP_ZINS      CHAR(2) STATIC INIT('06');
     DCL 1 KO_ABW_TAB STATIC,
        3 KO_ABW(12),
           5 KO_ABW_CD   FIXED BIN(15)
           INIT(100,101,102,103,104,105,106,107,108,109,110,111),
           5 KO_ABW_TX   CHAR(30)
            INIT('KARTE UNBEKANNT',
                 'KARTE GESPERRT',
                 'KONTO UNBEKANNT',
                 'KONTO GESCHLOSSEN',
                    'KONTO IM VERZUG',
                 'KARTE ABGELAUFEN',
                 'KREDITLIMIT UEBERSCHRITTEN',
                 'BARGELDLIMIT UEBERSCHRITTEN',
                 'HAENDLERKATEGORIE GESPERRT',
                 'BETRAG UNGUELTIG',
                   'DOPPELTE TRANSAKTION',
                 'TRANSAKTIONSTYP UNBEKANNT');
  DCL KO_MCC_SPERR     CHAR(4) STATIC INIT('7995');
  DCL KO_MCC_LEBM      CHAR(4) STATIC INIT('5411');
  DCL KO_MCC_REST      CHAR(4) STATIC INIT('5812');
  DCL KO_MCC_ATM       CHAR(4) STATIC INIT('6011');  /* NICHHT MEHR */
  dcl KO_GEB_BAR_PROZ  FIXED DEC(15,2) STATIC INIT(5.00);
    DCL KO_GEB_BAR_MIN   FIXED DEC(15,2) STATIC INIT(10.00);
  DCL KO_MAHN_1        FIXED DEC(15,2) STATIC INIT(25.00);
     DCL KO_MAHN_2        FIXED DEC(15,2) STATIC INIT(35.00);
     DCL KO_UEBZ          FIXED DEC(15,2) STATIC INIT(29.00);
  DCL KO_MINZ_MIN      FIXED DEC(15,2) STATIC INIT(25.00);
  DCL KO_MINZ_PROZ     FIXED DEC(15,2) STATIC INIT(2.00);
  DCL KO_ZINS_FREI     FIXED DEC(15,2) STATIC INIT(1.00);
  DCL KO_AUFS_VERZ     FIXED DEC(5,2)  STATIC INIT(3.00);
  DCL KO_AUFS_FICO     FIXED DEC(5,2)  STATIC INIT(2.00);
      DCL KO_FICO_GRENZE   FIXED BIN(15)   STATIC INIT(600);
  DCL KO_FAELLIG_TG    FIXED BIN(31)   STATIC INIT(25);
  dcl KO_VERZ_AB       FIXED BIN(15)   STATIC INIT(2);
     DCL KO_ABSCHR_AB     FIXED BIN(15)   STATIC INIT(6);
      DCL KO_EURO_KURS     FIXED DEC(7,5)  STATIC INIT(1.95583);
  DCL KO_MAX_PKT       FIXED DEC(11)   STATIC INIT(999999999);


# INCLUDE/KBC00011
 /*******************************************************************/
 /* KBC00011  ARBEITSFELDER, SCHALTER, ZAEHLER                        */
 /*   W_RC IST EXTERNAL: JEDES UNTERPROGRAMM DARF ES HOCHSETZEN,      */
 /*   DER JOBSTEP ENDET MIT DIESEM RETURNCODE.                        */
 /*******************************************************************/
  DCL W_LAUFDT         CHAR(8);
  DCL 1 W_LDT          DEFINED(W_LAUFDT),
        3 W_LDT_JJJJ   CHAR(4),
        3 W_LDT_MM     CHAR(2),
        3 W_LDT_TT     CHAR(2);
  DCL W_STEU           CHAR(80);
  DCL W_RC             FIXED BIN(31) EXTERNAL;
      DCL W_PGM            CHAR(8);
  DCL (SW_EOF_TRN,
        SW_EOF_KTO,
        SW_EOF_XRF,
       SW_EOF_TCA,
           SW_EOF_DSC,
        SW_EOF_KDS)     BIT(1) INIT('0'B);
  DCL SW_EURO          CHAR(1) INIT('N');
  DCL SW_TEST          BIT(1)  INIT('0'B);
  dcl (Z_GELESEN,
          Z_GEBUCHT,
       Z_ABGEW,
       Z_GESCHR)       FIXED DEC(7) INIT(0);
  dcl (W_HV1, W_HV2, W_HV3) FIXED DEC(15,2);
     DCL W_TXT            CHAR(120) VARYING;
      DCL W_ZTXT           PIC 'ZZZZZZ9';
