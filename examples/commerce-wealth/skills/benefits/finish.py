import json, os
x = json.loads(os.environ['SKILL_INPUT'])
results = x.get('results', {})
# Only previously verified read results enter the final summary; this operation performs no business I/O.
data = {'summary': json.dumps({k: results[k] for k in ['balance', 'gifts'] if k in results}, ensure_ascii=False)}
print(json.dumps({'success': True, 'data': data, 'model_data': data}, ensure_ascii=False))
