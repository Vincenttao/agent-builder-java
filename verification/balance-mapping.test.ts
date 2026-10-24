import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {createBusinessMock} from '../mock-business/server.js';

const execute=promisify(execFile);
test('actual balance adapter rejects a missing result mapping and succeeds after configuration correction',async t=>{
 const server=createBusinessMock().listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 const address=server.address();assert.ok(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port;
 const run=(balancePath:string)=>execute('/usr/bin/python3',['-I',resolve('examples/idou/skills/benefits/balance.py')],{env:{SKILL_INPUT:JSON.stringify({configuration:{connections:{idou:base},mapping:{balancePath}}})},timeout:5000});
 await assert.rejects(run('data.points.available'),error=>error instanceof Error&&error.message.includes('KeyError'));
 const result=await run('employee.wallet.availablePoints');const value=JSON.parse(result.stdout);assert.equal(value.success,true);assert.equal(value.data.available,1280);assert.equal(value.model_data.available,1280);
 const state=await(await fetch(base+'/__mock/state')).json() as any;assert.equal(state.writes,0);
});
