export type BaselineTemplateId = 'equipment-read@1' | 'equipment-workorder@1';
export interface BaselineInput { expectedRevision: number; templateId: string; expectedDigest: string; confirmed: boolean }
export interface BaselinePreview { digest: string; content: AcceptanceBaseline['content'] }
export interface BusinessRequirement { id: string; text: string; source: 'user' | 'template' | 'suggestion' }
export interface BusinessCase {
  id: string; scenario: string; title: string; requirementIds: string[]; required: true;
  input: string; fault: 'normal' | 'read-timeout' | 'write-after-timeout';
  assertions: { ruleId: string; expected: unknown }[];
}
export interface AcceptanceBaseline {
  id: string; draftId: string; draftRevision: number; digest: string; confirmedAt: string; confirmedBy: string;
  content: { schemaVersion: 1; templateId: BaselineTemplateId; draftId: string; draftRevision: number;
    audience: string; requirements: BusinessRequirement[]; cases: BusinessCase[]; seed: 'enterprise-default@1'; rulesVersion: 'equipment-assertions@1' | 'equipment-workorder-assertions@2' };
}
export const baselineInputSchema = { type: 'object', additionalProperties: false, required: ['expectedRevision','templateId','expectedDigest','confirmed'], properties: {
  expectedRevision: { type: 'integer', minimum: 1 }, expectedDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' }, templateId: { enum: ['equipment-read@1','equipment-workorder@1'] }, confirmed: { const: true }
} } as const;
