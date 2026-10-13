"""Exercise Phase 3/4 permissions in a local emulator; never uses the live project."""
import base64
import json
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

BASE = 'http://127.0.0.1:9019'
NS = 'demo-mukando-phase4'
def token(uid):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
    claims = {'sub':uid,'user_id':uid,'aud':NS,'iss':f'https://securetoken.google.com/{NS}',
              'iat':int(time.time()),'exp':int(time.time())+3600,'firebase':{'sign_in_provider':'password'}}
    return encode({'alg':'none','typ':'JWT'})+'.'+encode(claims)+'.'
def call(path, method='GET', data=None, uid='owner', query=None):
    headers={'Content-Type':'application/json'}
    params={'ns':NS}
    if uid=='owner':headers['Authorization']='Bearer owner'
    else:params['auth']=token(uid)
    if query:params.update({key:json.dumps(value) for key,value in query.items()})
    request=Request(f'{BASE}/{path}.json?{urlencode(params)}',json.dumps(data).encode() if data is not None else None,headers,method=method)
    try:
        with urlopen(request,timeout=10) as response:return response.status,json.load(response)
    except HTTPError as error:return error.code,error.read().decode()
def succeeds(path, method='GET', data=None, uid='owner', query=None):
    status,result=call(path,method,data,uid,query)
    assert status==200,(path,status,result)
    return result
def denied(path, method='GET', data=None, uid='owner', query=None):
    status,result=call(path,method,data,uid,query)
    assert status in (401,403),(path,status,result)
def audit(id, actor, action):
    return {'id':id,'time':'2026-10-07T10:00:00Z','userId':actor,'action':action,'details':'Test event'}

succeeds('.settings/rules','PUT',json.loads(Path('database.rules.json').read_text()))
users={uid:{'id':uid,'username':uid,'role':role,'active':True} for uid,role in [('a','admin'),('c','chairperson'),('t','treasurer'),('u1','member'),('u2','member')]}
users['u1']['memberId']='m1';users['u2']['memberId']='m2'
members={id:{'id':id,'fullName':'Name '+id,'phone':'+263771234567','joinDate':'2026-01-01','status':'active','notes':''} for id in ['m1','m2','m3']}
policy={'id':'club','clubName':'Club','amount':20,'frequency':'monthly','startDate':'2026-01-31','penaltyAmount':2,'graceDays':3}
succeeds('','PUT',{'mukando':{'users':users,'members':members,'rules':{'club':policy}}})
updates={'auditLog/rotation':audit('rotation','c','rotation.created'),'rounds/r1':{'id':'r1','number':1,'firstCycleId':'r1-c1','memberCount':3,'mode':'manual','createdAt':'2026-10-07T10:00:00Z','auditId':'rotation'}}
cycles=[]
for index,member in enumerate(members,1):
    cycle={'id':f'r1-c{index}','number':index,'round':1,'roundKey':'r1','dueDate':['2026-01-31','2026-02-28','2026-03-31'][index-1],
           'recipientMemberId':member,'status':'open' if index==1 else 'scheduled','memberIds':{id:True for id in members},'participantIds':'|m1|m2|m3|',
           'amount':20,'amountCents':2000,'memberCount':3,'expectedPoolCents':6000,'penaltyAmount':2,'graceDays':3,'auditId':'rotation'}
    cycles.append(cycle);updates['cycles/'+cycle['id']]=cycle;updates['roundRecipients/r1/'+member]=cycle['id']
    for member_id in members:
        projection={key:cycle[key] for key in ['id','number','round','dueDate','amount','penaltyAmount','graceDays','status']}
        projection.update({'cycleId':cycle['id'],'isRecipient':member_id==member})
        updates[f'memberCycles/{member_id}/{cycle["id"]}']=projection
# Wrong roles cannot generate a round; the manager's atomic request succeeds.
denied('mukando','PATCH',updates,'t');succeeds('mukando','PATCH',updates,'c');denied('mukando','PATCH',updates,'c')
assert len(succeeds('mukando/cycles',uid='t'))==3
denied('mukando/cycles',uid='u1');denied('mukando/members/m2',uid='u1')
assert succeeds('mukando/members/m1',uid='u1')['fullName']=='Name m1'
own=succeeds('mukando/memberCycles/m1',uid='u1');assert len(own)==3
assert all('memberIds' not in row and 'recipientMemberId' not in row for row in own.values())
denied('mukando/memberCycles/m2',uid='u1')
# Snapshot changes and duplicate recipients are rejected even with a fresh audit event.
denied('mukando','PATCH',{'cycles/r1-c1/amount':30,'cycles/r1-c1/auditId':'tamper','auditLog/tamper':audit('tamper','c','rotation.reordered')},'c')
denied('mukando','PATCH',{'cycles/r1-c1/recipientMemberId':'m3','cycles/r1-c1/auditId':'duplicate','roundRecipients/r1/m3':'r1-c1','auditLog/duplicate':audit('duplicate','c','rotation.reordered')},'c')
# Swap the first two recipients; projections and the audit save together.
reorder={'auditLog/reorder':audit('reorder','c','rotation.reordered'),'roundRecipients/r1/m1':'r1-c2','roundRecipients/r1/m2':'r1-c1'}
for cycle,recipient in [('r1-c1','m2'),('r1-c2','m1')]:
    reorder[f'cycles/{cycle}/recipientMemberId']=recipient;reorder[f'cycles/{cycle}/auditId']='reorder'
    for member in members:reorder[f'memberCycles/{member}/{cycle}/isRecipient']=member==recipient
