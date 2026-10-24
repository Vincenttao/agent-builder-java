import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {moaTemplateFiles} from '../workbench-server/template.js';
import {ProjectStore,WorkbenchError} from '../workbench-server/projects.js';

test('published MOA includes real Java foundation and self-contained tests while application starts without business',t=>{
 const files=moaTemplateFiles();assert.ok(files['pom.xml']?.includes('agent-runtime-java'));
 assert.ok(files['src/main/java/com/openjiuwen/workbench/runtime/BusinessHost.java']?.includes('class BusinessHost'));
 assert.ok(files['src/test/java/com/openjiuwen/workbench/BusinessHostTest.java'].includes('runtime-tests/fixtures/idou'));
 assert.ok(files['runtime-tests/fixtures/idou/application.json']);assert.equal(Object.keys(files).some(f=>f.startsWith('target/')),false);
 const root=mkdtempSync(join(tmpdir(),'workbench-runtime-template-'));const store=new ProjectStore(root);t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
 const template=store.seedTemplate(files);const release=store.publish(template.id,'platform','1.0.0');const app=store.createApplication(release.id,'空应用','application');
 assert.deepEqual(store.definition(app.id,'application').skills,[]);assert.deepEqual(store.definition(app.id,'application').scope.own,[]);
 assert.equal(store.files(app.id,'application')['src/main/java/com/openjiuwen/workbench/runtime/BusinessHost.java'],files['src/main/java/com/openjiuwen/workbench/runtime/BusinessHost.java']);
 assert.throws(()=>store.save(app.id,'application',app.head,{'pom.xml':'override'}),(e:unknown)=>e instanceof WorkbenchError&&e.code==='FORBIDDEN_PATH');
 const changed=store.save(template.id,'platform',template.head,{'RUNTIME.md':files['RUNTIME.md']+'\n平台模板发行说明。\n'});const next=store.publish(changed.id,'platform','1.1.0');
 const newer=store.createApplication(next.id,'新版本应用','application');assert.notEqual(store.files(newer.id,'application')['RUNTIME.md'],store.files(app.id,'application')['RUNTIME.md']);
});
