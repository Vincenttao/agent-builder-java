import json, os
x=json.loads(os.environ['SKILL_INPUT'])
data={'summary':json.dumps(x.get('results',{}),ensure_ascii=False)}
print(json.dumps({'success':True,'data':data,'model_data':data},ensure_ascii=False))