succeeds('mukando','PATCH',reorder,'c')
assert succeeds('mukando/memberCycles/m1/r1-c2',uid='u1')['isRecipient'] is True

def payment(id,member,amount,cycle='r1-c1',reverse=None):
    result={'id':id,'cycleId':cycle,'memberId':member,'amount':amount,'amountCents':round(amount*100),'method':'cash','reference':'Test','date':'2026-10-07','recordedBy':'t','auditId':'log-'+id}
    if reverse:result['reversesPaymentId']=reverse
    return result
def payment_update(entry):
    result={f'payments/{entry["id"]}':entry,f'auditLog/{entry["auditId"]}':audit(entry['auditId'],'t','payment.reversed' if entry.get('reversesPaymentId') else 'payment.recorded')}
    if entry.get('reversesPaymentId'):result['paymentReversals/'+entry['reversesPaymentId']]=entry['id']
    else:result['cycleLocks/'+entry['cycleId']+'/hasPayments']=True
    return result
p1=payment('p1','m1',10);p2=payment('p2','m1',10);other=payment('other','m2',20)
denied('mukando','PATCH',payment_update(p1),'a');denied('mukando','PATCH',payment_update(p1),'c')
succeeds('mukando','PATCH',payment_update(p1),'t');succeeds('mukando','PATCH',payment_update(p2),'t');succeeds('mukando','PATCH',payment_update(other),'t')
denied('mukando','PATCH',payment_update(p1),'t')
denied('mukando/payments/p1','PATCH',{'amount':1},'t');denied('mukando/payments/p1','DELETE',uid='a')
denied('mukando','PATCH',payment_update(payment('scheduled','m1',5,'r1-c2')),'t')
denied('mukando','PATCH',payment_update(payment('outsider','stranger',5)),'t')
# Firebase filters member reads at the server, rather than fetching all and hiding rows.
denied('mukando/payments',uid='u1')
denied('mukando/payments',uid='u1',query={'orderBy':'memberId','equalTo':'m2'})
private=succeeds('mukando/payments',uid='u1',query={'orderBy':'memberId','equalTo':'m1'})
assert set(private)=={'p1','p2'}
assert len(succeeds('mukando/payments',uid='a'))==3
# Reversals are exact, append-only and limited to one per original payment.
wrong=payment('wrong','m1',-5,reverse='p1');denied('mukando','PATCH',payment_update(wrong),'t')
rev=payment('rev','m1',-10,reverse='p1');succeeds('mukando','PATCH',payment_update(rev),'t')
denied('mukando','PATCH',payment_update(payment('again','m1',-10,reverse='p1')),'t')
assert succeeds('mukando/payments/p1',uid='t')['amount']==10
assert sum(row['amount'] for row in succeeds('mukando/payments',uid='u1',query={'orderBy':'memberId','equalTo':'m1'}).values())==10
# A paid-out recipient cannot be changed; untouched future recipients can still be reordered.
succeeds('mukando/cycles/r1-c1/status','PUT','closed')
succeeds('mukando/cycleLocks/r1-c1/hasPayout','PUT',True)
denied('mukando','PATCH',{'cycles/r1-c1/recipientMemberId':'m1','cycles/r1-c1/auditId':'closed','auditLog/closed':audit('closed','c','rotation.reordered')},'c')
denied('mukando','PATCH',payment_update(payment('closed-payment','m1',5)),'t')
remaining={'auditLog/after-payout':audit('after-payout','c','rotation.reordered'),'roundRecipients/r1/m1':'r1-c3','roundRecipients/r1/m3':'r1-c2'}
for cycle,recipient in [('r1-c2','m3'),('r1-c3','m1')]:
    remaining[f'cycles/{cycle}/recipientMemberId']=recipient;remaining[f'cycles/{cycle}/auditId']='after-payout'
    for member in members:remaining[f'memberCycles/{member}/{cycle}/isRecipient']=member==recipient
succeeds('mukando','PATCH',remaining,'c')
assert succeeds('mukando/cycles/r1-c1',uid='c')['recipientMemberId']=='m2'
print('PASS: compiled rotation/payment rules, complete atomic rounds, immutable terms, unique recipients, role restrictions, member privacy, exact single reversals, closed-cycle locks and audit records. Emulator only.')
