import {afterEach,expect,it} from 'vitest';
import {createEngineeringMcp} from '../../apps/runner/src/engineering/mcp.js';
import type {EngineeringWorkspace} from '../../apps/runner/src/engineering/workspace.js';
const apps:ReturnType<typeof createEngineeringMcp>[]=[];afterEach(async()=>{await Promise.all(apps.splice(0).map(app=>app.close()));});
it('MCP binds role outside model input, validates operation arguments, and never exposes shell or another role credential',async()=>{
 const writes:unknown[]=[];const workspace={read:async(role:string,path:string)=>JSON.stringify({role,path}),write:async(role:string,path:string,content:string)=>{writes.push({role,path,content});return{saved:true};},inspect:()=>({}),run:async()=>({exitCode:0})} as unknown as EngineeringWorkspace;
 const tokens={developer:'developer-mcp-test-token-0123456789',tester:'tester-mcp-test-token-0123456789'};const app=createEngineeringMcp(workspace,tokens);apps.push(app);
 const rpc=(role:string,token:string,method:string,params:unknown={})=>app.inject({method:'POST',url:`/mcp/${role}`,headers:{authorization:`Bearer ${token}`},payload:{jsonrpc:'2.0',id:1,method,params}});
 expect((await rpc('developer',tokens.tester,'tools/list')).statusCode).toBe(401);
 expect((await rpc('developer',tokens.developer,'initialize',{protocolVersion:'2025-03-26'})).json().result.serverInfo.version).toBe('1');
 const list=(await rpc('tester',tokens.tester,'tools/list')).json();expect(list.result.tools.map((t:{name:string})=>t.name)).not.toContain('run');
 const read=await rpc('tester',tokens.tester,'tools/call',{name:'read',arguments:{path:'context.json'}});expect(read.json().result.content[0].text).toContain('tester');
 const invalid=await rpc('tester',tokens.tester,'tools/call',{name:'write',arguments:{path:'tests/plan.json',content:'{}',role:'developer'}});expect(invalid.json().result.isError).toBe(true);expect(writes).toHaveLength(0);
 const valid=await rpc('tester',tokens.tester,'tools/call',{name:'write',arguments:{path:'tests/plan.json',content:'{}'}});expect(valid.json().result.isError).not.toBe(true);expect(writes).toEqual([{role:'tester',path:'tests/plan.json',content:'{}'}]);
 const arbitrary=await rpc('developer',tokens.developer,'tools/call',{name:'shell',arguments:{command:'echo arbitrary'}});expect(arbitrary.json().result.isError).toBe(true);
});
