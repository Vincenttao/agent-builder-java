import type {RuntimeSpec} from './index.js';
import {canonicalJson} from './canonical.js';

export interface GeneratedRailDefinition {
  schemaVersion:1;
  rails:{templateId:'tool-call-limit@1';parameters:{maximum:number}}[];
}
export type RailGenerationError='RAIL_REQUIREMENT_UNSUPPORTED'|'RAIL_PARAMETER_INVALID'|'RAIL_CONFIG_CONFLICT'|'RAIL_SCOPE_NOT_ALLOWED';
export class RailDefinitionError extends Error {constructor(public readonly code:RailGenerationError){super(code);}}

/** First supported NL form is intentionally explicit: "每次运行最多 N 次工具调用". */
export function railDefinitionForGoal(goal:string):GeneratedRailDefinition {
  const hits=[...goal.matchAll(/每次运行最多\s*(\d+)\s*次工具调用/g)];
  const limitMentions=[...goal.matchAll(/最多|不超过|限额|上限|限制/g)];
  const mentionsLimit=/工具调用/.test(goal)&&limitMentions.length>0;
  if(mentionsLimit&&hits.length!==limitMentions.length)throw new RailDefinitionError('RAIL_REQUIREMENT_UNSUPPORTED');
  if(!hits.length){if(mentionsLimit)throw new RailDefinitionError('RAIL_REQUIREMENT_UNSUPPORTED');return{schemaVersion:1,rails:[]};}
  if(hits.length!==1)throw new RailDefinitionError('RAIL_REQUIREMENT_UNSUPPORTED');
  const maximum=Number(hits[0]![1]);if(!Number.isInteger(maximum)||maximum<1||maximum>20)throw new RailDefinitionError('RAIL_PARAMETER_INVALID');
  return{schemaVersion:1,rails:[{templateId:'tool-call-limit@1',parameters:{maximum}}]};
}

export function validateGeneratedRailDefinition(goal:string,value:unknown):GeneratedRailDefinition {
  const expected=railDefinitionForGoal(goal);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new RailDefinitionError('RAIL_PARAMETER_INVALID');
  const candidate=value as Record<string,unknown>;
  if(Object.keys(candidate).sort().join(',')!=='rails,schemaVersion'||candidate.schemaVersion!==1||!Array.isArray(candidate.rails)||candidate.rails.length>1)
    throw new RailDefinitionError('RAIL_PARAMETER_INVALID');
  for(const rail of candidate.rails){
    if(!rail||typeof rail!=='object'||Array.isArray(rail))throw new RailDefinitionError('RAIL_PARAMETER_INVALID');
    const item=rail as Record<string,unknown>;
    if(Object.keys(item).sort().join(',')!=='parameters,templateId'||item.templateId!=='tool-call-limit@1'||!item.parameters||typeof item.parameters!=='object'||Array.isArray(item.parameters))throw new RailDefinitionError('RAIL_PARAMETER_INVALID');
    const parameters=item.parameters as Record<string,unknown>;
    if(Object.keys(parameters).join(',')!=='maximum'||!Number.isInteger(parameters.maximum)||Number(parameters.maximum)<1||Number(parameters.maximum)>20)throw new RailDefinitionError('RAIL_PARAMETER_INVALID');
  }
  if(canonicalJson(value)!==canonicalJson(expected))throw new RailDefinitionError('RAIL_PARAMETER_INVALID');
  return expected;
}

/** Rail-free profiles get a platform-owned empty definition. Model output cannot add an undeclared Rail. */
export function resolveGeneratedRailDefinition(goal:string,railScope:boolean,value:unknown):GeneratedRailDefinition {
  if(!railScope){
    const required=railDefinitionForGoal(goal);
    if(required.rails.length)throw new RailDefinitionError('RAIL_SCOPE_NOT_ALLOWED');
    return required;
  }
  return validateGeneratedRailDefinition(goal,value);
}

export function effectiveRuntimeSpec(base:RuntimeSpec,definition:GeneratedRailDefinition):RuntimeSpec {
  const rails=definition.rails.map(item=>`tool-call-limit@1:${item.parameters.maximum}`);
  const prior=base.agent.rails.filter(rail=>rail.startsWith('tool-call-limit@1:'));
  if(prior.length>1||prior.length&&JSON.stringify(prior)!==JSON.stringify(rails))throw new RailDefinitionError('RAIL_CONFIG_CONFLICT');
  const otherRails=base.agent.rails.filter(rail=>!rail.startsWith('tool-call-limit@1:'));
  return{...structuredClone(base),agent:{...structuredClone(base.agent),rails:[...otherRails,...(prior.length?prior:rails)]}};
}
