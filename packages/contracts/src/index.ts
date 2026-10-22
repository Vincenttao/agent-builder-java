import type { FromSchema } from 'json-schema-to-ts';

const fieldSchema = {
  type: 'object', additionalProperties: false,
  required: ['value', 'source', 'confirmed'],
  properties: {
    value: { type: 'string', maxLength: 8000 },
    source: { enum: ['user', 'template', 'suggestion'] },
    confirmed: { type: 'boolean' }
  }
} as const;

export const draftInputSchema = {
  type: 'object', additionalProperties: false,
  required: ['name', 'brief'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
    brief: {
      type: 'object', additionalProperties: false, required: ['audience', 'goal', 'output'],
      properties: { audience: fieldSchema, goal: fieldSchema, output: fieldSchema }
    }
  }
} as const;
export const draftUpdateSchema = {
  ...draftInputSchema,
  required: [...draftInputSchema.required, 'expectedRevision'],
  properties: { ...draftInputSchema.properties, expectedRevision: { type: 'integer', minimum: 1 } }
} as const;
export const draftParamsSchema = {
  type: 'object', required: ['id'], additionalProperties: false,
  properties: { id: { type: 'string', format: 'uuid' } }
} as const;
export const bindingInputSchema = {
  type: 'object', additionalProperties: false, required: ['kind', 'profile'],
  properties: { kind: { type: 'string' }, profile: { type: 'string', maxLength: 100 } }
} as const;

export type DraftInput = FromSchema<typeof draftInputSchema>;
export type DraftUpdate = FromSchema<typeof draftUpdateSchema>;
export type BindingInput = FromSchema<typeof bindingInputSchema>;
export const assemblyInputSchema = {
  type: 'object', additionalProperties: false,
  required: ['agentType', 'systemPrompt', 'maxIterations', 'railIds', 'toolIds'],
  properties: {
    agentType: { type: 'string', maxLength: 40 }, systemPrompt: { type: 'string', minLength: 1, maxLength: 8000 },
    maxIterations: { type: 'integer', minimum: 1, maximum: 20 },
    railIds: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 10 },
    toolIds: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 20 }
  }
} as const;
export const snapshotInputSchema = {
  type: 'object', additionalProperties: false, required: ['expectedRevision', 'assembly'],
  properties: { expectedRevision: { type: 'integer', minimum: 1 }, assembly: assemblyInputSchema }
} as const;
export type AssemblyInput = FromSchema<typeof assemblyInputSchema>;
export type SnapshotInput = FromSchema<typeof snapshotInputSchema>;
export interface Draft extends DraftInput { id: string; revision: number; createdAt: string; updatedAt: string }
export interface RuntimeSpec {
  agent: { id: string; type: string; systemPrompt: string; maxIterations: number; rails: string[] };
  tools: { name: string; description: string; operationId: string; inputFields: Record<string, string>; responseFields: Record<string, string> }[];
}
export interface Snapshot {
  id: string; draftId: string; draftRevision: number; digest: string; createdAt: string;
  content: { draft: Draft; assembly: AssemblyInput; runtimeSpec: RuntimeSpec; executionMode: 'trusted-local';
    sdk: { core: string; runtime: string }; modelProfile: string; connectionProfile: string };
}
export interface ApiError { code: string; message: string; details: unknown; correlationId: string }
export interface Blocker { code: string; message: string; path: string }
export interface EnvironmentStatus {
  checkedAt: string; executionMode: 'trusted-local'; sandboxEnabled: false;
  database: 'ready' | 'unavailable'; model: 'not_configured' | 'configured_unverified'; runtime: 'not_implemented' | 'ready' | 'unavailable';
  canSaveDraft: boolean; canRun: boolean; blockers: Blocker[];
}
