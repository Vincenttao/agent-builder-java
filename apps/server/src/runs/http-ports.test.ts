import{createServer}from'node:http';import{expect,it}from'vitest';import{HttpRunner}from'./http-ports.js';
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
