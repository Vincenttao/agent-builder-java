import type {CommandResult} from '../../../../packages/contracts/src/development.js';

export function isValidRedExecution(input:{source:string;stubSource:string;originalSource?:string;result:CommandResult}):boolean{
  const {source,stubSource,originalSource,result}=input;
  if(result.status!=='failed'||result.truncated)return false;
  return originalSource!==undefined
    ? source===originalSource&&result.output.includes('REPAIR_REGRESSION_FAILED')
    : source===stubSource&&result.output.includes('IMPLEMENTATION_REQUIRED');
}
