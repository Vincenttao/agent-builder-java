import json, os, urllib.request, urllib.parse
x = json.loads(os.environ['SKILL_INPUT'])
key = x['arguments']['idempotencyKey']
with urllib.request.urlopen(x['configuration']['connections']['idou'] + '/api/redemptions/by-key/' + urllib.parse.quote(key, safe=''), timeout=2) as response:
    order = json.load(response)['order']
data = {'status': 'completed', 'idempotencyKey': key, 'orderId': order['id']}
print(json.dumps({'success': True, 'data': data, 'model_data': data}, ensure_ascii=False))
