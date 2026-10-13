# Paste this entire block into Google Cloud Shell.
# Fills the club with demo data: 20 members, one full rotation round starting in January,
# monthly contributions up to today, confirmed payouts, a few late and unpaid members,
# one corrected payment, and reminders.
# If the club already has members, cycles or payments, they are REPLACED. A copy of the old
# records is saved first to mukando-before-demo-DATE.json in the folder you run this from.
# Login accounts are kept; member accounts are re-linked to the demo members. Club name,
# amount, penalty and grace days are kept; the start date is moved to 5 January this year.
# Set REPLACE_EXISTING=no below to make it stop instead of replacing.
# Remove the demo data again with REMOVE-DEMO-DATA.sh.
REPLACE_EXISTING=yes
export REPLACE_EXISTING
python3 - <<'PYTHON'
import json, os, random, subprocess, sys
from datetime import date, datetime, timedelta, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError
DB = os.environ.get('MUKANDO_DB_URL', 'https://scanpoly-f2834-default-rtdb.firebaseio.com').rstrip('/')
if os.environ.get('MUKANDO_TOKEN'):
    headers = {'Authorization': 'Bearer ' + os.environ['MUKANDO_TOKEN'], 'Content-Type': 'application/json'}
else:
    token = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()
    headers = {'Authorization': 'Bearer ' + token, 'x-goog-user-project': 'scanpoly-f2834', 'Content-Type': 'application/json'}
def call(path, method='GET', body=None):
    path, _, extra = path.partition('?')
    query = '&'.join(part for part in [extra, os.environ.get('MUKANDO_QUERY', '')] if part)
    request = Request(f'{DB}/{path}.json' + ('?' + query if query else ''),
                      json.dumps(body).encode() if body is not None else None, headers, method=method)
    try:
        with urlopen(request, timeout=60) as response:
            return json.load(response)
    except HTTPError as error:
        raise SystemExit(f'Error {error.code}: {error.read().decode()[:300]}')

# ---- 1. Existing club data: back it up, then replace it ----
TABLES = ['members', 'rounds', 'cycles', 'roundRecipients', 'memberCycles', 'cycleLocks', 'payments', 'paymentReversals', 'payouts',
          'cycleApprovals', 'reminders', 'auditLog', 'demoSeed']
existing = [t for t in ['members', 'cycles', 'payments', 'payouts', 'rounds'] if call(f'mukando/{t}?shallow=true')]
if existing:
    if os.environ.get('REPLACE_EXISTING', 'yes') != 'yes':
        raise SystemExit(f'Stopped: the club already has {", ".join(existing)}. Set REPLACE_EXISTING=yes to replace it. Nothing was changed.')
    backup = {t: call(f'mukando/{t}') for t in TABLES}
    name = f'mukando-before-demo-{date.today().isoformat()}.json'
    with open(name, 'w') as handle: json.dump(backup, handle)
    print(f'Existing club records saved to {name} ({sum(len(v or {}) for v in backup.values())} records). Replacing them with demo data.')
users = call('mukando/users') or {}
def pick(role):
    return next((uid for uid, row in sorted(users.items()) if row.get('active') and row.get('role') == role), None)
admin = pick('admin')
if not admin: raise SystemExit('Stopped: no active admin profile found under /mukando/users. Create the admin first (see README).')
treasurer = pick('treasurer') or admin

# ---- 2. Club rules (your terms are kept; the start date is January) ----
today = date.today()
saved = call('mukando/rules/club')
rules = {'id': 'club', 'clubName': 'Agape Fushai Group', 'amount': 20, 'frequency': 'monthly', 'startDate': f'{today.year}-01-05', 'penaltyAmount': 2, 'graceDays': 3}
if saved:   # keep the club's own terms, but start the year in January so there is a full year of history
    rules.update({key: saved[key] for key in ['clubName', 'amount', 'frequency', 'penaltyAmount', 'graceDays'] if key in saved})
