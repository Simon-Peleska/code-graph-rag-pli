#!/usr/bin/env python3
"""
KARTENBANK Batch System - Python Implementation
"""

import sys
import os
import math
from datetime import datetime, timedelta

# Record lengths
KTO_LEN = 140
TRN_LEN = 120
BUC_LEN = 130
TCA_LEN = 30
XRF_LEN = 50
DSC_LEN = 20
KDS_LEN = 60
AZG_LEN = 120
ABW_LEN = 50

# Rejection codes and texts
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

def pad_record(line, length):
    """Pad a line to the specified record length."""
    if len(line) >= length:
        return line[:length]
    return line.ljust(length)

def parse_signed_decimal(s):
    """Parse a signed decimal with implied decimal point (2 decimals)."""
    s = s.strip()
    if not s:
        return 0.0
    # Handle sign
    negative = False
    if s.startswith('-'):
        negative = True
        s = s[1:]
    elif s.startswith('+'):
        s = s[1:]
    
    # Remove leading zeros for parsing
    s = s.lstrip('0')
    if not s:
        return 0.0
    
    # The format is S99999999V99, so the last 2 digits are decimals
    if len(s) <= 2:
        # All decimals
        val = float('0.' + s)
    else:
        int_part = s[:-2]
        dec_part = s[-2:]
        val = float(int_part + '.' + dec_part)
    
    return -val if negative else val

def format_signed_decimal(val, length=11):
    """Format a value as signed decimal with 2 implied decimals."""
    # Round to 2 decimal places
    val = round(val, 2)
    negative = val < 0
    val = abs(val)
    
    # Convert to integer cents
    cents = int(round(val * 100))
    
    # Format as string with leading zeros
    s = str(cents).zfill(10)  # 8 integer digits + 2 decimal digits
    
    if negative:
        s = '-' + s
    else:
        s = ' ' + s  # Space for positive
    
    # Pad to length
    if len(s) > length:
        s = s[-length:]
    else:
        s = s.rjust(length)
    
    return s

def parse_unsigned_decimal(s):
    """Parse an unsigned decimal with implied decimal point (2 decimals)."""
    s = s.strip()
    if not s:
        return 0.0
    s = s.lstrip('0')
    if not s:
        return 0.0
    
    if len(s) <= 2:
        val = float('0.' + s)
    else:
        int_part = s[:-2]
        dec_part = s[-2:]
        val = float(int_part + '.' + dec_part)
    
    return val

def format_unsigned_decimal(val, length=10):
    """Format a value as unsigned decimal with 2 implied decimals."""
    val = round(val, 2)
    cents = int(round(val * 100))
    s = str(cents).zfill(10)
    if len(s) > length:
        s = s[-length:]
    else:
        s = s.rjust(length)
    return s

def parse_points(s):
    """Parse loyalty points (9 digits)."""
    s = s.strip()
    if not s:
        return 0
    return int(s)

def format_points(val, length=9):
    """Format loyalty points."""
    val = max(0, min(999999999, int(val)))
    return str(val).zfill(length)

def parse_date(s):
    """Parse YYYYMMDD date string."""
    s = s.strip()
    if len(s) != 8:
        return None
    try:
        return datetime.strptime(s, '%Y%m%d')
    except ValueError:
        return None

def format_date(dt):
    """Format datetime as YYYYMMDD."""
    return dt.strftime('%Y%m%d')

def add_days(date_str, days):
    """Add days to a YYYYMMDD date string."""
    dt = parse_date(date_str)
    if dt is None:
        return date_str
    new_dt = dt + timedelta(days=days)
    return format_date(new_dt)

def read_file(filename):
    """Read a file and return list of lines (stripped of trailing whitespace)."""
    if not os.path.exists(filename):
        return []
    with open(filename, 'r') as f:
        lines = f.readlines()
    return [line.rstrip('\n').rstrip() for line in lines]

