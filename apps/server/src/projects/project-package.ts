import {contentDigest} from '../snapshots/domain/assembly.js';
import type {ProjectPackage} from '../../../../packages/contracts/src/project-package.js';
import type {Draft} from '../../../../packages/contracts/src/index.js';
import type {Snapshot} from '../../../../packages/contracts/src/index.js';
import type {AcceptanceBaseline} from '../../../../packages/contracts/src/baselines.js';
import {AppError} from '../shared/errors.js';
import {createHash} from 'node:crypto';
import type {PortableDevelopmentJob,PortableCandidate} from '../../../../packages/contracts/src/project-package.js';
import type {MockScenePackage} from '../../../../packages/contracts/src/mock-scene.js';

export function createProjectPackage(draft:Draft,snapshots:Snapshot[],baselines:AcceptanceBaseline[],exportedAt:string,jobs:PortableDevelopmentJob[]=[],candidates:PortableCandidate[]=[],mockScene?:MockScenePackage):ProjectPackage{
  const dependencyMap=new Map<string,ProjectPackage['automation']['artifactDependencies'][number]>();
  for(const job of jobs)dependencyMap.set(job.bundle.sdkArtifactDigest,{artifactDigest:job.bundle.sdkArtifactDigest,restore:'platform-template'});
  for(const candidate of candidates){const job=candidate.generated?jobs.find(item=>item.id===candidate.generated!.developmentJobId):undefined;
    dependencyMap.set(candidate.artifactDigest,{artifactDigest:candidate.artifactDigest,...(job?{sdkArtifactDigest:job.bundle.sdkArtifactDigest}:{}),
      ...(candidate.generated?{restore:'rebuild-from-source',sourceJobId:candidate.generated.developmentJobId}:{restore:'platform-template'})});
  }
  const artifactDependencies=[...dependencyMap.values()];
  const body={schemaVersion:1 as const,packageKind:'agent-builder-project' as const,
    source:{projectId:draft.id,revision:draft.revision,exportedAt},draft:{name:draft.name,brief:structuredClone(draft.brief)},
    snapshots:snapshots.map(snapshot=>({sourceDigest:snapshot.digest,assembly:structuredClone(snapshot.content.assembly)})),
    baselines:baselines.map(baseline=>({templateId:baseline.content.templateId,sourceDigest:baseline.digest,content:structuredClone(baseline.content)})),
    automation:{jobs:structuredClone(jobs),candidates:candidates.map(candidate=>({id:candidate.id,snapshotId:candidate.snapshotId,snapshotDigest:candidate.snapshotDigest,specDigest:candidate.specDigest,artifactDigest:candidate.artifactDigest,bundleDigest:candidate.bundleDigest,provenance:candidate.provenance,...(candidate.runtimeSpec?{runtimeSpec:structuredClone(candidate.runtimeSpec)}:{}),...(candidate.generated?{generated:{developmentJobId:candidate.generated.developmentJobId,developmentBundleDigest:candidate.generated.developmentBundleDigest,baselineId:candidate.generated.baselineId,baselineDigest:candidate.generated.baselineDigest,sourceDigest:candidate.generated.sourceDigest}}:{})})),artifactDependencies},
    ...(mockScene?{mockScene:structuredClone(mockScene)}:{}),
    connectionRequirements:[...new Set(snapshots.map(snapshot=>snapshot.content.connectionProfile))].map(profile=>({profile,action:'rebind' as const}))};
  const result={...body,packageDigest:contentDigest(body)};verifyProjectPackage(result);return result;
}

export function verifyProjectPackage(value:ProjectPackage):void{
  const {packageDigest,...body}=value;
  if(contentDigest(body)!==packageDigest)throw new AppError('PROJECT_PACKAGE_INTEGRITY_ERROR','项目包摘要校验失败',422);
  if(value.schemaVersion!==1||value.packageKind!=='agent-builder-project'||!value.source.projectId||!Number.isInteger(value.source.revision)
    ||value.connectionRequirements.some(item=>item.action!=='rebind'))throw new AppError('PROJECT_PACKAGE_INVALID','项目包内容无效',422);
  if(value.baselines.some(item=>contentDigest(item.content)!==item.sourceDigest||item.templateId!==item.content.templateId))throw new AppError('PROJECT_PACKAGE_BASELINE_INTEGRITY_ERROR','验收基线摘要校验失败',422);
  if(value.mockScene){const{digest,...scene}=value.mockScene;if(contentDigest(scene)!==digest)throw new AppError('PROJECT_PACKAGE_SCENE_INTEGRITY_ERROR','Mock 场景包摘要校验失败',422);}
  const snapshotDigests=new Set(value.snapshots.map(snapshot=>snapshot.sourceDigest));
  for(const job of value.automation.jobs){const{digest,...bundle}=job.bundle;if(contentDigest(bundle)!==digest)throw new AppError('PROJECT_PACKAGE_BUNDLE_INTEGRITY_ERROR','生成 Bundle 摘要校验失败',422);
    if(!snapshotDigests.has(job.snapshotDigest)||job.bundle.snapshotId!==job.snapshotId||job.bundle.baselineId!==job.baselineId||job.bundle.baselineDigest!==job.baselineDigest
      ||contentDigest(job.bundle.files.filter(file=>file.path!=='component.jar'))!==job.bundle.sourceDigest||job.bundle.files.find(file=>file.path==='component.jar')?.digest!==job.bundle.artifactDigest)throw new AppError('PROJECT_PACKAGE_BINDING_MISMATCH','生成任务与项目快照或制品不匹配',422);
    for(const file of job.files)if(file.path.startsWith('/')||file.path.includes('\\')||file.path.split('/').some(part=>!part||part==='.'||part==='..')||createHash('sha256').update(file.content).digest('hex')!==file.digest||!job.bundle.files.some(item=>item.path===file.path&&item.digest===file.digest))throw new AppError('PROJECT_PACKAGE_SOURCE_INTEGRITY_ERROR','生成源码摘要校验失败',422);
    if(job.files.length!==job.bundle.files.filter(file=>file.path!=='component.jar').length)throw new AppError('PROJECT_PACKAGE_SOURCE_INCOMPLETE','项目包缺少生成源码',422);
  }
  for(const candidate of value.automation.candidates){if(!snapshotDigests.has(candidate.snapshotDigest))throw new AppError('PROJECT_PACKAGE_BINDING_MISMATCH','候选与项目快照不匹配',422);
    if(candidate.runtimeSpec&&contentDigest(candidate.runtimeSpec)!==candidate.specDigest)throw new AppError('PROJECT_PACKAGE_BINDING_MISMATCH','候选运行规格摘要不匹配',422);
    if(candidate.provenance==='generated-component'){
    const source=value.automation.jobs.find(job=>job.id===candidate.generated?.developmentJobId);const dependency=value.automation.artifactDependencies.find(item=>item.artifactDigest===candidate.artifactDigest);
    if(!source||source.bundle.digest!==candidate.generated?.developmentBundleDigest||source.bundle.sourceDigest!==candidate.generated?.sourceDigest||dependency?.restore!=='rebuild-from-source'||dependency.sourceJobId!==source.id)throw new AppError('PROJECT_PACKAGE_CANDIDATE_SOURCE_MISSING','生成候选缺少对应源码或制品依赖',422);
  }}
  const byteLength=Buffer.byteLength(JSON.stringify(value));if(byteLength>1_800_000)throw new AppError('PROJECT_PACKAGE_TOO_LARGE','项目包超过 1.8 MB，请缩减或分拆项目',413);
}
