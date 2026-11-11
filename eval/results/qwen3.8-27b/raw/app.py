#!/usr/bin/env python3
import sys
import os
import math
from datetime import datetime, timedelta

# Constants
KO_TYP_KAUF = '01'
KO_TYP_ZAHL = '02'
KO_TYP_GUT = '03'
KO_TYP_BAR = '04'
KO_TYP_GEB = '05'
KO_TYP_ZINS = '06'
KO_MCC_SPERR = '7995'
KO_MCC_LEBM = '5411'
KO_MCC_REST = '5812'
KO_GEB_BAR_PROZ = 5.00
KO_GEB_BAR_MIN = 10.00
KO_MAHN_1 = 25.00
KO_MAHN_2 = 35.00
KO_UEBZ = 29.00
KO_MINZ_MIN = 25.00
KO_MINZ_PROZ = 2.00
KO_ZINS_FREI = 1.00
KO_AUFS_VERZ = 3.00
KO_AUFS_FICO = 2.00
KO_FICO_GRENZE = 600
KO_FAELLIG_TG = 25
KO_VERZ_AB = 2
KO_ABSCHR_AB = 6
KO_EURO_KURS = 1.95583
KO_MAX_PKT = 999999999

REJECT_TEXTS = {
    100: 'KARTE UNBEKANNT',
    101: 'KARTE GESPERRT',
    102: 'KONTO UNBEKANNT',
    103: 'KONTO GESCHLOSSEN',
    104: 'KONTO IM VERZUG',
    105: 'KARTE ABGELAUFEN',
    106: 'KREDITLIMIT UEBERSCHRITTEN',
    107: 'BARGELDLIMIT UEBERSCHRITTEN',
    108: 'HAENDLERKATEGORIE GESPERRT',
    109: 'BETRAG UNGUELTIG',
    110: 'DOPPELTE TRANSAKTION',
    111: 'TRANSAKTIONSTYP UNBEKANNT'
}

def round2(val):
    """Commercial rounding (half away from zero) to 2 decimals."""
    if val >= 0:
        return math.floor(val * 100 + 0.5) / 100.0
    else:
        return math.ceil(val * 100 - 0.5) / 100.0

def parse_signed_decimal(s, length):
    """Parse a signed decimal string with implied decimal point.
    Format: S99999999V99 (11 chars) or similar.
    The 'V' is implied, so the last 2 digits are decimals.
    """
    s = s.strip()
    if not s:
        return 0.0
    
    sign = 1
    if s[0] == '-':
        sign = -1
        s = s[1:]
    elif s[0] == '+':
        s = s[1:]
    
    # Remove leading zeros for calculation, but keep track of length
    # The format is fixed width. Let's just convert to int and divide by 100.
    # Since it's fixed width, we can just take the numeric part.
    try:
        # If the string is all zeros or empty, return 0
        if not s or s == '0':
            return 0.0
        
        # The last 2 digits are the decimal part
        # The rest are the integer part
        # But wait, the input is a string like "00000000123" (11 chars)
        # We need to be careful with leading zeros.
        # Let's just convert the whole string to an integer and divide by 100.
        # This works because the format is fixed and the decimal point is implied at the end.
        val = int(s)
        return sign * val / 100.0
    except ValueError:
        return 0.0

def format_signed_decimal(val, length):
    """Format a decimal value into a fixed-width signed decimal string.
    Length includes the sign if negative, or just digits if positive?
    PIC 'S99999999V99' is 11 chars.
    If positive: 00000000123
    If negative: -00000000123 (or 00000000123 with sign separate? No, S means sign is part of the field)
    Actually, in COBOL, S99999999V99 is 11 digits. The sign is usually leading or trailing.
    Let's assume leading sign for simplicity, or just standard formatting.
    The doc says: PIC 'S99999999V99'.
    Let's format as: sign + 9 digits + 2 decimals.
    But the field is 11 chars total.
    So: 1 sign + 9 integer digits + 2 decimal digits? No, that's 12.
    Wait, 99999999 is 8 digits. V99 is 2 digits. Total 10 digits.
    S means signed. So 11 chars total.
    Example: 123.45 -> 00000012345 (11 chars)
    -123.45 -> -0000012345 (11 chars)
    """
    val = round2(val)
    sign = ''
    if val < 0:
        sign = '-'
        val = -val
    
    # Convert to integer cents
    cents = int(val * 100 + 0.5)
    
    # Format as 10 digits (8 integer + 2 decimal)
    # But we need to fit in 11 chars including sign.
    # If sign is present, we have 10 digits left.
    # If no sign, we have 11 digits? No, the field is fixed 11.
    # Let's assume the format is: [Sign] + 9 digits (integer) + 2 digits (decimal) is too long.
    # Let's re-read: PIC 'S99999999V99'.
    # 99999999 is 8 digits. V99 is 2 digits. Total 10 digits.
    # S means signed. So 11 chars.
    # So: 1 sign + 8 integer digits + 2 decimal digits.
    
    # Let's format the integer part to 8 digits and decimal part to 2 digits.
    int_part = cents // 100
    dec_part = cents % 100
    
    # Format integer part to 8 digits
    int_str = f"{int_part:08d}"
    dec_str = f"{dec_part:02d}"
    
    result = sign + int_str + dec_str
    
    # If result is longer than length, truncate? Or pad?
    # It should fit exactly.
    if len(result) > length:
        # This shouldn't happen if range is correct
        result = result[-length:]
    else:
        # Pad with leading zeros if no sign, or after sign if sign?
        # If sign is present, pad the digits.
        if sign:
            result = sign + result[1:].zfill(length - 1)
        else:
            result = result.zfill(length)
            
    return result

