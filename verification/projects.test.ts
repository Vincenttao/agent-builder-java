import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectStore, WorkbenchError} from '../workbench-server/projects.js';

const templateFiles = {
  'application.json': JSON.stringify({schemaVersion:1,name:'MOA 应用',description:'',scope:{own:[],delegated:[],outside:[]},skills:[],capabilities:[],handoff:{enabled:false,target:'',unfinished:'ask',resume:'prompt',maxTasks:2},connections:{},mapping:{balancePath:'data.points.available'}}),
  'instructions.md': '你是应用助手。按当前业务范围处理，不擅自执行业务。',
  '.opencode/skills/moa-application-development/SKILL.md': '---\nname: moa-application-development\ndescription: MOA应用开发指导\n---\n先读取 application.json；以差异交付，不修改固定业务约束。',
};
function fixture(t: test.TestContext) {
  const root=mkdtempSync(join(tmpdir(),'workbench-projects-'));
  const store=new ProjectStore(root);
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  const project=store.seedTemplate(templateFiles);
  return {store,root,project};
}
function error(code:string) {return (e:unknown)=>e instanceof WorkbenchError && e.code===code;}

test('only a platform developer publishes an immutable template version',t=>{
  const {store,project}=fixture(t);
  assert.throws(()=>store.publish(project.id,'application','1.0.0'),error('FORBIDDEN'));
  const first=store.publish(project.id,'platform','1.0.0');
  assert.equal(first.commit,project.head);
  assert.throws(()=>store.publish(project.id,'platform','1.0.0'),error('RELEASE_EXISTS'));
  assert.throws(()=>store.publish(project.id,'platform','1.1.0'),error('ALREADY_PUBLISHED'));
  const changed=store.save(project.id,'platform',project.head,{'instructions.md':'模板 v2 指导'});
  const second=store.publish(project.id,'platform','1.1.0');
  assert.equal(second.commit,changed.head);
  const oldApp=store.createApplication(first.id,'旧应用','application');
  const newApp=store.createApplication(second.id,'新应用','application');
  assert.equal(store.files(oldApp.id,'application')['instructions.md'],templateFiles['instructions.md']);
  assert.equal(store.files(newApp.id,'application')['instructions.md'],'模板 v2 指导');
});

test('new application starts empty from MOA and data stays isolated and persistent',t=>{
  const {store,root,project}=fixture(t);
  const release=store.publish(project.id,'platform','1.0.0');
  assert.throws(()=>store.createApplication(release.id,'错身份','platform'),error('FORBIDDEN'));
  const a=store.createApplication(release.id,'员工助手','application');
  const b=store.createApplication(release.id,'第二应用','application');
  assert.deepEqual(store.definition(a.id,'application').scope.own,[]);
  assert.equal(store.definition(a.id,'application').name,'员工助手');
  const changed=store.save(a.id,'application',a.head,{'instructions.md':'仅此应用的行为'});
  assert.equal(store.files(b.id,'application')['instructions.md'],templateFiles['instructions.md']);
  assert.throws(()=>store.save(a.id,'application',a.head,{'instructions.md':'陈旧修改'}),error('REVISION_CONFLICT'));
  assert.equal(store.get(a.id,'application').head,changed.head);
  store.close(); // Simulate a restart; a live data directory now has one owner.
  const reopened=new ProjectStore(root);
  assert.equal(reopened.workspaceId,store.workspaceId);
  assert.equal(reopened.files(a.id,'application')['instructions.md'],'仅此应用的行为');
  reopened.close();
});

test('file writes cannot escape project, alter dev skills or break config; failed saves preserve head',t=>{
  const {store,root,project}=fixture(t);
  const release=store.publish(project.id,'platform','1.0.0');
  const a=store.createApplication(release.id,'应用','application');
  for(const p of ['../outside.txt','/tmp/outside.txt','.git/config','.env.local','x/../../escape.txt','x\\escape','instructions.md\u0000']) {
    assert.throws(()=>store.save(a.id,'application',a.head,{[p]:'bad'}),error('INVALID_PATH'));
  }
  assert.throws(()=>store.save(a.id,'application',a.head,{'.opencode/skills/x/SKILL.md':'override'}),error('FORBIDDEN_PATH'));
  assert.throws(()=>store.save(a.id,'application',a.head,{'application.json':'{"schemaVersion":1}'}),error('INVALID_DEFINITION'));
  assert.throws(()=>store.save(a.id,'application',a.head,{'instructions.md':null}),error('INVALID_DEFINITION'));
  assert.equal(store.get(a.id,'application').head,a.head);
  assert.equal(store.files(a.id,'application')['instructions.md'],templateFiles['instructions.md']);
  const outside=join(root,'sensitive.txt');writeFileSync(outside,'outside');
  symlinkSync(outside,join(store.path(a.id),'skills','link.md'));
  assert.throws(()=>store.files(a.id,'application'),error('INVALID_PATH'));
});

test('platform can diagnose applications but cannot silently edit their content',t=>{
  const {store,project}=fixture(t);
  const release=store.publish(project.id,'platform','1.0.0');
  const a=store.createApplication(release.id,'应用','application');
  assert.equal(store.get(a.id,'platform').id,a.id);
  assert.throws(()=>store.save(a.id,'platform',a.head,{'instructions.md':'覆盖用户内容'}),error('FORBIDDEN'));
  assert.throws(()=>store.files(project.id,'application'),error('FORBIDDEN'));
});

test('application edits stay inside template-opened business files',t=>{
  const {store,project}=fixture(t);
  const release=store.publish(project.id,'platform','1.0.0');
  const a=store.createApplication(release.id,'应用','application');
  for(const name of ['pom.xml','src/main/java/com/openjiuwen/workbench/RuntimeServer.java','.opencode/skills/moa-application-development/SKILL.md']){
    assert.throws(()=>store.save(a.id,'application',a.head,{[name]:'replace fixed infrastructure'}),error('FORBIDDEN_PATH'));
  }
  assert.equal(store.get(a.id,'application').head,a.head);
});
