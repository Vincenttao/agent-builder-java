import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { createApp } from '../../apps/server/src/app.js';
import { DraftService } from '../../apps/server/src/drafts/application/draft-service.js';
import { MemoryDraftRepository } from '../support/memory-drafts.js';
import { InvocationService } from '../../apps/server/src/invocations/invocation-service.js';
import type { DemoIdentity, MessageInput } from '../../packages/contracts/src/invocations.js';
const apps:ReturnType<typeof createApp>[]=[];
afterEach(async()=>{await Promise.all(apps.splice(0).map(app=>app.close()));});
const origin='http://127.0.0.1:8080';const bootstrapToken='agent-api-bootstrap-test-0123456789';
async function setup(){
  let now=Date.now();const agentId=randomUUID();const environmentId=randomUUID();const sent:{identity:DemoIdentity;input:MessageInput}[]=[];
  const invocations={identity:async(id:string,actorId:DemoIdentity['actorId'])=>({agentId:id,actorId,environmentId}),
    send:async(identity:DemoIdentity,input:MessageInput)=>{sent.push({identity,input});return{requestId:randomUUID(),runId:randomUUID(),conversationId:randomUUID(),agentVersion:randomUUID()};},
    get:async(identity:DemoIdentity,id:string)=>({requestId:id,actorId:identity.actorId})} as unknown as InvocationService;
  const app=createApp({drafts:new DraftService(new MemoryDraftRepository(),{now:()=>new Date(now).toISOString()},{next:randomUUID}),databaseReady:async()=>true,now:()=>new Date(now).toISOString(),bootstrapToken,origin,modelConfigured:false,...{invocations}});apps.push(app);
  const login=await app.inject({method:'POST',url:'/api/auth/session',headers:{origin},payload:{token:bootstrapToken}});
  const admin={origin,cookie:login.headers['set-cookie']!.toString().split(';')[0]!,'x-csrf-token':login.json().csrfToken as string};
  return{app,admin,agentId,sent,expire:()=>{now+=9*60*60*1000;}};
}
it('issues an actor-bound demo credential through protected management API; agent-api never accepts admin cookies or actor overrides',async()=>{
  const h=await setup();const payload={agentId:h.agentId,actorId:'U1002'};
  expect((await h.app.inject({method:'POST',url:'/api/demo-sessions',headers:{origin,cookie:h.admin.cookie},payload})).statusCode).toBe(403);
  const grant=await h.app.inject({method:'POST',url:'/api/demo-sessions',headers:h.admin,payload});expect(grant.statusCode).toBe(201);
  const credential=grant.json();expect(credential.actorId).toBe('U1002');expect(credential.token.length).toBeGreaterThanOrEqual(32);
  const url=`/agent-api/agents/${h.agentId}/messages`;const body={clientRequestId:randomUUID(),input:'查询余额'};
  expect((await h.app.inject({method:'POST',url,headers:h.admin,payload:body})).statusCode).toBe(401);
  const headers={authorization:`Bearer ${credential.token}`,origin};
  for(const extra of [{actorId:'U1001'},{deploymentId:randomUUID()},{environmentId:randomUUID()},{agentVersion:randomUUID()}])
    expect((await h.app.inject({method:'POST',url,headers,payload:{...body,...extra}})).statusCode).toBe(400);
  expect(h.sent).toHaveLength(0);
  const result=await h.app.inject({method:'POST',url,headers,payload:body});expect(result.statusCode).toBe(202);
  expect(h.sent).toEqual([{identity:{agentId:h.agentId,environmentId:credential.environmentId,actorId:'U1002'},input:body}]);
  expect(result.headers['cache-control']).toBe('no-store');
  expect((await h.app.inject({method:'POST',url:`/agent-api/agents/${randomUUID()}/messages`,headers,payload:body})).statusCode).toBe(403);
  expect((await h.app.inject({method:'POST',url,headers:{...headers,origin:'https://foreign.example'},payload:body})).statusCode).toBe(403);
  expect((await h.app.inject({method:'GET',url:'/api/drafts',headers})).statusCode).toBe(401);
  h.expire();expect((await h.app.inject({method:'GET',url:`/agent-api/requests/${result.json().requestId}`,headers})).statusCode).toBe(401);
});
