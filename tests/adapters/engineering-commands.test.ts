import {expect,it} from 'vitest';
import {resolve,join} from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {EngineeringCommands} from '../../apps/runner/src/engineering/commands.js';
import type {CommandResult} from '../../packages/contracts/src/development.js';
it('records real exit codes, excludes service credentials, and confirms owned process cancellation and time limits',async()=>{
 const root=resolve('test-results',`engineering-commands-${randomUUID()}`);await mkdir(root,{recursive:true});const results:CommandResult[]=[];
 const commands=new EngineeringCommands(async result=>{results.push(result);});const original=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='fixture-model-secret-must-not-inherit';
 try{
  const isolated=await commands.run('environment-check',process.execPath,['-e',"if(process.env.DEEPSEEK_API_KEY||process.env.RUNNER_CONTROL_TOKEN||process.env.DATABASE_URL)process.exit(8);console.log('SERVICE_CREDENTIALS_ABSENT');"],root);
  expect(isolated).toMatchObject({exitCode:0,status:'passed',output:'SERVICE_CREDENTIALS_ABSENT\n'});
  const marker=join(root,'started');const running=commands.run('held-command',process.execPath,['-e',"require('node:fs').writeFileSync('started','started');setInterval(()=>{},1000)"],root);
  await expect.poll(()=>readFile(marker,'utf8').catch(()=>''),{timeout:10000}).toBe('started');await commands.cancel();expect((await running).status).toBe('cancelled');expect(results).toHaveLength(2);
  const limited=new EngineeringCommands(async()=>{},{timeoutMs:500,maxOutputBytes:1024});const timed=await limited.run('timed-command',process.execPath,['-e','setInterval(()=>{},1000)'],root);expect(timed.status).toBe('timed_out');expect(Date.parse(timed.finishedAt)-Date.parse(timed.startedAt)).toBeLessThan(10000);
 }finally{if(original===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=original;await commands.cancel();}
});
