import json, os, urllib.request, urllib.parse, urllib.error
x=json.loads(os.environ['SKILL_INPUT']); key=x['arguments']['idempotencyKey']; cfg=x['configuration']['connections']
if key.startswith('redeem-'):
 url=cfg['idou']+'/api/redemptions/by-key/'+urllib.parse.quote(key,safe='')
else:
 if not key.startswith(('transfer-','purchase-')): raise ValueError('UNSUPPORTED_RECEIPT_KEY')
 url=cfg['wealth']+'/api/wealth/receipts/'+urllib.parse.quote(key,safe='')
try:
 with urllib.request.urlopen(url,timeout=2) as r: data=json.load(r)
 if 'order' in data: data={'status':'completed','idempotencyKey':key,'orderId':data['order']['id']}
 else: data={k:data[k] for k in ['status','idempotencyKey','orderId']}
except urllib.error.HTTPError as e:
 if e.code!=404: raise
 data={'status':'unknown','idempotencyKey':key,'orderId':''}
print(json.dumps({'success':True,'data':data,'model_data':data},ensure_ascii=False))
