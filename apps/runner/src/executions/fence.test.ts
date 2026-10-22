import{mkdtemp}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{randomUUID}from'node:crypto';
import{expect,it}from'vitest';import{ExecutionFence}from'./fence.js';
it('rejects old or absent worker tokens, persists monotonic ownership, and fences late starts after cancellation across restart',async()=>{
  const root=await mkdtemp(join(tmpdir(),'execution-fence-'));const fence=new ExecutionFence(root);await fence.initialize();const id=randomUUID();let effects=0;
  await fence.claim(id,'1');await fence.command(id,'1','start',async()=>{effects++;});await fence.claim(id,'2');
  await expect(fence.command(id,'1','start',async()=>{effects++;})).rejects.toMatchObject({code:'EXECUTION_CLAIM_LOST'});
  await expect(fence.command(id,undefined,'resume',async()=>{effects++;})).rejects.toMatchObject({code:'EXECUTION_CLAIM_LOST'});
  await fence.command(id,'2','cancel',async()=>{});
  await expect(fence.command(id,'2','start',async()=>{effects++;})).rejects.toMatchObject({code:'EXECUTION_RETIRED'});
  const recovered=new ExecutionFence(root);await recovered.initialize();await expect(recovered.claim(id,'1')).rejects.toMatchObject({code:'EXECUTION_CLAIM_LOST'});
  expect(await recovered.claim(id,'3')).toEqual({token:'3',retired:true});
  await expect(recovered.command(id,'3','resume',async()=>{effects++;})).rejects.toMatchObject({code:'EXECUTION_RETIRED'});expect(effects).toBe(1);
});
it('orders an in-flight command before takeover while a command arriving after takeover cannot run',async()=>{
  const fence=new ExecutionFence(await mkdtemp(join(tmpdir(),'execution-fence-order-')));await fence.initialize();const id=randomUUID();await fence.claim(id,'1');
  let enter!:()=>void;let release!:()=>void;const reached=new Promise<void>(r=>{enter=r;});const held=new Promise<void>(r=>{release=r;});const calls:string[]=[];
  const first=fence.command(id,'1','start',async()=>{enter();await held;calls.push('first');});await reached;
  const takeover=fence.claim(id,'2');const stale=fence.command(id,'1','start',async()=>{calls.push('stale');}).catch(error=>error);
  release();await first;await takeover;expect(await stale).toMatchObject({code:'EXECUTION_CLAIM_LOST'});expect(calls).toEqual(['first']);
});
