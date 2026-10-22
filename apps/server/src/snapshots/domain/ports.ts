import type { Snapshot } from '../../../../../packages/contracts/src/index.js';
export interface SnapshotRepository {
  create(snapshot: Snapshot): Promise<Snapshot>;
  get(id: string): Promise<Snapshot | undefined>;
  list(draftId: string): Promise<Snapshot[]>;
}