def parse_unsigned_decimal(s, length):
    """Parse an unsigned decimal string with implied decimal point."""
    s = s.strip()
    if not s:
        return 0.0
    try:
        val = int(s)
        return val / 100.0
    except ValueError:
        return 0.0

def format_unsigned_decimal(val, length):
    """Format a decimal value into a fixed-width unsigned decimal string."""
    val = round2(val)
    cents = int(val * 100 + 0.5)
    int_part = cents // 100
    dec_part = cents % 100
    int_str = f"{int_part:08d}"
    dec_str = f"{dec_part:02d}"
    result = int_str + dec_str
    if len(result) > length:
        result = result[-length:]
    else:
        result = result.zfill(length)
    return result

def parse_int(s, length):
    """Parse an integer string."""
    s = s.strip()
    if not s:
        return 0
    try:
        return int(s)
    except ValueError:
        return 0

def format_int(val, length):
    """Format an integer into a fixed-width string."""
    return f"{val:0{length}d}"

def add_days(date_str, days):
    """Add N days to a YYYYMMDD date string."""
    dt = datetime.strptime(date_str, "%Y%m%d")
    new_dt = dt + timedelta(days=days)
    return new_dt.strftime("%Y%m%d")

def load_file(filename, record_length):
    """Load a fixed-length file into a list of strings, padded to record_length."""
    records = []
    if not os.path.exists(filename):
        return records
    with open(filename, 'r') as f:
        for line in f:
            line = line.rstrip('\n').rstrip('\r')
            # Pad to record length
            if len(line) < record_length:
                line = line.ljust(record_length)
            else:
                line = line[:record_length]
            records.append(line)
    return records

def write_file(filename, records, record_length):
    """Write a list of strings to a fixed-length file."""
    with open(filename, 'w') as f:
        for rec in records:
            if len(rec) < record_length:
                rec = rec.ljust(record_length)
            else:
                rec = rec[:record_length]
            f.write(rec + '\n')

