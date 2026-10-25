import json, os, urllib.request, urllib.error, socket
x=json.loads(os.environ['SKILL_INPUT'])
operation='purchase'
key=operation+'-'+x['execution_id']
payload=dict(x['arguments'],idempotencyKey=key)
url=x['configuration']['connections']['wealth']+'/api/wealth/'+('transfers' if operation=='transfer' else 'purchases')
request=urllib.request.Request(url,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'},method='POST')
try:
 with urllib.request.urlopen(request,timeout=1) as r: result=json.load(r)
 data={'status':'completed','idempotencyKey':key,'orderId':result['orderId']}
except urllib.error.HTTPError as e:
 data={'status':'failed','idempotencyKey':key,'orderId':'','error':json.load(e).get('error','BUSINESS_ERROR')}
except (TimeoutError,socket.timeout,urllib.error.URLError):
 data={'status':'unknown','idempotencyKey':key,'orderId':''}
print(json.dumps({'success':True,'data':data,'model_data':data},ensure_ascii=False))
