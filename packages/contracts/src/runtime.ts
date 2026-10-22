export const uuidParamsSchema = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } as const;
const fields = { type: 'object', maxProperties: 30, propertyNames: { pattern: '^[a-zA-Z][a-zA-Z0-9_]{0,63}$' }, additionalProperties: { enum: ['string', 'integer', 'boolean'] } } as const;
export const runtimeSpecSchema = {
  type: 'object', additionalProperties: false, required: ['agent', 'tools'], properties: {
    agent: { type: 'object', additionalProperties: false, required: ['id', 'type', 'systemPrompt', 'maxIterations', 'rails'], properties: {
      id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,80}$' }, type: { const: 'DeepAgent' },
      systemPrompt: { type: 'string', minLength: 1, maxLength: 8000 }, maxIterations: { type: 'integer', minimum: 1, maximum: 20 },
      rails: { type: 'array', items: { enum: ['audit', 'tool-allowlist', 'write-confirm'] }, uniqueItems: true, maxItems: 3, contains: { const: 'tool-allowlist' } }
    } },
    tools: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false,
      required: ['name', 'description', 'operationId', 'inputFields', 'responseFields'], properties: {
        name: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$' }, description: { type: 'string', maxLength: 1000 },
        operationId: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$' }, inputFields: fields, responseFields: fields
      } } }
  }
} as const;
export const deploymentRequestSchema = { type: 'object', additionalProperties: false, required: ['artifactDigest', 'spec'], properties: {
  artifactDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' }, spec: runtimeSpecSchema
} } as const;
export const fencingTokenSchema={type:'string',pattern:'^[1-9][0-9]{0,18}$'} as const;
export const executionClaimSchema={type:'object',additionalProperties:false,required:['fencingToken'],properties:{fencingToken:fencingTokenSchema}} as const;
export const executionRequestSchema = { type: 'object', additionalProperties: false, required: ['deploymentId', 'sessionId', 'message','fencingToken'], properties: {
  fencingToken:fencingTokenSchema,
  deploymentId: { type: 'string', format: 'uuid' }, sessionId: { type: 'string', format: 'uuid' }, message: { type: 'string', minLength: 1, maxLength: 8000, pattern: '\\S' }
} } as const;
export const resumeRequestSchema = { type: 'object', additionalProperties: false, required: ['resumeId','toolCallId','approved','fencingToken'], properties: {
  fencingToken:fencingTokenSchema,
  resumeId: { type: 'string', format: 'uuid' }, toolCallId: { type: 'string', minLength: 1, maxLength: 200 }, approved: { type: 'boolean' }
} } as const;
