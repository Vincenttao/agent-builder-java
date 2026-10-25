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
 let parsed:any;try{if(!raw||raw.length>128000)throw Error();parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();}catch{throw new WorkbenchError('CONSISTENCY_REPORT_INVALID','助手未交付有效的结构化诊断');}
 // Models may add explanatory annotations. Preserve raw output in the Coding record,
 // but only these required, strictly validated fields affect the product decision.
 const value={inputDigest:parsed.inputDigest,verdict:parsed.verdict,issues:Array.isArray(parsed.issues)?parsed.issues.map((i:any)=>i&&typeof i==='object'?{paths:i.paths,description:i.description,impact:i.impact,suggestion:i.suggestion}:i):parsed.issues};
 if(!validate(value)||value.inputDigest!==source.digest||(value.verdict==='clear')!==(value.issues.length===0)||value.issues.some((i:any)=>i.paths.some((p:string)=>!source.paths.includes(p))))throw new WorkbenchError('CONSISTENCY_REPORT_INVALID','诊断格式、输入摘要、结论或来源路径无效');
 return value;
}
