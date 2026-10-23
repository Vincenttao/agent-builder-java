import { readFile, mkdir, writeFile, realpath, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { evaluateAcceptance, type AcceptanceCase, type Binding, type BranchResult } from '../apps/server/src/acceptance/application/acceptance-gate.js';

const args = process.argv.slice(2);
const option = (key: string) => args[args.indexOf(key) + 1];
const phase = args.includes('--phase') ? option('--phase') : 'P0-A';
if (!['P0-A', 'P0-B', 'P0-C'].includes(phase ?? '')) throw new Error('Use --phase P0-A, P0-B or P0-C');
const manifestBytes = await readFile('tests/acceptance/manifest.json');
const manifest = JSON.parse(manifestBytes.toString()) as { baselineDigest: string; cases: AcceptanceCase[] };
const input = args.includes('--report') ? JSON.parse(await readFile(option('--report')!, 'utf8')) as { binding: Binding; results: BranchResult[] } : null;
// Expected identity comes from the executor's frozen target, never from the report under review.
const target = args.includes('--target') ? JSON.parse(await readFile(option('--target')!, 'utf8')) as { artifactPath: string; artifactDigest: string; compatibilityKey: string } : null;
if (input && !target) throw new Error('--report requires an independent --target');
if (target && createHash('sha256').update(await readFile(target.artifactPath)).digest('hex') !== target.artifactDigest) throw new Error('Target artifact has changed');
const binding: Binding = { baselineDigest: manifest.baselineDigest, artifactDigest: target?.artifactDigest ?? '',
  testSetDigest: createHash('sha256').update(manifestBytes).digest('hex'), compatibilityKey: target?.compatibilityKey ?? '' };
const phaseCases = manifest.cases.filter(c => c.phase <= phase!);
const phaseCaseIds = new Set(phaseCases.map(item => item.caseId));
const phaseResults = input?.results.filter(item => phaseCaseIds.has(item.caseId)) ?? [];
for (const item of manifest.cases) {
  if (item.testFile) await access(item.testFile).catch(() => { item.testFile = null; });
}
const evidenceRoot = await realpath('test-results');
const report = await evaluateAcceptance(phaseCases, phaseResults, binding, async path => {
  const file = await realpath(resolve(evidenceRoot, path));
  const rel = relative(evidenceRoot, file);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Evidence outside managed storage');
  return readFile(file);
});
await mkdir('test-results/acceptance', { recursive: true });
const file = join('test-results/acceptance', `${phase}-${Date.now()}.json`);
await writeFile(file, JSON.stringify({ phase, binding, ...report }, null, 2) + '\n');
console.log(`${phase}: ${report.status}; ${manifest.cases.filter(c => c.phase <= phase!).length} required items; report=${file}`);
process.exitCode = report.status === 'passed' ? 0 : 1;
