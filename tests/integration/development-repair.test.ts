import {randomUUID,createHash} from 'node:crypto';
import {beforeAll,afterAll,expect,it} from 'vitest';
import {Pool} from '../../apps/server/src/db/pool.js';
import {migrate} from '../../apps/server/src/db/migrations.js';
import {DraftService} from '../../apps/server/src/drafts/application/draft-service.js';
import {PostgresDraftRepository} from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import {SnapshotService} from '../../apps/server/src/snapshots/application/snapshot-service.js';
import {PostgresSnapshotRepository} from '../../apps/server/src/snapshots/adapters/postgres-snapshots.js';
import {BaselineService} from '../../apps/server/src/acceptance/application/baseline-service.js';
import {ValidationService} from '../../apps/server/src/acceptance/application/validation-service.js';
import {DevelopmentService,type EngineeringPort} from '../../apps/server/src/development/development-service.js';
import {CandidateService} from '../../apps/server/src/candidates/candidate-service.js';
import {contentDigest} from '../../apps/server/src/snapshots/domain/assembly.js';
import {equipmentAssembly} from '../../packages/contracts/src/equipment-template.js';
import {equipmentGenerationRequest} from '../../packages/contracts/src/generation-profile.js';
import type {DevelopmentJob,EngineeringTaskInput,GeneratedBundle} from '../../packages/contracts/src/development.js';
import type {ValidationReport,ValidationExecution} from '../../packages/contracts/src/validations.js';
import {runtimeModelProfile} from '../../apps/runner/src/runtime/model-profile.js';
import {draftInput} from '../support/fixtures.js';
import {generatedTool,generatedUnit,generatedSkill} from '../support/generated-equipment.js';
const schema=`it_repair_${randomUUID().replaceAll('-','')}`,url=process.env.TEST_DATABASE_URL??'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const admin=new Pool({connectionString:url}),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
const clock={now:()=>new Date().toISOString()},ids={next:randomUUID},hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const drafts=new DraftService(new PostgresDraftRepository(pool),clock,ids),snapshots=new SnapshotService(drafts,new PostgresSnapshotRepository(pool),clock,ids),baselines=new BaselineService(pool,clock,ids);
beforeAll(async()=>{await admin.query(`CREATE SCHEMA "${schema}"`);await migrate(pool);});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();});
async function setup(){
 const draft=await drafts.create({...draftInput,brief:{...draftInput.brief,output:{value:'设备报告',source:'user',confirmed:true}}});
 const snapshot=await snapshots.create(draft.id,{expectedRevision:1,assembly:equipmentAssembly()});const preview=await baselines.preview(draft.id,'equipment-read@1');
 const baseline=await baselines.confirm(draft.id,{expectedRevision:1,templateId:'equipment-read@1',expectedDigest:preview.digest,confirmed:true});
 const plan=JSON.stringify({baselineDigest:baseline.digest,cases:baseline.content.cases.map(c=>({caseId:c.id,requirementIds:c.requirementIds,assertions:c.assertions,steps:['Invoke candidate','Check external state']}))});
 const files=[{path:'src/generated/EquipmentTool.java',content:generatedTool},{path:'test/generated/EquipmentToolTest.java',content:generatedUnit},{path:'skills/equipment-query/SKILL.md',content:generatedSkill},{path:'test-plan.json',content:plan}].map(f=>({...f,digest:hash(f.content)}));
 const body={artifactDigest:'c'.repeat(64),sourceDigest:contentDigest(files),profileDigest:'e'.repeat(64),sdkArtifactDigest:'a'.repeat(64),snapshotId:snapshot.id,baselineId:baseline.id,baselineDigest:baseline.digest,planDigest:hash(plan),files:files.map(f=>({path:f.path,digest:f.digest,size:Buffer.byteLength(f.content)})),unitRedId:randomUUID(),unitGreenId:randomUUID(),contractCheckId:randomUUID(),buildId:randomUUID()};
 const bundle:GeneratedBundle={...body,digest:contentDigest(body)};const generation={...equipmentGenerationRequest,scope:[...equipmentGenerationRequest.scope],dependencies:[...equipmentGenerationRequest.dependencies]};
 const task:EngineeringTaskInput={context:{snapshotId:snapshot.id,baseline,goal:draft.brief.goal.value},generation,maxSeconds:30};const now=clock.now();
 const parent:DevelopmentJob={id:randomUUID(),agentId:draft.id,snapshotId:snapshot.id,baselineId:baseline.id,baselineDigest:baseline.digest,inputDigest:contentDigest(task),status:'built',createdAt:now,updatedAt:now,roles:[],bundle};
 await pool.query('INSERT INTO development_jobs(id,draft_id,snapshot_id,baseline_id,client_request_id,input_digest,task_input,record) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[parent.id,draft.id,snapshot.id,baseline.id,randomUUID(),parent.inputDigest,task,parent]);
 const artifact={kind:'generated-component',artifactDigest:'9'.repeat(64),sdkArtifactDigest:'a'.repeat(64),generated:{kind:'equipment-tool-skill@1',developmentBundleDigest:bundle.digest,sdkArtifactDigest:'a'.repeat(64),snapshotId:snapshot.id,specDigest:contentDigest(snapshot.content.runtimeSpec),componentDigest:bundle.artifactDigest,skillDigest:files[2]!.digest,classes:{'generated/EquipmentTool.class':'2'.repeat(64)}}};
 const candidates=new CandidateService(pool,snapshots,{capabilities:async()=>({executionMode:'trusted-local',artifactDigest:'a'.repeat(64)}),packageGenerated:async()=>artifact} as never,baselines);
 const candidate=await candidates.create(snapshot.id,parent.id),reference=await candidates.validationReference(candidate.id);
 const validations=new ValidationService(pool,baselines,snapshots,{} as never,clock,candidates);
 async function report(verdict:ValidationReport['verdict']='failed'){
  const executionId=randomUUID();const binding={baselineDigest:baseline.digest,snapshotDigest:snapshot.digest,artifactDigest:candidate.artifactDigest,testSetDigest:contentDigest(baseline.content.cases),compatibilityKey:'b'.repeat(64),modelProfile:runtimeModelProfile('http://127.0.0.1:1/v1'),mockDigest:'c'.repeat(64),candidate:reference};
  const cases=baseline.content.cases.map((c,i)=>({caseId:c.id,status:i===0?verdict:'passed' as const,assertions:c.assertions.map((a,j)=>({...a,status:i===0&&j===0?verdict:'passed' as const,actual:i===0&&j===0?'wrong':a.expected})),reasons:[],evidenceId:randomUUID(),evidenceDigest:''}));
  const record:ValidationExecution={id:executionId,snapshotId:snapshot.id,baselineId:baseline.id,clientRequestId:randomUUID(),inputDigest:'f'.repeat(64),allowMockWrites:false,binding,status:'completed',verdict,cases:cases.map(c=>({caseId:c.caseId,runId:randomUUID(),state:'completed'})),results:[],createdAt:now,updatedAt:now};
  await pool.query('INSERT INTO validation_executions(id,snapshot_id,baseline_id,client_request_id,record) VALUES($1,$2,$3,$4,$5)',[executionId,snapshot.id,baseline.id,record.clientRequestId,record]);
  for(const c of cases){const content={run:{id:record.cases.find(p=>p.caseId===c.caseId)!.runId,status:'succeeded'},calls:[],events:[],actions:[],attempts:[],businessState:{},complete:true};c.evidenceDigest=contentDigest(content);await pool.query('INSERT INTO validation_evidence(id,execution_id,case_id,digest,content) VALUES($1,$2,$3,$4,$5)',[c.evidenceId,executionId,c.caseId,c.evidenceDigest,content]);}
  const report:ValidationReport={executionId,snapshotId:snapshot.id,baselineId:baseline.id,binding,verdict,cases,reasons:[],createdAt:now};await pool.query('INSERT INTO validation_reports(execution_id,digest,record) VALUES($1,$2,$3)',[executionId,contentDigest(report),report]);return report;
 }
 let reads=0;let corrupt=false;const port:EngineeringPort={submit:async()=>{throw new Error('fixture not executed');},get:async()=>{throw new Error('fixture not executed');},cancel:async id=>({id,status:'cancelled'}),events:async()=>[],file:async(_id,path)=>{reads++;const f=files.find(f=>f.path===path)!;return{...f,content:f.content+(corrupt?'tamper':'')};}};
 const service=new DevelopmentService(pool,snapshots,baselines,port,{validations,candidates});
 const failed=await report();const input={clientRequestId:randomUUID(),baselineId:baseline.id,generation,maxSeconds:30,repairExecutionId:failed.executionId};
 return{snapshot,baseline,parent,candidate,failed,report,service,input,reads:()=>reads,corrupt:()=>{corrupt=true;}};
}
it('freezes verified failed evidence and old files, deduplicates retries, and prevents baseline or report substitution',async()=>{
 const h=await setup();const [a,b]=await Promise.all([h.service.start(h.snapshot.id,h.input),h.service.start(h.snapshot.id,h.input)]);expect(a.id).toBe(b.id);
 expect(a.repair).toMatchObject({parentJobId:h.parent.id,rootJobId:h.parent.id,executionId:h.failed.executionId,reportDigest:contentDigest(h.failed),candidateId:h.candidate.id,attempt:1,maxAttempts:3});
 const saved=(await pool.query<{task_input:EngineeringTaskInput}>('SELECT task_input FROM development_jobs WHERE id=$1',[a.id])).rows[0]!.task_input;
 expect(saved.context.repair?.files.find(f=>f.path==='src/generated/EquipmentTool.java')?.content).toBe(generatedTool);expect(saved.context.repair?.failures[0]).toMatchObject({caseId:'TC-001',actual:'wrong'});
 expect(saved.context.repair?.bundle.planDigest).toBe(h.parent.bundle!.planDigest);
 const reads=h.reads();h.corrupt();expect((await h.service.start(h.snapshot.id,h.input)).id).toBe(a.id);expect(h.reads()).toBe(reads);
 await expect(h.service.start(h.snapshot.id,{...h.input,repairExecutionId:randomUUID()})).rejects.toMatchObject({code:'DEVELOPMENT_INPUT_CONFLICT'});
 await expect(pool.query("UPDATE development_jobs SET task_input=jsonb_set(task_input,'{context,repair,failures}','[]') WHERE id=$1",[a.id])).rejects.toThrow(/immutable/i);
 expect(await new ValidationService(pool,baselines,snapshots,{} as never,clock).report(h.failed.executionId)).toEqual(h.failed);
});
it('rejects passed, blocked and unverified reports, cross-target reports, missing repair support and altered source bytes',async()=>{
 const h=await setup();for(const verdict of ['passed','blocked','unverified'] as const){const report=await h.report(verdict);await expect(h.service.start(h.snapshot.id,{...h.input,clientRequestId:randomUUID(),repairExecutionId:report.executionId})).rejects.toMatchObject({code:'REPAIR_NOT_IMPLEMENTATION_FAILURE'});}
 const other=await setup();await expect(h.service.start(other.snapshot.id,{...h.input,baselineId:other.baseline.id})).rejects.toMatchObject({code:'REPAIR_TARGET_MISMATCH'});
 await expect(new DevelopmentService(pool,snapshots,baselines,{} as never).start(h.snapshot.id,h.input)).rejects.toMatchObject({code:'REPAIR_UNAVAILABLE'});
 h.corrupt();await expect(h.service.start(h.snapshot.id,h.input)).rejects.toMatchObject({code:'REPAIR_SOURCE_MISMATCH'});
});
it('counts cancelled attempts against a shared three-attempt budget and serializes concurrent repair starts',async()=>{
 const h=await setup();const inputs=[h.input,{...h.input,clientRequestId:randomUUID()}];const result=await Promise.allSettled(inputs.map(input=>h.service.start(h.snapshot.id,input)));
 expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(result.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'REPAIR_ALREADY_ACTIVE'}});
 const first=result.find(r=>r.status==='fulfilled')! as PromiseFulfilledResult<DevelopmentJob>;await h.service.cancel(first.value.id);await h.service.tick();
 for(const attempt of [2,3]){const job=await h.service.start(h.snapshot.id,{...h.input,clientRequestId:randomUUID()});expect(job.repair?.attempt).toBe(attempt);await h.service.cancel(job.id);await h.service.tick();}
 await expect(h.service.start(h.snapshot.id,{...h.input,clientRequestId:randomUUID()})).rejects.toMatchObject({code:'REPAIR_BUDGET_EXCEEDED'});
 expect((await h.service.list(h.snapshot.draftId)).filter(j=>j.repair)).toHaveLength(3);
});
