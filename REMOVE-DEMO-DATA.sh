# Removes the data created by SEED-DEMO-DATA.sh. Login accounts (/mukando/users) and the club rules are kept.
# This DELETES members, rotation, payments, payouts, reminders and the audit trail, including anything
# you recorded after seeding. To confirm, change the next line to CONFIRM_DELETE=yes, then paste it all into Cloud Shell.
CONFIRM_DELETE=no
export CONFIRM_DELETE
python3 - <<'PYTHON'
import json, os, subprocess
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
    request = Request(f'{DB}/{path}.json' + ('?' + query if query else ''), json.dumps(body).encode() if body is not None else None, headers, method=method)
    try:
        with urlopen(request, timeout=60) as response:
            return json.load(response)
    except HTTPError as error:
        raise SystemExit(f'Error {error.code}: {error.read().decode()[:300]}')
if os.environ.get('CONFIRM_DELETE') != 'yes':
    raise SystemExit('Nothing deleted. Edit the CONFIRM_DELETE line at the top to "yes" and run again.')
if not call('mukando/demoSeed'):
    raise SystemExit('Stopped: no demo-data marker found, so this club was not created by SEED-DEMO-DATA.sh. Nothing deleted.')
tables = ['members', 'rounds', 'cycles', 'roundRecipients', 'memberCycles', 'cycleLocks', 'payments', 'paymentReversals', 'payouts', 'cycleApprovals', 'reminders', 'auditLog', 'demoSeed']
call('mukando', 'PATCH', {table: None for table in tables})
print('SUCCESS: demo data removed. Login accounts and club rules were kept.')
PYTHON