def step_post(in_dir, out_dir):
    """Step 010: KBP00001 (Transaction Booking)"""
    # 1. Read CTLCARD
    ctldata = load_file(os.path.join(in_dir, 'CTLCARD'), 80)
    if not ctldata:
        print("ERROR: CTLCARD not found")
        sys.exit(16)
    
    w_laufdt = ctldata[0][0:8]
    if not w_laufdt.isdigit():
        print("ERROR: Invalid run date")
        sys.exit(16)
    
    # 2. Load Account Table
    acct_records = load_file(os.path.join(in_dir, 'ACCTFILE'), 140)
    accounts = []
    for rec in acct_records:
        acct = {
            'KTO_NR': rec[0:11],
            'KTO_ST': rec[11],
            'KTO_SLD': parse_signed_decimal(rec[12:23], 11),
            'KTO_KLIM': parse_unsigned_decimal(rec[23:33], 10),
            'KTO_BLIM': parse_unsigned_decimal(rec[33:43], 10),
            'KTO_ERDT': rec[43:51],
            'KTO_ABDT': rec[51:59],
            'KTO_ZYK_HAB': parse_signed_decimal(rec[59:70], 11),
            'KTO_ZYK_SOL': parse_signed_decimal(rec[70:81], 11),
            'KTO_GRP': rec[81:91],
            'KTO_MAHN': parse_int(rec[91:93], 2),
            'KTO_MINZ': parse_signed_decimal(rec[93:104], 11),
            'KTO_ZYK_ZAHL': parse_signed_decimal(rec[104:115], 11),
            'KTO_PKT': parse_int(rec[115:124], 9),
            'KTO_KDNR': rec[124:133],
        }
        accounts.append(acct)
    
    # 3. Load Category Table
    tcat_records = load_file(os.path.join(in_dir, 'TCATFILE'), 30)
    tcat = []
    for rec in tcat_records:
        tcat.append({
            'TCA_KTO': rec[0:11],
            'TCA_TYP': rec[11:13],
            'TCA_KAT': rec[13:17],
            'TCA_SLD': parse_signed_decimal(rec[17:28], 11),
        })
    
    # 4. Load Card Table
    xref_records = load_file(os.path.join(in_dir, 'XREFFILE'), 50)
    cards = []
    for rec in xref_records:
        cards.append({
            'XRF_KARTE': rec[0:16],
            'XRF_KDNR': rec[16:25],
            'XRF_KTO': rec[25:36],
            'XRF_ST': rec[36],
        })
    
    # 5. Load Transactions
    tran_records = load_file(os.path.join(in_dir, 'DALYTRAN'), 120)
    
    # Initialize counters
    z_gelesen = 0
    z_gebuacht = 0
    z_abgew = 0
    
    # Duplicate check array
    gs = []
    gn = 0
    
    # Output lists
    acct_out = []
    tcat_out = []
    tran_out = []
    rejects = []
    
    # Process each transaction
    for tran_rec in tran_records:
        z_gelesen += 1
        
        # Parse transaction
        trn_id = tran_rec[0:16]
        trn_typ = tran_rec[16:18]
        trn_kat = tran_rec[18:22]
        trn_quelle = tran_rec[22:32]
        trn_txt = tran_rec[32:62]
        trn_btr = parse_signed_decimal(tran_rec[62:73], 11)
        trn_hdl = tran_rec[73:82]
        trn_mcc = tran_rec[82:86]
        trn_karte = tran_rec[86:102]
        trn_dt = tran_rec[102:110]
        
        # 2. Duplicate Check
        dopp = 0
        if trn_id in gs:
            dopp = 1
        else:
            gs.append(trn_id)
            gn += 1
            if gn > 20000:
                print("ERROR: Duplicate check array full")
                sys.exit(16)
        
        # 3. Determine Direction
        soll = 0
        if trn_typ in [KO_TYP_KAUF, KO_TYP_BAR]:
            soll = 1
        
        # 4. Validation
        reject_code = 0
        reject_text = ''
        
        # Rule 110 (Duplicate)
        if dopp == 1:
            reject_code = 110
            reject_text = REJECT_TEXTS[110]
        
        # Rule 109 (Invalid Amount)
        if reject_code == 0 and trn_btr <= 0:
            reject_code = 109
            reject_text = REJECT_TEXTS[109]
        
        # Rule 111 (Invalid Type)
        if reject_code == 0 and trn_typ not in [KO_TYP_KAUF, KO_TYP_ZAHL, KO_TYP_GUT, KO_TYP_BAR]:
            reject_code = 111
            reject_text = REJECT_TEXTS[111]
        
        # Card Lookup
        card_idx = -1
        for i, card in enumerate(cards):
            if card['XRF_KARTE'] == trn_karte:
                card_idx = i
                break
        
        if reject_code == 0:
            if card_idx == -1:
                reject_code = 100
                reject_text = REJECT_TEXTS[100]
            else:
                if cards[card_idx]['XRF_ST'] != 'Y':
                    reject_code = 101
                    reject_text = REJECT_TEXTS[101]
        
        # Account Lookup
        acct_idx = -1
        if reject_code == 0 and card_idx != -1:
            acct_nr = cards[card_idx]['XRF_KTO']
            for i, acct in enumerate(accounts):
                if acct['KTO_NR'] == acct_nr:
                    acct_idx = i
                    break
        
        if reject_code == 0:
            if acct_idx == -1:
                reject_code = 102
                reject_text = REJECT_TEXTS[102]
            else:
                acct = accounts[acct_idx]
                # Rule 103 (Closed Account)
                if acct['KTO_ST'] in ['C', 'X']:
                    reject_code = 103
                    reject_text = REJECT_TEXTS[103]
                # Rule 105 (Expired Card)
                elif trn_dt > acct['KTO_ABDT']:
                    reject_code = 105
                    reject_text = REJECT_TEXTS[105]
                # Rule 104 (Delinquent Account)
                elif soll == 1 and acct['KTO_ST'] == 'D':
                    reject_code = 104
                    reject_text = REJECT_TEXTS[104]
                # Rule 108 (Blocked MCC)
                elif trn_typ == KO_TYP_KAUF and trn_mcc == KO_MCC_SPERR:
                    reject_code = 108
                    reject_text = REJECT_TEXTS[108]
                # Rule 107 (Cash Limit)
                elif trn_typ == KO_TYP_BAR and trn_btr > acct['KTO_BLIM']:
                    reject_code = 107
                    reject_text = REJECT_TEXTS[107]
                # Rule 106 (Credit Limit)
                elif soll == 1:
                    new_balance = acct['KTO_SLD'] + trn_btr
                    if new_balance > acct['KTO_KLIM']:
                        reject_code = 106
                        reject_text = REJECT_TEXTS[106]
        
        # 5. Rejection Handling
        if reject_code != 0:
            z_abgew += 1
            # Write to REJECTS
            abw_trn = trn_id.ljust(16)
            abw_grd = f"{reject_code:03d}"
            abw_txt = reject_text.ljust(30)
            filler = ' '
            rejects.append(abw_trn + abw_grd + abw_txt + filler)
            continue
        
        # 6. Booking
        acct = accounts[acct_idx]
        
        # Update Account Balance
        if soll == 1:
            acct['KTO_SLD'] += trn_btr
            acct['KTO_ZYK_SOL'] += trn_btr
        else:
            acct['KTO_SLD'] -= trn_btr
            acct['KTO_ZYK_HAB'] += trn_btr
        
        if trn_typ == KO_TYP_ZAHL:
            acct['KTO_ZYK_ZAHL'] += trn_btr
        
        # Update Category Balance
        key = acct['KTO_NR'] + trn_typ + trn_kat
        found = False
        for tc in tcat:
            if tc['TCA_KTO'] + tc['TCA_TYP'] + tc['TCA_KAT'] == key:
                if soll == 1:
                    tc['TCA_SLD'] += trn_btr
                else:
                    tc['TCA_SLD'] -= trn_btr
                found = True
                break
        
        if not found:
            new_tc = {
                'TCA_KTO': acct['KTO_NR'],
                'TCA_TYP': trn_typ,
                'TCA_KAT': trn_kat,
                'TCA_SLD': trn_btr if soll == 1 else -trn_btr
            }
            tcat.append(new_tc)
        
        # Bonus Points
        if trn_typ == KO_TYP_KAUF:
            base_points = int(trn_btr)
            multiplier = 1
            if trn_mcc == KO_MCC_LEBM:
                multiplier = 2
            elif trn_mcc == KO_MCC_REST:
                multiplier = 3
            acct['KTO_PKT'] += base_points * multiplier
            if acct['KTO_PKT'] > KO_MAX_PKT:
                acct['KTO_PKT'] = KO_MAX_PKT
        elif trn_typ == KO_TYP_GUT:
            acct['KTO_PKT'] -= int(trn_btr)
            if acct['KTO_PKT'] < 0:
                acct['KTO_PKT'] = 0
        
        # Write Output
        buc_trn = tran_rec[:110]
        buc_kto = acct['KTO_NR'].ljust(11)
        buc_dt = w_laufdt.ljust(8)
        filler = ' '
        tran_out.append(buc_trn + buc_kto + buc_dt + filler)
        z_gebuacht += 1
        
        # 7. Cash Withdrawal Fee
        if trn_typ == KO_TYP_BAR:
            raw_fee = (trn_btr * KO_GEB_BAR_PROZ) / 100
            fee = max(raw_fee, KO_GEB_BAR_MIN)
            fee = round2(fee)
            
            # Update Account
            acct['KTO_SLD'] += fee
            acct['KTO_ZYK_SOL'] += fee
            
            # Update Category
            fee_key = acct['KTO_NR'] + KO_TYP_GEB + '0001'
            found = False
            for tc in tcat:
                if tc['TCA_KTO'] + tc['TCA_TYP'] + tc['TCA_KAT'] == fee_key:
                    tc['TCA_SLD'] += fee
                    found = True
                    break
            
            if not found:
                new_tc = {
                    'TCA_KTO': acct['KTO_NR'],
                    'TCA_TYP': KO_TYP_GEB,
                    'TCA_KAT': '0001',
                    'TCA_SLD': fee
                }
                tcat.append(new_tc)
            
            # Write Fee Transaction
            cf_id = 'CF' + trn_id[2:]
            cf_id = cf_id.ljust(16)
            cf_typ = KO_TYP_GEB
            cf_kat = '0001'
            cf_quelle = 'SYSTEM'.ljust(10)
            cf_txt = 'BARGELDGEBUEHR'.ljust(30)
            cf_btr = format_signed_decimal(fee, 11)
            cf_hdl = '000000000'
            cf_mcc = '0000'
            cf_karte = trn_karte.ljust(16)
            cf_dt = w_laufdt.ljust(8)
            cf_filler = ' ' * 10
            
            cf_rec = cf_id + cf_typ + cf_kat + cf_quelle + cf_txt + cf_btr + cf_hdl + cf_mcc + cf_karte + cf_dt + cf_filler
            cf_rec = cf_rec[:110]
            
            buc_trn = cf_rec
            buc_kto = acct['KTO_NR'].ljust(11)
            buc_dt = w_laufdt.ljust(8)
            filler = ' '
            tran_out.append(buc_trn + buc_kto + buc_dt + filler)
    
    # 3.3 Finalization
    # Write updated Account Table to ACCTOUT
    for acct in accounts:
        rec = acct['KTO_NR'].ljust(11)
        rec += acct['KTO_ST']
        rec += format_signed_decimal(acct['KTO_SLD'], 11)
        rec += format_unsigned_decimal(acct['KTO_KLIM'], 10)
        rec += format_unsigned_decimal(acct['KTO_BLIM'], 10)
        rec += acct['KTO_ERDT'].ljust(8)
        rec += acct['KTO_ABDT'].ljust(8)
        rec += format_signed_decimal(acct['KTO_ZYK_HAB'], 11)
        rec += format_signed_decimal(acct['KTO_ZYK_SOL'], 11)
        rec += acct['KTO_GRP'].ljust(10)
        rec += format_int(acct['KTO_MAHN'], 2)
        rec += format_signed_decimal(acct['KTO_MINZ'], 11)
        rec += format_signed_decimal(acct['KTO_ZYK_ZAHL'], 11)
        rec += format_int(acct['KTO_PKT'], 9)
        rec += acct['KTO_KDNR'].ljust(9)
        rec += ' ' * 7
        acct_out.append(rec)
    
    # Write updated Category Table to TCATOUT
    for tc in tcat:
        rec = tc['TCA_KTO'].ljust(11)
        rec += tc['TCA_TYP'].ljust(2)
        rec += tc['TCA_KAT'].ljust(4)
        rec += format_signed_decimal(tc['TCA_SLD'], 11)
        rec += ' ' * 2
        tcat_out.append(rec)
    
    # Write outputs
    write_file(os.path.join(out_dir, 'ACCTOUT'), acct_out, 140)
    write_file(os.path.join(out_dir, 'TCATOUT'), tcat_out, 30)
    write_file(os.path.join(out_dir, 'TRANOUT'), tran_out, 130)
    write_file(os.path.join(out_dir, 'REJECTS'), rejects, 50)
    
    # Set Return Code
    if z_abgew > 0:
        sys.exit(4)
    else:
        sys.exit(0)