amount, penalty, grace = rules['amount'], rules['penaltyAmount'], rules['graceDays']
cents = lambda value: round(value * 100)
def cycle_date(offset):
    start = date.fromisoformat(rules['startDate'])
    if rules['frequency'] == 'weekly': return start + timedelta(days=7 * offset)
    month = start.month - 1 + offset; year = start.year + month // 12; month = month % 12 + 1
    last = (date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1)).day
    return date(year, month, min(start.day, last))
iso = lambda value: value.isoformat()

# ---- 3. Members ----
rnd = random.Random(2026)
first = ['Tendai', 'Rudo', 'Farai', 'Chipo', 'Tatenda', 'Nyasha', 'Kudzai', 'Tapiwa', 'Rumbidzai', 'Blessing',
         'Simba', 'Memory', 'Tafadzwa', 'Loveness', 'Takudzwa', 'Precious', 'Munashe', 'Shamiso', 'Brighton', 'Netsai']
last = ['Moyo', 'Ncube', 'Dube', 'Sibanda', 'Chikwanha', 'Mutasa', 'Zhou', 'Banda', 'Phiri', 'Marufu']
rnd.shuffle(first)
members = {}
audit = {}
def log(time, user, action, details):
    entry_id = f'demo-log-{len(audit) + 1:04d}'
    audit[entry_id] = {'id': entry_id, 'time': time.strftime('%Y-%m-%dT%H:%M:%SZ'), 'userId': user, 'action': action, 'details': details[:2000]}
    return entry_id
def at(day, hour=9, minute=0): return datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc)
first_due = cycle_date(0)
for index, name in enumerate(first):
    mid = f'member-{index + 1:02d}'
    full = f'{name} {last[index % len(last)]}' if index < 10 else f'{name} {last[(index * 3) % len(last)]}'
    joined = first_due - timedelta(days=rnd.choice([4, 10, 30, 60, 120, 200]))
    members[mid] = {'id': mid, 'fullName': full, 'phone': f'+26377{rnd.randint(1000000, 9999999)}', 'joinDate': iso(joined), 'status': 'active', 'notes': ''}
    log(at(joined), admin, 'member.created', full)
ids = sorted(members)
log(at(first_due - timedelta(days=3)), admin, 'rules.updated', 'Club contribution rules saved.')

# ---- 4. Rotation: one cycle per member, in random order ----
order = ids[:]; rnd.shuffle(order)
n = len(order)
rotation_log = log(at(first_due - timedelta(days=2)), admin, 'rotation.created', 'Created a random rotation.')
elapsed = sum(1 for k in range(n) if cycle_date(k) <= today)       # cycles whose due date has arrived
open_index = elapsed - 1 if 0 < elapsed <= n else (0 if elapsed == 0 else None)   # None: the whole round is finished
participants = '|' + '|'.join(ids) + '|'
cycles, member_cycles, round_recipients, locks, payments, reversals, payouts, approvals = {}, {}, {}, {}, {}, {}, {}, {}
def status_of(k):
    if open_index is None or k < open_index: return 'closed'
    return 'open' if k == open_index else 'scheduled'
for k, recipient in enumerate(order):
    cid = f'r1-c{k + 1}'
    cycles[cid] = {'id': cid, 'number': k + 1, 'round': 1, 'roundKey': 'r1', 'dueDate': iso(cycle_date(k)), 'recipientMemberId': recipient,
                   'status': status_of(k), 'memberIds': {m: True for m in ids}, 'participantIds': participants, 'amount': amount,
                   'amountCents': cents(amount), 'memberCount': n, 'expectedPoolCents': cents(amount) * n,
                   'penaltyAmount': penalty, 'graceDays': grace, 'auditId': rotation_log}
    round_recipients[recipient] = cid
    for m in ids:
        member_cycles.setdefault(m, {})[cid] = {'id': cid, 'cycleId': cid, 'number': k + 1, 'round': 1, 'dueDate': iso(cycle_date(k)), 'amount': amount,
                                                'penaltyAmount': penalty, 'graceDays': grace, 'status': cycles[cid]['status'], 'isRecipient': m == recipient}
