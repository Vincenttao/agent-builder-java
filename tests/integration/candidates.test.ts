import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {Pool} from '../../apps/server/src/db/pool.js';
import {migrate} from '../../apps/server/src/db/migrations.js';
import {DraftService} from '../../apps/server/src/drafts/application/draft-service.js';
import {PostgresDraftRepository} from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import {SnapshotService} from '../../apps/server/src/snapshots/application/snapshot-service.js';
import {PostgresSnapshotRepository} from '../../apps/server/src/snapshots/adapters/postgres-snapshots.js';
import {CandidateService} from '../../apps/server/src/candidates/candidate-service.js';
import {equipmentAssembly,wealthBalanceAssembly} from '../../packages/contracts/src/equipment-template.js';
import {draftInput} from '../support/fixtures.js';
import {BaselineService} from '../../apps/server/src/acceptance/application/baseline-service.js';
import {contentDigest} from '../../apps/server/src/snapshots/domain/assembly.js';
import {builtDevelopmentFixture} from '../support/built-development.js';
import {wealthBalanceGenerationRequest,wealthBalanceRuntimeTool} from '../../packages/contracts/src/generation-profile.js';
const schema=`it_candidates_${randomUUID().replaceAll('-','')}`;
const url=process.env.TEST_DATABASE_URL??'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const admin=new Pool({connectionString:url});const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
const clock={now:()=>new Date().toISOString()};const ids={next:randomUUID};
const drafts=new DraftService(new PostgresDraftRepository(pool),clock,ids);
const snapshots=new SnapshotService(drafts,new PostgresSnapshotRepository(pool),clock,ids);
let artifactDigest='a'.repeat(64);
const candidates=new CandidateService(pool,snapshots,{capabilities:async()=>({artifactDigest,modelConfigured:true,executionMode:'trusted-local',bootId:'fixture'})});
beforeAll(async()=>{await admin.query(`CREATE SCHEMA "${schema}"`);await migrate(pool);});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();});
it('registers a fixed assembled candidate from the actual Runner artifact; retries preserve it across draft edits and new builds',async()=>{
  const draft=await drafts.create({...draftInput,brief:{...draftInput.brief,output:{value:'设备报告',source:'user',confirmed:true}}});
  const snapshot=await snapshots.create(draft.id,{expectedRevision:1,assembly:equipmentAssembly()});
  const [first,retry]=await Promise.all([candidates.create(snapshot.id),candidates.create(snapshot.id)]);
  expect(first.id).toBe(retry.id);expect(first).toMatchObject({snapshotId:snapshot.id,snapshotDigest:snapshot.digest,artifactDigest,provenance:'assembled-template'});
  await drafts.update(draft.id,{expectedRevision:1,name:'新的草稿',brief:draft.brief});
  artifactDigest='b'.repeat(64);const rebuilt=await candidates.create(snapshot.id);
  expect(rebuilt.id).not.toBe(first.id);expect(rebuilt.bundleDigest).not.toBe(first.bundleDigest);
  expect(await candidates.get(first.id)).toEqual(first);
  await expect(pool.query("UPDATE candidates SET record=record || '{\"artifactDigest\":\"wrong\"}'::jsonb WHERE id=$1",[first.id])).rejects.toThrow(/immutable/i);
  await expect(pool.query('DELETE FROM candidates WHERE id=$1',[first.id])).rejects.toThrow(/immutable/i);
});
it('does not silently register the template when a generated job is requested but has not built',async()=>{
 const draft=await drafts.create({...draftInput,brief:{...draftInput.brief,output:{value:'报告',source:'user',confirmed:true}}});
 const snapshot=await snapshots.create(draft.id,{expectedRevision:1,assembly:equipmentAssembly()});
 await expect(candidates.create(snapshot.id,randomUUID())).rejects.toMatchObject({code:'CANDIDATE_BUILD_UNAVAILABLE'});
 expect(await candidates.list(draft.id)).toHaveLength(0);
});
it('binds an actual Runner registration to the exact built job and rejects a mismatched composition response',async()=>{
 const draft=await drafts.create({...draftInput,brief:{...draftInput.brief,output:{value:'报告',source:'user',confirmed:true}}});
 const snapshot=await snapshots.create(draft.id,{expectedRevision:1,assembly:equipmentAssembly()});const baselines=new BaselineService(pool,clock,ids);
 const preview=await baselines.preview(draft.id,'equipment-read@1');const baseline=await baselines.confirm(draft.id,{expectedRevision:1,templateId:'equipment-read@1',expectedDigest:preview.digest,confirmed:true});
 const h=await builtDevelopmentFixture(pool,snapshot,baseline,'a'.repeat(64));let wrong=true;let packages=0;let runtimeBase='a'.repeat(64);
 const service=new CandidateService(pool,snapshots,{capabilities:async()=>({artifactDigest:runtimeBase,modelConfigured:true,executionMode:'trusted-local',bootId:'fixture'}),
  packageGenerated:async(id,input)=>{packages++;expect(id).toBe(h.job.id);expect(input).toEqual({bundleDigest:h.bundle.digest,specDigest:contentDigest(snapshot.content.runtimeSpec)});return wrong?{...h.artifact,generated:{...h.artifact.generated,specDigest:'f'.repeat(64)}}:h.artifact;}},baselines);
 await expect(service.create(snapshot.id,h.job.id)).rejects.toMatchObject({code:'CANDIDATE_ARTIFACT_MISMATCH'});expect(await service.list(draft.id)).toHaveLength(0);
 wrong=false;const registered=await service.create(snapshot.id,h.job.id);expect(registered).toMatchObject({provenance:'generated-component',artifactDigest:h.artifact.artifactDigest,generated:{developmentJobId:h.job.id,developmentBundleDigest:h.bundle.digest}});
 expect(await service.create(snapshot.id,h.job.id)).toEqual(registered);expect(packages).toBe(3);
 runtimeBase='b'.repeat(64);await expect(service.create(snapshot.id,h.job.id)).rejects.toMatchObject({code:'CANDIDATE_SDK_CHANGED'});expect(packages).toBe(3);runtimeBase='a'.repeat(64);
 const other=await drafts.create({...draftInput,brief:{...draftInput.brief,output:{value:'报告',source:'user',confirmed:true}}});const otherSnapshot=await snapshots.create(other.id,{expectedRevision:1,assembly:equipmentAssembly()});
 await expect(service.create(otherSnapshot.id,h.job.id)).rejects.toBeDefined();expect(await service.list(other.id)).toHaveLength(0);
});
it('pins a generated Rail into the candidate RuntimeSpec and rejects any other binding',async()=>{
 const goal='设备 Agent 每次运行最多 3 次工具调用';
 const draft=await drafts.create({...draftInput,brief:{...draftInput.brief,goal:{value:goal,source:'user',confirmed:true},output:{value:'设备报告',source:'user',confirmed:true}}});
 const snapshot=await snapshots.create(draft.id,{expectedRevision:1,assembly:equipmentAssembly()});const baselines=new BaselineService(pool,clock,ids);
 const preview=await baselines.preview(draft.id,'equipment-read@1');const baseline=await baselines.confirm(draft.id,{expectedRevision:1,templateId:'equipment-read@1',expectedDigest:preview.digest,confirmed:true});
 const definition={schemaVersion:1 as const,rails:[{templateId:'tool-call-limit@1' as const,parameters:{maximum:3}}]};
 const h=await builtDevelopmentFixture(pool,snapshot,baseline,'a'.repeat(64),goal,definition);let specDigest='';
 const service=new CandidateService(pool,snapshots,{capabilities:async()=>({artifactDigest:'a'.repeat(64),modelConfigured:true,executionMode:'trusted-local',bootId:'fixture'}),
  packageGenerated:async(_id,input)=>{specDigest=input.specDigest;return{...h.artifact,generated:{...h.artifact.generated,specDigest:input.specDigest}};}},baselines);
 const candidate=await service.create(snapshot.id,h.job.id);
 expect(candidate.runtimeSpec?.agent.rails).toContain('tool-call-limit@1:3');expect(candidate.specDigest).toBe(specDigest);
});
it('binds the finance balance Tool, operation and Skill identity into a generated candidate',async()=>{
 const draft=await drafts.create({...draftInput,brief:{...draftInput.brief,goal:{value:'查询模拟账户余额',source:'user',confirmed:true},output:{value:'余额',source:'user',confirmed:true}}});
 const snapshot=await snapshots.create(draft.id,{expectedRevision:1,assembly:wealthBalanceAssembly('查询模拟账户余额')});const baselines=new BaselineService(pool,clock,ids);
 const preview=await baselines.preview(draft.id,'wealth-balance-read@1');const baseline=await baselines.confirm(draft.id,{expectedRevision:1,templateId:'wealth-balance-read@1',expectedDigest:preview.digest,confirmed:true});
 const financeGeneration={...wealthBalanceGenerationRequest,scope:[...wealthBalanceGenerationRequest.scope],dependencies:[...wealthBalanceGenerationRequest.dependencies]};
 const h=await builtDevelopmentFixture(pool,snapshot,baseline,'a'.repeat(64),'Generate balance Tool and Skill',{schemaVersion:1,rails:[]},financeGeneration);
 const service=new CandidateService(pool,snapshots,{capabilities:async()=>({artifactDigest:'a'.repeat(64),modelConfigured:true,executionMode:'trusted-local',bootId:'fixture'}),
  packageGenerated:async(_id,input)=>({...h.artifact,generated:{...h.artifact.generated,specDigest:input.specDigest}})},baselines);
 const candidate=await service.create(snapshot.id,h.job.id);
 expect(candidate.runtimeSpec?.tools).toEqual([wealthBalanceRuntimeTool]);
 const artifact=candidate.generated?.runtimeArtifact;expect(artifact?.kind).toBe('generated-component');
 if(artifact?.kind!=='generated-component')throw new Error('GENERATED_COMPONENT_EXPECTED');
 expect(artifact.generated).toMatchObject({toolName:'get_account_balance',operationId:'getAccountBalance',skillName:'balance-query',skillPath:'skills/balance-query/SKILL.md'});
});
