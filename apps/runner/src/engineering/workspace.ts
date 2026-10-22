import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname,delimiter,relative} from 'node:path';
import type {AcceptanceBaseline} from '../../../../packages/contracts/src/baselines.js';
import type {EngineeringRole,EngineeringEvent,GeneratedBundle,CommandResult,EngineeringContext} from '../../../../packages/contracts/src/development.js';
import {canonicalJson} from '../../../../packages/contracts/src/canonical.js';
import {generationProfile,PolicyError,checkFileAccess,checkCommand} from './profile.js';
import {toolStub,toolContract,repairContract,engineeringSkills,platformContractTest} from './templates.js';
import {EngineeringCommands} from './commands.js';
const digest=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
interface WorkspaceState {sdkArtifactDigest?:string;unitRed?:CommandResult;unitGreen?:CommandResult;unitDigest?:string;greenSourceDigest?:string;planDigest?:string;bundle?:GeneratedBundle}
export class EngineeringWorkspace {
  private state:WorkspaceState={};private queue:Promise<unknown>=Promise.resolve();private sequence=0;private commands:EngineeringCommands;
  private sdkReady:Promise<void>|undefined;private cancelled=false;
  constructor(readonly root:string,private readonly sdkJar:string,readonly context:EngineeringContext,private readonly onEvent:(event:EngineeringEvent)=>Promise<void>=async()=>{}){
    this.root=resolve(root);this.sdkJar=resolve(sdkJar);this.commands=new EngineeringCommands(async result=>{
      await writeFile(join(this.root,'control','commands',`${result.id}.json`),JSON.stringify(result,null,2));await this.event(null,'command.completed',{id:result.id,commandId:result.commandId,status:result.status,exitCode:result.exitCode,truncated:result.truncated});
    });
  }
  async initialize(){
    for(const dir of ['developer/src/generated','developer/test/generated','developer/skills/equipment-query','tester/tests','control/commands','control/sdk','control/checks/verification','bundles'])await mkdir(join(this.root,dir),{recursive:true});
    if(this.context.repair)this.validateRepair();
    for(const role of ['developer','tester'] as const){await writeFile(join(this.root,role,'context.json'),JSON.stringify({profile:generationProfile,baseline:this.context.baseline,goal:this.context.goal,contract:this.context.repair?repairContract:toolContract,...(this.context.repair?{repair:this.context.repair}:{})},null,2));await writeFile(join(this.root,role,'engineering-skill.md'),engineeringSkills[role]);}
    try{this.state=JSON.parse(await readFile(join(this.root,'control','state.json'),'utf8')) as WorkspaceState;}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;this.state.sdkArtifactDigest=digest(await readFile(this.sdkJar));
      if(this.context.repair){
        if(this.context.repair.bundle.sdkArtifactDigest!==this.state.sdkArtifactDigest)throw new PolicyError('SDK_ARTIFACT_CHANGED');
        for(const file of this.context.repair.files)await writeFile(join(this.root,file.path==='test-plan.json'?'tester/tests/plan.json':`developer/${file.path}`),file.content,{flag:'wx'});
        this.state.planDigest=this.context.repair.bundle.planDigest;
      }else await writeFile(join(this.root,'developer',generationProfile.developerFiles[0]),toolStub,{flag:'wx'});
      await this.persist();}
    await this.assertSdk();
  }
  inspect(){return structuredClone(this.state);}
  private validateRepair(){
    const repair=this.context.repair!,{digest:bundleDigest,...body}=repair.bundle,attempt=repair.reference.attempt;
    if(!Number.isInteger(attempt)||attempt<1||attempt>3||repair.reference.maxAttempts!==3||digest(canonicalJson(body))!==bundleDigest||repair.bundle.snapshotId!==this.context.snapshotId||repair.bundle.baselineId!==this.context.baseline.id||repair.bundle.baselineDigest!==this.context.baseline.digest)throw new PolicyError('REPAIR_CONTEXT_INVALID');
    const required=[...generationProfile.developerFiles,'test-plan.json'];const allowed=[...required,...generationProfile.repair.regressionFiles.slice(0,attempt-1)];
    const descriptors=repair.bundle.files.filter(f=>f.path!=='component.jar');
    if(repair.files.length!==descriptors.length||new Set(repair.files.map(f=>f.path)).size!==repair.files.length||required.some(path=>!repair.files.some(f=>f.path===path)))throw new PolicyError('REPAIR_CONTEXT_INVALID');
    for(const file of repair.files){const expected=descriptors.find(f=>f.path===file.path);if(!allowed.includes(file.path)||!expected||expected.digest!==file.digest||digest(file.content)!==file.digest||Buffer.byteLength(file.content)!==expected.size||expected.size>generationProfile.maxFileBytes)throw new PolicyError('REPAIR_SOURCE_MISMATCH');}
    const plan=repair.files.find(f=>f.path==='test-plan.json')!;if(plan.digest!==repair.bundle.planDigest)throw new PolicyError('TEST_PLAN_FROZEN');this.validatePlan(plan.content);
  }
  private developerFiles(){return [...generationProfile.developerFiles,...(this.context.repair?[...this.context.repair.files.filter(f=>f.path.startsWith('test/')&&f.path!==generationProfile.developerFiles[1]).map(f=>f.path),this.repairTest()!]:[])];}
  private repairTest(){return this.context.repair?generationProfile.repair.regressionFiles[this.context.repair.reference.attempt-1]:undefined;}
  private async testDigest(){const tests=this.developerFiles().filter(path=>path.startsWith('test/'));return digest(canonicalJson(await Promise.all(tests.map(async path=>({path,content:await readFile(join(this.root,'developer',path),'utf8')})))));}
  private async event(role:EngineeringRole|null,type:string,data:Record<string,unknown>){await this.onEvent({sequence:++this.sequence,occurredAt:new Date().toISOString(),subjectId:this.root.split(/[\\/]/).at(-1)!,role,type,data});}
  private async persist(){const target=join(this.root,'control','state.json');const temp=`${target}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(this.state,null,2));await rename(temp,target);}
  private serial<T>(body:()=>Promise<T>):Promise<T>{const next=this.queue.then(()=>{if(this.cancelled)throw new PolicyError('ENGINEERING_CANCELLED');return body();});this.queue=next.catch(()=>{});return next;}
  private async path(role:EngineeringRole,path:string){
    const target=path.startsWith('implementation/')?join(this.root,'developer',path.slice(15)):join(this.root,role,path);
    // Exact profile paths above and segment checks reject symlinks/reparse traversal on normal tool operations.
    const root=await realpath(this.root);let part=this.root;
    for(const segment of relative(this.root,target).split(/[\\/]/)){part=join(part,segment);try{if((await lstat(part)).isSymbolicLink())throw new PolicyError('WORKSPACE_LINK_REJECTED');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
    const parent=await realpath(dirname(target));const outside=relative(root,parent);if(outside==='..'||outside.startsWith(`..${process.platform==='win32'?'\\':'/'}`)||resolve(parent)===resolve(root)&&target===root)throw new PolicyError('WORKSPACE_PATH_REJECTED');return target;
  }
  async read(role:EngineeringRole,path:string){checkFileAccess(role,'read',path,this.context.repair?.reference.attempt);return this.serial(async()=>readFile(await this.path(role,path),'utf8'));}
  async write(role:EngineeringRole,path:string,content:string){
    return this.serial(async()=>{
      try{checkFileAccess(role,'write',path,this.context.repair?.reference.attempt);if(Buffer.byteLength(content)>generationProfile.maxFileBytes)throw new PolicyError('GENERATED_FILE_TOO_LARGE');
        if(role==='developer'&&this.context.repair&&path.startsWith('test/')&&path!==this.repairTest())throw new PolicyError('PRIOR_TEST_FROZEN');
        if(role==='developer'&&path.startsWith('src/')&&!this.state.unitRed)throw new PolicyError('UNIT_RED_REQUIRED');
        if(role==='developer'&&this.context.repair&&path.startsWith('skills/')&&!this.state.unitRed)throw new PolicyError('UNIT_RED_REQUIRED');
        if(role==='developer'&&path.startsWith('test/')&&this.state.unitRed)throw new PolicyError('UNIT_TEST_FROZEN');
        if(role==='tester'&&path==='tests/plan.json'){this.validatePlan(content);if(this.state.planDigest&&this.state.planDigest!==digest(content))throw new PolicyError('TEST_PLAN_FROZEN');}
        if(path.endsWith('.java'))for(const imported of content.matchAll(/\bimport\s+([\w.*]+)\s*;/g)){if(!/^java\.util\.[\w*]+$/.test(imported[1]!)&&!['com.openjiuwen.core.foundation.tool.Tool','com.openjiuwen.core.foundation.tool.ToolCard'].includes(imported[1]!))throw new PolicyError('DEPENDENCY_NOT_ALLOWED');}
        const target=await this.path(role,path);await writeFile(target,content);
        if(role==='tester'&&path==='tests/plan.json')this.state.planDigest=digest(content);await this.persist();
        await this.event(role,'file.written',{path,digest:digest(content),bytes:Buffer.byteLength(content)});return{path,digest:digest(content)};
      }catch(error){await this.event(role,'policy.rejected',{path,code:error instanceof PolicyError?error.code:'FILE_OPERATION_FAILED'});throw error;}
    });
  }
  private validatePlan(content:string){
    let plan:{baselineDigest:string;cases:{caseId:string;requirementIds:string[];assertions:unknown[];steps:string[]}[]};try{plan=JSON.parse(content);}catch{throw new PolicyError('TEST_PLAN_INVALID');}
    if(!plan||typeof plan!=='object')throw new PolicyError('TEST_PLAN_INVALID');
    const baseline=this.context.baseline;
    if(plan.baselineDigest!==baseline.digest||!Array.isArray(plan.cases)||plan.cases.length!==baseline.content.cases.length||new Set(plan.cases.map(c=>c.caseId)).size!==plan.cases.length)throw new PolicyError('TEST_BASELINE_IMMUTABLE');
    for(const expected of baseline.content.cases){const actual=plan.cases.find(c=>c.caseId===expected.id);if(!actual||canonicalJson(actual.assertions)!==canonicalJson(expected.assertions)||canonicalJson(actual.requirementIds)!==canonicalJson(expected.requirementIds)||!Array.isArray(actual.steps)||actual.steps.length<2||actual.steps.some(step=>typeof step!=='string'||!step.trim()))throw new PolicyError('TEST_BASELINE_IMMUTABLE');}
  }
  private async sdk(){
    await (this.sdkReady??=this.commands.run('prepare-sdk','jar',['--extract','--file',this.sdkJar,'BOOT-INF/classes','BOOT-INF/lib'],join(this.root,'control/sdk')).then(result=>{if(result.status!=='passed')throw new PolicyError('SDK_UNAVAILABLE');}));
    return[join(this.root,'control/sdk/BOOT-INF/classes'),join(this.root,'control/sdk/BOOT-INF/lib/*')].join(delimiter);
  }
  private async assertSdk(){if(digest(await readFile(this.sdkJar))!==this.state.sdkArtifactDigest)throw new PolicyError('SDK_ARTIFACT_CHANGED');}
  private async source(){return await readFile(join(this.root,'developer',generationProfile.developerFiles[0]),'utf8');}
  async run(role:EngineeringRole,commandId:string){
    return this.serial(async()=>{
      checkCommand(role,commandId);if(!this.state.planDigest)throw new PolicyError('INDEPENDENT_TEST_PLAN_REQUIRED');
      await this.assertSdk();
      const plan=await readFile(join(this.root,'tester/tests/plan.json'));if(digest(plan)!==this.state.planDigest)throw new PolicyError('TEST_PLAN_FROZEN');
      if(commandId==='build'&&!this.state.unitGreen)throw new PolicyError('UNIT_GREEN_REQUIRED');
      const cp=await this.sdk();await this.assertSdk();const directory=join(this.root,'control','commands',randomUUID());await mkdir(directory,{recursive:true});
      const source=await this.source();const sourceDigest=digest(source);const tests=this.developerFiles().filter(path=>path.startsWith('test/'));
      if(commandId==='unit-test'){
        const testDigest=await this.testDigest();if(this.state.unitDigest&&this.state.unitDigest!==testDigest)throw new PolicyError('UNIT_TEST_FROZEN');
        if(this.context.repair)for(const file of this.context.repair.files.filter(f=>f.path.startsWith('test/')))if(digest(await readFile(join(this.root,'developer',file.path)))!==file.digest)throw new PolicyError('PRIOR_TEST_FROZEN');
        const compile=await this.commands.run('compile-unit','javac',['-encoding','UTF-8','--release','21','-cp',cp,'-d',directory,join(this.root,'developer',generationProfile.developerFiles[0]),...tests.map(path=>join(this.root,'developer',path))],this.root);
        if(compile.status!=='passed')return compile;
        let result:CommandResult|undefined;
        for(const path of tests){result=await this.commands.run('unit-test','java',['-ea','-cp',directory+delimiter+cp,`generated.${path.split('/').at(-1)!.replace('.java','')}`],this.root);if(result.status!=='passed'&&path!==tests.at(-1))return result;}
        if(sourceDigest!==digest(await this.source())||testDigest!==await this.testDigest())throw new PolicyError('SOURCE_CHANGED_DURING_COMMAND');
        const isRed=this.context.repair?source===this.context.repair.files.find(f=>f.path===generationProfile.developerFiles[0])!.content&&result!.output.includes('AssertionError: REPAIR_REGRESSION_FAILED'):source===toolStub&&result!.output.includes('IMPLEMENTATION_REQUIRED');
        if(!this.state.unitRed&&isRed&&result!.status==='failed'&&!result!.truncated){this.state.unitRed=result!;this.state.unitDigest=testDigest;}
        if(this.state.unitRed&&source!==toolStub&&result!.status==='passed'&&!result!.truncated){this.state.unitGreen=result!;this.state.greenSourceDigest=sourceDigest;}
        await this.persist();return result!;
      }
      if(sourceDigest!==this.state.greenSourceDigest)throw new PolicyError('UNIT_GREEN_STALE');
      if(await this.testDigest()!==this.state.unitDigest)throw new PolicyError('UNIT_TEST_FROZEN');
      const skill=await readFile(join(this.root,'developer',generationProfile.developerFiles[2]),'utf8');
      if(!skill.includes('name: equipment-query')||!skill.includes('get_equipment')||skill.length<120)throw new PolicyError('SKILL_PACKAGE_INVALID');
      const harness=join(this.root,'control/checks/verification/EquipmentContract.java');await writeFile(harness,platformContractTest);
      const compiled=await this.commands.run('compile-contract','javac',['-encoding','UTF-8','--release','21','-cp',cp,'-d',directory,join(this.root,'developer',generationProfile.developerFiles[0]),harness],this.root);
      if(compiled.status!=='passed')return compiled;
      const contract=await this.commands.run('platform-contract','java',['-ea','-cp',directory+delimiter+cp,'verification.EquipmentContract'],this.root);
      if(contract.status!=='passed'||contract.truncated||!contract.output.includes('PLATFORM_CONTRACT_OK'))return contract;
      const jar=join(directory,'component.jar');const built=await this.commands.run('package-component','jar',['--create','--file',jar,'-C',directory,'generated','-C',join(this.root,'developer'),'skills'],this.root);
      if(built.status!=='passed')return built;
      if(sourceDigest!==digest(await this.source())||skill!==await readFile(join(this.root,'developer',generationProfile.developerFiles[2]),'utf8'))throw new PolicyError('SOURCE_CHANGED_DURING_COMMAND');
      const files=[];const contents=new Map<string,Buffer>();for(const path of this.developerFiles()){const data=await readFile(join(this.root,'developer',path));contents.set(path,data);files.push({path,digest:digest(data),size:data.length});}
      contents.set('test-plan.json',plan);files.push({path:'test-plan.json',digest:digest(plan),size:plan.length});
      const artifact=await readFile(jar);contents.set('component.jar',artifact);files.push({path:'component.jar',digest:digest(artifact),size:artifact.length});
      await this.assertSdk();const manifest={artifactDigest:digest(artifact),sourceDigest:digest(canonicalJson(files.filter(f=>f.path!=='component.jar'))),profileDigest:digest(canonicalJson(generationProfile)),sdkArtifactDigest:this.state.sdkArtifactDigest!,files,
        snapshotId:this.context.snapshotId,baselineId:this.context.baseline.id,baselineDigest:this.context.baseline.digest,planDigest:this.state.planDigest,
        unitRedId:this.state.unitRed!.id,unitGreenId:this.state.unitGreen!.id,contractCheckId:contract.id,buildId:built.id,...(this.context.repair?{repair:this.context.repair.reference}:{})};
      const bundle:GeneratedBundle={...manifest,digest:digest(canonicalJson(manifest))};const destination=join(this.root,'bundles',bundle.digest);await mkdir(destination,{recursive:true});
      for(const[path,data]of contents){await mkdir(dirname(join(destination,path)),{recursive:true});try{await writeFile(join(destination,path),data,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||digest(await readFile(join(destination,path)))!==digest(data))throw error;}}
      await writeFile(join(destination,'manifest.json'),JSON.stringify(bundle,null,2),{flag:'wx'});this.state.bundle=bundle;await this.persist();await this.event(role,'bundle.created',{digest:bundle.digest,artifactDigest:bundle.artifactDigest});return{...built,bundle};
    });
  }
  async cancel(){this.cancelled=true;await this.commands.cancel();await this.queue;}
}
