```python
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
        
        if