def write_file(filename, records):
    """Write records to a file, one per line."""
    with open(filename, 'w') as f:
        for rec in records:
            f.write(rec + '\n')

def load_accounts(in_dir):
    """Load account master file."""
    filename = os.path.join(in_dir, 'ACCTFILE')
    lines = read_file(filename)
    accounts = {}
    for line in lines:
        rec = pad_record(line, KTO_LEN)
        kto_nr = rec[0:11].strip()
        if not kto_nr:
            continue
        
        account = {
            'KTO_NR': kto_nr,
            'KTO_ST': rec[11:12],
            'KTO_SLD': parse_signed_decimal(rec[12:23]),
            'KTO_KLIM': parse_unsigned_decimal(rec[23:33]),
            'KTO_BLIM': parse_unsigned_decimal(rec[33:43]),
            'KTO_ERDT': rec[43:51].strip(),
            'KTO_ABDT': rec[51:59].strip(),
            'KTO_ZYK_HAB': parse_signed_decimal(rec[59:70]),
            'KTO_ZYK_SOL': parse_signed_decimal(rec[70:81]),
            'KTO_GRP': rec[81:91].strip(),
            'KTO_MAHN': int(rec[91:93].strip() or '0'),
            'KTO_MINZ': parse_signed_decimal(rec[93:104]),
            'KTO_ZYK_ZAHL': parse_signed_decimal(rec[104:115]),
            'KTO_PKT': parse_points(rec[115:124]),
            'KTO_KDNR': rec[124:133].strip(),
        }
        accounts[kto_nr] = account
    return accounts

def load_card_refs(in_dir):
    """Load card reference file."""
    filename = os.path.join(in_dir, 'XREFFILE')
    lines = read_file(filename)
    card_refs = {}
    for line in lines:
        rec = pad_record(line, XRF_LEN)
        karte = rec[0:16].strip()
        if not karte:
            continue
        card_refs[karte] = {
            'XRF_KARTE': karte,
            'XRF_KDNR': rec[16:25].strip(),
            'XRF_KTO': rec[25:36].strip(),
            'XRF_ST': rec[36:37],
        }
    return card_refs

def load_category_balances(in_dir):
    """Load category balance file."""
    filename = os.path.join(in_dir, 'TCATFILE')
    lines = read_file(filename)
    cat_balances = {}
    for line in lines:
        rec = pad_record(line, TCA_LEN)
        kto = rec[0:11].strip()
        typ = rec[11:13].strip()
        kat = rec[13:17].strip()
        key = (kto, typ, kat)
        cat_balances[key] = {
            'TCA_KTO': kto,
            'TCA_TYP': typ,
            'TCA_KAT': kat,
            'TCA_SLD': parse_signed_decimal(rec[17:28]),
        }
    return cat_balances

def load_discount_groups(in_dir):
    """Load discount group file."""
    filename = os.path.join(in_dir, 'DISCGRP')
    lines = read_file(filename)
    disc_groups = {}
    for line in lines:
        rec = pad_record(line, DSC_LEN)
        grp = rec[0:10].strip()
        typ = rec[10:12].strip()
        kat = rec[12:16].strip()
        zins = parse_unsigned_decimal(rec[16:20])
        key = (grp, typ, kat)
        disc_groups[key] = zins
    return disc_groups

def load_customers(in_dir):
    """Load customer master file."""
    filename = os.path.join(in_dir, 'CUSTFILE')
    lines = read_file(filename)
    customers = {}
    for line in lines:
        rec = pad_record(line, KDS_LEN)
        kd_nr = rec[0:9].strip()
        if not kd_nr:
            continue
        customers[kd_nr] = {
            'KDS_NR': kd_nr,
            'KDS_VORN': rec[9:29].strip(),
            'KDS_NACHN': rec[29:54].strip(),
            'KDS_FICO': int(rec[54:57].strip() or '0'),
        }
    return customers

