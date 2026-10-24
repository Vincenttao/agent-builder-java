import json, os, urllib.request
x = json.loads(os.environ['SKILL_INPUT'])
c = x['configuration']
with urllib.request.urlopen(c['connections']['idou'] + '/api/employees/demo/balance', timeout=2) as response:
    value = json.load(response)
for key in c['mapping']['balancePath'].split('.'):
    value = value[key]
if isinstance(value, bool) or not isinstance(value, int):
    raise ValueError('BALANCE_MAPPING_INVALID')
data = {'available': value, 'unit': 'i豆'}
print(json.dumps({'success': True, 'data': data, 'model_data': data}, ensure_ascii=False))
