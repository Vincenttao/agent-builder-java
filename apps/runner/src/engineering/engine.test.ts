import {afterEach,expect,it,vi} from 'vitest';
import {OpenCodeEngine} from './engine.js';

afterEach(()=>vi.restoreAllMocks());

it('uses a configurable request timeout for OpenCode API calls',async()=>{
  const timeout=vi.spyOn(AbortSignal,'timeout').mockReturnValue(new AbortController().signal);
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,json:async()=>({healthy:true})}) as Response));
  const engine=new OpenCodeEngine({root:'.',executable:'opencode',modelKey:'test-key',mcpBase:'http://127.0.0.1',tokens:{developer:'d',tester:'t'},apiTimeoutMs:45_000});
  const internal=engine as unknown as {base:string;api<T>(path:string):Promise<T>};
  internal.base='http://127.0.0.1:4096';

  await expect(internal.api('/global/health')).resolves.toEqual({healthy:true});
  expect(timeout).toHaveBeenCalledWith(45_000);
});

it('keeps OpenCode API calls within a bounded default timeout',async()=>{
  const timeout=vi.spyOn(AbortSignal,'timeout').mockReturnValue(new AbortController().signal);
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,json:async()=>({healthy:true})}) as Response));
  const engine=new OpenCodeEngine({root:'.',executable:'opencode',modelKey:'test-key',mcpBase:'http://127.0.0.1',tokens:{developer:'d',tester:'t'}});
  const internal=engine as unknown as {base:string;api<T>(path:string):Promise<T>};
  internal.base='http://127.0.0.1:4096';

  await internal.api('/global/health');
  expect(timeout).toHaveBeenCalledWith(60_000);
});
