#!/usr/bin/env python3
"""
Kartenbank Batch Processing System (KBJ00001)
Rebuilt from PL/I documentation.
"""

import sys
import os
import re
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP, ROUND_DOWN

# Constants
KO_MINZ_PROZ = Decimal('5.00')
KO_MINZ_MIN = Decimal('10.00')
KO_GEB_BAR_PROZ = Decimal('5.00')
KO_GEB_BAR_MIN = Decimal('10.00')
KO_AUFS_VERZ = Decimal('3.00')
KO_AUFS_FICO = Decimal('2.00')
KO_VERZ_AB = 2
KO_ABSCHR_AB = 6
KO_FAELLIG_TG = 25
KO_MCC_LEBM = '5411'
KO_MCC_REST = '5812'
KO_MCC_SPERR = '7995'
KO_TYP_KAUF = '01'
KO_TYP_ZAHL = '02'
KO_TYP_GUT = '03'
KO_TYP_BAR = '04'
KO_TYP_GEB = '05'
KO_TYP_ZINS = '06'
KO_MAX_PKT = 999999999
KO_ZINS_FREI = Decimal('1.00')
KO_MAHN_1 = Decimal('25.00')
KO_MAHN_2 = Decimal('35.00')
KO_UEBZ = Decimal('29.00')
GRP_DEF = 'DEF'
AKT_GRP = 'AKTION2010'
AKT_VON = '20100101'
AKT_BIS = '20111231'
KO_FICO_GRENZE = 600
SW_EURO = 'N'  # Default to No conversion unless specified
EUR_RATE = Decimal('1.95583')

# Rejection Texts
REJ_TEXTS = {
    '100': 'KARTE UNBEKANNT',
    '101': 'KARTE GESPERRT',
    '102': 'KONTO UNBEKANNT',
    '103': 'KONTO GESPERRT',
    '104': 'KONTO IN VERZ',
    '105': 'KARTE ABGELAUFEN',
    '106': 'LIMIT UBERSCHRITTEN',
    '107': 'BARLIM UBERSCHRITTEN',
    '108': 'MCC GESPERRT',
    '109': 'BETRAG UNGUETIG',
    '110': 'DOPPELBUCHUNG',
    '111': 'TYP INTERNE',
}

def parse_pic_s99999999v99(s):
    """Parse PIC 'S99999999V99' format."""
    s = s.strip()
    if not s:
        return Decimal('0')
    sign = 1
    if s.startswith('-'):
        sign = -1
        s = s[1:]
    elif s.startswith('+'):
        s = s[1:]
    
    # Remove leading zeros for easier parsing, but keep track
    # Format is 8 digits integer, 2 digits decimal
    # Example: 0000012345 -> 123.45
    # The string is fixed width 10 or 11 (with sign)
    # Let's just use Decimal directly if it looks like a number
    try:
        # If it has a decimal point, use it
        if '.' in s:
            val = Decimal(s)
        else:
            # Assume last 2 digits are decimals
            if len(s) >= 2:
                int_part = s[:-2]
                dec_part = s[-2:]
                val = Decimal(int_part + '.' + dec_part)
            else:
                val = Decimal(s)
        return sign * val
    except:
        return Decimal('0')

def format_pic_s99999999v99(val):
    """Format Decimal to PIC 'S99999999V99' (11 chars)."""
    val = val.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    sign = ''
    if val < 0:
        sign = '-'
        val = -val
    # Format as 8 digits integer, 2 digits decimal
    int_part = int(val)
    dec_part = int((val - int_part) * 100)
    # Ensure 2 decimal digits
    dec_str = f"{dec_part:02d}"
    int_str = f"{int_part:08d}"
    return sign + int_str + dec_str

def parse_pic_99999999v99(s):
    """Parse PIC '99999999V99' format (unsigned)."""
    s = s.strip()
    if not s:
        return Decimal('0')
    try:
        if '.' in s:
            return Decimal(s)
        else:
            if len(s) >= 2:
                int_part = s[:-2]
                dec_part = s[-2:]
                return Decimal(int_part + '.' + dec_part)
            else:
                return Decimal(s)
    except:
        return Decimal('0')

