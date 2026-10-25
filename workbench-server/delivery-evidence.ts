import {randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProjectStore,WorkbenchError,type Role} from './projects.js';
import {ReviewManager} from './reviews.js';
import {RunManager} from './runs.js';
import {ExportManager} from './exports.js';
import {BusinessTests} from './business-tests.js';
import {ConsistencyManager} from './consistency.js';

function fail(code:string,message:string,status=409):never{throw new WorkbenchError(code,message,status);}
export class DeliveryEvidence{
 constructor(private store:ProjectStore,private reviews:ReviewManager,private runs:RunManager,private exports:ExportManager,private tests:BusinessTests,private consistency:ConsistencyManager){
  store.db.exec(`CREATE TABLE IF NOT EXISTS delivery_candidates(id TEXT PRIMARY KEY,projectId TEXT NOT NULL,checkId TEXT NOT NULL REFERENCES design_checks(id) ON DELETE RESTRICT,testId TEXT NOT NULL REFERENCES business_tests(id) ON DELETE RESTRICT,runId TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,exportId TEXT NOT NULL REFERENCES exports(id) ON DELETE RESTRICT,consistencyId TEXT NOT NULL REFERENCES coding_jobs(id) ON DELETE RESTRICT,record TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS delivery_registrations(id TEXT PRIMARY KEY,candidateId TEXT NOT NULL REFERENCES delivery_candidates(id) ON DELETE RESTRICT,record TEXT NOT NULL);`);
 }
 private owner(id:string,role:Role){const p=this.store.get(id,role);if(p.kind!=='application'||role!=='application')fail('FORBIDDEN','验证候选和企业交接登记由应用开发者维护',403);return p;}
 get(id:string,role:Role){const row=this.store.db.prepare('SELECT record FROM delivery_candidates WHERE id=?').get(id) as {record:string}|undefined;if(!row)fail('NOT_FOUND','验证证据候选不存在',404);const c=JSON.parse(row.record),p=this.store.get(c.projectId,role),registrations=(this.store.db.prepare('SELECT record FROM delivery_registrations WHERE candidateId=? ORDER BY rowid DESC').all(id) as {record:string}[]).map(r=>JSON.parse(r.record));const diagnostic=this.consistency.state(c.projectId,role,c.head);return {...c,stale:c.head!==p.head,definitionStatus:diagnostic.status,blocked:diagnostic.blocked,registrations};}
 list(id:string,role:Role){this.store.get(id,role);return (this.store.db.prepare('SELECT id FROM delivery_candidates WHERE projectId=? ORDER BY rowid DESC LIMIT 48').all(id) as {id:string}[]).map(r=>this.get(r.id,role));}
 options(id:string,role:Role){const p=this.store.get(id,role);return {head:p.head,checks:this.reviews.list(id,role).filter(c=>c.head===p.head&&c.passed),tests:this.tests.list(id,role).filter(r=>r.head===p.head&&r.status==='passed'),consistency:this.consistency.state(id,role),exports:this.exports.list(id,role),candidates:this.list(id,role)};}
 async create(id:string,role:Role,input:Record<string,unknown>){
  const p=this.owner(id,role);if(p.head!==input.baseHead)fail('REVISION_CONFLICT','请基于当前保存版本固定验证证据');
  for(const key of ['checkId','testId','runId','exportId','consistencyId'])if(typeof input[key]!=='string'||!/^[a-f0-9-]{36}$/.test(String(input[key])))fail('EVIDENCE_REQUIRED','请选择结构报告、业务报告、原运行、诊断和交付包');
  const report=this.reviews.list(id,role).find(c=>c.id===input.checkId),test=this.tests.get(String(input.testId),role),run=this.runs.get(String(input.runId),role),exported=this.exports.get(String(input.exportId),role),semantic=this.consistency.state(id,role);
  this.consistency.guard(id,role,p.head);
  if(!report?.passed||report.head!==p.head||test.projectId!==id||test.head!==p.head||test.status!=='passed'||test.runId!==run.id||run.projectId!==id||run.head!==p.head||exported.projectId!==id||exported.head!==p.head||exported.runId!==run.id||exported.engine!==run.engine)fail('EVIDENCE_MISMATCH','证据必须属于同一应用、源码版本及原运行，不能混用相同源码的另一次运行');
  const files=this.store.snapshot(id,p.head),suite=files['tests/business-cases.json'];
  if(!suite||createHash('sha256').update(suite).digest('hex')!==test.suiteDigest||!run.artifact||run.testing||run.unobserved?.length||test.engine!==run.engine||test.jarSha256!==run.artifact.sha256||!isDeepStrictEqual(test.configuration,run.configuration??null))fail('EVIDENCE_MISMATCH','用例、JAR、模型来源或原请求状态不匹配');
  if(semantic.status!=='clear'||semantic.report?.id!==input.consistencyId)fail('CONSISTENCY_REQUIRED','先对当前定义完成一致性诊断，结构报告不能代替语义检查');
  const manifest=await this.exports.manifest(exported.id,role);
  if(manifest.runId!==run.id||manifest.sourceHead!==p.head||manifest.jar?.sha256!==run.artifact.sha256||!isDeepStrictEqual(manifest.runtime?.executionConfiguration??null,run.configuration??null))fail('EVIDENCE_MISMATCH','交付清单与业务测试实际运行不一致');
  await Promise.all(['application','source'].map(kind=>this.exports.file(exported.id,role,kind)));
  if(this.store.get(id,role).head!==p.head)fail('REVISION_CONFLICT','核对制品期间工程已变化');
  this.consistency.guard(id,role,p.head);if(this.consistency.state(id,role).report?.id!==input.consistencyId)fail('CONSISTENCY_REQUIRED','诊断结论已更新，请刷新后固定');
  const previous=this.list(id,role).find(c=>c.head===p.head&&c.checkId===input.checkId&&c.testId===input.testId&&c.runId===input.runId&&c.exportId===input.exportId&&c.consistencyId===input.consistencyId);if(previous)return previous;
  if((this.store.db.prepare('SELECT count(*) n FROM delivery_candidates').get() as {n:number}).n>=48)fail('RETENTION_LIMIT','验证候选已达48份，请保留证据并安排归档');
  const real=run.engine==='local-java'&&semantic.verification==='opencode-analysis'&&run.configuration?.configured===true&&test.verification!=='contract-fixture';
  const candidate={id:randomUUID(),projectId:id,head:p.head,sourceReleaseId:p.sourceReleaseId,createdAt:new Date().toISOString(),checkId:report.id,testId:test.id,runId:run.id,exportId:exported.id,consistencyId:semantic.report!.id,semanticInputDigest:semantic.inputDigest,semanticSourceHead:semantic.sourceHead,suiteDigest:test.suiteDigest,jarSha256:run.artifact.sha256,configuration:run.configuration??null,engine:run.engine,artifacts:exported.artifacts,manifestSha256:exported.manifestSha256,verification:real?test.verification:'contract-only',business:real?'controlled-tests-passed':'not-verified',enterprise:'not-verified',publication:'not-published'};
  this.store.db.prepare('INSERT INTO delivery_candidates VALUES(?,?,?,?,?,?,?,?)').run(candidate.id,id,candidate.checkId,candidate.testId,candidate.runId,candidate.exportId,candidate.consistencyId,JSON.stringify(candidate));
  return this.get(candidate.id,role);
 }
 register(id:string,role:Role,input:Record<string,unknown>){
  const c=this.get(id,role);this.owner(c.projectId,role);
  if(!['acceptance','handoff'].includes(String(input.kind))||!['passed','failed','pending'].includes(String(input.outcome)))fail('INVALID_REGISTRATION','请选择企业验收或交接及实际登记结果',400);
  for(const [key,max] of [['owner',120],['title',200],['note',4000]] as const)if(typeof input[key]!=='string'||!String(input[key]).trim()||String(input[key]).length>max)fail('INVALID_REGISTRATION','负责人、标题和依据说明须填写且不能超过长度限制',400);
  let url='';if(input.url!==undefined&&input.url!==''){try{const value=new URL(String(input.url));if(!['http:','https:'].includes(value.protocol)||value.username||value.password||String(input.url).length>2000)throw Error();url=value.href;}catch{fail('INVALID_REGISTRATION','依据链接须为无凭据的HTTP(S)地址',400);}}
  if(/sk-[a-zA-Z0-9_-]{20,}/.test(JSON.stringify(input)))fail('SECRET_IN_REGISTRATION','登记中不得包含模型Key',400);
  if(input.outcome==='passed')this.consistency.guard(c.projectId,role,c.head);
  if((this.store.db.prepare('SELECT count(*) n FROM delivery_registrations').get() as {n:number}).n>=96||c.registrations.length>=12)fail('RETENTION_LIMIT','登记已达保留上限，请保留证据并安排归档');
  const registration={id:randomUUID(),candidateId:id,head:c.head,exportId:c.exportId,manifestSha256:c.manifestSha256,createdAt:new Date().toISOString(),source:'user-declared',kind:input.kind,outcome:input.outcome,owner:input.owner,title:input.title,note:input.note,url,execution:'not-executed-by-workbench'};
  this.store.db.prepare('INSERT INTO delivery_registrations VALUES(?,?,?)').run(registration.id,id,JSON.stringify(registration));return registration;
 }
}
