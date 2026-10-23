import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {EngineeringTaskManager} from './task-manager.js';
import {generationProfile} from './profile.js';
import {generationProfileFor} from './profile.js';
import {PolicyError} from './profile.js';
import {wealthBalanceGenerationRequest} from '../../../../packages/contracts/src/generation-profile.js';
import {canonicalJson} from '../../../../packages/contracts/src/canonical.js';
import {createHash} from 'node:crypto';
import type {EngineeringTaskInput,GeneratedBundle} from '../../../../packages/contracts/src/development.js';
const input={context:{snapshotId:randomUUID(),goal:'equipment',runtimeSpec:{agent:{id:'a',type:'DeepAgent',systemPrompt:'test',maxIterations:1,rails:[]},tools:[]},baseline:{id:randomUUID(),digest:'b'.repeat(64)}},generation:{profileVersion:generationProfile.version,scope:[...generationProfile.scope],dependencies:[...generationProfile.dependencies],connectionProfile:generationProfile.connectionProfile},maxSeconds:30} as unknown as EngineeringTaskInput;
it('deduplicates jobs, preserves cancelled IDs against delayed starts, and waits for actual executor stop before cancelled',async()=>{
 let release!:()=>void;let confirm!:()=>void;let entered!:()=>void;const reached=new Promise<void>(r=>{entered=r;});const done=new Promise<void>(r=>{release=r;});const stopped=new Promise<void>(r=>{confirm=r;});let starts=0;
 const manager=new EngineeringTaskManager(resolve('test-results',`engineering-manager-${randomUUID()}`),()=>({run:async(_input,_events,onRole)=>{starts++;await onRole('tester','running','fixture-session');entered();await done;return{digest:'fixture'} as GeneratedBundle;},cancel:async()=>{await stopped;release();}}));await manager.initialize();
 const id=randomUUID();const first=await manager.submit(id,input);expect(await manager.submit(id,input)).toEqual(first);
 await expect(manager.submit(id,{...input,maxSeconds:25})).rejects.toMatchObject({code:'ENGINEERING_INPUT_CONFLICT'});
 await manager.tick();await reached;const cancelling=manager.cancel(id);expect((await manager.get(id)).status).not.toBe('cancelled');
 confirm();await cancelling;expect((await manager.get(id)).status).toBe('cancelled');expect(starts).toBe(1);await manager.tick();expect(starts).toBe(1);
 expect((await manager.get(id)).roles.find(role=>role.role==='tester')?.status).toBe('cancelled');
 const late=randomUUID();expect((await manager.cancel(late)).status).toBe('cancelled');await expect(manager.submit(late,input)).rejects.toMatchObject({code:'ENGINEERING_TASK_RETIRED'});await manager.close();
});
it('marks all roles skipped when a queued engineering task is cancelled before execution',async()=>{
 let starts=0;const manager=new EngineeringTaskManager(resolve('test-results',`engineering-queued-cancel-${randomUUID()}`),()=>({run:async()=>{starts++;throw new Error('must not start');},cancel:async()=>{}}));await manager.initialize();
 const id=randomUUID();await manager.submit(id,input);expect((await manager.get(id)).roles.map(role=>role.status)).toEqual(['queued','queued']);
 expect(await manager.cancel(id)).toMatchObject({status:'cancelled'});expect((await manager.get(id)).roles.map(role=>role.status)).toEqual(['skipped','skipped']);
 await manager.tick();expect(starts).toBe(0);await manager.close();
});
it('binds finance generation jobs to their selected profile and profile-owned file set',async()=>{
 const root=resolve('test-results',`engineering-finance-profile-${randomUUID()}`);
 const manager=new EngineeringTaskManager(root,()=>({run:async()=>{throw new Error('must not start');},cancel:async()=>{}}));await manager.initialize();
 const financeInput={...input,generation:{...wealthBalanceGenerationRequest,scope:[...wealthBalanceGenerationRequest.scope],dependencies:[...wealthBalanceGenerationRequest.dependencies]}} as EngineeringTaskInput;
 const id=randomUUID();const job=await manager.submit(id,financeInput);
 const expected=createHash('sha256').update(canonicalJson(generationProfileFor(wealthBalanceGenerationRequest.profileVersion))).digest('hex');
 const equipment=createHash('sha256').update(canonicalJson(generationProfile)).digest('hex');
 expect(job.profileDigest).toBe(expected);expect(job.profileDigest).not.toBe(equipment);
 await manager.close();
});
it('retains budget exhaustion when user cancellation overlaps and marks uncertain cleanup for reconciliation',async()=>{
 let release!:()=>void;let confirm!:()=>void;
 const done=new Promise<void>(r=>{release=r;});const stopped=new Promise<void>(r=>{confirm=r;});
 const manager=new EngineeringTaskManager(resolve('test-results',`engineering-manager-${randomUUID()}`),()=>({run:async()=>{await done;throw new Error('cancelled');},cancel:async()=>{await stopped;release();}}));await manager.initialize();
 const id=randomUUID();await manager.submit(id,input);await manager.tick();const budget=manager.cancel(id,true);const user=manager.cancel(id);confirm();await Promise.all([budget,user]);
 expect(await manager.get(id)).toMatchObject({status:'failed',diagnostic:'ENGINEERING_BUDGET_EXCEEDED'});await manager.close();
 const root=resolve('test-results',`engineering-manager-${randomUUID()}`);
 const uncertain=new EngineeringTaskManager(root,()=>({run:async()=>{throw new PolicyError('ENGINEERING_STOP_UNCONFIRMED');},cancel:async()=>{}}));await uncertain.initialize();const pending=randomUUID();await uncertain.submit(pending,input);await uncertain.tick();
 await expect.poll(async()=>(await uncertain.get(pending)).status).toBe('reconciling');await uncertain.close();
 const restored=new EngineeringTaskManager(root,()=>{throw new Error('must not replay');});await restored.initialize();await restored.tick();expect((await restored.get(pending)).status).toBe('reconciling');await restored.close();
});
