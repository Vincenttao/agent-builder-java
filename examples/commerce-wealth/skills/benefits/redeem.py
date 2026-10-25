import json, os, urllib.request, urllib.error, socket
x = json.loads(os.environ['SKILL_INPUT'])
key = 'redeem-' + x['execution_id']
payload = dict(x['arguments'], idempotencyKey=key)
request = urllib.request.Request(x['configuration']['connections']['idou'] + '/api/redemptions', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'}, method='POST')
try:
    with urllib.request.urlopen(request, timeout=1) as response:
        order = json.load(response)['order']
    data = {'status': 'completed', 'idempotencyKey': key, 'orderId': order['id']}
except urllib.error.HTTPError as error:
    data = {'status': 'failed', 'idempotencyKey': key, 'orderId': '', 'error': json.load(error).get('error', 'BUSINESS_ERROR')}
except (TimeoutError, socket.timeout, urllib.error.URLError):
    # A transport failure cannot establish whether the write committed. Never retry here.
    data = {'status': 'unknown', 'idempotencyKey': key, 'orderId': ''}
print(json.dumps({'success': True, 'data': data, 'model_data': data}, ensure_ascii=False))
