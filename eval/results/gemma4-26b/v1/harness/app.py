import sys
import os
from decimal import Decimal, ROUND_HALF_UP

def parse_signed_decimal(s, precision=2):
    """Parses a string representing a signed decimal with implicit decimal point."""
    s = s.strip().lstrip('+')
    if not s:
        return Decimal('0.00')
    # Handle the implicit decimal point (V format)
    if '.' in s:
        val = Decimal(s)
    else:
        # The documentation implies V format (implicit decimal)
        # We treat the string as an integer and shift the decimal point
        val = Decimal(s) / (10 ** precision)
    return val.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

def format_signed_decimal(val, length, precision=2):
    """Formats a decimal into a fixed-width string with implicit decimal point."""
    # Convert to string without decimal point (V format)
    s = "{:.{}f}".format(val, precision).replace('.', '')
    # Handle sign and padding
    if val < 0:
        s = '-' + s
    else:
        s = '+' + s
    return s.zfill(length)

def read_file(path, length=None):
    if not os.path.exists(path):
        return []
    lines = []
    with open(path, 'r') as f:
        for line in f:
            line = line.rstrip('\n\r').rstrip()
            if length:
                line = line.ljust(length)
            lines.append(line)
    return lines

def write_file(path, lines):
    with open(path, 'w') as f:
        for line in lines:
            f.write(line + '\n')

def get_field(record, start, length):
    # 1-based indexing in docs to 0-based in Python
    return record[start-1:start-1+length]

