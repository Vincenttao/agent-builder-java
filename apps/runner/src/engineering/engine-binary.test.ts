import {expect,it} from 'vitest';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {resolveOpenCodeExecutable} from './engine-binary.js';
it('uses the package bin entry even when a Linux native executable has an exe suffix',async()=>{
  const directory=resolve('.cache/test-engine-binary',randomUUID());await mkdir(join(directory,'bin'),{recursive:true});
  await writeFile(join(directory,'package.json'),JSON.stringify({bin:{opencode:'./bin/opencode.exe'}}));await writeFile(join(directory,'bin/opencode.exe'),Buffer.from([0x7f,0x45,0x4c,0x46]));
  expect(resolveOpenCodeExecutable(join(directory,'package.json'))).toBe(join(directory,'bin/opencode.exe'));
  await writeFile(join(directory,'package.json'),JSON.stringify({bin:{opencode:'../outside'}}));expect(()=>resolveOpenCodeExecutable(join(directory,'package.json'))).toThrow('OPENCODE_BINARY_UNAVAILABLE');
});
