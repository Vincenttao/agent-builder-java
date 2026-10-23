import {expect,it} from 'vitest';
import type {CommandResult} from '../../../../packages/contracts/src/development.js';
import {isValidRedExecution} from './unit-test-policy.js';
const result=(patch:Partial<CommandResult>={}):CommandResult=>({id:'id',commandId:'unit-test',executable:'java',args:[],exitCode:1,status:'failed',startedAt:'',finishedAt:'',output:'IMPLEMENTATION_REQUIRED',truncated:false,...patch});
it('recognizes Red only when execution reaches the unchanged implementation stub',()=>{
 const stub='fixed stub',changed='changed source';
 expect(isValidRedExecution({source:stub,stubSource:stub,result:result()})).toBe(true);
 expect(isValidRedExecution({source:stub,stubSource:stub,result:result({output:'TOOLCARD_SETUP_FAILED'})})).toBe(false);
 expect(isValidRedExecution({source:stub,stubSource:stub,result:result({status:'passed',exitCode:0})})).toBe(false);
 expect(isValidRedExecution({source:stub,stubSource:stub,result:result({truncated:true})})).toBe(false);
 expect(isValidRedExecution({source:changed,stubSource:stub,result:result()})).toBe(false);
});
it('recognizes repair Red only against the original implementation and the exact regression assertion',()=>{
 const original='old implementation';
 expect(isValidRedExecution({source:original,stubSource:'stub',originalSource:original,result:result({output:'AssertionError: REPAIR_REGRESSION_FAILED'})})).toBe(true);
 expect(isValidRedExecution({source:'modified implementation',stubSource:'stub',originalSource:original,result:result({output:'REPAIR_REGRESSION_FAILED'})})).toBe(false);
 expect(isValidRedExecution({source:original,stubSource:'stub',originalSource:original,result:result({output:'unrelated failure'})})).toBe(false);
});
