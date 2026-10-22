import type {ValidationTestAuthority} from '../../shared/validation-claim.js';
import type {ValidationLeaseTokens} from '../../shared/validation-lease-tokens.js';
import {AppError} from '../../shared/errors.js';
export class TestApiClient {
  private session:{cookie:string;csrf:string}|undefined;
  constructor(private readonly base:()=>string,private readonly origin:string,private readonly bootstrapToken:string,private readonly grants:ValidationLeaseTokens){}
  private async login(){
    const response=await fetch(`${this.base()}/api/auth/session`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10_000),headers:{origin:this.origin,'content-type':'application/json',...(this.session?{cookie:this.session.cookie}:{})},body:JSON.stringify({token:this.bootstrapToken})});
    if(!response.ok)throw new AppError('VALIDATION_HTTP_AUTH_FAILED','测试执行器无法登录管理接口',503);
    const body=await response.json() as {csrfToken:string};const cookie=response.headers.get('set-cookie')?.split(';')[0];
    if(!cookie||!body.csrfToken)throw new AppError('VALIDATION_HTTP_AUTH_FAILED','管理接口缺少会话凭据',503);
    this.session={cookie,csrf:body.csrfToken};
  }
  async management<T>(path:string,method='GET',body?:unknown,authority?:ValidationTestAuthority):Promise<T>{
    if(!path.startsWith('/api/test-deployments'))throw new Error('INVALID_VALIDATION_MANAGEMENT_PATH');
    if(!this.session)await this.login();
    const send=()=>fetch(`${this.base()}${path}`,{method,redirect:'error',signal:AbortSignal.timeout(30_000),headers:{origin:this.origin,cookie:this.session!.cookie,'x-csrf-token':this.session!.csrf,'content-type':'application/json',...(authority?{'x-builder-validation-grant':this.grants.issue(authority)}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    let response=await send();if(response.status===401){await this.login();response=await send();}
    return this.decode<T>(response);
  }
  async business<T>(targetId:string,token:string,path:string,method='GET',body?:unknown):Promise<T>{
    const response=await fetch(`${this.base()}/test-api/deployments/${encodeURIComponent(targetId)}${path}`,{method,redirect:'error',signal:AbortSignal.timeout(30_000),headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return this.decode<T>(response);
  }
  private async decode<T>(response:Response):Promise<T>{
    const value=await response.json() as T&{code?:string};
    if(!response.ok)throw new AppError(value.code&&/^[A-Z_]+$/.test(value.code)?value.code:'VALIDATION_HTTP_FAILED','测试入口执行失败',response.status);
    return value;
  }
}
