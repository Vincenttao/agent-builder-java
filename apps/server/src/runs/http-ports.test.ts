import{createServer}from'node:http';import{expect,it}from'vitest';import{HttpMock,HttpRunner}from'./http-ports.js';
it('preserves recognized dependency control errors but never forwards arbitrary error strings',async()=>{
  let code='EXECUTION_CLAIM_LOST';const server=createServer((_request,response)=>{response.writeHead(409,{'content-type':'application/json'});response.end(JSON.stringify({code,message:'SENTINEL_PRIVATE_UPSTREAM_DETAIL'}));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('port missing');
  const runner=new HttpRunner(`http://127.0.0.1:${address.port}`,'test-control-token-0123456789');
  try{
    await expect(runner.claim('id','1')).rejects.toMatchObject({code:'EXECUTION_CLAIM_LOST',status:409});
    code='SENTINEL_PRIVATE_CONNECTION_KEY';const error=await runner.claim('id','1').catch(error=>error as Error);
    expect(error).toMatchObject({code:'DEPENDENCY_REQUEST_FAILED'});expect(JSON.stringify(error)).not.toContain('SENTINEL');
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it('classifies a refused dependency connection without leaking transport details',async()=>{
  const server=createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('port missing');
  const port=address.port;await new Promise<void>(resolve=>server.close(()=>resolve()));
  const runner=new HttpRunner(`http://127.0.0.1:${port}`,'test-control-token-0123456789');
  const error=await runner.capabilities().catch(error=>error as Error);
  expect(error).toMatchObject({code:'DEPENDENCY_UNAVAILABLE',status:503});
  expect(JSON.stringify(error)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/);
});
it('forwards MCP JSON-RPC to the registered Mock connection with platform-resolved identity headers',async()=>{
  let captured:{headers:Record<string,string|string[]|undefined>;body:unknown}|undefined;
  const server=createServer(async(request,response)=>{
    const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
    captured={headers:request.headers as Record<string,string|string[]|undefined>,body:JSON.parse(Buffer.concat(chunks).toString())};
    response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({jsonrpc:'2.0',id:4,result:{isError:false,structuredContent:{status:'warning'}}}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('port missing');
  const mock=new HttpMock(`http://127.0.0.1:${address.port}`,'mock-control-token-0123456789','mock-business-token-0123456789');
  const context={runId:'e0131ad8-0000-4000-8000-000000000002',environmentId:'e0131ad8-0000-4000-8000-000000000001',actorId:'U1002',operations:['equipment-status']};
  const request={jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'equipment_status',arguments:{equipmentId:'PUMP-001'}}};
  try{
    await expect(mock.mcp(context,request)).resolves.toEqual({status:200,result:{jsonrpc:'2.0',id:4,result:{isError:false,structuredContent:{status:'warning'}}}});
    expect(captured?.headers.authorization).toBe('Bearer mock-business-token-0123456789');
    expect(captured?.headers['x-environment-id']).toBe(context.environmentId);expect(captured?.headers['x-run-id']).toBe(context.runId);expect(captured?.headers['x-actor-id']).toBe('U1002');
    expect(captured?.body).toEqual(request);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it.each([
  ['getAccountBalance',{accountId:'A1001'},'/mock-business/v1/accounts/A1001/balance',{accountId:'A1001',currency:'CNY',availableBalanceFen:1000000,asOf:'2026-10-21T08:00:00.000Z'}],
  ['listWealthProducts',{},'/mock-business/v1/wealth/products',{items:[],version:'seed-finance-001@1'}]
] as const)('invokes registered finance read operation %s with platform identity',async(operation,input,path,result)=>{
  let captured:{url:string;headers:Record<string,string|string[]|undefined>}|undefined;
  const server=createServer((request,response)=>{
    captured={url:request.url??'',headers:request.headers as Record<string,string|string[]|undefined>};
    response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify(result));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('port missing');
  const mock=new HttpMock(`http://127.0.0.1:${address.port}`,'mock-control-token-0123456789','mock-business-token-0123456789');
  const context={runId:'e0131ad8-0000-4000-8000-000000000002',environmentId:'e0131ad8-0000-4000-8000-000000000001',actorId:'U1001',operations:[operation]};
  try{
    await expect(mock.invoke(context,operation,input)).resolves.toEqual({status:200,result});
    expect(captured?.url).toBe(path);
    expect(captured?.headers.authorization).toBe('Bearer mock-business-token-0123456789');
    expect(captured?.headers['x-environment-id']).toBe(context.environmentId);expect(captured?.headers['x-run-id']).toBe(context.runId);expect(captured?.headers['x-actor-id']).toBe(context.actorId);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it('does not invoke an operation absent from the bound RuntimeSpec',async()=>{
  const mock=new HttpMock('http://127.0.0.1:1','mock-control-token-0123456789','mock-business-token-0123456789');
  const context={runId:'e0131ad8-0000-4000-8000-000000000002',environmentId:'e0131ad8-0000-4000-8000-000000000001',actorId:'U1001',operations:[]};
  await expect(mock.invoke(context,'getAccountBalance',{accountId:'A1001'})).rejects.toThrow('OPERATION_NOT_BOUND');
});
