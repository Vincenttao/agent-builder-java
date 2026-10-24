import {describe,expect,it} from 'vitest';
import {runTesterUntilPlan} from './task-executor.js';

describe('tester plan completion',()=>{
  it('opens one bounded follow-up session when the first session completes without a plan',async()=>{
    let planReady=false;const attempts:number[]=[];const retries:number[]=[];
    await runTesterUntilPlan({hasPlan:()=>planReady,runAttempt:async attempt=>{attempts.push(attempt);if(attempt===2)planReady=true;},onRetry:async attempt=>{retries.push(attempt);}});
    expect(attempts).toEqual([1,2]);
    expect(retries).toEqual([2]);
  });

  it('stops after the configured number of sessions when the plan is still missing',async()=>{
    const attempts:number[]=[];const retries:number[]=[];
    await expect(runTesterUntilPlan({hasPlan:()=>false,runAttempt:async attempt=>{attempts.push(attempt);},onRetry:async attempt=>{retries.push(attempt);},maxAttempts:2})).rejects.toMatchObject({code:'TEST_PLAN_MISSING'});
    expect(attempts).toEqual([1,2]);
    expect(retries).toEqual([2]);
  });
});
