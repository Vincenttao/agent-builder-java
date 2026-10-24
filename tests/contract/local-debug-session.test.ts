import {randomUUID} from 'node:crypto';
import {afterEach,expect,it} from 'vitest';
import {createApp} from '../../apps/server/src/app.js';
import {DraftService} from '../../apps/server/src/drafts/application/draft-service.js';
import {MemoryDraftRepository} from '../support/memory-drafts.js';
const apps:ReturnType<typeof createApp>[]=[];
afterEach(async()=>{await Promise.all(apps.splice(0).map(app=>app.close()));});
const origin='http://127.0.0.1:8080';
function setup(localDebugAuth=false){
  let time=Date.now();const now=()=>new Date(time).toISOString();
  const app=createApp({drafts:new DraftService(new MemoryDraftRepository(),{now},{next:randomUUID}),databaseReady:async()=>true,now,bootstrapToken:localDebugAuth?'':'test-bootstrap-01234567890123456789',origin,modelConfigured:false,localDebugAuth});
  apps.push(app);return {app,expire:()=>{time+=9*60*60*1000;}};
}
it('keeps token login required when local debug mode is disabled',async()=>{
  const {app}=setup();expect((await app.inject('/api/auth/session')).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url:'/api/auth/session',headers:{origin},payload:{token:''}})).statusCode).toBe(401);
});
it('opens and renews a debug session without a token while retaining Origin and CSRF checks',async()=>{
  const {app,expire}=setup(true);
  const session=await app.inject('/api/auth/session');expect(session.statusCode).toBe(200);expect(session.json().localDebugAuth).toBe(true);
  const cookie=String(session.headers['set-cookie']).split(';')[0]!;
  expect((await app.inject({url:'/api/drafts',headers:{cookie}})).statusCode).toBe(200);
  const reused=await app.inject({url:'/api/auth/session',headers:{cookie}});expect(reused.json().csrfToken).toBe(session.json().csrfToken);
  expect((await app.inject({method:'DELETE',url:'/api/auth/session',headers:{cookie,origin}})).statusCode).toBe(403);
  const headers={cookie,origin,'x-csrf-token':session.json().csrfToken};
  expect((await app.inject({method:'DELETE',url:'/api/auth/session',headers:{...headers,origin:'https://foreign.example'}})).statusCode).toBe(403);
  expect((await app.inject({method:'DELETE',url:'/api/auth/session',headers})).statusCode).toBe(204);
  expect((await app.inject('/api/auth/session')).statusCode).toBe(200);
  expire();expect((await app.inject({url:'/api/auth/session',headers:{cookie}})).statusCode).toBe(200);
});