def step_interest(in_dir, out_dir):
    """Step 020: KBP00002 (Interest & Fees)"""
    # 1. Read CTLCARD
    ctldata = load_file(os.path.join(in_dir, 'CTLCARD'), 80)
    if not ctldata:
        print("ERROR: CTLCARD not found")
        sys.exit(16)
    
    w_laufdt = ctldata[0][0:8]
    if not w_laufdt.isdigit():
        print("ERROR: Invalid run date")
        sys.exit(16)
    
    # 2. Load Account Table
    acct_records = load_file(os.path.join(in_dir, 'ACCTFILE'), 140)
    accounts = []
    for rec in acct_records:
        acct = {
            'KTO_NR': rec[0:11],
            'KTO_ST': rec[11],
            'KTO_SLD': parse_signed_decimal(rec[12:23], 11),
            'KTO_KLIM': parse_unsigned_decimal(rec[23:33], 10),
            'KTO_BLIM': parse_unsigned_decimal(rec[33:43], 10),
            'KTO_ERDT': rec[43:51],
            'KTO_ABDT': rec[51:59],
            'KTO_ZYK_HAB': parse_signed_decimal(rec[59:70], 11),
            'KTO_ZYK_SOL': parse_signed_decimal(rec[70:81], 11),
            'KTO_GRP': rec[81:91],
            'KTO_MAHN': parse_int(rec[91:93], 2),
            'KTO_MINZ': parse_signed_decimal(rec[93:104], 11),
            'KTO_ZYK_ZAHL': parse_signed_decimal(rec[104:115], 11),
            'KTO_PKT': parse_int(rec[115:124], 9),
            'KTO_KDNR': rec[124:133],
        }
        accounts.append(acct)
    
    # 3. Load Customer Table
    cust_records = load_file(os.path.join(in_dir, 'CUSTFILE'), 60)
    customers = []
    for rec in cust_records:
        customers.append({
            'KDS_NR': rec[0:9],
            'KDS_VORN': rec[9:29],
            'KDS_NACHN': rec[29:54],
            'KDS_FICO': parse_int(rec[54:57], 3),
        })
    
    # 4. Load Interest Rates
    disc_records = load_file(os.path.join(in_dir, 'DISCGRP'), 20)
    interest_rates = {}
    for rec in disc_records:
        grp = rec[0:10]
        typ = rec[10:12]
        kat = rec[12:16]
        zins = parse_unsigned_decimal(rec[16:20], 4)
        key = grp + typ + kat
        interest_rates[key] = zins
    
    # Output lists
    acct_out = []
    tran_out = []
    
    # Helper: BELASTEN
    def belasten(prefix, typ, kat, txt, amount, acct):
        # Update Account
        acct['KTO_SLD'] += amount
        acct['KTO_ZYK_SOL'] += amount
        
        # Create Transaction Record
        trn_id = (prefix + acct['KTO_NR'] + '000')[:16]
        trn_id = trn_id.ljust(16)
        trn_typ = typ.ljust(2)
        trn_kat = kat.ljust(4)
        trn_quelle = 'ZINSLAUF'.ljust(10)
        trn_txt = txt.ljust(30)
        trn_btr = format_signed_decimal(amount, 11)
        trn_hdl = '000000000'
        trn_mcc = '0000'
        trn_karte = ' ' * 16
        trn_dt = w_laufdt.ljust(8)
        trn_filler = ' ' * 10
        
        trn_rec = trn_id + trn_typ + trn_kat + trn_quelle + trn_txt + trn_btr + trn_hdl + trn_mcc + trn_karte + trn_dt + trn_filler
        trn_rec = trn_rec[:110]
        
        buc_trn = trn_rec
        buc_kto = acct['KTO_NR'].ljust(11)
        buc_dt = w_laufdt.ljust(8)
        filler = ' '
        tran_out.append(buc_trn + buc_kto + buc_dt + filler)
    
    # 4.2 Main Loop
    for acct in accounts:
        # 1. Skip Written-off
        if acct['KTO_ST'] == 'X':
            continue
        
        # 2. Get Customer FICO
        fico = 0
        for cust in customers:
            if cust['KDS_NR'] == acct['KTO_KDNR']:
                fico = cust['KDS_FICO']
                break
        
        # 3. Calculate Interest
        total_interest = 0.0
        
        # Iterate through Category Table
        # We need to load TCATFILE again or use the one from step 010?
        # The doc says: Input: ACCTFILE(+1), TCATFILE(+1), DISCGRP, CUSTFILE.
        # So we need to load TCATFILE from in_dir.
        tcat_records = load_file(os.path.join(in_dir, 'TCATFILE'), 30)
        tcat = []
        for rec in tcat_records:
            tcat.append({
                'TCA_KTO': rec[0:11],
                'TCA_TYP': rec[11:13],
                'TCA_KAT': rec[13:17],
                'TCA_SLD': parse_signed_decimal(rec[17:28], 11),
            })
        
        for tc in tcat:
            # Match Account
            if tc['TCA_KTO'] != acct['KTO_NR']:
                continue
            
            # Skip if TC_SLD <= 0
            if tc['TCA_SLD'] <= 0:
                continue
            
            # Skip if TC_KEY(12-13) == '02' (Payments)
            if tc['TCA_TYP'] == KO_TYP_ZAHL:
                continue
            
            # Determine Rate
            key = acct['KTO_GRP'] + tc['TCA_TYP'] + tc['TCA_KAT']
            rate = interest_rates.get(key, 0.0)
            
            if rate == 0.0:
                default_key = 'DEFAULT' + tc['TCA_TYP'] + tc['TCA_KAT']
                rate = interest_rates.get(default_key, 0.0)
            
            # Apply Special Rules
            if acct['KTO_GRP'] == 'AKTION2010' and '20100101' <= w_laufdt <= '20111231':
                rate = 0.0
            
            if rate > 0:
                if acct['KTO_ST'] == 'D':
                    rate += KO_AUFS_VERZ
                if fico > 0 and fico < KO_FICO_GRENZE:
                    rate += KO_AUFS_FICO
            
            # Calculate Amount
            monthly_interest = (tc['TCA_SLD'] * rate) / 1200
            monthly_interest = round2(monthly_interest)
            total_interest += monthly_interest
        
        # Post Interest
        if total_interest >= KO_ZINS_FREI:
            belasten('ZI', KO_TYP_ZINS, '0001', 'SOLLZINSEN', total_interest, acct)
        
        # 4. Calculate Fees (Only if Status A or D)
        if acct['KTO_ST'] in ['A', 'D']:
            # Dunning Fee
            if acct['KTO_MINZ'] > 0 and acct['KTO_ZYK_ZAHL'] < acct['KTO_MINZ']:
                if acct['KTO_MAHN'] > 0:
                    fee = KO_MAHN_2
                else:
                    fee = KO_MAHN_1
                acct['KTO_MAHN'] += 1
                if acct['KTO_MAHN'] > 99:
                    acct['KTO_MAHN'] = 99
                belasten('MG', KO_TYP_GEB, '0002', 'MAHNGEBUEHR', fee, acct)
            else:
                acct['KTO_MAHN'] = 0
            
            # Overdraft Fee
            if acct['KTO_SLD'] > acct['KTO_KLIM']:
                belasten('UL', KO_TYP_GEB, '0003', 'UEBERZIEHUNGSGEBUEHR', KO_UEBZ, acct)
        
        # 5. Update Status
        if acct['KTO_ST'] == 'A' and acct['KTO_MAHN'] >= KO_VERZ_AB:
            acct['KTO_ST'] = 'D'
        if acct['KTO_ST'] == 'D' and acct['KTO_MAHN'] >= KO_ABSCHR_AB:
            acct['KTO_ST'] = 'X'
        if acct['KTO_ST'] == 'D' and acct['KTO_MAHN'] == 0:
            acct['KTO_ST'] = 'A'
    
    # 4.4 Finalization
    # Write updated Account Table to ACCTOUT
    for acct in accounts:
        rec = acct['KTO_NR'].ljust(11)
        rec += acct['KTO_ST']
        rec += format_signed_decimal(acct['KTO_SLD'], 11)
        rec += format_unsigned_decimal(acct['KTO_KLIM'], 10)
        rec += format_unsigned_decimal(acct['KTO_BLIM'], 10)
        rec += acct['KTO_ERDT'].ljust(8)
        rec += acct['KTO_ABDT'].ljust(8)
        rec += format_signed_decimal(acct['KTO_ZYK_HAB'], 11)
        rec += format_signed_decimal(acct['KTO_ZYK_SOL'], 11)
        rec += acct['KTO_GRP'].ljust(10)
        rec += format_int(acct['KTO_MAHN'], 2)
        rec += format_signed_decimal(acct['KTO_MINZ'], 11)
        rec += format_signed_decimal(acct['KTO_ZYK_ZAHL'], 11)
        rec += format_int(acct['KTO_PKT'], 9)
        rec += acct['KTO_KDNR'].ljust(9)
        rec += ' ' * 7
        acct_out.append(rec)
    
    # Write outputs
    write_file(os.path.join(out_dir, 'ACCTOUT'), acct_out, 140)
    write_file(os.path.join(out_dir, 'TRANOUT'), tran_out, 130)
    
    sys.exit(0)

