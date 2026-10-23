import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const manifestPath = 'tests/acceptance/manifest.json';
const outputPath = 'tests/acceptance/p0-a-coverage-map.json';
const candidates = {
  'AC-01': ['tests/integration/drafts.test.ts', 'tests/integration/runs.test.ts', 'tests/e2e/draft-flow.spec.ts', 'scripts/verify-td15-ac01-no-model.mjs'],
  'AC-02': ['tests/integration/drafts.test.ts', 'tests/e2e/draft-flow.spec.ts', 'tests/e2e/requirements-mode.spec.ts'],
  'AC-03': ['tests/integration/drafts.test.ts', 'tests/e2e/draft-flow.spec.ts'],
  'AC-04': ['tests/integration/snapshots.test.ts', 'apps/web/src/assembly-editor.test.ts', 'tests/e2e/assembly-ui.spec.ts', 'scripts/verify-td15-ac04-invalid-assembly.mjs'],
  'AC-05': ['tests/adapters/platform-runtime.test.ts', 'tests/e2e/assembly-ui.spec.ts', 'scripts/verify-td15-ac05-two-rails-live.mjs'],
  'AC-06': ['tests/integration/snapshots.test.ts', 'apps/web/src/assembly-editor.test.ts', 'scripts/verify-td15-ac06-incompatible-assembly.mjs'],
  'AC-07': ['tests/contract/runner-api.test.ts', 'tests/contract/engineering-mcp.test.ts', 'tests/adapters/platform-runtime.test.ts', 'scripts/verify-td15-ac07-http-mcp.mjs'],
  'AC-08': ['tests/adapters/platform-runtime.test.ts', 'tests/integration/validations.test.ts', 'scripts/verify-td15-nf01-validation-branches.mjs'],
  'AC-09': ['tests/integration/validations.test.ts', 'tests/e2e/workorder-validation-flow.spec.ts', 'scripts/verify-td15-nf01-validation-branches.mjs'],
  'AC-10': ['tests/adapters/workorder-validation.test.ts', 'tests/e2e/workorder-validation-flow.spec.ts', 'scripts/verify-td15-nf01-validation-branches.mjs'],
  'AC-11': ['tests/integration/actions.test.ts', 'tests/adapters/platform-approval.test.ts', 'tests/e2e/approval-flow.spec.ts', 'scripts/verify-td15-ac11-live.mjs'],
  'AC-12': ['tests/integration/actions.test.ts', 'tests/adapters/workorder-validation.test.ts', 'tests/e2e/workorder-validation-flow.spec.ts', 'scripts/verify-td15-nf01-validation-branches.mjs'],
  'AC-13': ['tests/integration/runs.test.ts', 'tests/e2e/debug-run.spec.ts', 'scripts/verify-td15-nf01-sse-reconnect.mjs'],
  'AC-14': ['tests/integration/snapshots.test.ts', 'tests/integration/test-deployments.test.ts', 'tests/e2e/snapshot-flow.spec.ts', 'scripts/verify-td15-ac14-live.mjs'],
  'AC-15': ['tests/integration/releases.test.ts', 'apps/server/src/releases/project-release-gate.test.ts'],
  'AC-16': ['tests/integration/releases.test.ts', 'apps/server/src/releases/project-release-gate.test.ts', 'scripts/verify-td15-ac16-rollback-evidence.mjs'],
  'AC-17': ['tests/integration/shared-runs.test.ts', 'tests/adapters/platform-runtime.test.ts', 'scripts/verify-td15-nf01-two-sessions.mjs'],
  'AC-18': ['tests/contract/project-export.test.ts', 'tests/integration/project-imports.test.ts', 'tests/e2e/project-package-ui.spec.ts', 'scripts/verify-td15-nf05-workspace.mjs'],
  'AC-19': ['tests/integration/actions.test.ts', 'tests/integration/runs.test.ts', 'tests/adapters/platform-approval.test.ts'],
  'AC-20': ['apps/server/src/releases/project-release-gate.test.ts', 'tests/integration/releases.test.ts'],
  'AC-42a': ['tests/contract/runner-api.test.ts', 'tests/integration/invocations.test.ts', 'tests/adapters/platform-runtime.test.ts', 'scripts/verify-td15-ac42a-live.mjs'],
  'EQ-01': ['tests/integration/mock-services.test.ts', 'apps/server/src/snapshots/domain/assembly.test.ts', 'scripts/verify-td15-eq01-empty-retrieval-live.mjs'],
  'EQ-02': ['tests/integration/mock-services.test.ts', 'tests/adapters/workorder-validation.test.ts', 'scripts/verify-td15-nf01-validation-branches.mjs'],
  'EQ-03': ['tests/integration/actions.test.ts', 'tests/adapters/workorder-validation.test.ts', 'scripts/verify-td15-nf01-validation-branches.mjs'],
  'NF-01': ['tests/integration/run-leases.test.ts', 'tests/integration/shared-runs.test.ts', 'tests/integration/runs.test.ts', 'tests/adapters/deployment-recovery.test.ts', 'scripts/verify-td15-nf01-active-write-restart.mjs', 'scripts/verify-td15-nf01-restart-snapshot-events.mjs', 'scripts/verify-td15-nf01-two-sessions.mjs', 'scripts/verify-td15-nf01-sse-reconnect.mjs'],
  'NF-02': ['tests/contract/project-export.test.ts', 'tests/integration/project-imports.test.ts'],
  'NF-03': ['scripts/benchmark-td15-nf03.mjs'],
  'NF-04': ['tests/integration/runs.test.ts', 'scripts/verify-td15-nf04-budget.mjs', 'scripts/verify-td15-nf04-errors.mjs', 'scripts/verify-td15-nf04-live-iterations.mjs', 'scripts/verify-td15-nf04-event-retention-live.mjs'],
  'NF-05': ['tests/integration/project-imports.test.ts', 'tests/e2e/project-package-ui.spec.ts', 'scripts/init-local.mjs']
};

