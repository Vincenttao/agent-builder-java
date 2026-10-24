import express,{type Request,type Response,type NextFunction} from 'express';
import {readFileSync,readdirSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CodingJobs,type CodingEngine} from './coding.js';
import {OpenCodeEngine} from './opencode.js';
import {ProjectStore,WorkbenchError,applicationEditable,type Role,type Files} from './projects.js';
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function readTree(root:string):Files{
  const result:Files={};
  function visit(dir:string,prefix=''){for(const entry of readdirSync(dir,{withFileTypes:true})){if(entry.isSymbolicLink())throw new WorkbenchError('INVALID_PATH','模板不允许符号链接');const name=prefix+entry.name;entry.isDirectory()?visit(join(dir,entry.name),name+'/'):result[name]=readFileSync(join(dir,entry.name),'utf8');}}
  visit(root);return result;
}
export function createWorkbench(options:{root:string;templateFiles?:Files;codingEngine?:CodingEngine}){
  const store=new ProjectStore(options.root);
  store.seedTemplate(options.templateFiles??readTree(join(repository,'templates/moa')));
  const jobs=new CodingJobs(store,options.codingEngine??new OpenCodeEngine(repository));
  const app=express();app.disable('x-powered-by');app.use(express.json({limit:'4mb'}));
  app.use('/api',(req,res,next)=>{
    const role=req.header('x-workbench-role')??'application';
    if(!['application','platform'].includes(role))return next(new WorkbenchError('INVALID_ROLE','请选择应用开发者或平台开发者'));
    res.locals.role=role as Role;res.set('Cache-Control','no-store');next();
  });
  app.get('/api/context',(req,res)=>res.json({identity:{role:res.locals.role,name:res.locals.role==='platform'?'林知远':'陈晓',simulated:true},mode:'local-development',model:'deepseek-flash'}));
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
  app.post('/api/jobs/:id/apply',async(req,res)=>res.json({job:await jobs.apply(req.params.id,res.locals.role)}));
  app.post('/api/jobs/:id/reject',async(req,res)=>res.json({job:await jobs.reject(req.params.id,res.locals.role)}));
  app.post('/api/jobs/:id/cancel',async(req,res)=>res.json({job:await jobs.cancel(req.params.id,res.locals.role)}));
  app.post('/api/jobs/:id/answer',async(req,res)=>res.json({job:await jobs.answer(req.params.id,res.locals.role,req.body.questionId,req.body.answers)}));
  app.get('/api/jobs/:id/events',(req,res)=>{
    jobs.get(req.params.id,res.locals.role);res.set({'Content-Type':'text/event-stream','Connection':'keep-alive','Cache-Control':'no-store'});res.flushHeaders();
    const emit=()=>{try{const job=jobs.get(req.params.id,res.locals.role);res.write('event: state\ndata: '+JSON.stringify(job)+'\n\n');if(!['running','awaiting_input'].includes(job.status)){clearInterval(timer);res.end();}}catch{clearInterval(timer);res.end();}};
    const timer=setInterval(emit,750);req.on('close',()=>clearInterval(timer));emit();
  });
  app.use('/api',(_req,_res,next)=>next(new WorkbenchError('NOT_FOUND','接口不存在',404)));
  app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
    const e=error instanceof WorkbenchError?error:error instanceof SyntaxError?new WorkbenchError('INVALID_JSON','请求必须是有效 JSON'):new WorkbenchError('INTERNAL_ERROR','操作失败，请查看本机服务状态',500);
    res.status(e.status).json({error:{code:e.code,message:e.message}});
  });
  return {app,store,jobs};
}
