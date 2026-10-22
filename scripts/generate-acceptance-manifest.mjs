import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Explicit phase/branch choices supplement the authoritative Markdown tables.
// No result is generated here. New entries remain unimplemented until wired to a test.
const prd = await readFile('docs/NL2Agent_需求文档_v0.1.md', 'utf8');
const baseline = await readFile('docs/NL2Agent_测试与验收基线_v0.1.md', 'utf8');
const split = { 22: 'abcd', 29: 'ab', 33: 'ab', 36: 'ab', 38: 'ab', 39: 'ab', 40: 'ab', 41: 'abc', 42: 'abcd' };
const c = new Set(['AC-22c', 'AC-22d', 'AC-29b', 'AC-33b', 'AC-34', 'AC-35', 'AC-36b', 'AC-37', 'AC-40b', 'AC-42d']);
const branches = {
  'AC-01': ['save-without-model', 'run-blocked'], 'AC-02': ['guided-to-form', 'form-to-guided'],
  'AC-03': ['write-confirmation-added', 'resource-gap', 'unrelated-fields-retained'],
  'AC-04': ['unknown-tool', 'invalid-rail-parameter', 'invalid-change-not-applied'],
  'AC-05': ['two-rails-loaded', 'two-rails-triggered'], 'AC-06': ['conflicting-rails', 'unsupported-agent'],
  'AC-07': ['http-tool', 'mcp-tool'], 'AC-08': ['facts', 'recommendations', 'sources', 'output-schema'],
  'AC-09': ['clarification', 'zero-tool-calls'], 'AC-10': ['refuse-zero-writes', 'cancel-preserves-analysis'],
  'AC-11': ['sequential-duplicate', 'concurrent-duplicate'], 'AC-12': ['write-response-lost', 'reconcile-no-replay'],
  'AC-13': ['refresh', 'sse-reconnect', 'duplicate-events'], 'AC-14': ['old-run-pinned', 'new-snapshot', 'old-test-invalid'],
  'AC-15': ['startup-failure-keeps-release'], 'AC-16': ['new-request-rolled-back', 'history-unchanged'],
  'AC-17': ['interleaved-sessions'], 'AC-18': ['export-no-secrets', 'fresh-directory-import', 'rebind-required'],
  'AC-19': ['cancel-accepted-before-terminal', 'unknown-write-reconciled'], 'AC-20': ['simulation-not-publishable'],
  'AC-21': ['independent-role-records', 'shared-confirmed-baseline'],
  'AC-22a': ['empty-tool-source', 'build', 'actual-http-mapping'], 'AC-22b': ['empty-skill-source', 'loaded', 'model-trigger'],
  'AC-22c': ['agent-source', 'build', 'real-task'], 'AC-22d': ['rail-source', 'loaded-hook', 'below-limit', 'at-limit', 'above-limit'],
  'AC-23': ['directory', 'dependency', 'command', 'connection'], 'AC-24': ['dev-copy-changed', 'tester-write-denied', 'digest-before', 'digest-after'],
  'AC-25': ['developer-deletes-case', 'tester-lowers-expectation'], 'AC-26': ['defect-observed', 'new-candidate', 'same-assertion', 'failure-history-retained'],
  'AC-27': ['regression-without-model'], 'AC-28': ['false-success-external-mismatch', 'environment-unavailable'],
  'AC-29a': ['budget', 'cancel-child-process', 'restart-no-replay', 'history-retained'], 'AC-29b': ['cancel-unknown-write', 'restart-reconcile'],
  'AC-30': ['same-seed', 'independent-instances', 'active-run-reset-denied', 'unknown-write-reset-denied', 'history-after-reset'],
  'AC-31': ['generate-empty-assets', 'load-and-query'], 'AC-32': ['app-balance', 'app-products', 'request-run-version'],
  'AC-33a': ['cross-account', 'cross-identity-request'], 'AC-33b': ['cross-identity-approval'],
  'AC-34': ['not-confirmed', 'refused', 'approved', 'duplicate-approval'], 'AC-35': ['committed-response-lost', 'original-key-reconciliation'],
  'AC-36a': ['duplicate-read', 'refresh', 'same-id-different-input', 'retry-after-release-switch'], 'AC-36b': ['duplicate-purchase', 'duplicate-confirm', 'refresh'],
  'AC-37': ['below-limit', 'at-limit', 'above-limit-zero-write'], 'AC-38a': ['contract-change', 'old-report-invalid', 'repair-and-retest'],
  'AC-38b': ['seed-change', 'fault-change', 'old-report-retained'], 'AC-39a': ['compatible-independent-instance', 'readiness', 'readonly-smoke', 'switch-after-ready'],
  'AC-39b': ['service-change', 'connection-change', 'policy-change', 'uncovered-seed'],
  'AC-40a': ['tool-skill-export', 'no-credentials', 'digest', 'fresh-import-rebind', 'reverify'],
  'AC-40b': ['four-asset-types', 'purchase', 'low-balance-seed', 'fault-profile', 'import-reverify'],
  'AC-41a': ['first-candidate-no-release', 'actual-artifact', 'release-pointer-unchanged'],
  'AC-41b': ['parallel-v1-v2', 'actual-artifact-run-report'],
  'AC-41c': ['wrong-auth', 'expired-auth', 'cross-deployment-request', 'cross-deployment-session', 'not-ready', 'stopped', 'history-readable'],
  'AC-42a': ['trusted-local-visible', 'production-connection-denied'],
  'AC-42b': ['spoofed-identity', 'unregistered-operation', 'arbitrary-url', 'mock-admin', 'normal-read'],
  'AC-42c': ['generated-proxy-template', 'no-admin-credential', 'unauthenticated-mock-denied'],
  'AC-42d': ['not-confirmed', 'refused', 'expired', 'cross-run', 'changed-parameters', 'approved', 'duplicate'],
  'EQ-01': ['empty-retrieval'], 'EQ-02': ['tool-unavailable', 'read-timeout'], 'EQ-03': ['changed-parameters', 'expired'],
  'TC-002a': ['list', 'details'], 'TC-002b': ['initial-empty', 'after-purchase'], 'TC-004d': ['changed-parameters', 'expired', 'cross-run'],
  'TC-005a': ['duplicate-message', 'duplicate-approval', 'concurrent-approval'], 'TC-006a': ['100000', '200000'], 'TC-006b': ['200001', '300000'],
  'TC-007a': ['invalid-product', 'paused-product', 'negative', 'zero', 'fractional', 'below-minimum'],
  'TC-007f': ['cancel', 'restart'],
  'NF-01': ['two-sessions', 'refresh-reconnect', 'restart-snapshots-events', 'no-replay-unknown-reconcile'],
  'NF-02': ['sentinel-logs', 'sentinel-errors', 'sentinel-export'], 'NF-03': ['reference-workload', 'save-p95', 'list-p95', 'error-rate'],
  'NF-04': ['iteration-limit', 'timeout', 'error-classification', 'event-retention'],
  'NF-05': ['fresh-directory-start', 'export-import', 'configurable-ports', 'rebind'],
  'NF-06': ['runner-constraints', 'cancel', 'immutable-candidate-report', 'independent-environments', 'evaluation-records']
};
const entries = [];
function references(value) {
  let prefix;
  return value.split('、').map(part => {
    const match = part.match(/^(?:(FR|NFR)-)?(\d+)$/);
    if (!match) throw new Error(`Invalid requirement reference: ${part}`);
    prefix = match[1] ?? prefix;
    return `${prefix}-${match[2]}`;
  });
}
for (const line of prd.split('\n')) {
  const cells = line.split('|').map(v => v.trim());
  if (!/^AC-\d+$/.test(cells[1] ?? '')) continue;
  const n = Number(cells[1].slice(3));
  for (const suffix of split[n] ?? ['']) {
    const id = cells[1] + suffix;
    entries.push({ id, phase: n <= 20 || id === 'AC-42a' ? 'P0-A' : c.has(id) ? 'P0-C' : 'P0-B', requirements: references(cells[4]), title: cells[2] });
  }
}
for (const line of baseline.split('\n')) {
  const cells = line.split('|').map(v => v.trim());
  const id = cells[1] ?? '';
  if (/^EQ-\d+$/.test(id)) entries.push({ id, phase: 'P0-A', requirements: references(cells[4]), title: cells[2] });
  if (/^TC-\d+[a-z]$/.test(id)) entries.push({ id, phase: cells[2], requirements: [`BR-${id.slice(3, 6)}`], title: cells[3] });
  if (/^NF-\d+$/.test(id)) entries.push({ id, phase: cells[2], requirements: references(cells[3]), title: cells[4] });
}
const previous = await readFile('tests/acceptance/manifest.json', 'utf8').then(JSON.parse).catch(() => ({ cases: [] }));
const manifest = {
  schemaVersion: 1,
  baselineDigest: createHash('sha256').update(prd.replaceAll('\r\n', '\n')).update(baseline.replaceAll('\r\n', '\n')).digest('hex'),
  cases: entries.map(e => ({ caseId: e.id, phase: e.phase, title: e.title, requirementIds: e.requirements,
    testFile: previous.cases.find(p => p.caseId === e.id)?.testFile ?? null,
    executionMode: 'live-mock', branches: (branches[e.id] ?? ['scenario']).map(id => ({ id, evidenceKinds: ['assertions', 'execution-record'] })) }))
};
if (manifest.cases.length !== 88) throw new Error(`Expected 88 items, got ${manifest.cases.length}`);
await mkdir('tests/acceptance', { recursive: true });
await writeFile('tests/acceptance/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`Generated ${manifest.cases.length} planned acceptance items; no results generated.`);
