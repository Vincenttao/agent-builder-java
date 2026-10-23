import {afterEach,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createApp} from '../../apps/server/src/app.js';
import {DraftService} from '../../apps/server/src/drafts/application/draft-service.js';
import {MemoryDraftRepository} from '../support/memory-drafts.js';
import {SnapshotService} from '../../apps/server/src/snapshots/application/snapshot-service.js';
import {equipmentAssembly} from '../../packages/contracts/src/equipment-template.js';
import {equipmentBaseline} from '../../apps/server/src/acceptance/application/equipment-baseline.js';
import {contentDigest} from '../../apps/server/src/snapshots/domain/assembly.js';
import {createHash} from 'node:crypto';
import {draftInput} from '../support/fixtures.js';
import type {Snapshot} from '../../packages/contracts/src/index.js';
import {mockScenePackage} from '../../apps/mock-services/src/scene.js';

const apps:ReturnType<typeof createApp>[]=[];afterEach(async()=>Promise.all(apps.splice(0).map(app=>app.close())));
const origin='http://127.0.0.1:8080',token='test-bootstrap-token-32-characters';
async function setup(){
  const drafts=new DraftService(new MemoryDraftRepository(),{now:()=> '2026-10-22T01:00:00Z'},{next:randomUUID});
  const rows:Snapshot[]=[];const snapshots=new SnapshotService(drafts,{create:async row=>{rows.push(row);return row;},get:async id=>rows.find(row=>row.id===id),list:async id=>rows.filter(row=>row.draftId===id)},{now:()=> '2026-10-22T01:00:00Z'},{next:randomUUID});
  const baselines={list:async(draftId:string)=>{const draft=await drafts.get(draftId);const content=equipmentBaseline(draft,'equipment-read@1');return[{id:'33333333-3333-4333-8333-333333333333',draftId,draftRevision:draft.revision,digest:contentDigest(content),confirmedAt:'2026-10-22T01:00:00Z',confirmedBy:'local-operator',content}];}};
  const sourceFiles=['src/generated/EquipmentTool.java','test/generated/EquipmentToolTest.java','skills/equipment-query/SKILL.md','rails/definition.json'].map((path,index)=>{const content=`generated source ${index}`;return{path,digest:createHash('sha256').update(content).digest('hex'),content};});
  const generatedSource=sourceFiles[0]!;const sourceDescriptors=sourceFiles.map(file=>({path:file.path,digest:file.digest,size:Buffer.byteLength(file.content)}));
  const jarDescriptor={path:'component.jar',digest:'f'.repeat(64),size:10};
  const makeJob=async(snapshot:Snapshot)=>{const baseline=(await baselines.list(snapshot.draftId))[0]!;const bundleBody={artifactDigest:jarDescriptor.digest,sourceDigest:contentDigest(sourceDescriptors),profileDigest:'a'.repeat(64),sdkArtifactDigest:'9'.repeat(64),snapshotId:snapshot.id,baselineId:baseline.id,baselineDigest:baseline.digest,planDigest:'8'.repeat(64),files:[...sourceDescriptors,jarDescriptor],unitRedId:'44444444-4444-4444-8444-444444444444',unitGreenId:'55555555-5555-4555-8555-555555555555',contractCheckId:'66666666-6666-4666-8666-666666666666',buildId:'77777777-7777-4777-8777-777777777777'};const bundle={...bundleBody,digest:contentDigest(bundleBody)};return{id:'11111111-1111-4111-8111-111111111111',snapshotId:snapshot.id,snapshotDigest:snapshot.digest,baselineId:baseline.id,baselineDigest:baseline.digest,inputDigest:'d'.repeat(64),status:'built' as const,generation:{profileVersion:'equipment-java@3',scope:['tool','skill','rail'] as ('tool'|'skill'|'rail')[],dependencies:['openjiuwen-core@0.1.17','agent-builder-bridge@0.1.0'],connectionProfile:'mock-equipment@1'},bundle,files:sourceFiles};};
  const development={exportProject:async()=>{const snapshot=rows[0];return snapshot?[await makeJob(snapshot)]:[];}};
  const candidates={list:async()=>{const snapshot=rows[0];if(!snapshot)return[];const job=await makeJob(snapshot);return[{id:'88888888-8888-4888-8888-888888888888',snapshotId:snapshot.id,snapshotDigest:snapshot.digest,specDigest:'2'.repeat(64),artifactDigest:'3'.repeat(64),bundleDigest:'4'.repeat(64),provenance:'generated-component' as const,generated:{developmentJobId:job.id,developmentBundleDigest:job.bundle.digest,baselineId:job.baselineId,baselineDigest:job.baselineDigest,sourceDigest:job.bundle.sourceDigest}}];}};
  const importedPackages=new Map<string,unknown>();const projectPackages={save:async(id:string,value:unknown)=>{importedPackages.set(id,structuredClone(value));},get:async(id:string)=>importedPackages.get(id)};
  const app=createApp({drafts,snapshots,baselines:baselines as never,development:development as never,candidates:candidates as never,projectPackages:projectPackages as never,projectScene:async()=>mockScenePackage,databaseReady:async()=>true,now:()=> '2026-10-22T01:00:00Z',bootstrapToken:token,origin,modelConfigured:false});apps.push(app);
  const login=await app.inject({method:'POST',url:'/api/auth/session',headers:{origin},payload:{token}});const headers={origin,cookie:String(login.headers['set-cookie']).split(';')[0]!, 'x-csrf-token':login.json().csrfToken as string};
  return{app,headers,drafts,snapshots,generatedSource};
}
describe('P0-A project export and import',()=>{
  it('exports only portable project inputs and imports into a new identity with revalidation and rebinding required',async()=>{
    const h=await setup();const input={...draftInput,brief:{...draftInput.brief,output:{...draftInput.brief.output,confirmed:true}}};
    const draft=await h.drafts.create(input);await h.snapshots.create(draft.id,{expectedRevision:1,assembly:equipmentAssembly()});
    const exported=await h.app.inject({method:'GET',url:`/api/drafts/${draft.id}/export`,headers:h.headers});expect(exported.statusCode).toBe(200);
    const archive=exported.json();expect(archive).toMatchObject({
      schemaVersion:1,packageKind:'agent-builder-project',source:{projectId:draft.id},draft:{name:input.name},
      snapshots:[{sourceDigest:expect.any(String),assembly:equipmentAssembly()}],
      baselines:[{templateId:'equipment-read@1',sourceDigest:expect.any(String),content:{
        requirements:expect.arrayContaining([expect.objectContaining({id:'BR-001'})]),
        cases:expect.arrayContaining([expect.objectContaining({id:'TC-001',assertions:expect.any(Array)})])
      }}],
      automation:{jobs:[{status:'built',files:expect.arrayContaining([h.generatedSource]),generation:{scope:['tool','skill','rail']}}],
        candidates:[{artifactDigest:'3'.repeat(64),provenance:'generated-component'}],
        artifactDependencies:[{artifactDigest:'9'.repeat(64),restore:'platform-template'},{artifactDigest:'3'.repeat(64),restore:'rebuild-from-source',sdkArtifactDigest:'9'.repeat(64),sourceJobId:'11111111-1111-4111-8111-111111111111'}]},
      mockScene:{sceneVersion:'enterprise-mock@1',contracts:expect.arrayContaining([expect.objectContaining({operationId:'getAccountBalance',method:'GET'})]),
        seeds:expect.arrayContaining([expect.objectContaining({id:'enterprise-default@1',accounts:expect.arrayContaining([expect.objectContaining({accountId:'A1001',availableBalanceFen:1000000})])})])},
      connectionRequirements:[{action:'rebind'}]
    });
    expect(JSON.stringify(archive)).not.toMatch(/apiKey|secret|password|token/i);
    const restored=await h.app.inject({method:'POST',url:'/api/projects/import',headers:h.headers,payload:archive});expect(restored.statusCode,restored.body).toBe(201);
    expect(restored.json()).toMatchObject({draft:{name:input.name,brief:input.brief},snapshots:[{content:{assembly:equipmentAssembly()}}],baselinesToReview:[{templateId:'equipment-read@1',requiresConfirmation:true,content:{cases:expect.arrayContaining([expect.objectContaining({id:'TC-001',assertions:expect.any(Array)})])}}],connectionsToRebind:['equipment-mock@1'],artifactsToRebuild:[{artifactDigest:'3'.repeat(64),reason:'SOURCE_INCLUDED_BINARY_NOT_PACKAGED'}],mockSceneToRestore:{digest:mockScenePackage.digest}});
    expect(restored.json().draft.id).not.toBe(draft.id);
    const recovery=await h.app.inject({method:'GET',url:`/api/drafts/${restored.json().draft.id}/recovery-package`,headers:h.headers});expect(recovery.statusCode).toBe(200);expect(recovery.json().packageDigest).toBe(archive.packageDigest);expect(recovery.json().automation.jobs[0].files).toContainEqual(h.generatedSource);
  },15000);
  it('rejects a modified package digest and unknown credential fields',async()=>{
    const h=await setup();const draft=await h.drafts.create(draftInput);const archive=(await h.app.inject({method:'GET',url:`/api/drafts/${draft.id}/export`,headers:h.headers})).json();
    expect((await h.app.inject({method:'POST',url:'/api/projects/import',headers:h.headers,payload:{...archive,draft:{...archive.draft,apiKey:'sentinel'}}})).statusCode).toBe(400);
    expect((await h.app.inject({method:'POST',url:'/api/projects/import',headers:h.headers,payload:{...archive,draft:{...archive.draft,name:'tampered'}}})).json().code).toBe('PROJECT_PACKAGE_INTEGRITY_ERROR');
  });
  it('rejects altered acceptance cases even when the outer package digest is recomputed',async()=>{
    const h=await setup();const draft=await h.drafts.create(draftInput);const archive=(await h.app.inject({method:'GET',url:`/api/drafts/${draft.id}/export`,headers:h.headers})).json();
    const changed={...archive,baselines:archive.baselines.map((item:{content:{cases:Array<{title:string}>}})=>({...item,content:{...item.content,cases:item.content.cases.map((test,index)=>index?test:{...test,title:'tampered'})}}))};
    const {packageDigest:_old,...body}=changed;changed.packageDigest=contentDigest(body);
    const response=await h.app.inject({method:'POST',url:'/api/projects/import',headers:h.headers,payload:changed});expect(response.statusCode).toBe(422);expect(response.json().code).toBe('PROJECT_PACKAGE_BASELINE_INTEGRITY_ERROR');
  });
  it('rejects altered generated source even when the outer package digest is recomputed',async()=>{
    const h=await setup();const draft=await h.drafts.create({...draftInput,brief:{...draftInput.brief,output:{...draftInput.brief.output,confirmed:true}}});await h.snapshots.create(draft.id,{expectedRevision:1,assembly:equipmentAssembly()});const archive=(await h.app.inject({method:'GET',url:`/api/drafts/${draft.id}/export`,headers:h.headers})).json();
    const changed={...archive,automation:{...archive.automation,jobs:archive.automation.jobs.map((job:{files:Array<{content:string}>},jobIndex:number)=>jobIndex?job:{...job,files:job.files.map((file,index)=>index?file:{...file,content:'altered source'})})}};
    const {packageDigest:_old,...body}=changed;changed.packageDigest=contentDigest(body);
    const response=await h.app.inject({method:'POST',url:'/api/projects/import',headers:h.headers,payload:changed});expect(response.statusCode).toBe(422);expect(response.json().code).toBe('PROJECT_PACKAGE_SOURCE_INTEGRITY_ERROR');
  });
  it('rejects altered Mock seed data even when the outer package digest is recomputed',async()=>{
    const h=await setup();const draft=await h.drafts.create(draftInput);const archive=(await h.app.inject({method:'GET',url:`/api/drafts/${draft.id}/export`,headers:h.headers})).json();
    const changed={...archive,mockScene:{...archive.mockScene,seeds:archive.mockScene.seeds.map((seed:{accounts:Array<{availableBalanceFen:number}>},index:number)=>index?seed:{...seed,accounts:seed.accounts.map((account,index)=>index?account:{...account,availableBalanceFen:123})})}};
    const {packageDigest:_old,...body}=changed;changed.packageDigest=contentDigest(body);
    const response=await h.app.inject({method:'POST',url:'/api/projects/import',headers:h.headers,payload:changed});expect(response.statusCode).toBe(422);expect(response.json().code).toBe('PROJECT_PACKAGE_SCENE_INTEGRITY_ERROR');
  });
});
