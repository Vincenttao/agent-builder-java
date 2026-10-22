import {createRequire} from 'node:module';
import {readFileSync,statSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve} from 'node:path';
/** The package chooses the native binary; its installed filename is not platform-derived. */
export function resolveOpenCodeExecutable(packageFile=createRequire(import.meta.url).resolve('opencode-ai/package.json')){
  const metadata=JSON.parse(readFileSync(packageFile,'utf8')) as {bin?:string|{opencode?:string}};
  const entry=typeof metadata.bin==='string'?metadata.bin:metadata.bin?.opencode;
  if(!entry)throw new Error('OPENCODE_BINARY_UNAVAILABLE');
  const directory=dirname(packageFile);const binary=resolve(directory,entry);const within=relative(directory,binary);
  if(isAbsolute(within)||within==='..'||within.startsWith('../')||within.startsWith('..\\')||!statSync(binary).isFile())throw new Error('OPENCODE_BINARY_UNAVAILABLE');
  return binary;
}