def format_pic_99999999v99(val):
    """Format Decimal to PIC '99999999V99' (10 chars)."""
    val = val.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    if val < 0:
        val = 0
    int_part = int(val)
    dec_part = int((val - int_part) * 100)
    dec_str = f"{dec_part:02d}"
    int_str = f"{int_part:08d}"
    return int_str + dec_str

def parse_pic_99v99(s):
    """Parse PIC '99V99' format."""
    s = s.strip()
    if not s:
        return Decimal('0')
    try:
        if '.' in s:
            return Decimal(s)
        else:
            if len(s) >= 2:
                int_part = s[:-2]
                dec_part = s[-2:]
                return Decimal(int_part + '.' + dec_part)
            else:
                return Decimal(s)
    except:
        return Decimal('0')

def format_pic_99v99(val):
    """Format Decimal to PIC '99V99' (4 chars)."""
    val = val.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    int_part = int(val)
    dec_part = int((val - int_part) * 100)
    dec_str = f"{dec_part:02d}"
    int_str = f"{int_part:02d}"
    return int_str + dec_str

def parse_pic_99(s):
    """Parse PIC '99' format."""
    s = s.strip()
    if not s:
        return 0
    try:
        return int(s)
    except:
        return 0

def format_pic_99(val):
    """Format int to PIC '99' (2 chars)."""
    return f"{val:02d}"

def parse_pic_999(s):
    """Parse PIC '999' format."""
    s = s.strip()
    if not s:
        return 0
    try:
        return int(s)
    except:
        return 0

def format_pic_999(val):
    """Format int to PIC '999' (3 chars)."""
    return f"{val:03d}"

def parse_pic_9(s):
    """Parse PIC '(9)9' format (9 digits)."""
    s = s.strip()
    if not s:
        return 0
    try:
        return int(s)
    except:
        return 0

def format_pic_9(val):
    """Format int to PIC '(9)9' (9 chars)."""
    return f"{val:09d}"