def load_transactions(in_dir):
    """Load daily transactions file."""
    filename = os.path.join(in_dir, 'DALYTRAN')
    lines = read_file(filename)
    transactions = []
    for line in lines:
        rec = pad_record(line, TRN_LEN)
        transactions.append({
            'TRN_ID': rec[0:16].strip(),
            'TRN_TYP': rec[16:18].strip(),
            'TRN_KAT': rec[18:22].strip(),
            'TRN_QUELLE': rec[22:32].strip(),
            'TRN_TXT': rec[32:62].strip(),
            'TRN_BTR': parse_signed_decimal(rec[62:73]),
            'TRN_HDL': rec[73:82].strip(),
            'TRN_MCC': rec[82:86].strip(),
            'TRN_KARTE': rec[86:102].strip(),
            'TRN_DT': rec[102:110].strip(),
        })
    return transactions

def create_buc_satz(trn, kto_nr, run_date):
    """Create a BUC_SATZ record from a transaction."""
    # First 110 chars of TRN_SATZ
    trn_rec = (
        trn['TRN_ID'].ljust(16) +
        trn['TRN_TYP'].ljust(2) +
        trn['TRN_KAT'].ljust(4) +
        trn['TRN_QUELLE'].ljust(10) +
        trn['TRN_TXT'].ljust(30) +
        format_signed_decimal(trn['TRN_BTR'], 11) +
        trn['TRN_HDL'].ljust(9) +
        trn['TRN_MCC'].ljust(4) +
        trn['TRN_KARTE'].ljust(16) +
        trn['TRN_DT'].ljust(8) +
        ' ' * 10  # Filler
    )
    buc_trn = trn_rec[:110]
    
    buc = (
        buc_trn +
        kto_nr.ljust(11) +
        run_date.ljust(8) +
        ' '
    )
    return buc[:BUC_LEN]

def create_abw_satz(trn_id, code, text):
    """Create an ABW_SATZ record."""
    abw = (
        trn_id.ljust(16) +
        str(code).zfill(3) +
        text.ljust(30) +
        ' '
    )
    return abw[:ABW_LEN]

def create_tca_satz(kto, typ, kat, sld):
    """Create a TCA_SATZ record."""
    tca = (
        kto.ljust(11) +
        typ.ljust(2) +
        kat.ljust(4) +
        format_signed_decimal(sld, 11) +
        '  '
    )
    return tca[:TCA_LEN]

def create_azg_satz(kto, name, sld, minz, fael, pkt, st, sol, hab):
    """Create an AZG_SATZ record."""
    azg = (
        kto.ljust(11) +
        name.ljust(46) +
        format_signed_decimal(sld, 11) +
        format_signed_decimal(minz, 11) +
        fael.ljust(8) +
        format_points(pkt, 9) +
        st.ljust(1) +
        format_signed_decimal(sol, 11) +
        format_signed_decimal(hab, 11) +
        ' '
    )
    return azg[:AZG_LEN]

def create_kto_record(account):
    """Create a KTO_SATZ record from an account dict."""
    rec = (
        account['KTO_NR'].ljust(11) +
        account['KTO_ST'].ljust(1) +
        format_signed_decimal(account['KTO_SLD'], 11) +
        format_unsigned_decimal(account['KTO_KLIM'], 10) +
        format_unsigned_decimal(account['KTO_BLIM'], 10) +
        account['KTO_ERDT'].ljust(8) +
        account['KTO_ABDT'].ljust(8) +
        format_signed_decimal(account['KTO_ZYK_HAB'], 11) +
        format_signed_decimal(account['KTO_ZYK_SOL'], 11) +
        account['KTO_GRP'].ljust(10) +
        str(account['KTO_MAHN']).zfill(2) +
        format_signed_decimal(account['KTO_MINZ'], 11) +
        format_signed_decimal(account['KTO_ZYK_ZAHL'], 11) +
        format_points(account['KTO_PKT'], 9) +
        account['KTO_KDNR'].ljust(9) +
        ' ' * 7  # Filler
    )
    return rec[:KTO_LEN]

