import {randomBytes} from 'node:crypto';
import {EngineeringWorkspace} from './workspace.js';
import {OpenCodeEngine} from './engine.js';
import {createEngineeringMcp} from './mcp.js';
import type {EngineeringTaskInput,EngineeringEvent,EngineeringRole,GeneratedBundle} from '../../../../packages/contracts/src/development.js';
import {PolicyError} from './profile.js';
export interface TaskExecutor {
 run(input:EngineeringTaskInput,onEvent:(event:EngineeringEvent)=>Promise<void>,onRole:(role:EngineeringRole,status:string,sessionId?:string)=>Promise<void>):Promise<GeneratedBundle>;
 cancel():Promise<void>;
}
export class OpenCodeTaskExecutor implements TaskExecutor {
 private workspace:EngineeringWorkspace|undefined;private engine:OpenCodeEngine|undefined;private cancelled=false;
 constructor(private readonly options:{root:string;sdkJar:string;executable:string;modelKey:string}){}
 async run(input:EngineeringTaskInput,onEvent:(event:EngineeringEvent)=>Promise<void>,onRole:(role:EngineeringRole,status:string,sessionId?:string)=>Promise<void>){
  if(this.cancelled)throw new PolicyError('ENGINEERING_CANCELLED');if(!this.options.modelKey)throw new PolicyError('ENGINE_MODEL_NOT_CONFIGURED');
  const workspace=this.workspace=new EngineeringWorkspace(this.options.root,this.options.sdkJar,input.context,onEvent,input.generation);await workspace.initialize();
  const tokens={developer:randomBytes(32).toString('hex'),tester:randomBytes(32).toString('hex')};const mcp=createEngineeringMcp(workspace,tokens);
  try{
   if(this.cancelled)throw new PolicyError('ENGINEERING_CANCELLED');const base=await mcp.listen({host:'127.0.0.1',port:0});
   const engine=this.engine=new OpenCodeEngine({root:this.options.root,executable:this.options.executable,modelKey:this.options.modelKey,mcpBase:base,tokens,maxTaskMs:input.maxSeconds*1000,profile:workspace.profile});
   if(this.cancelled)throw new PolicyError('ENGINEERING_CANCELLED');await engine.start();
   for(const role of ['tester','developer'] as const){
    if(role==='tester'&&input.context.repair){await onRole(role,'reused');await onEvent({sequence:0,occurredAt:new Date().toISOString(),subjectId:'',role,type:'test-plan.reused',data:{planDigest:workspace.inspect().planDigest,parentJobId:input.context.repair.reference.parentJobId}});continue;}
    await onRole(role,'running');
    const result=await engine.runRole(role,role==='tester'?'Read engineering-skill.md and context.json using builder tools. Prepare and save the independent test plan. Preserve every confirmed assertion.':input.context.repair?'Read context.json using builder tools. This is a repair task: follow its repair contract. Reproduce the reported failure with a new regression test against the frozen OLD implementation; preserve prior tests and plan. Observe actual red, repair the implementation, obtain green for all tests and build a new bundle.':'Read engineering-skill.md and context.json using builder tools. Write and run the unit test first against the stub. After observing real red, implement the Tool and Skill, obtain green unit results, and execute build. Deliver actual files and command evidence, not prose.');
    await onRole(role,result.status,result.sessionId);
    if(result.status!=='completed')throw new PolicyError('ENGINE_ROLE_FAILED');
    if(role==='tester'&&!workspace.inspect().planDigest)throw new PolicyError('TEST_PLAN_MISSING');
   }
   const state=workspace.inspect();const bundle=state.bundle;if(!bundle)throw new PolicyError(state.diagnostic??'GENERATED_BUNDLE_MISSING');return bundle;
  }finally{
   const cleanup=await Promise.allSettled([workspace.cancel(),this.engine?.stop(),mcp.close()]);
   if(cleanup.some(result=>result.status==='rejected'))throw new PolicyError('ENGINEERING_STOP_UNCONFIRMED');
  }
 }
 async cancel(){this.cancelled=true;await Promise.all([this.workspace?.cancel(),this.engine?.stop()]);}
}
