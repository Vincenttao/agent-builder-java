import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../../packages/contracts/src/canonical.js';
import { AppError } from '../shared/errors.js';

export const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export function normalizeAction(operation: string, value: unknown): Record<string, unknown> {
  if (operation !== 'work-order-create') throw new AppError('WRITE_OPERATION_NOT_ALLOWED', '写操作未注册', 422);
  const args = value as Record<string, unknown>;
  if (!args || Array.isArray(args) || typeof args !== 'object' || Object.keys(args).sort().join(',') !== 'description,equipmentId,priority'
      || typeof args.equipmentId !== 'string' || !/^[A-Z0-9-]{1,80}$/.test(args.equipmentId.trim())
      || typeof args.description !== 'string' || !args.description.trim() || args.description.length > 2000
      || !['normal', 'urgent'].includes(String(args.priority))) throw new AppError('INVALID_ACTION_INPUT', '工单参数不合法', 422);
  return { equipmentId: args.equipmentId.trim(), description: args.description.trim(), priority: args.priority };
}
