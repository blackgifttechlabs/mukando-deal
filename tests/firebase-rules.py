"""Check Phase 2 rules against a local Realtime Database emulator on port 9019."""
import base64
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

BASE = 'http://127.0.0.1:9019'
NS = 'demo-mukando-phase2'
def token(uid):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
    claims = {'sub': uid, 'user_id': uid, 'aud': NS, 'iss': f'https://securetoken.google.com/{NS}',
              'iat': int(time.time()), 'exp': int(time.time()) + 3600,
              'firebase': {'sign_in_provider': 'password'}}
    return encode({'alg': 'none', 'typ': 'JWT'}) + '.' + encode(claims) + '.'
def call(path, method='GET', data=None, uid='owner'):
    headers = {'Content-Type': 'application/json'}
    if uid == 'owner': headers['Authorization'] = 'Bearer owner'
    url = f'{BASE}/{path}.json?ns={NS}' + ('' if uid == 'owner' else '&auth=' + token(uid))
    request = Request(url, json.dumps(data).encode() if data is not None else None, headers, method=method)
    try:
        with urlopen(request, timeout=10) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, error.read().decode()

rules = json.loads(Path('database.rules.json').read_text())
status, result = call('.settings/rules', 'PUT', rules)
assert status == 200, result
fixture = {'mukando': {'users': {uid: {'id': uid, 'username': uid, 'role': role, 'active': True}
           for uid, role in [('a','admin'), ('c','chairperson'), ('m','member'), ('t','treasurer')]}}}
assert call('', 'PUT', fixture)[0] == 200
member = {'id': 'one', 'fullName': 'Alice', 'phone': '+263771234567', 'joinDate': '2026-10-07', 'status': 'active', 'notes': ''}
assert call('mukando/members/one', 'PUT', member, 'c')[0] == 200
assert call('mukando/members', uid='c')[0] == 200
assert call('mukando/members', uid='t')[0] == 200
for uid in ['m', 't']:
    if uid == 'm': assert call('mukando/members', uid=uid)[0] in (401, 403)
    assert call('mukando/members/one', 'PATCH', {'fullName':'Hacked'}, uid)[0] in (401, 403)
    assert call(f'mukando/users/{uid}', uid=uid)[0] == 200
assert call('mukando/users/a', uid='m')[0] in (401, 403)
assert call('mukando/users/m', 'PATCH', {'role':'admin'}, 'm')[0] in (401, 403)
assert call('mukando/members/one', 'PATCH', {'phone':'bad'}, 'c')[0] in (401, 403)
assert call('mukando/members/one', 'DELETE', uid='c')[0] in (401, 403)
club = {'id':'club', 'clubName':'Club', 'amount':20, 'frequency':'weekly', 'startDate':'2026-10-07', 'penaltyAmount':2, 'graceDays':3}
assert call('mukando/rules/club', 'PUT', club, 'c')[0] == 200
assert call('mukando/rules/club', 'PATCH', {'graceDays':1.5}, 'c')[0] in (401, 403)
log = {'id':'log', 'time':'2026-10-07T10:00:00Z','userId':'c','action':'member.updated','details':'Alice'}
updates = {'members/one/fullName':'Alice Updated', 'auditLog/log':log}
assert call('mukando', 'PATCH', updates, 'c')[0] == 200
assert call('mukando/auditLog/log', 'PATCH', {'details':'Changed'}, 'c')[0] in (401, 403)
assert call('mukando/auditLog/log', 'DELETE', uid='a')[0] in (401, 403)
assert call('mukando/auditLog', uid='c')[0] in (401, 403)
assert call('mukando/auditLog', uid='a')[0] == 200
bad = {'members/one/fullName':'Should not save', 'auditLog/bad':{**log,'id':'bad','userId':'a'}}
assert call('mukando', 'PATCH', bad, 'c')[0] in (401, 403)
assert call('mukando/members/one', uid='c')[1]['fullName'] == 'Alice Updated'
assert call('mukando/cycles/cycle', 'PUT', {'id':'cycle','dueDate':'2026-10-07'})[0] == 200
assert call('mukando/members/one', 'PATCH', {'status':'inactive'}, 'a')[0] in (401, 403)
assert call('mukando/rules/club', 'PATCH', {'amount':30}, 'a')[0] in (401, 403)
assert call('mukando/rules/club', 'PATCH', {'clubName':'New name'}, 'a')[0] == 200
print('PASS: compiled Firebase rules, manager permissions, own-profile isolation, record validation, audit immutability/atomicity, and schedule locks. Emulator only; no live changes.')
