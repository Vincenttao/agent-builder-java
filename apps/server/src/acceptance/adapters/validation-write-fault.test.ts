import {it,expect,vi} from 'vitest';
import type {Pool} from 'pg';
import {ValidationWriteFault} from './validation-write-fault.js';
it('a validation-tagged run with no persisted execution cannot reach the write service',async()=>{
  const invoke=vi.fn(),query=vi.fn(async()=>({rows:[{run:{id:'run',validationId:'missing'},execution:null,baseline:null}]}));
  const adapter=new ValidationWriteFault({query} as unknown as Pool,{invoke});
  await expect(adapter.invoke('run','U1001','write','work-order-create',{equipmentId:'PUMP-001',description:'检查',priority:'normal'})).rejects.toMatchObject({code:'VALIDATION_WRITE_CONTEXT_REJECTED'});
  expect(invoke).not.toHaveBeenCalled();
});