def step_statement(in_dir, out_dir):
    """Step 030: KBP00003 (Statements & Cycle Reset)"""
    # 1. Read CTLCARD
    ctldata = load_file(os.path.join(in_dir, 'CTLCARD'), 80)
    if not ctldata:
        print("ERROR: CTLCARD not found")
        sys.exit(16)
    
    w_laufdt = ctldata[0][0:8]
    if not w_laufdt.isdigit():
        print("ERROR: Invalid run date")
        sys.exit(16)
    
    # 2. Calculate Due Date
    due_date = add_days(w_laufdt, KO_FAELLIG_TG)
    
    # 3. Load Account Table
    acct_records = load_file(os.path.join(in_dir, 'ACCTFILE'), 140)
    accounts = []
    for rec in acct_records:
        acct = {
            'KTO_NR': rec[0:11],
            'KTO_ST': rec[11],
            'KTO_SLD': parse_signed_decimal(rec[12:23], 11),
            'KTO_KLIM': parse_unsigned_decimal(rec[23:33], 10),
            'KTO_BLIM': parse_unsigned_decimal(rec[33:43], 10),
            'KTO_ERDT': rec[43:51],
            'KTO_ABDT': rec[51:59],
            'KTO_ZYK_HAB': parse_signed_decimal(rec[59:70], 11),
            'KTO_ZYK_SOL': parse_signed_decimal(rec[70:81], 11),
            'KTO_GRP': rec[81:91],
            'KTO_MAHN': parse_int(rec[91:93], 2),
            'KTO_MINZ': parse_signed_decimal(rec[93:104], 11),
            'KTO_ZYK_ZAHL': parse_signed_decimal(rec[104:115], 11),
            'KTO_PKT': parse_int(rec[115:124], 9),
            'KTO_KDNR': rec[124:133],
        }
        accounts.append(acct)
    
    # 4. Load Customer Table
    cust_records = load_file(os.path.join(in_dir, 'CUSTFILE'), 60)
    customers = []
    for rec in cust_records:
        customers.append({
            'KDS_NR': rec[0:9],
            'KDS_VORN': rec[9:29],
            'KDS_NACHN': rec[29:54],
            'KDS_FICO': parse_int(rec[54:57], 3),
        })
    
    # Output lists
    acct_out = []
    stmt_out = []
    
    # 5.2 Main Loop
    for acct in accounts:
        # 1. Skip Written-off
        if acct['KTO_ST'] == 'X':
            continue
        
        # 2. Calculate Minimum Payment
        if acct['KTO_SLD'] <= 0:
            min_pay = 0.0
        elif acct['KTO_SLD'] < KO_MINZ_MIN:
            min_pay = acct['KTO_SLD']
        else:
            base_min = (acct['KTO_SLD'] * KO_MINZ_PROZ) / 100
            min_pay = max(base_min, KO_MINZ_MIN)
            if acct['KTO_SLD'] > acct['KTO_KLIM']:
                overdraft = acct['KTO_SLD'] - acct['KTO_KLIM']
                min_pay += overdraft
            if min_pay > acct['KTO_SLD']:
                min_pay = acct['KTO_SLD']
        
        # 3. Generate Statement
        if acct['KTO_SLD'] != 0 or acct['KTO_ZYK_SOL'] != 0 or acct['KTO_ZYK_HAB'] != 0:
            # Get Customer Name
            name = 'UNBEKANNT'
            for cust in customers:
                if cust['KDS_NR'] == acct['KTO_KDNR']:
                    name = (cust['KDS_VORN'] + ' ' + cust['KDS_NACHN']).strip()
                    break
            
            # Euro Conversion (Dead code, SW_EURO = 'N')
            display_balance = acct['KTO_SLD']
            
            # Write to STMTFILE
            azg_kto = acct['KTO_NR'].ljust(11)
            azg_name = name.ljust(46)
            azg_sld = format_signed_decimal(display_balance, 11)
            azg_minz = format_signed_decimal(min_pay, 11)
            azg_faell = due_date.ljust(8)
            azg_pkt = format_int(acct['KTO_PKT'], 9)
            azg_st = acct['KTO_ST']
            azg_sol = format_signed_decimal(acct['KTO_ZYK_SOL'], 11)
            azg_hab = format_signed_decimal(acct['KTO_ZYK_HAB'], 11)
            filler = ' '
            
            stmt_rec = azg_kto + azg_name + azg_sld + azg_minz + azg_faell + azg_pkt + azg_st + azg_sol + azg_hab + filler
            stmt_out.append(stmt_rec)
        
        # 4. Reset Cycle
        acct['KTO_ZYK_SOL'] = 0.0
        acct['KTO_ZYK_HAB'] = 0.0
        acct['KTO_ZYK_ZAHL'] = 0.0
        acct['KTO_MINZ'] = min_pay
    
    # 5.3 Finalization
    # Write updated Account Table to ACCTOUT
    for acct in accounts:
        rec = acct['KTO_NR'].ljust(11)
        rec += acct['KTO_ST']
        rec += format_signed_decimal(acct['KTO_SLD'], 11)
        rec += format_unsigned_decimal(acct['KTO_KLIM'], 10)
        rec += format_unsigned_decimal(acct['KTO_BLIM'], 10)
        rec += acct['KTO_ERDT'].ljust(8)
        rec += acct['KTO_ABDT'].ljust(8)
        rec += format_signed_decimal(acct['KTO_ZYK_HAB'], 11)
        rec += format_signed_decimal(acct['KTO_ZYK_SOL'], 11)
        rec += acct['KTO_GRP'].ljust(10)
        rec += format_int(acct['KTO_MAHN'], 2)
        rec += format_signed_decimal(acct['KTO_MINZ'], 11)
        rec += format_signed_decimal(acct['KTO_ZYK_ZAHL'], 11)
        rec += format_int(acct['KTO_PKT'], 9)
        rec += acct['KTO_KDNR'].ljust(9)
        rec += ' ' * 7
        acct_out.append(rec)
    
    # Write outputs
    write_file(os.path.join(out_dir, 'ACCTOUT'), acct_out, 140)
    write_file(os.path.join(out_dir, 'STMTFILE'), stmt_out, 120)
    
    sys.exit(0)

def main():
    if len(sys.argv) != 4:
        print("Usage: python3 app.py STEP IN_DIR OUT_DIR")
        sys.exit(1)
    
    step = sys.argv[1].upper()
    in_dir = sys.argv[2]
    out_dir = sys.argv[3]
    
    if not os.path.exists(in_dir):
        print(f"ERROR: Input directory {in_dir} does not exist")
        sys.exit(1)
    
    if not os.path.exists(out_dir):
        os.makedirs(out_dir)
    
    if step == 'POST':
        step_post(in_dir, out_dir)
    elif step == 'INTEREST':
        step_interest(in_dir, out_dir)
    elif step == 'STATEMENT':
        step_statement(in_dir, out_dir)
    else:
        print(f"ERROR: Unknown step {step}")
        sys.exit(1)

if __name__ == '__main__':
    main()