rounds = {'r1': {'id': 'r1', 'number': 1, 'firstCycleId': 'r1-c1', 'memberCount': n, 'mode': 'random', 'createdAt': at(first_due - timedelta(days=2)).strftime('%Y-%m-%dT%H:%M:%SZ'), 'auditId': rotation_log}}

# ---- 5. Contributions, payouts and closing ----
methods = ['cash', 'cash', 'ecocash', 'ecocash', 'bank']
def add_payment(cid, mid, value, when, note=''):
    method = rnd.choice(methods)
    pid = f'demo-pay-{len(payments) + 1:04d}'
    event = log(at(when, 10, len(payments) % 50), treasurer, 'payment.recorded', f'Recorded {value:.2f} for member {mid}, cycle {cycles[cid]["number"]}.')
    payments[pid] = {'id': pid, 'cycleId': cid, 'memberId': mid, 'amount': value, 'amountCents': cents(value), 'method': method,
                     'reference': note or (f'EC{rnd.randint(10000000, 99999999)}' if method == 'ecocash' else f'RCT-{len(payments) + 1:04d}' if method == 'bank' else ''),
                     'date': iso(when), 'recordedBy': treasurer, 'auditId': event}
    locks.setdefault(cid, {})['hasPayments'] = True
    return pid
def clamp(when, member):
    return max(min(when, today), date.fromisoformat(members[member]['joinDate']))
unpaid_cycles = {2: 1, 5: 2} if n > 5 else {}          # cycle number -> how many members pay nothing or only half
reversal_cycle = 2
for k in range(n):
    cid = f'r1-c{k + 1}'; state = status_of(k)
    if state == 'scheduled': continue
    due = cycle_date(k); deadline = due + timedelta(days=grace)
    skip = set(rnd.sample(ids, unpaid_cycles.get(k + 1, 0))) if state == 'closed' else set()
    for index, mid in enumerate(ids):
        roll = rnd.random()
        if state == 'open':
            if roll < 0.60: add_payment(cid, mid, amount, clamp(due - timedelta(days=rnd.randint(0, 3)), mid))
            elif roll < 0.75: add_payment(cid, mid, amount / 2, clamp(due - timedelta(days=rnd.randint(0, 2)), mid))
            continue
        if mid in skip:
            if index % 2 == 0: add_payment(cid, mid, amount / 2, clamp(due, mid))      # paid half, never the rest
            continue
        if k + 1 == reversal_cycle and index == 0:
            wrong = add_payment(cid, mid, amount + 5, clamp(due - timedelta(days=1), mid), 'Typed the wrong amount')
            rev_when = clamp(due, mid); rid = f'demo-pay-{len(payments) + 1:04d}'
            event = log(at(rev_when, 11), treasurer, 'payment.reversed', f'Reversed payment {wrong}: Typed the wrong amount')
            payments[rid] = {'id': rid, 'cycleId': cid, 'memberId': mid, 'amount': -(amount + 5), 'amountCents': -cents(amount + 5), 'method': payments[wrong]['method'],
                             'reference': 'Typed the wrong amount', 'date': iso(rev_when), 'recordedBy': treasurer, 'reversesPaymentId': wrong, 'auditId': event}
            reversals[wrong] = rid
            add_payment(cid, mid, amount, clamp(due, mid)); continue
        if roll < 0.80: add_payment(cid, mid, amount, clamp(due - timedelta(days=rnd.randint(0, 2)), mid))
        elif roll < 0.90:
            add_payment(cid, mid, amount / 2, clamp(due - timedelta(days=rnd.randint(0, 2)), mid)); add_payment(cid, mid, amount / 2, clamp(due + timedelta(days=rnd.randint(0, grace)), mid))
        elif roll < 0.97:
            late = clamp(deadline + timedelta(days=rnd.randint(1, 10)), mid); add_payment(cid, mid, amount, late); add_payment(cid, mid, penalty, late, 'Late penalty')
        else: add_payment(cid, mid, amount + penalty, clamp(deadline + timedelta(days=rnd.randint(1, 6)), mid))
    if state != 'closed': continue
    collected = sum(p['amountCents'] for p in payments.values() if p['cycleId'] == cid)
    paid_day = min(today, max(date.fromisoformat(p['date']) for p in payments.values() if p['cycleId'] == cid) + timedelta(days=1))
    recipient = order[k]
    payout_log = log(at(paid_day, 14), treasurer, 'payout.recorded', f'Recorded payout of {collected / 100:.2f} to member {recipient} for cycle {k + 1}.')
    confirm_log = log(at(paid_day, 16), treasurer, 'payout.confirmed', f'Confirmed payout for cycle {cid} (treasurer).')
    payouts[cid] = {'id': cid, 'cycleId': cid, 'memberId': recipient, 'amount': collected / 100, 'amountCents': collected, 'date': iso(paid_day), 'confirmed': True,
                    'recordedBy': treasurer, 'auditId': payout_log, 'confirmedBy': treasurer, 'confirmedAt': at(paid_day, 16).strftime('%Y-%m-%dT%H:%M:%SZ'), 'confirmAuditId': confirm_log}
    locks.setdefault(cid, {})['hasPayout'] = True
    note = ''
    if skip:
        approve_log = log(at(paid_day, 12), admin, 'cycle.closing-approved', f'Approved closing cycle {k + 1} with unpaid members: Members will pay at the next meeting')
        approvals[cid] = {'cycleId': cid, 'approvedBy': admin, 'time': at(paid_day, 12).strftime('%Y-%m-%dT%H:%M:%SZ'), 'reason': 'Members will pay at the next meeting', 'auditId': approve_log}
        note = f' with {len(skip)} unpaid (chairperson approved)'
    log(at(paid_day, 17), treasurer, 'cycle.closed', f'Closed cycle {k + 1}{note}; opened cycle {k + 2}.' if k + 1 < n else f'Closed cycle {k + 1}{note}; round complete.')