def read_file_lines(filename):
    """Read file and return list of lines with trailing whitespace removed."""
    if not os.path.exists(filename):
        return []
    with open(filename, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    return [line.rstrip('\n').rstrip() for line in lines]

def write_file_lines(filename, lines):
    """Write list of lines to file."""
    with open(filename, 'w', encoding='utf-8') as f:
        for line in lines:
            f.write(line + '\n')

def pad_line(line, length):
    """Pad line to specified length with spaces."""
    if len(line) >= length:
        return line[:length]
    return line.ljust(length)

def parse_kto_satz(line):
    """Parse KTO_SATZ (140 chars)."""
    line = pad_line(line, 140)
    return {
        'KTO_NR': line[0:11],
        'KTO_ST': line[11:12],
        'KTO_SLD': parse_pic_s99999999v99(line[12:23]),
        'KTO_KLIM': parse_pic_99999999v99(line[23:33]),
        'KTO_BLIM': parse_pic_99999999v99(line[33:43]),
        'KTO_ERDT': line[43:51],
        'KTO_ABDT': line[51:59],
        'KTO_ZYK_HAB': parse_pic_s99999999v99(line[59:70]),
        'KTO_ZYK_SOL': parse_pic_s99999999v99(line[70:81]),
        'KTO_GRP': line[81:91],
        'KTO_MAHN': parse_pic_99(line[91:93]),
        'KTO_MINZ': parse_pic_s99999999v99(line[93:104]),
        'KTO_ZYK_ZAHL': parse_pic_s99999999v99(line[104:115]),
        'KTO_PKT': parse_pic_9(line[115:124]),
        'KTO_KDNR': line[124:133],
    }

def format_kto_satz(acct):
    """Format KTO_SATZ (140 chars)."""
    s = ''
    s += acct['KTO_NR'].ljust(11)
    s += acct['KTO_ST'].ljust(1)
    s += format_pic_s99999999v99(acct['KTO_SLD'])
    s += format_pic_99999999v99(acct['KTO_KLIM'])
    s += format_pic_99999999v99(acct['KTO_BLIM'])
    s += acct['KTO_ERDT'].ljust(8)
    s += acct['KTO_ABDT'].ljust(8)
    s += format_pic_s99999999v99(acct['KTO_ZYK_HAB'])
    s += format_pic_s99999999v99(acct['KTO_ZYK_SOL'])
    s += acct['KTO_GRP'].ljust(10)
    s += format_pic_99(acct['KTO_MAHN'])
    s += format_pic_s99999999v99(acct['KTO_MINZ'])
    s += format_pic_s99999999v99(acct['KTO_ZYK_ZAHL'])
    s += format_pic_9(acct['KTO_PKT'])
    s += acct['KTO_KDNR'].ljust(9)
    s += ' ' * 7  # Filler
    return s[:140]

def parse_xrf_satz(line):
    """Parse XRF_SATZ (50 chars)."""
    line = pad_line(line, 50)
    return {
        'XRF_KARTE': line[0:16],
        'XRF_KDNR': line[16:25],
        'XRF_KTO': line[25:36],
        'XRF_ST': line[36:37],
    }

def parse_tca_satz(line):
    """Parse TCA_SATZ (30 chars)."""
    line = pad_line(line, 30)
    return {
        'TCA_KTO': line[0:11],
        'TCA_TYP': line[11:13],
        'TCA_KAT': line[13:17],
        'TCA_SLD': parse_pic_s99999999v99(line[17:28]),
    }

def format_tca_satz(tca):
    """Format TCA_SATZ (30 chars)."""
    s = ''
    s += tca['TCA_KTO'].ljust(11)
    s += tca['TCA_TYP'].ljust(2)
    s += tca['TCA_KAT'].ljust(4)
    s += format_pic_s99999999v99(tca['TCA_SLD'])
    s += ' ' * 2  # Filler
    return s[:30]

def parse_trn_satz(line):
    """Parse TRN_SATZ (120 chars)."""
    line = pad_line(line, 120)
    return {
        'TRN_ID': line[0:16],
        'TRN_TYP': line[16:18],
        'TRN_KAT': line[18:22],
        'TRN_QUELLE': line[22:32],
        'TRN_TXT': line[32:62],
        'TRN_BTR': parse_pic_s99999999v99(line[62:73]),
        'TRN_HDL': line[73:82],
        'TRN_MCC': line[82:86],
        'TRN_KARTE': line[86:102],
        'TRN_DT': line[102:110],
    }

def format_buc_satz(trn, kto_nr, buch_dt):
    """Format BUC_SATZ (130 chars)."""
    # First 110 chars of TRN_SATZ
    trn_line = pad_line(
        trn['TRN_ID'].ljust(16) +
        trn['TRN_TYP'].ljust(2) +
        trn['TRN_KAT'].ljust(4) +
        trn['TRN_QUELLE'].ljust(10) +
        trn['TRN_TXT'].ljust(30) +
        format_pic_s99999999v99(trn['TRN_BTR']) +
        trn['TRN_HDL'].ljust(9) +
        trn['TRN_MCC'].ljust(4) +
        trn['TRN_KARTE'].ljust(16) +
        trn['TRN_DT'].ljust(8) +
        ' ' * 10,  # Filler
        120
    )
    buc_trn = trn_line[:110]
    s = buc_trn
    s += kto_nr.ljust(11)
    s += buch_dt.ljust(8)
    s += ' '  # Filler
    return s[:130]

def format_abw_satz(trn_id, code, text):
    """Format ABW_SATZ (50 chars)."""
    s = trn_id.ljust(16)
    s += format_pic_999(code)
    s += text.ljust(30)
    s += ' '  # Filler
    return s[:50]

def parse_dsc_satz(line):
    """Parse DSC_SATZ (20 chars)."""
    line = pad_line(line, 20)
    return {
        'DSC_GRP': line[0:10],
        'DSC_TYP': line[10:12],
        'DSC_KAT': line[12:16],
        'DSC_ZINS': parse_pic_99v99(line[16:20]),
    }

def parse_kds_satz(line):
    """Parse KDS_SATZ (60 chars)."""
    line = pad_line(line, 60)
    return {
        'KDS_NR': line[0:9],
        'KDS_VORN': line[9:29],
        'KDS_NACHN': line[29:54],
        'KDS_FICO': parse_pic_999(line[54:57]),
    }

def format_azg_satz(kto, name, sld, minz, fael, pkt, st, sol, hab):
    """Format AZG_SATZ (120 chars)."""
    s = ''
    s += kto.ljust(11)
    s += name.ljust(46)
    s += format_pic_s99999999v99(sld)
    s += format_pic_s99999999v99(minz)
    s += fael.ljust(8)
    s += format_pic_9(pkt)
    s += st.ljust(1)
    s += format_pic_s99999999v99(sol)
    s += format_pic_s99999999v99(hab)
    s += ' '  # Filler
    return s[:120]

def step_post(in_dir, out_dir):
    """Step 010: UMSAETZE BUCHEN (Post Transactions)"""
    # Read Control Card
    ctl_lines = read_file_lines(os.path.join(in_dir, 'CTLCARD'))
    if not ctl_lines:
        sys.exit(16)
    w_ldt = ctl_lines[0][:8]
    if not w_ldt.isdigit():
        sys.exit(16)
    run_date = w_ldt

    # Load Account File
    acct_lines = read_file_lines(os.path.join(in_dir, 'ACCTFILE'))
    accounts = {}
    for line in acct_lines:
        if line.strip():
            acct = parse_kto_satz(line)
            accounts[acct['KTO_NR']] = acct

    # Load Cross-Reference File
    xref_lines = read_file_lines(os.path.join(in_dir, 'XREFFILE'))
    xrefs = {}
    for line in xref_lines:
        if line.strip():
            xrf = parse_xrf_satz(line)
            xrefs[xrf['XRF_KARTE']] = xrf

    # Load Category Balances
    tcat_lines = read_file_lines(os.path.join(in_dir, 'TCATFILE'))
    tcats = {}
    for line in tcat_lines:
        if line.strip():
            tca = parse_tca_satz(line)
            key = (tca['TCA_KTO'], tca['TCA_TYP'], tca['TCA_KAT'])
            tcats[key] = tca

    # Load Daily Transactions
    trn_lines = read_file_lines(os.path.join(in_dir, 'DALYTRAN'))
    
    seen_ids = set()
    rejects = []
    trans_out = []
    z_abgew = 0
    z_gebu = 0

    for line in trn_lines:
        if not line.strip():
            continue
        trn = parse_trn_satz(line)
        trn_id = trn['TRN_ID']
        trn_typ = trn['TRN_TYP']
        trn_btr = trn['TRN_BTR']
        trn_karte = trn['TRN_KARTE']
        trn_dt = trn['TRN_DT']
        trn_mcc = trn['TRN_MCC']

        # Duplicate Check
        dopp = trn_id in seen_ids
        if dopp:
            seen_ids.add(trn_id)
            code = 110
            text = REJ_TEXTS.get('110', 'DOPPELBUCHUNG')
            rejects.append(format_abw_satz(trn_id, code, text))
            z_abgew += 1
            continue
        seen_ids.add(trn_id)

        # Direction Determination
        soll = trn_typ in ('01', '04')

        # Validation
        reject_code = None
        reject_text = None

        if dopp:
            reject_code = 110
        elif trn_btr <= 0:
            reject_code = 109
        elif trn_typ in ('05', '06'):
            reject_code = 111
        elif trn_typ not in ('01', '02', '03', '04'):
            reject_code = 111
        else:
            # Check Card
            if trn_karte not in xrefs:
                reject_code = 100
            else:
                xrf = xrefs[trn_karte]
                if xrf['XRF_ST'] != 'Y':
                    reject_code = 101
                else:
                    kto_nr = xrf['XRF_KTO']
                    if kto_nr not in accounts:
                        reject_code = 102
                    else:
                        acct = accounts[kto_nr]
                        if acct['KTO_ST'] in ('C', 'X'):
                            reject_code = 103
                        elif trn_dt > acct['KTO_ABDT']:
                            reject_code = 105
                        elif soll and acct['KTO_ST'] == 'D':
                            reject_code = 104
                        elif trn_typ == '01' and trn_mcc == '7995':
                            reject_code = 108
                        elif trn_typ == '04' and trn_btr > acct['KTO_BLIM']:
                            reject_code = 107
                        elif soll and (acct['KTO_SLD'] + trn_btr) > acct['KTO_KLIM']:
                            reject_code = 106

        if reject_code is not None:
            text = REJ_TEXTS.get(str(reject_code), 'FEHLER')
            rejects.append(format_abw_satz(trn_id, reject_code, text))
            z_abgew += 1
            continue

        # Booking
        kto_nr = xrefs[trn_karte]['XRF_KTO']
        acct = accounts[kto_nr]

        if soll:
            acct['KTO_SLD'] += trn_btr
            acct['KTO_ZYK_SOL'] += trn_btr
        else:
            acct['KTO_SLD'] -= trn_btr
            acct['KTO_ZYK_HAB'] += trn_btr

        if trn_typ == '02':
            acct['KTO_ZYK_ZAHL'] += trn_btr

        # Points Calculation
        if trn_typ == '01':
            factor = 1
            if trn_mcc == '5411':
                factor = 2
            elif trn_mcc == '5812':
                factor = 3
            pkt_add = int(trn_btr) * factor
            acct['KTO_PKT'] += pkt_add
            if acct['KTO_PKT'] > KO_MAX_PKT:
                acct['KTO_PKT'] = KO_MAX_PKT
        elif trn_typ == '03':
            pkt_sub = int(trn_btr)
            acct['KTO_PKT'] -= pkt_sub
            if acct['KTO_PKT'] < 0:
                acct['KTO_PKT'] = 0

        # Cash Fee
        if trn_typ == '04':
            fee = (trn_btr * KO_GEB_BAR_PROZ) / 100
            fee = fee.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            if fee < KO_GEB_BAR_MIN:
                fee = KO_GEB_BAR_MIN
            acct['KTO_SLD'] += fee
            acct['KTO_ZYK_SOL'] += fee
            
            # Create Fee Transaction
            fee_trn = {
                'TRN_ID': 'CF' + trn_id[2:],
                'TRN_TYP': '05',
                'TRN_KAT': '0001',
                'TRN_QUELLE': trn['TRN_QUELLE'],
                'TRN_TXT': 'BARGELDGEBUEHR',
                'TRN_BTR': fee,
                'TRN_HDL': trn['TRN_HDL'],
                'TRN_MCC': trn['TRN_MCC'],
                'TRN_KARTE': trn['TRN_KARTE'],
                'TRN_DT': trn['TRN_DT'],
            }
            trans_out.append(format_buc_satz(fee_trn, kto_nr, run_date))

        # Write Original Transaction
        trans_out.append(format_buc_satz(trn, kto_nr, run_date))

        # Update TCATFILE
        key = (kto_nr, trn_typ, trn['TRN_KAT'])
        if key in tcats:
            tcats[key]['TCA_SLD'] += trn_btr
        else:
            tcats[key] = {
                'TCA_KTO': kto_nr,
                'TCA_TYP': trn_typ,
                'TCA_KAT': trn['TRN_KAT'],
                'TCA_SLD': trn_btr,
            }

        z_gebu += 1

    # Write Outputs
    acct_out_lines = [format_kto_satz(acct) for acct in accounts.values()]
    write_file_lines(os.path.join(out_dir, 'ACCTOUT'), acct_out_lines)

    tcat_out_lines = [format_tca_satz(tca) for tca in tcats.values()]
    write_file_lines(os.path.join(out_dir, 'TCATOUT'), tcat_out_lines)

    write_file_lines(os.path.join(out_dir, 'TRANOUT'), trans_out)

    write_file_lines(os.path.join(out_dir, 'REJECTS'), rejects)

    if z_abgew > 0:
        sys.exit(4)

def step_interest(in_dir, out_dir):
    """Step 020: ZINSEN / GEBUEHREN / STATUS (Interest/Fees/Status)"""
    # Read Control Card
    ctl_lines = read_file_lines(os.path.join(in_dir, 'CTLCARD'))
    if not ctl_lines:
        sys.exit(16)
    w_ldt = ctl_lines[0][:8]
    if not w_ldt.isdigit():
        sys.exit(16)
    run_date = w_ldt

    # Load Account File
    acct_lines = read_file_lines(os.path.join(in_dir, 'ACCTFILE'))
    accounts = {}
    for line in acct_lines:
        if line.strip():
            acct = parse_kto_satz(line)
            accounts[acct['KTO_NR']] = acct

    # Load Category Balances
    tcat_lines = read_file_lines(os.path.join(in_dir, 'TCATFILE'))
    tcats = {}
    for line in tcat_lines:
        if line.strip():
            tca = parse_tca_satz(line)
            key = (tca['TCA_KTO'], tca['TCA_TYP'], tca['TCA_KAT'])
            tcats[key] = tca

    # Load Discount Groups
    dsc_lines = read_file_lines(os.path.join(in_dir, 'DISCGRP'))
    dscs = {}
    for line in dsc_lines:
        if line.strip():
            dsc = parse_dsc_satz(line)
            key = (dsc['DSC_GRP'], dsc['DSC_TYP'], dsc['DSC_KAT'])
            dscs[key] = dsc

    # Load Customer File
    cust_lines = read_file_lines(os.path.join(in_dir, 'CUSTFILE'))
    custs = {}
    for line in cust_lines:
        if line.strip():
            kds = parse_kds_satz(line)
            custs[kds['KDS_NR']] = kds

    trans_out = []

    for kto_nr, acct in accounts.items():
        if acct['KTO_ST'] == 'X':
            continue

        # Interest Calculation
        total_interest = Decimal('0')
        for key, tca in tcats.items():
            if tca['TCA_KTO'] != kto_nr:
                continue
            if tca['TCA_SLD'] <= 0:
                continue
            if tca['TCA_TYP'] == '02':
                continue

            # Rate Lookup
            grp = acct['KTO_GRP']
            typ = tca['TCA_TYP']
            kat = tca['TCA_KAT']
            
            rate = None
            key1 = (grp, typ, kat)
            if key1 in dscs:
                rate = dscs[key1]['DSC_ZINS']
            else:
                key2 = (GRP_DEF, typ, kat)
                if key2 in dscs:
                    rate = dscs[key2]['DSC_ZINS']
                else:
                    rate = Decimal('0')

            # Special Promo
            if grp == AKT_GRP and AKT_VON <= run_date <= AKT_BIS:
                rate = Decimal('0')

            # Surcharges
            if acct['KTO_ST'] == 'D':
                rate += KO_AUFS_VERZ
            
            # FICO Check
            kd_nr = acct['KTO_KDNR']
            if kd_nr in custs:
                fico = custs[kd_nr]['KDS_FICO']
                if fico < KO_FICO_GRENZE:
                    rate += KO_AUFS_FICO

            # Calculation
            interest = (tca['TCA_SLD'] * rate) / 1200
            interest = interest.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            total_interest += interest

        # Threshold
        if total_interest >= KO_ZINS_FREI:
            acct['KTO_SLD'] += total_interest
            acct['KTO_ZYK_SOL'] += total_interest
            trn = {
                'TRN_ID': 'ZI' + kto_nr + '000',
                'TRN_TYP': '06',
                'TRN_KAT': '0001',
                'TRN_QUELLE': ' ',
                'TRN_TXT': 'ZINSEN',
                'TRN_BTR': total_interest,
                'TRN_HDL': ' ',
                'TRN_MCC': ' ',
                'TRN_KARTE': ' ',
                'TRN_DT': run_date,
            }
            trans_out.append(format_buc_satz(trn, kto_nr, run_date))

        # Dunning Fees
        if acct['KTO_ST'] in ('A', 'D'):
            if acct['KTO_MINZ'] > 0 and acct['KTO_ZYK_ZAHL'] < acct['KTO_MINZ']:
                if acct['KTO_MAHN'] > 0:
                    fee = KO_MAHN_2
                else:
                    fee = KO_MAHN_1
                
                acct['KTO_SLD'] += fee
                acct['KTO_ZYK_SOL'] += fee
                trn = {
                    'TRN_ID': 'MA' + kto_nr + '000',
                    'TRN_TYP': '05',
                    'TRN_KAT': '0001',
                    'TRN_QUELLE': ' ',
                    'TRN_TXT': 'MAHNGEBUEHR',
                    'TRN_BTR': fee,
                    'TRN_HDL': ' ',
                    'TRN_MCC': ' ',
                    'TRN_KARTE': ' ',
                    'TRN_DT': run_date,
                }
                trans_out.append(format_buc_satz(trn, kto_nr, run_date))
                acct['KTO_MAHN'] += 1
                if acct['KTO_MAHN'] > 99:
                    acct['KTO_MAHN'] = 99
            else:
                # Reset
                if acct['KTO_ZYK_ZAHL'] >= acct['KTO_MINZ'] or acct['KTO_MINZ'] == 0:
                    acct['KTO_MAHN'] = 0

        # Overdraft Fee
        if acct['KTO_SLD'] > acct['KTO_KLIM']:
            fee = KO_UEBZ
            acct['KTO_SLD'] += fee
            acct['KTO_ZYK_SOL'] += fee
            trn = {
                'TRN_ID': 'UE' + kto_nr + '000',
                'TRN_TYP': '05',
                'TRN_KAT': '0001',
                'TRN_QUELLE': ' ',
                'TRN_TXT': 'UEBERZUGSGEBUEHR',
                'TRN_BTR': fee,
                'TRN_HDL': ' ',
                'TRN_MCC': ' ',
                'TRN_KARTE': ' ',
                'TRN_DT': run_date,
            }
            trans_out.append(format_buc_satz(trn, kto_nr, run_date))

        # Status Update
        if acct['KTO_ST'] == 'A' and acct['KTO_MAHN'] >= KO_VERZ_AB:
            acct['KTO_ST'] = 'D'
        elif acct['KTO_ST'] == 'D' and acct['KTO_MAHN'] >= KO_ABSCHR_AB:
            acct['KTO_ST'] = 'X'
        elif acct['KTO_ST'] == 'D' and acct['KTO_MAHN'] == 0:
            acct['KTO_ST'] = 'A'

    # Write Outputs
    acct_out_lines = [format_kto_satz(acct) for acct in accounts.values()]
    write_file_lines(os.path.join(out_dir, 'ACCTOUT'), acct_out_lines)

    write_file_lines(os.path.join(out_dir, 'TRANOUT'), trans_out)

def step_statement(in_dir, out_dir):
    """Step 030: KONTOAUSZUG, NEUER ZYKLUS (Statement/New Cycle)"""
    # Read Control Card
    ctl_lines = read_file_lines(os.path.join(in_dir, 'CTLCARD'))
    if not ctl_lines:
        sys.exit(16)
    w_ldt = ctl_lines[0][:8]
    if not w_ldt.isdigit():
        sys.exit(16)
    run_date = w_ldt

    # Calculate Due Date
    dt = datetime.strptime(run_date, '%Y%m%d')
    due_dt = dt + timedelta(days=KO_FAELLIG_TG)
    due_date = due_dt.strftime('%Y%m%d')

    # Load Account File
    acct_lines = read_file_lines(os.path.join(in_dir, 'ACCTFILE'))
    accounts = {}
    for line in acct_lines:
        if line.strip():
            acct = parse_kto_satz(line)
            accounts[acct['KTO_NR']] = acct

    # Load Customer File
    cust_lines = read_file_lines(os.path.join(in_dir, 'CUSTFILE'))
    custs = {}
    for line in cust_lines:
        if line.strip():
            kds = parse_kds_satz(line)
            custs[kds['KDS_NR']] = kds

    stmt_lines = []

    for kto_nr, acct in accounts.items():
        if acct['KTO_ST'] == 'X':
            continue

        # Minimum Payment Calculation
        if acct['KTO_SLD'] <= 0:
            min_pay = Decimal('0')
        else:
            if acct['KTO_SLD'] < KO_MINZ_MIN:
                min_pay = acct['KTO_SLD']
            else:
                min_pay = max((acct['KTO_SLD'] * KO_MINZ_PROZ) / 100, KO_MINZ_MIN)
                if acct['KTO_SLD'] > acct['KTO_KLIM']:
                    min_pay += (acct['KTO_SLD'] - acct['KTO_KLIM'])
                if min_pay > acct['KTO_SLD']:
                    min_pay = acct['KTO_SLD']
        
        acct['KTO_MINZ'] = min_pay

        # Statement Generation
        if acct['KTO_SLD'] != 0 or acct['KTO_ZYK_SOL'] != 0 or acct['KTO_ZYK_HAB'] != 0:
            # Name Lookup
            kd_nr = acct['KTO_KDNR']
            if kd_nr in custs:
                name = custs[kd_nr]['KDS_VORN'] + ' ' + custs[kd_nr]['KDS_NACHN']
            else:
                name = 'UNBEKANNT'

            # Currency Conversion
            sld = acct['KTO_SLD']
            if SW_EURO == 'J':
                sld = sld / EUR_RATE
                sld = sld.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

            stmt = format_azg_satz(
                kto_nr,
                name,
                sld,
                acct['KTO_MINZ'],
                due_date,
                acct['KTO_PKT'],
                acct['KTO_ST'],
                acct['KTO_ZYK_SOL'],
                acct['KTO_ZYK_HAB']
            )
            stmt_lines.append(stmt)

        # Cycle Reset
        acct['KTO_ZYK_SOL'] = Decimal('0')
        acct['KTO_ZYK_HAB'] = Decimal('0')
        acct['KTO_ZYK_ZAHL'] = Decimal('0')
        acct['KTO_MINZ'] = KO_MINZ_MIN  # System minimum

    # Write Outputs
    acct_out_lines = [format_kto_satz(acct) for acct in accounts.values()]
    write_file_lines(os.path.join(out_dir, 'ACCTOUT'), acct_out_lines)

    write_file_lines(os.path.join(out_dir, 'STMTFILE'), stmt_lines)

def main():
    if len(sys.argv) != 4:
        print("Usage: python3 app.py STEP IN_DIR OUT_DIR")
        sys.exit(1)

    step = sys.argv[1].upper()
    in_dir = sys.argv[2]
    out_dir = sys.argv[3]

    if not os.path.exists(out_dir):
        os.makedirs(out_dir)

    if step == 'POST':
        step_post(in_dir, out_dir)
    elif step == 'INTEREST':
        step_interest(in_dir, out_dir)
    elif step == 'STATEMENT':
        step_statement(in_dir, out_dir)
    else:
        print(f"Unknown step: {step}")
        sys.exit(1)

if __name__ == '__main__':
    main()
