import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectStore,WorkbenchError} from '../workbench-server/projects.js';
test('a live data directory has one owner; closing permits a new workbench without old owner deleting its lock',t=>{
 const root=mkdtempSync(join(tmpdir(),'workbench-owner-'));const first=new ProjectStore(root);t.after(()=>{first.close();rmSync(root,{recursive:true,force:true});});
 assert.throws(()=>new ProjectStore(root),(error:unknown)=>error instanceof WorkbenchError&&error.code==='DATA_DIR_IN_USE');
 first.close();const next=new ProjectStore(root);try{first.close();assert.throws(()=>new ProjectStore(root),(error:unknown)=>error instanceof WorkbenchError&&error.code==='DATA_DIR_IN_USE');}finally{next.close();}
});

test('model key content is rejected before automatic project commit',t=>{
 const root=mkdtempSync(join(tmpdir(),'workbench-secret-'));const store=new ProjectStore(root);t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
 const files={'application.json':JSON.stringify({schemaVersion:1,name:'MOA',description:'',scope:{own:[],delegated:[],outside:[]},skills:[],capabilities:[],handoff:{enabled:false,target:'',unfinished:'ask',resume:'prompt',maxTasks:2},connections:{},mapping:{balancePath:'data.points'}}),'instructions.md':'应用指令'};
 const template=store.seedTemplate(files);const release=store.publish(template.id,'platform','1.0.0');const app=store.createApplication(release.id,'应用','application');
 assert.throws(()=>store.save(app.id,'application',app.head,{'instructions.md':'sk-'+'a'.repeat(32)}),(error:unknown)=>error instanceof WorkbenchError&&error.code==='SECRET_IN_PROJECT');
 assert.equal(store.get(app.id,'application').head,app.head);assert.equal(store.files(app.id,'application')['instructions.md'],'应用指令');
});
