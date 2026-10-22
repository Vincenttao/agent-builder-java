import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import type {ValidationTestAuthority} from './validation-claim.js';
import {AppError} from './errors.js';
/** Process-local signing key. HTTP carries a short-lived capability, never caller-selected authority. */
export class ValidationLeaseTokens {
  private readonly key=randomBytes(32);
  issue(authority:ValidationTestAuthority){
    const body=Buffer.from(JSON.stringify({...authority,expiresAt:Date.now()+120_000})).toString('base64url');
    return`${body}.${createHmac('sha256',this.key).update(body).digest('hex')}`;
  }
  read(value:unknown):ValidationTestAuthority|undefined{
    if(value===undefined)return;
    const fail=()=>new AppError('VALIDATION_AUTHORITY_INVALID','自动验收执行授权无效',403);
    if(typeof value!=='string'||value.length>2048||!/^[-\w]+\.[a-f0-9]{64}$/.test(value))throw fail();
    const [body,signature]=value.split('.');const expected=createHmac('sha256',this.key).update(body!).digest();
    if(!timingSafeEqual(expected,Buffer.from(signature!,'hex')))throw fail();
    try{
      const decoded=JSON.parse(Buffer.from(body!,'base64url').toString()) as ValidationTestAuthority&{expiresAt:number};
      if(decoded.expiresAt<=Date.now()||!['executionId','owner','token','runId'].every(key=>typeof decoded[key as keyof ValidationTestAuthority]==='string'))throw fail();
      return{executionId:decoded.executionId,owner:decoded.owner,token:decoded.token,runId:decoded.runId};
    }catch{throw fail();}
  }
}