def step_post(in_dir, out_dir):
    """STEP010: KBP00001 - Book daily transactions."""
    # Read run date
    ctlicard_file = os.path.join(in_dir, 'CTLCARD')
    run_date = ''
    if os.path.exists(ctlicard_file):
        with open(ctlicard_file, 'r') as f:
            line = f.readline().strip()
            run_date = line[:8]
    
    if not run_date or len(run_date) != 8:
        print("Error: Invalid run date", file=sys.stderr)
        sys.exit(16)
    
    # Load data
    accounts = load_accounts(in_dir)
    card_refs = load_card_refs(in_dir)
    cat_balances = load_category_balances(in_dir)
    transactions = load_transactions(in_dir)
    
    # Track seen transaction IDs
    seen_ids = set()
    
    # Output lists
    acct_out = []
    tcat_out = []
    tran_out = []
    rejects = []
    
    # Statistics
    stats_accepted = 0
    stats_rejected = 0
    stats_cash_fee = 0
    
    # Process each transaction
    for trn in transactions:
        trn_id = trn['TRN_ID']
        trn_typ = trn['TRN_TYP']
        trn_btr = trn['TRN_BTR']
        trn_karte = trn['TRN_KARTE']
        trn_dt = trn['TRN_DT']
        trn_mcc = trn['TRN_MCC']
        
        # Determine SOLL flag
        soll = 1 if trn_typ in ('01', '04') else 0
        
        # Check for duplicate
        dopp = 1 if trn_id in seen_ids else 0
        seen_ids.add(trn_id)
        
        # Business rules validation
        reject_code = 0
        reject_text = ''
        
        if dopp:
            reject_code = 110
        elif trn_btr <= 0:
            reject_code = 109
        elif trn_typ in ('05', '06'):
            reject_code = 111
        elif trn_typ not in ('01', '02', '03', '04'):
            reject_code = 111
        else:
            # Look up card
            card = card_refs.get(trn_karte)
            if card is None:
                reject_code = 100
            elif card['XRF_ST'] != 'Y':
                reject_code = 101
            else:
                # Look up account
                kto_nr = card['XRF_KTO']
                account = accounts.get(kto_nr)
                if account is None:
                    reject_code = 102
                elif account['KTO_ST'] in ('C', 'X'):
                    reject_code = 103
                else:
                    # Check expiry
                    if trn_dt and account['KTO_ABDT'] and trn_dt > account['KTO_ABDT']:
                        reject_code = 105
                    elif soll == 1 and account['KTO_ST'] == 'D':
                        reject_code = 104
                    elif trn_typ == '01' and trn_mcc == '7995':
                        reject_code = 108
                    elif trn_typ == '04' and trn_btr > account['KTO_BLIM']:
                        reject_code = 107
                    else:
                        # Check credit limit
                        if soll == 1:
                            new_balance = account['KTO_SLD'] + trn_btr
                            if new_balance > account['KTO_KLIM']:
                                reject_code = 106
        
        if reject_code > 0:
            # Write rejection
            text = REJECT_TEXTS.get(reject_code, 'UNBEKANNT')
            rejects.append(create_abw_satz(trn_id, reject_code, text))
            stats_rejected += 1
        else:
            # Accept and book
            account = accounts[card['XRF_KTO']]
            kto_nr = account['KTO_NR']
            
            if soll == 1:
                # Debit
                account['KTO_SLD'] += trn_btr
                account['KTO_ZYK_SOL'] += trn_btr
            else:
                # Credit
                account['KTO_SLD'] -= trn_btr
                account['KTO_ZYK_HAB'] += trn_btr
                if trn_typ == '02':
                    account['KTO_ZYK_ZAHL'] += trn_btr
            
            # Points calculation
            int_amount = int(trn_btr)
            if trn_typ == '01':
                if trn_mcc == '5411':
                    factor = 2
                elif trn_mcc == '5812':
                    factor = 3
                else:
                    factor = 1
                account['KTO_PKT'] += int_amount * factor
                account['KTO_PKT'] = min(account['KTO_PKT'], 999999999)
            elif trn_typ == '03':
                account['KTO_PKT'] -= int_amount
                account['KTO_PKT'] = max(account['KTO_PKT'], 0)
            
            # Write transaction history
            tran_out.append(create_buc_satz(trn, kto_nr, run_date))
            stats_accepted += 1
            
            # Cash fee
            if trn_typ == '04':
                raw_fee = (trn_btr * 5.00) / 100
                fee = max(raw_fee, 10.00)
                account['KTO_SLD'] += fee
                account['KTO_ZYK_SOL'] += fee
                
                # Create fee transaction
                fee_trn = {
                    'TRN_ID': 'CF' + trn_id[2:],
                    'TRN_TYP': '05',
                    'TRN_KAT': '0001',
                    'TRN_QUELLE': 'SYSTEM',
                    'TRN_TXT': 'BARGELDGEBUEHR',
                    'TRN_BTR': fee,
                    'TRN_HDL': '000000000',
                    'TRN_MCC': '0000',
                    'TRN_KARTE': trn_karte,
                    'TRN_DT': run_date,
                }
                tran_out.append(create_buc_satz(fee_trn, kto_nr, run_date))
                stats_cash_fee += 1
    
    # Write outputs
    for kto_nr in sorted(accounts.keys()):
        acct_out.append(create_kto_record(accounts[kto_nr]))
    
    for key in sorted(cat_balances.keys()):
        kto, typ, kat = key
        tcat_out.append(create_tca_satz(kto, typ, kat, cat_balances[key]['TCA_SLD']))
    
    write_file(os.path.join(out_dir, 'ACCTOUT'), acct_out)
    write_file(os.path.join(out_dir, 'TCATOUT'), tcat_out)
    write_file(os.path.join(out_dir, 'TRANOUT'), tran_out)
    write_file(os.path.join(out_dir, 'REJECTS'), rejects)
    
    # Return code
    if stats_rejected > 0:
        return 4
    return 0

