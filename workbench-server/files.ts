import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {WorkbenchError,type Files} from './projects.js';
export function readTree(root:string):Files{
 const result:Files={};
 function visit(dir:string,prefix=''){for(const entry of readdirSync(dir,{withFileTypes:true})){if(entry.isSymbolicLink())throw new WorkbenchError('INVALID_PATH','模板不允许符号链接');const name=prefix+entry.name;entry.isDirectory()?visit(join(dir,entry.name),name+'/'):result[name]=readFileSync(join(dir,entry.name),'utf8');}}
 visit(root);return result;
}