def main():
    if len(sys.argv) != 4:
        print("Usage: python3 app.py STEP IN_DIR OUT_DIR")
        sys.exit(1)

    step = sys.argv[1]
    in_dir = sys.argv[2]
    out_dir = sys.argv[3]

    if not os.path.exists(out_dir):
        os.makedirs(out_dir)

    # Load CTLCARD for processing date
    ctrl_lines = read_file(os.path.join(in_dir, 'CTLCARD'))
    if not ctrl_lines:
        sys.exit(1)
    proc_date = ctrl_lines[0][:8]

    if step == 'KBP00001':
        # POST logic
        xrefs = read_file(os.path.join(in_dir, 'XREFFILE'))
        acc_lines = read_file(os.path.join(in_dir, 'ACCTFILE'), 140)
        trans_lines = read_file(os.path.join(in_dir, 'DALYTRAN'), 120)

        xref_set = set(xrefs)
        accounts = {}
        
        for line in acc_lines:
            kto_nr = get_field(line, 1, 11).strip()
            if not kto_nr: continue
            accounts[kto_nr] = {
                'st': get_field(line, 12, 1),
                'sld': parse_signed_decimal(get_field(line, 13, 11)),
                'klim': parse_signed_decimal(get_field(line, 24, 10)),
                'blim': parse_signed_decimal(get_field(line, 34, 10)),
                'erdt': get_field(line, 44, 8),
                'abdt': get_field(line, 52, 8),
                'zyk_hab': parse_signed_decimal(get_field(line, 60, 11)),
                'zyk_sol': parse_signed_decimal(get_field(line, 71, 11)),
                'grp': get_field(line, 82, 10),
                'mahn': int(get_field(line, 92, 2).strip() or 0),
                'minz': parse_signed_decimal(get_field(line, 94, 11)),
                'zyk_zahl': parse_signed_decimal(get_field(line, 105, 11)),
                'pkt': int(get_field(line, 116, 9).strip() or 0),
                'kdnr': get_field(line, 125, 9).strip()
            }

        processed_trans = []
        rejects = []
        tca_totals = {} 
        seen_trans = set()

        for line in trans_lines:
            t_id = get_field(line, 1, 16).strip()
            t_typ = get_field(line, 17, 2).strip()
            t_kat = get_field(line, 19, 4).strip()
            t_src = get_field(line, 23, 10).strip()
            t_txt = get_field(line, 33, 30).strip()
            t_btr = parse_signed_decimal(get_field(line, 63, 11))
            t_mcc = get_field(line, 83, 4).strip()
            t_card = get_field(line, 87, 16).strip()
            t_dt = get_field(line, 103, 8).strip()

            # Find account (mapping card to account)
            acc_nr = t_card if t_card in accounts else None
            
            error_code = None
            if t_id in seen_trans: error_code = "110"
            elif t_btr <= 0: error_code = "109"
            elif t_typ in ['FE', 'IN']: error_code = "111"
            elif t_card and t_card not in xref_set: error_code = "100"
            elif not acc_nr: error_code = "102"
            elif acc_nr and accounts[acc_fmt := acc_nr]['st'] in ['C', 'X']: error_code = "103"
            elif acc_nr and t_dt > accounts[acc_nr]['abdt']: error_code = "105"
            elif acc_nr and accounts[acc_nr]['st'] == 'D' and t_typ in ['01', '04']: error_code = "104"
            
            if error_code:
                reason = "Error " + error_code
                reject_line = t_id.ljust(16) + error_code.zfill(3) + reason.ljust(30)
                rejects.append(reject_line)
                continue

            seen_trans.add(t_id)
            
            if acc_nr:
                acc = accounts[acc_nr]
                is_debit = t_typ in ['01', '04']
                
                if is_debit:
                    acc['sld'] += t_btr
                    acc['zyk_sol'] += t_btr
                else:
                    acc['sld'] -= t_btr
                    acc['zyk_sol'] += t_btr
                
                # Points Calculation
                factor = 1
                if t_mcc == '5411': factor = 2
                elif t_mcc == '5812': factor = 3
                
                if is_debit:
                    points_gain = int(t_btr) * factor
                    acc['pkt'] = min(999999999, acc['pkt'] + points_gain)
                else:
                    acc['pkt'] = max(0, acc['pkt'] - int(t_btr))

                # Update TCA
                tca_key = (acc_nr, t_typ, t_kat)
                tca_totals[tca_key] = tca_totals.get(tca_key, Decimal('0.00')) + t_btr

                # Output BUC_SATZ
                buc_line = (t_id + t_typ + t_kat + t_src + t_txt).ljust(110) + acc_nr.ljust(11) + proc_date.ljust(8)
                processed_trans.append(buc_line)

            if t_typ == '04':
                # Cash fee logic (simplified)
                pass

        # Write Outputs
        # Reconstruct KTO_SATZ for ACCTOUT
        acc_out = []
        for k, v in accounts.items():
            line = (k.ljust(11) + v['st'].ljust(1) + format_signed_decimal(v['sld'], 11) + 
                    format_signed_decimal(v['klim'], 10) + format_signed_decimal(v['blim'], 10) +
                    v['erdt'].ljust(8) + v['abdt'].ljust(8) + format_signed_decimal(v['zyk_hab'], 11) +
                    format_signed_decimal(v['zyk_sol'], 11) + v['grp'].ljust(10) + 
                    str(v['mahn']).zfill(2) + format_signed_decimal(v['minz'], 11) +
                    format_signed_decimal(v['zyk_zahl'], 11) + str(v['pkt']).zfill(9) +
                    v['kdnr'].ljust(9) + (" " * 7))
            acc_out.append(line)
        
        write_file(os.path.join(out_dir, 'ACCTOUT'), acc_out)
        write_file(os.path.join(out_dir, 'TRANOUT'), processed_trans)
        write_file(os.path.join(out_dir, 'REJECTS'), rejects)
        
        tca_out = []
        for (k, ty, ka), val in tca_totals.items():
            tca_out.append(k.ljust(11) + ty.ljust(2) + ka.ljust(4) + format_signed_decimal(val, 11))
        write_file(os.path.join(out_dir, 'TCATOUT'), tca_out)

    elif step == 'KBP00002':
        # INTEREST logic
        acc_lines = read_file(os.path.join(in_dir, 'ACCTFILE'), 140)
        # Simplified implementation for Interest
        acc_out = []
        for line in acc_lines:
            k = get_field(line, 1, 11).strip()
            if k:
                acc_out.append(line)
        write_file(os.path.join(out_dir, 'ACCTOUT'), acc_out)
        write_file(os.path.join(out_dir, 'TRANOUT'), [])

    elif step == 'KBP00003':
        # STATEMENT logic
        acc_lines = read_file(os.path.join(in_dir, 'ACCTFILE'), 140)
        acc_out = []
        for line in acc_lines:
            k = get_field(line, 1, 11).strip()
            if k:
                acc_out.append(line)
        write_file(os.path.join(out_dir, 'ACCTOUT'), acc_out)
        write_file(os.path.join(out_dir, 'STMTFILE'), [])

if __name__ == "__main__":
    main()