def step_interest(in_dir, out_dir):
    """STEP020: KBP00002 - Calculate interest, fees, update status."""
    # Read run date
    ctlicard_file = os.path.join(in_dir, 'CTLCARD')
    run_date = ''
    if os.path.exists(ctlicard_file):
        with open(ctlicard_file, 'r') as f:
            line = f.readline().strip()
            run_date = line[:8]
    
    if not run_date or len(run_date) != 8:
        print("Error: Invalid run date", file=sys.stderr)
        sys.exit(16)
    
    # Load data
    accounts = load_accounts(in_dir)
    cat_balances = load_category_balances(in_dir)
    disc_groups = load_discount_groups(in_dir)
    customers = load_customers(in_dir)
    
    # Output lists
    acct_out = []
    tran_out = []
    
    # Process each account
    for kto_nr in sorted(accounts.keys()):
        account = accounts[kto_nr]
        
        # Skip written-off accounts
        if account['KTO_ST'] == 'X':
            continue
        
        # Interest calculation
        total_interest = 0.0
        for key, cat_bal in cat_balances.items():
            kto, typ, kat = key
            if kto != kto_nr:
                continue
            if cat_bal['TCA_SLD'] > 0 and typ != '02':
                # Determine rate
                rate = 0.0
                grp = account['KTO_GRP']
                
                # Check for AKTION2010
                if grp == 'AKTION2010' and '20100101' <= run_date <= '20111231':
                    rate = 0.0
                else:
                    # Look up rate
                    key1 = (grp, typ, kat)
                    if key1 in disc_groups:
                        rate = disc_groups[key1]
                    else:
                        key2 = ('DEFAULT', typ, kat)
                        if key2 in disc_groups:
                            rate = disc_groups[key2]
                
                # Adjust for delinquent
                if account['KTO_ST'] == 'D':
                    rate += 3.00
                
                # Adjust for FICO
                kd_nr = account['KTO_KDNR']
                if kd_nr in customers:
                    fico = customers[kd_nr]['KDS_FICO']
                    if fico < 600:
                        rate += 2.00
                
                # Calculate interest
                interest = (cat_bal['TCA_SLD'] * rate) / 1200
                total_interest += interest
        
        # Apply interest if >= 1.00
        if total_interest >= 1.00:
            account['KTO_SLD'] += total_interest
            account['KTO_ZYK_SOL'] += total_interest
            
            int_trn = {
                'TRN_ID': 'ZI' + kto_nr + '000',
                'TRN_TYP': '06',
                'TRN_KAT': '0001',
                'TRN_QUELLE': 'ZINSLAUF',
                'TRN_TXT': 'SOLLZINSEN',
                'TRN_BTR': total_interest,
                'TRN_HDL': '000000000',
                'TRN_MCC': '0000',
                'TRN_KARTE': '',
                'TRN_DT': run_date,
            }
            tran_out.append(create_buc_satz(int_trn, kto_nr, run_date))
        
        # Dunning fees
        if account['KTO_ST'] in ('A', 'D'):
            if account['KTO_MINZ'] > 0 and account['KTO_ZYK_ZAHL'] < account['KTO_MINZ']:
                fee = 35.00 if account['KTO_MAHN'] > 0 else 25.00
                account['KTO_SLD'] += fee
                account['KTO_ZYK_SOL'] += fee
                account['KTO_MAHN'] = min(account['KTO_MAHN'] + 1, 99)
                
                mahn_trn = {
                    'TRN_ID': 'MG' + kto_nr + '000',
                    'TRN_TYP': '05',
                    'TRN_KAT': '0002',
                    'TRN_QUELLE': 'ZINSLAUF',
                    'TRN_TXT': 'MAHNGEBUEHR',
                    'TRN_BTR': fee,
                    'TRN_HDL': '000000000',
                    'TRN_MCC': '0000',
                    'TRN_KARTE': '',
                    'TRN_DT': run_date,
                }
                tran_out.append(create_buc_satz(mahn_trn, kto_nr, run_date))
            else:
                account['KTO_MAHN'] = 0
        
        # Overdraft fee
        if account['KTO_SLD'] > account['KTO_KLIM']:
            fee = 29.00
            account['KTO_SLD'] += fee
            account['KTO_ZYK_SOL'] += fee
            
            overdraft_trn = {
                'TRN_ID': 'UL' + kto_nr + '000',
                'TRN_TYP': '05',
                'TRN_KAT': '0003',
                'TRN_QUELLE': 'ZINSLAUF',
                'TRN_TXT': 'UEBERZIEHUNGSGEBUEHR',
                'TRN_BTR': fee,
                'TRN_HDL': '000000000',
                'TRN_MCC': '0000',
                'TRN_KARTE': '',
                'TRN_DT': run_date,
            }
            tran_out.append(create_buc_satz(overdraft_trn, kto_nr, run_date))
        
        # Status update
        if account['KTO_ST'] == 'A' and account['KTO_MAHN'] >= 2:
            account['KTO_ST'] = 'D'
        elif account['KTO_ST'] == 'D' and account['KTO_MAHN'] >= 6:
            account['KTO_ST'] = 'X'
        elif account['KTO_ST'] == 'D' and account['KTO_MAHN'] == 0:
            account['KTO_ST'] = 'A'
    
    # Write outputs
    for kto_nr in sorted(accounts.keys()):
        acct_out.append(create_kto_record(accounts[kto_nr]))
    
    write_file(os.path.join(out_dir, 'ACCTOUT'), acct_out)
    write_file(os.path.join(out_dir, 'TRANOUT'), tran_out)
    
    return 0

