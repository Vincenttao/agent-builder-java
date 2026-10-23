import type {GeneratedBundle} from '../../../../packages/contracts/src/development.js';
import type {RuntimeArtifact,GeneratedComponentManifest} from '../../../../packages/contracts/src/artifacts.js';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,copyFile,lstat,appendFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {canonicalJson} from '../../../../packages/contracts/src/canonical.js';
import {PolicyError,generationProfile,generationProfileFor} from '../engineering/profile.js';
import {EngineeringCommands} from '../engineering/commands.js';
const sha=/^[a-f0-9]{64}$/;
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const contentHash=(value:unknown)=>hash(canonicalJson(value));
export async function artifactFileDigest(path:string){const hash=createHash('sha256');for await(const part of createReadStream(path))hash.update(part);return hash.digest('hex');}
const defaultSkillPath='skills/equipment-query/SKILL.md';
export function componentEntries(listing:string,classPath='generated/EquipmentTool.class',skillPath=defaultSkillPath):string[]{
  if(!/^generated\/[A-Z][A-Za-z0-9]*Tool\.class$/.test(classPath)||!/^skills\/[a-z][a-z0-9-]{0,63}\/SKILL\.md$/.test(skillPath))throw new PolicyError('COMPONENT_ARCHIVE_INVALID');
  const entries=listing.split(/\r?\n/).filter(Boolean);const directories=new Set(['META-INF/','generated/','skills/',`${skillPath.slice(0,skillPath.lastIndexOf('/')+1)}`]);
  const classBase=classPath.slice(0,-6);
  const classPattern=new RegExp(`^${classBase}(\\$[A-Za-z0-9_$]+)?\\.class$`);
  if(entries.length>40||new Set(entries).size!==entries.length||!entries.includes(classPath)||!entries.includes(skillPath)
    ||entries.some(path=>!directories.has(path)&&path!=='META-INF/MANIFEST.MF'&&path!==skillPath&&!classPattern.test(path)))throw new PolicyError('COMPONENT_ARCHIVE_INVALID');
  return entries.filter(path=>path.endsWith('.class')||path===skillPath);
}
async function immutable(path:string,data:Buffer|string){
  await mkdir(dirname(path),{recursive:true});
  try{await writeFile(path,data,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||hash(await readFile(path))!==hash(data))throw new PolicyError('ARTIFACT_MISMATCH');}
}
export class RuntimeArtifactRegistry {
  defaultDigest='';private queue:Promise<unknown>=Promise.resolve();private legacyTemplates=new Set<string>();
  constructor(readonly root:string,readonly baseJar:string,private readonly inspectJar:(path:string)=>Promise<string[]>=async path=>{
    const result=await new EngineeringCommands(async()=>{}).run('inspect-legacy-template','jar',['--list','--file',path],this.root);
    if(result.status!=='passed'||result.truncated)throw new PolicyError('ARTIFACT_NOT_FOUND');
    return result.output.split(/\r?\n/).filter(Boolean);
  }){}
  path(digest:string){if(!sha.test(digest))throw new PolicyError('ARTIFACT_MISMATCH');return resolve(this.root,'artifacts',digest+'.jar');}
  async initialize():Promise<void>{
    await mkdir(join(this.root,'artifacts','index'),{recursive:true});this.defaultDigest=await artifactFileDigest(this.baseJar);
    try{await copyFile(this.baseJar,this.path(this.defaultDigest),1);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    await this.get(this.defaultDigest);
  }
  async get(digest:string):Promise<RuntimeArtifact>{
    const path=this.path(digest);let descriptor!:RuntimeArtifact;
    if(digest===this.defaultDigest)descriptor={kind:'assembled-template',artifactDigest:digest,sdkArtifactDigest:digest};
    else{
      let stored:{descriptor:RuntimeArtifact;digest:string}|undefined;
      try{stored=JSON.parse(await readFile(join(this.root,'artifacts',digest+'.json'),'utf8'));}
      catch(error){
        if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new PolicyError('ARTIFACT_MISMATCH');
        // Older releases used the runtime bridge jar itself as their immutable candidate.
        // The jar stays content-addressed; admit it only when its bridge layout is intact.
        if(!this.legacyTemplates.has(digest)){
          const path=this.path(digest);
          try{if((await lstat(path)).isSymbolicLink()||await artifactFileDigest(path)!==digest)throw new Error('changed');}
          catch{throw new PolicyError('ARTIFACT_NOT_FOUND');}
          const required=['META-INF/MANIFEST.MF','BOOT-INF/classes/application.properties','BOOT-INF/classes/local/agentbuilder/bridge/BridgeApplication.class','BOOT-INF/classes/local/agentbuilder/bridge/BridgeManifestController.class'];
          const entries=new Set(await this.inspectJar(path));
          if(required.some(entry=>!entries.has(entry))||entries.has('BOOT-INF/classes/generated/agent-builder-component.json'))throw new PolicyError('ARTIFACT_NOT_FOUND');
          this.legacyTemplates.add(digest);
        }
        descriptor={kind:'assembled-template',artifactDigest:digest,sdkArtifactDigest:digest};
      }
      if(stored){
        descriptor=stored.descriptor;
        if(contentHash(descriptor)!==stored.digest||descriptor.kind!=='generated-component'||descriptor.artifactDigest!==digest
          ||descriptor.sdkArtifactDigest===digest||descriptor.generated.sdkArtifactDigest!==descriptor.sdkArtifactDigest)throw new PolicyError('ARTIFACT_MISMATCH');
        const sdk=await this.get(descriptor.sdkArtifactDigest);if(sdk.kind!=='assembled-template')throw new PolicyError('ARTIFACT_MISMATCH');
      }
    }
    try{if((await lstat(path)).isSymbolicLink()||await artifactFileDigest(path)!==digest)throw new Error('changed');}catch{throw new PolicyError('ARTIFACT_MISMATCH');}
    return descriptor;
  }
  compose(bundle:GeneratedBundle,directory:string,specDigest:string):Promise<RuntimeArtifact>{
    const next=this.queue.then(()=>this.composeInternal(bundle,directory,specDigest));this.queue=next.catch(()=>{});return next;
  }
  private async composeInternal(bundle:GeneratedBundle,directory:string,specDigest:string):Promise<RuntimeArtifact>{
    const{digest,...body}=bundle;
    if(!sha.test(specDigest)||!sha.test(digest)||contentHash(body)!==digest)throw new PolicyError('GENERATED_BUNDLE_MISMATCH');
    if(bundle.sdkArtifactDigest!==this.defaultDigest)throw new PolicyError('SDK_ARTIFACT_CHANGED');
    let profile;try{profile=generationProfileFor(bundle.profileVersion??generationProfile.version);}catch{throw new PolicyError('GENERATION_PROFILE_UNSUPPORTED');}
    if(bundle.profileVersion&&bundle.profileDigest!==contentHash(profile))throw new PolicyError('GENERATION_PROFILE_MISMATCH');
    if(bundle.repair&&!profile.repairContract)throw new PolicyError('REPAIR_PROFILE_NOT_IMPLEMENTED');
    await this.get(this.defaultDigest);
    const expectedFiles=[...profile.developerFiles,'test-plan.json','component.jar'];
    if(bundle.repair){
      const attempt=bundle.repair.attempt;if(!Number.isInteger(attempt)||attempt<1||attempt>3||bundle.repair.maxAttempts!==3)throw new PolicyError('GENERATED_BUNDLE_MISMATCH');
      const regression=profile.repair.regressionFiles.slice(0,attempt);
      if(!bundle.files.some(file=>file.path===regression.at(-1)))throw new PolicyError('GENERATED_BUNDLE_MISMATCH');
      expectedFiles.push(...regression.filter(path=>bundle.files.some(file=>file.path===path)));
    }
    if(bundle.files.length!==expectedFiles.length||new Set(bundle.files.map(file=>file.path)).size!==expectedFiles.length)throw new PolicyError('GENERATED_BUNDLE_MISMATCH');
    for(const file of bundle.files){
      if(!expectedFiles.includes(file.path)||!sha.test(file.digest)||file.size>1048576)throw new PolicyError('GENERATED_BUNDLE_MISMATCH');
      const path=join(directory,file.path);if((await lstat(path)).isSymbolicLink())throw new PolicyError('GENERATED_BUNDLE_MISMATCH');
      const bytes=await readFile(path);if(bytes.length!==file.size||hash(bytes)!==file.digest)throw new PolicyError('GENERATED_BUNDLE_MISMATCH');
    }
    const component=await readFile(join(directory,'component.jar'));
    if(hash(component)!==bundle.artifactDigest||contentHash(bundle.files.filter(file=>file.path!=='component.jar'))!==bundle.sourceDigest
      ||hash(await readFile(join(directory,'test-plan.json')))!==bundle.planDigest)throw new PolicyError('GENERATED_BUNDLE_MISMATCH');
    const key=contentHash({bundleDigest:digest,specDigest,sdkArtifactDigest:this.defaultDigest});const indexPath=join(this.root,'artifacts','index',key+'.json');
    let previous:{artifactDigest:string}|undefined;
    try{previous=JSON.parse(await readFile(indexPath,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new PolicyError('ARTIFACT_MISMATCH');}
    if(previous){const record=await this.get(previous.artifactDigest);if(record.kind!=='generated-component'||record.generated.developmentBundleDigest!==digest||record.generated.specDigest!==specDigest)throw new PolicyError('ARTIFACT_MISMATCH');return record;}
    const work=resolve(this.root,'artifacts','builds',randomUUID());const stage=join(work,'stage');const extracted=join(work,'extracted');await mkdir(stage,{recursive:true});await mkdir(extracted);
    const commands=new EngineeringCommands(async result=>{await appendFile(join(work,'commands.jsonl'),JSON.stringify(result)+'\n');});
    async function jar(id:string,args:string[],cwd=work){const result=await commands.run(id,'jar',args,cwd);if(result.status!=='passed'||result.truncated)throw new PolicyError('ARTIFACT_PACKAGE_FAILED');return result.output;}
    const componentPath=join(work,'component.jar');await writeFile(componentPath,component,{flag:'wx'});
    const classSources=bundle.files.filter(file=>/^src\/generated\/[A-Z][A-Za-z0-9]*Tool\.java$/.test(file.path));
    const skillFiles=bundle.files.filter(file=>/^skills\/[a-z][a-z0-9-]{0,63}\/SKILL\.md$/.test(file.path));
    const runtimeTools=bundle.runtimeSpec?.tools??[];
    if(classSources.length!==1||skillFiles.length!==1||runtimeTools.length!==1)throw new PolicyError('GENERATED_COMPONENT_BINDING_INVALID');
    const toolClassName=`generated.${classSources[0]!.path.split('/').at(-1)!.replace(/\.java$/,'')}`;
    const classPath=`${toolClassName.replaceAll('.','/')}.class`;
    const skillPath=skillFiles[0]!.path;
    const skillName=skillPath.split('/')[1]!;
    const toolName=runtimeTools[0]!.name;const operationId=runtimeTools[0]!.operationId;
    const entries=componentEntries(await jar('list-component',['--list','--file',componentPath]),classPath,skillPath);
    await jar('extract-component',['--extract','--file',componentPath,...entries],extracted);
    const classes:Record<string,string>={};
    for(const entry of entries){const bytes=await readFile(join(extracted,entry));if(bytes.length>262144)throw new PolicyError('COMPONENT_ARCHIVE_INVALID');await immutable(join(stage,'BOOT-INF/classes',entry),bytes);if(entry.endsWith('.class'))classes[entry]=hash(bytes);}
    const skillDigest=hash(await readFile(join(extracted,skillPath)));
    if(skillDigest!==bundle.files.find(file=>file.path===skillPath)?.digest)throw new PolicyError('GENERATED_SKILL_MISMATCH');
    const generated:GeneratedComponentManifest={kind:'generated-tool-skill@1',developmentBundleDigest:digest,sdkArtifactDigest:this.defaultDigest,snapshotId:bundle.snapshotId,specDigest,componentDigest:bundle.artifactDigest,skillDigest,classes,toolClassName,toolName,operationId,skillName,skillPath};
    await immutable(join(stage,'BOOT-INF/classes/generated/agent-builder-component.json'),canonicalJson(generated));
    const jarPath=join(work,'candidate.jar');await copyFile(this.path(this.defaultDigest),jarPath,1);
    await jar('compose-candidate',['--update','--file',jarPath,'--date=2026-01-01T00:00:00Z','-C',stage,'BOOT-INF/classes']);
    await this.get(this.defaultDigest);const artifactDigest=await artifactFileDigest(jarPath);
    try{await copyFile(jarPath,this.path(artifactDigest),1);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    const descriptor:RuntimeArtifact={kind:'generated-component',artifactDigest,sdkArtifactDigest:this.defaultDigest,generated};
    await immutable(join(this.root,'artifacts',artifactDigest+'.json'),canonicalJson({descriptor,digest:contentHash(descriptor)}));
    await this.get(artifactDigest);await immutable(indexPath,canonicalJson({artifactDigest}));return descriptor;
  }
}
