import type { ActionRecord } from '../../../../packages/contracts/src/actions.js';
import { AppError } from '../shared/errors.js';
import { digest, normalizeAction } from './action-input.js';
import type { PostgresActions } from './postgres-actions.js';

export interface WriteContext { runId: string; actorId: string; environmentId: string }
export interface WritePort {
  write(context: WriteContext, operation: string, args: Record<string, unknown>, key: string): Promise<{ status: number; result: unknown }>;
  lookup(context: WriteContext, operation: string, key: string): Promise<unknown | null>;
}
export class ActionService {
  private readonly inFlight = new Map<string, Promise<NonNullable<ActionRecord['response']>>>();
  constructor(private readonly repository: PostgresActions, private readonly port: WritePort) {}
  async invoke(runId: string, actorId: string, toolCallId: string, operation: string, input: unknown) {
    const args = normalizeAction(operation, input); const key = digest({ runId, actorId, toolCallId, operation, args });
    const old = this.inFlight.get(key); if (old) return old;
    const result = this.execute(runId, actorId, toolCallId, operation, args); this.inFlight.set(key, result);
    try { return await result; } finally { this.inFlight.delete(key); }
  }
  private async execute(runId: string, actorId: string, toolCallId: string, operation: string, args: Record<string, unknown>) {
    const claim = await this.repository.claim(runId, actorId, toolCallId, operation, args); const action = claim.action;
    if (action.response) return action.response;
    const context = { runId, actorId, environmentId: action.environmentId };
    if (claim.write) {
      let response: ActionRecord['response'];
      try { response = await this.port.write(context, operation, action.args, action.id); } catch { /* A transport failure does not establish whether a write committed. */ }
      if (response && response.status >= 200 && response.status < 500) {
        const settled = await this.repository.settle(action.id, response.status < 300 ? 'write_succeeded' : 'write_failed', response); return settled.response!;
      }
      await this.repository.settle(action.id, 'write_unknown');
    }
    let found: unknown | null = null;
    try { found = await this.port.lookup(context, operation, action.id); } catch { /* Retain unknown; only a later lookup is permitted. */ }
    const settled = await this.repository.settle(action.id, found === null ? 'reconcile_missing' : 'reconcile_found', found === null ? undefined : { status: 200, result: found });
    if (settled.response) return settled.response;
    throw new AppError('ACTION_RESULT_UNKNOWN', '写入结果待核对，不能重复提交', 409, { actionId: action.id });
  }
}
