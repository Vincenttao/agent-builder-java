import json, os, urllib.request
x = json.loads(os.environ['SKILL_INPUT'])
with urllib.request.urlopen(x['configuration']['connections']['idou'] + '/api/gifts', timeout=2) as response:
    data = json.load(response)
print(json.dumps({'success': True, 'data': data, 'model_data': data}, ensure_ascii=False))
