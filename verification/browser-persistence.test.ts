import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';

test('browser draft peers preserve each other and unavailable storage keeps editing possible',()=>{
 const storage:Record<string,string>={};
 const localStorage=new Proxy(storage,{get(target,key){if(key==='getItem')return (k:string)=>target[k]??null;if(key==='setItem')return(k:string,v:string)=>{target[k]=v;};if(key==='removeItem')return(k:string)=>{delete target[k];};return target[key as string];}});
 const source=readFileSync('workbench-ui/persistence.js','utf8');
 const create=()=>{const window:any={};runInNewContext(source,{window,localStorage,crypto:{randomUUID}});window.WorkbenchPersistence.init({build:'v1',workspaceId:'one',buildKey:'build',onWarning:()=>{}});return window.WorkbenchPersistence;};
 const a=create(),b=create();const first={baseHead:'a'.repeat(40),changes:{'instructions.md':'first'},cacheTag:null};Object.assign(first,a.saveDraft('app','application',first));
 const peer=b.loadDraft('app','application');peer.changes['instructions.md']='peer';Object.assign(peer,b.saveDraft('app','application',peer));
 first.changes['instructions.md']='late';assert.equal(a.saveDraft('app','application',first).cached,false);assert.equal(a.clearDraft('app','application',first),false);assert.equal(b.loadDraft('app','application').changes['instructions.md'],'peer');assert.equal(a.loadDraft('app','platform'),null);
 const window:any={};runInNewContext(source,{window,localStorage:{getItem(){throw Error('disabled');}},crypto:{randomUUID}});window.WorkbenchPersistence.init({build:'v1',workspaceId:'one',buildKey:'build',onWarning:()=>{}});assert.equal(window.WorkbenchPersistence.stale(),false);assert.equal(window.WorkbenchPersistence.saveDraft('app','application',first).cached,false);
});
