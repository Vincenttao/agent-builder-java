import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { draftInput } from '../support/fixtures.js';
import { assemble } from '../../apps/server/src/snapshots/domain/assembly.js';
import { equipmentBaseline } from '../../apps/server/src/acceptance/application/equipment-baseline.js';
import type { AssemblyInput } from '../../packages/contracts/src/index.js';

test('catalog selections submit executable assembly and distinguish generated skills (API fixtures)', async ({ page }) => {
  const now = new Date().toISOString();
  const draft = { ...draftInput, name: '组件装配演示', id: randomUUID(), revision: 1, createdAt: now, updatedAt: now,
    brief: { ...draftInput.brief, output: { value: '设备报告与维修工单', source: 'user' as const, confirmed: true } } };
  let submitted: AssemblyInput | undefined;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); const path = url.pathname;
    let body: unknown = { items: [] };
    if (path === '/api/auth/session') body = { csrfToken: 'fixture' };
    else if (path === '/api/environment') body = { database: 'ready', model: 'configured_unverified', runtime: 'ready', canRun: true };
    else if (path === '/api/drafts') body = { items: [draft] };
    else if (path.includes('baseline-preview')) body = { content: equipmentBaseline(draft, url.searchParams.get('templateId') === 'equipment-workorder@1' ? 'equipment-workorder@1' : 'equipment-read@1'), digest: 'a'.repeat(64) };
    else if (path.endsWith('/releases')) body = { pointer: null, versions: [], operations: [], cleanupPending: [] };
    else if (path.endsWith('/snapshots') && route.request().method() === 'POST') {
      submitted = route.request().postDataJSON().assembly;
      const id = randomUUID();
      body = { id, draftId: draft.id, draftRevision: 1, digest: 'a'.repeat(64), createdAt: now,
        content: { draft, assembly: submitted, runtimeSpec: assemble(id, submitted!), executionMode: 'trusted-local' } };
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/');
  await page.getByRole('combobox', { name: '选择项目' }).selectOption({ label: `${draft.name} · r1` });
  await page.getByRole('tab', { name: /环境与装配/ }).click();
  const library = page.getByRole('region', { name: '组件目录' });
  await expect(library.getByRole('heading', { name: '设备查询 Skill' })).toBeVisible();
  await expect(library.getByText('需自动开发', { exact: true })).toBeVisible();
  await library.getByRole('button', { name: 'Rail', exact: true }).click();
  await expect(library.locator('article')).toHaveCount(4);
  await library.getByRole('button', { name: '全部', exact: true }).click();
  await page.getByLabel('装配维修工单', { exact: true }).check();
  await expect(page.getByLabel('能力模板')).toHaveValue('equipment-workorder');
  await expect(page.getByLabel('Agent 指令')).toHaveValue(/create_work_order/);
  const summary = page.getByRole('complementary', { name: '装配预览' });
  await expect(summary).toContainText('写入确认');
  await expect(summary).toContainText('模板未绑定');
  await page.getByLabel('Agent 指令').fill('使用工具查询设备，按用户意图申请工单。');
  await page.getByLabel('装配维修工单', { exact: true }).uncheck();
  await expect(summary).not.toContainText('写入确认');
  await expect(page.getByLabel('Agent 指令')).toHaveValue('使用工具查询设备，按用户意图申请工单。');
  await page.getByLabel('装配维修工单', { exact: true }).check();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await library.screenshot({ path: 'test-results/assembly-catalog-desktop.png' });
  const baseline = page.getByTestId('baseline-review');
  await baseline.getByRole('checkbox').check();
  await baseline.getByRole('button', { name: '确认验收基线' }).click();
  await expect(baseline.getByRole('status')).toHaveText('基线已确认');
  await page.getByRole('button', { name: /固定为测试版本/ }).click();
  await expect(page.getByTestId('snapshot-card')).toHaveCount(1);
  expect(submitted?.toolIds).toEqual(['equipment-status@1', 'work-order-create@1']);
  expect(submitted?.railIds).toContain('write-confirm@1');
  await page.getByText('查看固定定义', { exact: true }).click();
  await expect(page.getByTestId('snapshot-card').locator('pre').first()).toContainText('write-confirm@1');
  await page.getByRole('tab', { name: /环境与装配/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(library.getByRole('heading', { name: '设备查询 Skill' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await library.screenshot({ path: 'test-results/assembly-catalog-mobile.png' });
});
