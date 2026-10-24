import express,{type Request,type Response,type NextFunction} from 'express';
import {readFileSync,readdirSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProjectStore,WorkbenchError,applicationEditable,type Role,type Files} from './projects.js';
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function readTree(root:string):Files{
  const result:Files={};
  function visit(dir:string,prefix=''){for(const entry of readdirSync(dir,{withFileTypes:true})){if(entry.isSymbolicLink())throw new WorkbenchError('INVALID_PATH','模板不允许符号链接');const name=prefix+entry.name;entry.isDirectory()?visit(join(dir,entry.name),name+'/'):result[name]=readFileSync(join(dir,entry.name),'utf8');}}
  visit(root);return result;
}
export function createWorkbench(options:{root:string;templateFiles?:Files}){
  const store=new ProjectStore(options.root);
  store.seedTemplate(options.templateFiles??readTree(join(repository,'templates/moa')));
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
  app.use('/api',(_req,_res,next)=>next(new WorkbenchError('NOT_FOUND','接口不存在',404)));
  app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
    const e=error instanceof WorkbenchError?error:error instanceof SyntaxError?new WorkbenchError('INVALID_JSON','请求必须是有效 JSON'):new WorkbenchError('INTERNAL_ERROR','操作失败，请查看本机服务状态',500);
    res.status(e.status).json({error:{code:e.code,message:e.message}});
  });
  return {app,store};
}
