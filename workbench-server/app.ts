import express,{type Request,type Response,type NextFunction} from 'express';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ExportManager} from './exports.js';
import {RunManager} from './runs.js';
import {LocalJavaEngine,type RunEngine} from './local-java.js';
import {moaTemplateFiles} from './template.js';
import {CodingJobs,type CodingEngine} from './coding.js';
import {OpenCodeEngine} from './opencode.js';
import {ProjectStore,WorkbenchError,applicationEditable,type Role,type Files} from './projects.js';
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export {readTree} from './files.js';
export function createWorkbench(options:{root:string;templateFiles?:Files;codingEngine?:CodingEngine;runEngine?:RunEngine}){
  const store=new ProjectStore(options.root);
  store.seedTemplate(options.templateFiles??moaTemplateFiles());
  const jobs=new CodingJobs(store,options.codingEngine??new OpenCodeEngine(repository));
  const runs=new RunManager(store,options.runEngine??new LocalJavaEngine(repository));
  const exports=new ExportManager(store,runs);
  let closing=false;
  const uiFiles=new Map(['index.html','style.css','app.js','configuration.js','coding.js','runtime.js','delivery.js'].map(name=>[name,readFileSync(resolve(repository,'workbench-ui',name),'utf8')]));
  const uiVersion=createHash('sha256');
  for(const [name,content] of uiFiles)uiVersion.update(name+'\0'+content);
  const build=uiVersion.digest('hex');
  const app=express();app.disable('x-powered-by');app.use(express.json({limit:'4mb'}));
  // Serve only the explicit UI assets; never expose the repository or local configuration.
  app.get('/',(_req,res)=>{res.set('Cache-Control','no-store');res.type('html').send(uiFiles.get('index.html'));});
  for(const name of ['app.js','style.css','configuration.js','coding.js','runtime.js','delivery.js'])app.get('/workbench-ui/'+name,(_req,res)=>{res.set('Cache-Control','no-store');res.type(name).send(uiFiles.get(name));});
  app.use('/api',(req,res,next)=>{
    if(closing&&!['GET','HEAD'].includes(req.method))return next(new WorkbenchError('WORKBENCH_STOPPED','工作台正在关闭',503));
    const browserBuild=req.header('x-workbench-ui-build');
    if(browserBuild&&browserBuild!==build&&!['GET','HEAD'].includes(req.method))return next(new WorkbenchError('UI_VERSION_CHANGED','页面版本已变化，请保留草稿并刷新后操作',409));
    const role=req.header('x-workbench-role')??'application';
    if(!['application','platform'].includes(role))return next(new WorkbenchError('INVALID_ROLE','请选择应用开发者或平台开发者'));
    res.locals.role=role as Role;res.set('Cache-Control','no-store');next();
  });
  app.get('/api/context',(req,res)=>res.json({identity:{role:res.locals.role,name:res.locals.role==='platform'?'林知远':'陈晓',simulated:true},mode:'local-development',model:'deepseek-flash',uiVersion:build}));
  app.get('/api/templates',(_req,res)=>res.json({releases:store.listReleases()}));
  app.post('/api/templates/:id/releases',(req,res)=>res.status(201).json({release:store.publish(req.params.id,res.locals.role,req.body.version)}));
  app.get('/api/projects',(_req,res)=>res.json({projects:store.list(res.locals.role)}));
  app.post('/api/projects',(req,res)=>res.status(201).json({project:store.createApplication(req.body.releaseId,req.body.name,res.locals.role)}));
  app.get('/api/projects/:id',(req,res)=>{
    const project=store.get(req.params.id,res.locals.role);const files=store.files(project.id,res.locals.role);
    res.json({project,definition:store.definition(project.id,res.locals.role),files,editablePaths:Object.keys(files).filter(f=>project.kind==='template'?res.locals.role==='platform':res.locals.role==='application'&&applicationEditable(f))});
  });
  app.put('/api/projects/:id/files',(req,res)=>res.json({project:store.save(req.params.id,res.locals.role,req.body.baseHead,req.body.changes)}));
  app.get('/api/projects/:id/jobs',(req,res)=>res.json({jobs:jobs.list(req.params.id,res.locals.role)}));
  app.post('/api/projects/:id/jobs',async(req,res)=>res.status(202).json({job:await jobs.start(req.params.id,res.locals.role,req.body.prompt)}));
  app.get('/api/jobs/:id',(req,res)=>res.json({job:jobs.get(req.params.id,res.locals.role)}));
  app.get('/api/jobs/:id/review',(req,res)=>res.json(jobs.review(req.params.id,res.locals.role)));
  app.post('/api/jobs/:id/apply',async(req,res)=>res.json({job:await jobs.apply(req.params.id,res.locals.role)}));
  app.post('/api/jobs/:id/reject',async(req,res)=>res.json({job:await jobs.reject(req.params.id,res.locals.role)}));
  app.post('/api/jobs/:id/cancel',async(req,res)=>res.json({job:await jobs.cancel(req.params.id,res.locals.role)}));
  app.post('/api/jobs/:id/answer',async(req,res)=>res.json({job:await jobs.answer(req.params.id,res.locals.role,req.body.questionId,req.body.answers)}));
  app.get('/api/jobs/:id/events',(req,res)=>{
    jobs.get(req.params.id,res.locals.role);res.set({'Content-Type':'text/event-stream','Connection':'keep-alive','Cache-Control':'no-store'});res.flushHeaders();
    const emit=()=>{try{const job=jobs.get(req.params.id,res.locals.role);res.write('event: state\ndata: '+JSON.stringify(job)+'\n\n');if(!['running','awaiting_input'].includes(job.status)){clearInterval(timer);res.end();}}catch{clearInterval(timer);res.end();}};
    const timer=setInterval(emit,750);req.on('close',()=>clearInterval(timer));emit();
  });
  app.get('/api/projects/:id/runs',(req,res)=>res.json({runs:runs.list(req.params.id,res.locals.role)}));
  app.get('/api/runs',(_req,res)=>res.json({runs:runs.listAll(res.locals.role)}));
  app.post('/api/projects/:id/runs',async(req,res)=>res.status(202).json({run:await runs.start(req.params.id,res.locals.role,req.body.baseHead)}));
  app.get('/api/runs/:id',(req,res)=>res.json({run:runs.get(req.params.id,res.locals.role)}));
  app.post('/api/runs/:id/reconnect',async(req,res)=>res.json({run:await runs.reconnect(req.params.id,res.locals.role)}));
  app.post('/api/runs/:id/stop',async(req,res)=>res.json({run:await runs.stop(req.params.id,res.locals.role)}));
  app.delete('/api/runs/:id',async(req,res)=>{await runs.remove(req.params.id,res.locals.role);res.status(204).end();});
  app.post('/api/runs/:id/messages',async(req,res)=>res.json(await runs.message(req.params.id,res.locals.role,req.body)));
  app.get('/api/runs/:id/conversations/:conversation',async(req,res)=>res.json(await runs.conversation(req.params.id,res.locals.role,req.params.conversation)));
  app.post('/api/runs/:id/conversations/:conversation/observe',async(req,res)=>res.json(await runs.observe(req.params.id,res.locals.role,req.params.conversation)));
  for(const action of ['reply','decide','resume','receipt'])app.post<{id:string;conversation:string}>('/api/runs/:id/conversations/:conversation/'+action,async(req,res)=>res.json(await runs.command(req.params.id,res.locals.role,req.params.conversation,action,req.body)));
  app.get('/api/projects/:id/exports',(req,res)=>res.json({exports:exports.list(req.params.id,res.locals.role)}));
  app.post('/api/projects/:id/exports',async(req,res)=>{const result=await exports.create(req.params.id,res.locals.role,req.body?.runId);res.status(result.reused?200:201).json({export:result.record});});
  app.get('/api/exports/:id/manifest',async(req,res)=>res.json({manifest:await exports.manifest(req.params.id,res.locals.role)}));
  // ExportManager already restricts this to owned, hash-checked archives; .workbench is a hidden parent directory.
  app.get('/api/exports/:id/files/:kind',async(req,res,next)=>{const file=await exports.file(req.params.id,res.locals.role,req.params.kind);res.set('X-Content-SHA256',file.artifact.sha256);res.download(file.path,req.params.id+'-'+file.artifact.filename,{dotfiles:'allow'},error=>{if(error)next(error);});});
  app.delete('/api/exports/:id',async(req,res)=>{await exports.remove(req.params.id,res.locals.role);res.status(204).end();});
  app.use('/api',(_req,_res,next)=>next(new WorkbenchError('NOT_FOUND','接口不存在',404)));
  app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
    const e=error instanceof WorkbenchError?error:error instanceof SyntaxError?new WorkbenchError('INVALID_JSON','请求必须是有效 JSON'):new WorkbenchError('INTERNAL_ERROR','操作失败，请查看本机服务状态',500);
    res.status(e.status).json({error:{code:e.code,message:e.message}});
  });
  return {app,store,jobs,runs,exports,close:async()=>{closing=true;await Promise.all([exports.close(),jobs.close(),runs.close()]);}};
}