const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes.toString());
const cases = manifest.cases.filter(item => item.phase === 'P0-A');
const expectedIds = cases.map(item => item.caseId).sort();
if (JSON.stringify(expectedIds) !== JSON.stringify(Object.keys(candidates).sort())) {
  throw new Error('P0A_COVERAGE_MAP_CASES_OUT_OF_SYNC');
}

for (const [caseId, files] of Object.entries(candidates)) {
  if (new Set(files).size !== files.length) throw new Error(`DUPLICATE_CANDIDATE_TEST:${caseId}`);
  for (const file of files) await access(resolve(file));
}

const map = {
  schemaVersion: 1,
  baselineDigest: manifest.baselineDigest,
  manifestSha256: (await import('node:crypto')).createHash('sha256').update(manifestBytes).digest('hex'),
  evidenceBoundary: 'Candidate test references guide implementation and test planning. They are not branch execution evidence and cannot satisfy the live-mock acceptance gate.',
  cases: cases.map(item => ({
    caseId: item.caseId,
    title: item.title,
    branches: item.branches.map(branch => ({
      branchId: branch.id,
      candidateTestReferences: candidates[item.caseId],
      acceptanceStatus: 'unverified',
      missingEvidence: ['fixed-target live-mock execution record', 'branch-specific assertions', 'managed evidence files']
    }))
  }))
};

const serialized = `${JSON.stringify(map, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const existing = await readFile(outputPath, 'utf8');
  if (existing !== serialized) throw new Error('P0A_COVERAGE_MAP_STALE');
  process.stdout.write(`P0-A coverage map: ${map.cases.length} items, ${map.cases.reduce((n, item) => n + item.branches.length, 0)} branches; candidate references verified, acceptance remains unverified.\n`);
} else {
  await writeFile(outputPath, serialized);
  process.stdout.write(`Wrote ${outputPath}; no acceptance status was promoted.\n`);
}
