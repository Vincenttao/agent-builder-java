import {createHash} from 'node:crypto';
import {Ajv} from 'ajv';
import {WorkbenchError,type Files} from './projects.js';

export const consistencyPath='tests/.workbench-consistency.json';
export type ConsistencyAnalysis={inputDigest:string;verdict:'clear'|'conflict'|'needs-clarification';issues:{paths:string[];description:string;impact:string;suggestion:string}[]};
/** Conservative reuse: only tests, documentation and Git ignore rules may change. */
export function definitionInputs(files:Files){
 const paths=Object.keys(files).filter(p=>!p.startsWith('tests/')&&!p.startsWith('runtime-tests/')&&p!=='README.md'&&p!=='.gitignore').sort();
 const digest=createHash('sha256').update(JSON.stringify(paths.map(p=>[p,files[p]]))).digest('hex');
 const required=['application.json','instructions.md',...paths.filter(p=>/^skills\/.+\/SKILL\.md$/.test(p))];
 return {digest,paths,required};
}
const text={type:'string',minLength:1,maxLength:1500};
const validate=new Ajv({allErrors:true}).compile({type:'object',additionalProperties:false,required:['inputDigest','verdict','issues'],properties:{inputDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},verdict:{enum:['clear','conflict','needs-clarification']},issues:{type:'array',maxItems:12,items:{type:'object',additionalProperties:false,required:['paths','description','impact','suggestion'],properties:{paths:{type:'array',minItems:1,maxItems:12,uniqueItems:true,items:{type:'string',minLength:1,maxLength:300}},description:text,impact:text,suggestion:text}}}}});
export function parseConsistency(raw:string|undefined,source:ReturnType<typeof definitionInputs>):ConsistencyAnalysis{
 let value:any;try{value=JSON.parse(raw??'');}catch{throw new WorkbenchError('CONSISTENCY_REPORT_INVALID','助手未交付有效的结构化诊断');}
 if(!validate(value)||value.inputDigest!==source.digest||(value.verdict==='clear')!==(value.issues.length===0)||value.issues.some((i:any)=>i.paths.some((p:string)=>!source.paths.includes(p))))throw new WorkbenchError('CONSISTENCY_REPORT_INVALID','诊断格式、输入摘要、结论或来源路径无效');
 return value;
}
