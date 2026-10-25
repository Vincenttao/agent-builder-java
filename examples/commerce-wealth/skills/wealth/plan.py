import json, os, urllib.request, urllib.parse
x=json.loads(os.environ['SKILL_INPUT'])
url=x['configuration']['connections']['wealth']+'/api/wealth/plan?'+urllib.parse.urlencode(x['arguments'])
with urllib.request.urlopen(url,timeout=2) as r: data=json.load(r)
print(json.dumps({'success':True,'data':data,'model_data':data},ensure_ascii=False))
