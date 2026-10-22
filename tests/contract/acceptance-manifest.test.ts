import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import type { AcceptanceCase } from '../../apps/server/src/acceptance/application/acceptance-gate.js';

it('keeps the complete cumulative acceptance set and references in sync with the PRD', async () => {
  const manifest = JSON.parse(await readFile('tests/acceptance/manifest.json', 'utf8')) as { baselineDigest: string; cases: AcceptanceCase[] };
  const prd = await readFile('docs/NL2Agent_需求文档_v0.1.md', 'utf8');
  const baseline = await readFile('docs/NL2Agent_测试与验收基线_v0.1.md', 'utf8');
  const scenarios = await readFile('docs/NL2Agent_企业模拟环境_v0.1.md', 'utf8');
  expect(manifest.baselineDigest).toBe(createHash('sha256').update(prd.replaceAll('\r\n', '\n')).update(baseline.replaceAll('\r\n', '\n')).digest('hex'));
  expect(manifest.cases).toHaveLength(88);
  expect(new Set(manifest.cases.map(c => c.caseId)).size).toBe(88);
  expect(manifest.cases.filter(c => c.phase <= 'P0-A')).toHaveLength(29);
  expect(manifest.cases.filter(c => c.phase <= 'P0-B')).toHaveLength(63);
  expect(manifest.cases.filter(c => c.caseId.startsWith('AC-'))).toHaveLength(56);
  for (const item of manifest.cases) {
    expect(item.branches.length).toBeGreaterThan(0);
    expect(new Set(item.branches.map(b => b.id)).size).toBe(item.branches.length);
    for (const requirement of item.requirementIds) expect(prd + baseline + scenarios).toContain(requirement);
    if (item.testFile) await access(item.testFile);
  }
});
