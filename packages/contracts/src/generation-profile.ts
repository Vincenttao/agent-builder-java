import type {GenerationRequest} from './development.js';
export const equipmentGenerationRequest={profileVersion:'equipment-java@2',scope:['tool','skill'],dependencies:['openjiuwen-core@0.1.17','agent-builder-bridge@0.1.0'],connectionProfile:'mock-equipment@1'} as const;
export function generationPolicyError(request:GenerationRequest):string|undefined {
 if(request.profileVersion!==equipmentGenerationRequest.profileVersion)return 'GENERATION_PROFILE_UNSUPPORTED';
 if(JSON.stringify([...request.scope].sort())!==JSON.stringify([...equipmentGenerationRequest.scope].sort()))return 'GENERATION_SCOPE_UNSUPPORTED';
 if(JSON.stringify([...request.dependencies].sort())!==JSON.stringify([...equipmentGenerationRequest.dependencies].sort()))return 'DEPENDENCY_NOT_ALLOWED';
 if(request.connectionProfile!==equipmentGenerationRequest.connectionProfile)return 'BUSINESS_CONNECTION_NOT_ALLOWED';
}
