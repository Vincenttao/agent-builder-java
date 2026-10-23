import type { Pool } from 'pg';

export interface RunEventRetentionResult { runCount: number; eventCount: number; cutoff: string }

export class RunEventRetention {
  constructor(private readonly pool: Pool, readonly retentionDays: number) {
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error('RUN_EVENT_RETENTION_DAYS_INVALID');
  }

  async prune(now = new Date()): Promise<RunEventRetentionResult> {
    if (!Number.isFinite(now.getTime())) throw new Error('RUN_EVENT_RETENTION_CLOCK_INVALID');
    const cutoff = new Date(now.getTime() - this.retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const expired = await client.query<{ runId: string; throughSeq: string; eventCount: number }>(`
        SELECT e.run_id AS "runId", MAX(e.seq)::text AS "throughSeq", COUNT(*)::integer AS "eventCount"
        FROM run_events e JOIN runs r ON r.id=e.run_id
        WHERE e.created_at < $1 AND e.type <> 'run.event_history_pruned'
          AND r.record->>'status' IN ('succeeded','failed','cancelled','interrupted')
        GROUP BY e.run_id ORDER BY e.run_id`, [cutoff]);
      await client.query("SELECT set_config('agent_builder.allow_run_event_retention','on',true)");
      let runCount = 0; let eventCount = 0;
      for (const row of expired.rows) {
        const removed = await client.query<{ seq: string }>(`
          DELETE FROM run_events WHERE run_id=$1 AND created_at < $2 AND type <> 'run.event_history_pruned' RETURNING seq::text AS seq`, [row.runId, cutoff]);
        const throughSeq = row.throughSeq;
        const removedCount = removed.rowCount ?? 0;
        if (!removedCount) continue;
        await client.query(`INSERT INTO run_events(run_id,source,source_key,type,data)
          VALUES($1,'platform',$2,'run.event_history_pruned',$3)
          ON CONFLICT(run_id,source,source_key) DO NOTHING`, [row.runId, `retention-pruned-${throughSeq}`, {
          throughSeq: Number(throughSeq), removedCount, deletedBefore: cutoff, retentionDays: this.retentionDays
        }]);
        runCount++; eventCount += removedCount;
      }
      await client.query('COMMIT');
      return { runCount, eventCount, cutoff };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  static fromEnvironment(pool: Pool, value = process.env.RUN_EVENT_RETENTION_DAYS ?? '90') {
    if (!/^\d{1,4}$/.test(value)) throw new Error('RUN_EVENT_RETENTION_DAYS_INVALID');
    return new RunEventRetention(pool, Number(value));
  }
}
