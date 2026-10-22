import type { Draft, DraftInput } from '../../../../../packages/contracts/src/index.js';
export interface DraftRepository {
  create(draft: Draft): Promise<Draft>;
  get(id: string): Promise<Draft | undefined>;
  list(): Promise<Draft[]>;
  update(id: string, revision: number, input: DraftInput, at: string): Promise<Draft>;
}
export interface Clock { now(): string }
export interface IdGenerator { next(): string }
