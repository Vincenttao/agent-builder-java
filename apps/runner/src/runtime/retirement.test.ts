import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { JavaDeploymentManager } from './deployment-manager.js';
it('durably retires an unseen deployment before a delayed start can create a JVM', async()=>{
  const directory=await mkdtemp(join(tmpdir(),'builder-retire-'));const artifact=join(directory,'fixture.jar');await writeFile(artifact,'fixture-not-executed');
  const options={root:join(directory,'runtime'),artifactPath:artifact,modelKey:'fixture',proxyBase:'http://127.0.0.1:1',proxyToken:'fixture'};
  const id=randomUUID();const spec={agent:{id:'fixture',type:'DeepAgent' as const,systemPrompt:'hello',maxIterations:1,rails:['tool-allowlist']},tools:[]};
  try {
    const runtime=new JavaDeploymentManager(options);await runtime.initialize();
    expect(await runtime.retire(id)).toEqual({status:'stopped'});
    await expect(runtime.start(id,spec,runtime.artifactDigest)).rejects.toMatchObject({code:'DEPLOYMENT_RETIRED'});
    const restored=new JavaDeploymentManager(options);await restored.initialize();
    await expect(restored.start(id,spec,restored.artifactDigest)).rejects.toMatchObject({code:'DEPLOYMENT_RETIRED'});
    expect(await restored.retire(id)).toEqual({status:'stopped'});
  } finally {await rm(directory,{recursive:true,force:true});}
});
