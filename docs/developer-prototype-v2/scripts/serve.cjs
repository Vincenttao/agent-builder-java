const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const buildVersion=require('./build-version.cjs');
const routes={'/':['开发工作台2.0.html','text/html; charset=utf-8'],'/src/':['src/index.html','text/html; charset=utf-8'],'/src/style.css':['src/style.css','text/css; charset=utf-8'],'/src/app.js':['src/app.js','text/javascript; charset=utf-8']};
const server=http.createServer((req,res)=>{const route=routes[req.url.split('?')[0]];if(!route||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end('Not found');return;}fs.readFile(path.join(root,route[0]),(err,data)=>{if(err){res.writeHead(500);res.end('Build the prototype first.');return;}if(route[0]==='src/index.html')data=Buffer.from(data.toString().replace('__DEMO_BUILD__',buildVersion(root)));res.writeHead(200,{'Content-Type':route[1],'Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:data);});});
server.listen(Number(process.env.DEMO_PORT||8768),'127.0.0.1',()=>console.log(`双角色交互 Demo：http://127.0.0.1:${server.address().port}`));