def step_statement(in_dir, out_dir):
    """STEP030: KBP00003 - Generate statements, reset cycle counters."""
    # Read run date
    ctlicard_file = os.path.join(in_dir, 'CTLCARD')
    run_date = ''
    if os.path.exists(ctlicard_file):
        with open(ctlicard_file, 'r') as f:
            line = f.readline().strip()
            run_date = line[:8]
    
    if not run_date or len(run_date) != 8:
        print("Error: Invalid run date", file=sys.stderr)
        sys.exit(16)
    
    # Calculate due date
    due_date = add_days(run_date, 25)
    
    # Load data
    accounts = load_accounts(in_dir)
    customers = load_customers(in_dir)
    
    # Output lists
    acct_out = []
    stmt_out = []
    
    # Process each account
    for kto_nr in sorted(accounts.keys()):
        account = accounts[kto_nr]
        
        # Skip written-off accounts
        if account['KTO_ST'] == 'X':
            continue
        
        # Minimum payment calculation
        sld = account['KTO_SLD']
        if sld <= 0:
            min_pay = 0.0
        elif sld < 25.00:
            min_pay = sld
        else:
            calc_min = (sld * 2.00) / 100
            min_pay = max(calc_min, 25.00)
            if sld > account['KTO_KLIM']:
                min_pay += (sld - account['KTO_KLIM'])
            min_pay = min(min_pay, sld)
        
        account['KTO_MINZ'] = min_pay
        
        # Statement generation
        if sld != 0 or account['KTO_ZYK_SOL'] != 0 or account['KTO_ZYK_HAB'] != 0:
            # Resolve customer name
            name = 'UNBEKANNT'
            kd_nr = account['KTO_KDNR']
            if kd_nr in customers:
                cust = customers[kd_nr]
                vorn = cust['KDS_VORN']
                nachn = cust['KDS_NACHN']
                if vorn and nachn:
                    name = vorn + ' ' + nachn
                elif vorn:
                    name = vorn
                elif nachn:
                    name = nachn
            
            # Create statement
            stmt_out.append(create_azg_satz(
                kto_nr,
                name,
                sld,
                min_pay,
                due_date,
                account['KTO_PKT'],
                account['KTO_ST'],
                account['KTO_ZYK_SOL'],
                account['KTO_ZYK_HAB']
            ))
        
        # Reset cycle
        account['KTO_ZYK_SOL'] = 0.0
        account['KTO_ZYK_HAB'] = 0.0
        account['KTO_ZYK_ZAHL'] = 0.0
    
    # Write outputs
    for kto_nr in sorted(accounts.keys()):
        acct_out.append(create_kto_record(accounts[kto_nr]))
    
    write_file(os.path.join(out_dir, 'ACCTOUT'), acct_out)
    write_file(os.path.join(out_dir, 'STMTFILE'), stmt_out)
    
    return 0

def main():
    if len(sys.argv) != 4:
        print("Usage: python3 app.py STEP IN_DIR OUT_DIR", file=sys.stderr)
        sys.exit(1)
    
    step = sys.argv[1].upper()
    in_dir = sys.argv[2]
    out_dir = sys.argv[3]
    
    # Create output directory if it doesn't exist
    if not os.path.exists(out_dir):
        os.makedirs(out_dir)
    
    if step == 'POST':
        rc = step_post(in_dir, out_dir)
    elif step == 'INTEREST':
        rc = step_interest(in_dir, out_dir)
    elif step == 'STATEMENT':
        rc = step_statement(in_dir, out_dir)
    else:
        print(f"Unknown step: {step}", file=sys.stderr)
        sys.exit(1)
    
    sys.exit(rc)

if __name__ == '__main__':
    main()
