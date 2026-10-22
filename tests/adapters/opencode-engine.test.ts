import {resolveOpenCodeExecutable} from '../../apps/runner/src/engineering/engine-binary.js';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {expect,it} from 'vitest';
import {OpenCodeEngine} from '../../apps/runner/src/engineering/engine.js';
import {createEngineeringMcp} from '../../apps/runner/src/engineering/mcp.js';
import type {EngineeringWorkspace} from '../../apps/runner/src/engineering/workspace.js';
it('pinned OpenCode starts with authenticated API and distinct role directories, and stops its owned process',async()=>{
 const root=resolve('test-results',`engine-${randomUUID()}`);await mkdir(root,{recursive:true});
 const mcp=createEngineeringMcp({inspect:()=>({})} as unknown as EngineeringWorkspace,{developer:'engine-developer-test-0123456789',tester:'engine-tester-test-0123456789'});
 const base=await mcp.listen({host:'127.0.0.1',port:0});
 const engine=new OpenCodeEngine({root,executable:resolveOpenCodeExecutable(),modelKey:'fixture-no-model-call',mcpBase:base,tokens:{developer:'engine-developer-test-0123456789',tester:'engine-tester-test-0123456789'}});
 try{await engine.start();expect(engine.inspect().version).toBe('1.19.3');
  expect((await fetch(engine.inspect().base+'/global/health')).status).toBe(401);
  const developer=JSON.parse(await readFile(join(root,'developer','opencode.json'),'utf8'));const tester=JSON.parse(await readFile(join(root,'tester','opencode.json'),'utf8'));
  expect(developer.mcp.builder.url).toBe(base+'/mcp/developer');expect(tester.mcp.builder.url).toBe(base+'/mcp/tester');
  expect(developer.permission).toEqual({'*':'deny','builder_*':'allow'});expect(JSON.stringify(developer)).not.toContain('fixture-no-model-call');
  await engine.stop();await expect(fetch(engine.inspect().base+'/global/health')).rejects.toThrow();
 }finally{await engine.stop();await mcp.close();}
},60000);