# ---- 6. Reminders ----
meeting = today + timedelta(days=2)
reminders = {'demo-meeting-1': {'id': 'demo-meeting-1', 'type': 'meeting', 'message': 'Monthly meeting at the church hall, 2pm. Bring your contribution.',
                                'date': iso(meeting), 'sent': False, 'createdBy': admin}}

# ---- 7. Write everything in one request ----
data = {'rules': {'club': rules}, 'members': members, 'rounds': rounds, 'cycles': cycles, 'roundRecipients': {'r1': round_recipients},
        'memberCycles': member_cycles, 'cycleLocks': locks, 'payments': payments, 'paymentReversals': reversals, 'payouts': payouts,
        'cycleApprovals': approvals, 'reminders': reminders, 'auditLog': audit,
        'demoSeed': {'createdAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}}
# Re-link member accounts to the demo members so those people can still sign in and see their own records.
relinked = 0
for uid, row in sorted(users.items()):
    if row.get('memberId') and relinked < len(ids):
        data[f'users/{uid}/memberId'] = ids[relinked]; relinked += 1
# Tables with nothing to add are cleared (None) so no old records are left behind.
patch = {t: data.get(t) for t in TABLES}
patch.update({key: value for key, value in data.items() if key not in TABLES})   # includes the member-link paths
call('mukando', 'PATCH', patch)
net = sum(p['amountCents'] for p in payments.values()) / 100
print(f"SUCCESS: {len(members)} members, {len(cycles)} cycles ({sum(1 for c in cycles.values() if c['status'] == 'closed')} closed), "
      f"{len(payments)} payment entries (net ${net:,.2f}), {len(payouts)} payouts, {len(audit)} audit entries.")
if relinked: print(f'{relinked} member account(s) were re-linked to demo members.')
print('Sign in and open Dashboard, Payments, Payouts and Reports. Run REMOVE-DEMO-DATA.sh to clear it again.')
PYTHON
