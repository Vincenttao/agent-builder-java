import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const project = process.env.NF04_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const base = process.env.NF04_BASE_URL ?? 'http://127.0.0.1:18080';
const retentionDays = Number(process.env.RUN_EVENT_RETENTION_DAYS ?? '90');
assert.ok(Number.isInteger(retentionDays) && retentionDays >= 1 && retentionDays <= 3650, 'RETENTION_POLICY_INVALID');
const compose = (...args) => execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, ...args], { encoding: 'utf8', windowsHide: true }).trim();
const psql = sql => compose('exec', '-T', 'postgres', 'psql', '-U', 'builder', '-d', 'builder', '-v', 'ON_ERROR_STOP=1', '-Atc', sql);
const sqlString = value => `'${value.replaceAll("'", "''")}'`;
const runId = randomUUID(); const requestId = randomUUID(); const sourceKey = `retention-probe-${randomUUID()}`;
let created = false;
let result;
try {
  const snapshotId = psql('SELECT id FROM snapshots LIMIT 1');
  assert.match(snapshotId, /^[0-9a-f-]{36}$/i, 'SNAPSHOT_REQUIRED_FOR_RETENTION_PROBE');
  const snapshot = sqlString(snapshotId); const run = sqlString(runId); const request = sqlString(requestId);
  psql(`INSERT INTO runs(id,snapshot_id,client_request_id,input_digest,record,created_at) VALUES(${run},${snapshot},${request},${sqlString('a'.repeat(64))},'{"status":"succeeded"}'::jsonb,now()-interval '91 days')`);
  created = true;
  psql(`INSERT INTO run_events(run_id,source,source_key,type,data,created_at) VALUES(${run},'runtime',${sqlString(sourceKey)},'runtime.retention_probe','{}',now()-interval '91 days')`);
  const invoke = `import pg from 'pg';import{RunEventRetention}from'/app/dist/apps/server/src/runs/event-retention.js';const p=new pg.Pool({connectionString:process.env.DATABASE_URL});try{console.log(JSON.stringify(await RunEventRetention.fromEnvironment(p).prune(new Date())))}finally{await p.end()}`;
  const cleanupResult = JSON.parse(compose('exec', '-T', 'app', 'node', '--input-type=module', '-e', invoke));
  const observed = JSON.parse(psql(`SELECT json_build_object('expiredSentinelCount',count(*) FILTER(WHERE source_key=${sqlString(sourceKey)}),'markerCount',count(*) FILTER(WHERE type='run.event_history_pruned'),'markerData',(SELECT data FROM run_events WHERE run_id=${run} AND type='run.event_history_pruned' ORDER BY seq DESC LIMIT 1)) FROM run_events WHERE run_id=${run}`));
  assert.equal(observed.expiredSentinelCount, 0, 'EXPIRED_EVENT_NOT_REMOVED');
  assert.equal(observed.markerCount, 1, 'RETENTION_GAP_MARKER_MISSING');
  assert.equal(Number(observed.markerData.removedCount), 1, 'RETENTION_REMOVED_COUNT_MISMATCH');
  assert.ok(Number(observed.markerData.throughSeq) > 0, 'RETENTION_WATERMARK_MISSING');
  const images = compose('ps', '-q', 'app', 'runner').split(/\r?\n/).filter(Boolean);
  assert.equal(images.length, 2, 'FIXED_APP_RUNNER_TARGET_REQUIRED');
  const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...images], { encoding: 'utf8' }).trim().split(/\r?\n/);
  result = { schemaVersion: 1, requirement: 'TD-15/NF-04 expired terminal Run event cleanup with gap marker', executionMode: 'isolated-live-docker', measuredAt: new Date().toISOString(),
    composeProject: project, baseUrl: base, retentionDays, cutoff: cleanupResult.cutoff, cleanupResult, probeRunId: runId, observed, targetImageIds, verdict: 'passed' };
} finally {
  if (created) {
    const run = sqlString(runId);
    psql(`BEGIN; SELECT set_config('agent_builder.allow_run_event_retention','on',true); DELETE FROM run_events WHERE run_id=${run}; DELETE FROM runs WHERE id=${run}; COMMIT`);
  }
}
await mkdir('docs/implementation/evidence', { recursive: true });
await writeFile('docs/implementation/evidence/TD15-NF04-event-retention-live.json', JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(result) + '\n');
