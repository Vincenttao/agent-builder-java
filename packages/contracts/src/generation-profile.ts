import type {GenerationRequest} from './development.js';
import type {RuntimeSpec} from './index.js';
export const equipmentGenerationRequest={profileVersion:'equipment-java@3',scope:['tool','skill','rail'],dependencies:['openjiuwen-core@0.1.17','agent-builder-bridge@0.1.0'],connectionProfile:'mock-equipment@1'} as const;
export const wealthBalanceGenerationRequest={profileVersion:'wealth-balance-java@1',scope:['tool','skill'],dependencies:['openjiuwen-core@0.1.17','agent-builder-bridge@0.1.0'],connectionProfile:'mock-finance@1'} as const;
export const equipmentRuntimeTool={name:'get_equipment',description:'按设备编号查询 Mock 设备状态；equipmentId 必填，例如 PUMP-001。',operationId:'equipment-status',inputFields:{equipmentId:'string'},responseFields:{equipmentId:'string',status:'string',temperatureCelsius:'integer',source:'string'},protocol:'http',connectionRef:'enterprise-mock-http@1',toolVersion:'equipment-status-http@1'} satisfies RuntimeSpec['tools'][number];
export const wealthBalanceRuntimeTool={name:'get_account_balance',description:'查询模拟账户可用余额；accountId 必填。只报告接口返回值，不推断余额或收益。',operationId:'getAccountBalance',inputFields:{accountId:'string'},responseFields:{accountId:'string',currency:'string',availableBalanceFen:'integer',asOf:'string'},protocol:'http',connectionRef:'enterprise-mock-http@1',toolVersion:'account-balance-http@1'} satisfies RuntimeSpec['tools'][number];
export function generatedRuntimeTool(profileVersion:string):RuntimeSpec['tools'][number]|undefined{
 if(profileVersion===equipmentGenerationRequest.profileVersion)return structuredClone(equipmentRuntimeTool);
 if(profileVersion===wealthBalanceGenerationRequest.profileVersion)return structuredClone(wealthBalanceRuntimeTool);
 return undefined;
}
const reviewedProfiles=[equipmentGenerationRequest,wealthBalanceGenerationRequest] as const;
const implementedProfileVersions:readonly string[]=[equipmentGenerationRequest.profileVersion,wealthBalanceGenerationRequest.profileVersion];
export function generationPolicyError(request:GenerationRequest):string|undefined {
 const profile=reviewedProfiles.find(item=>item.profileVersion===request.profileVersion);
 if(!profile)return 'GENERATION_PROFILE_UNSUPPORTED';
 if(JSON.stringify([...request.scope].sort())!==JSON.stringify([...profile.scope].sort()))return 'GENERATION_SCOPE_UNSUPPORTED';
 if(JSON.stringify([...request.dependencies].sort())!==JSON.stringify([...profile.dependencies].sort()))return 'DEPENDENCY_NOT_ALLOWED';
 if(request.connectionProfile!==profile.connectionProfile)return 'BUSINESS_CONNECTION_NOT_ALLOWED';
}
export function generationImplementationError(request:GenerationRequest):string|undefined{
 const policyError=generationPolicyError(request);if(policyError)return policyError;
 if(!implementedProfileVersions.includes(request.profileVersion))return 'GENERATION_PROFILE_NOT_IMPLEMENTED';
}
