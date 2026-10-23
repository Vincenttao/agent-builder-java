import {describe,it,expect} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {DevelopmentService} from './development-service.js';
import {contentDigest} from '../snapshots/domain/assembly.js';
import type {DevelopmentJob,EngineeringTaskInput} from '../../../../packages/contracts/src/development.js';
import type {Snapshot} from '../../../../packages/contracts/src/index.js';
import {equipmentAssembly} from '../../../../packages/contracts/src/equipment-template.js';
import {assemble} from '../snapshots/domain/assembly.js';
import {draftInput} from '../../../../tests/support/fixtures.js';

describe('portable generated project source',()=>{
 it('exports fixed source files and their verified bundle metadata, excluding the binary jar',async()=>{
  const draft={...draftInput,id:randomUUID(),revision:1,createdAt:'',updatedAt:''};
  const snapshotId=randomUUID();const snapshot={id:snapshotId,draftId:draft.id,draftRevision:1,digest:'a'.repeat(64),createdAt:'',content:{draft,assembly:equipmentAssembly(),runtimeSpec:assemble(snapshotId,equipmentAssembly()),executionMode:'trusted-local'}} as Snapshot;
  const content='class GeneratedTool {}';const file={path:'src/generated/EquipmentTool.java',digest:createHash('sha256').update(content).digest('hex'),size:Buffer.byteLength(content)};
  const jar={path:'component.jar',digest:'b'.repeat(64),size:10};const bundleBody={digest:'',artifactDigest:jar.digest,sourceDigest:contentDigest([file]),profileDigest:'c'.repeat(64),sdkArtifactDigest:'d'.repeat(64),snapshotId,baselineId:randomUUID(),baselineDigest:'e'.repeat(64),planDigest:'f'.repeat(64),files:[file,jar],unitRedId:randomUUID(),unitGreenId:randomUUID(),contractCheckId:randomUUID(),buildId:randomUUID()};
  const{digest:_ignored,...withoutDigest}=bundleBody;const bundle={...withoutDigest,digest:contentDigest(withoutDigest)};
  const input={context:{snapshotId,baseline:{id:bundle.baselineId,digest:bundle.baselineDigest}},generation:{profileVersion:'equipment-java@3',scope:['tool'],dependencies:[],connectionProfile:'mock-equipment@1'},maxSeconds:30} as unknown as EngineeringTaskInput;
  const job={id:randomUUID(),agentId:draft.id,snapshotId,baselineId:bundle.baselineId,baselineDigest:bundle.baselineDigest,inputDigest:'1'.repeat(64),status:'built',createdAt:'',updatedAt:'',roles:[],bundle} as unknown as DevelopmentJob;
  const pool={query:async(sql:string)=>sql.includes('SELECT record,task_input')?{rows:[{record:job,task_input:input}]}:{rows:[{record:job}]}};
  const service=new DevelopmentService(pool as never,{get:async()=>snapshot} as never,{} as never,{submit:async()=>{throw new Error('unused');},get:async()=>{throw new Error('unused');},cancel:async()=>({id:job.id,status:'cancelled'}),events:async()=>[],file:async()=>({path:file.path,digest:file.digest,content})});
  const exported=await service.exportProject(draft.id);
  expect(exported).toHaveLength(1);expect(exported[0]).toMatchObject({snapshotDigest:snapshot.digest,bundle:{digest:bundle.digest},files:[{path:file.path,digest:file.digest,content}]});
  expect(exported[0]!.bundle.files.some(item=>item.path==='component.jar')).toBe(true);expect(exported[0]!.files.some(item=>item.path==='component.jar')).toBe(false);
 });
});
