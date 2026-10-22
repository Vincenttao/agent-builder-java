import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

for (const decision of ['approve','reject'] as const) test(`工单确认 ${decision}：真实模型、刷新后决定、外部状态核验`, async ({ page }) => {
  test.skip(process.env.RUN_LIVE_E2E !== '1', 'Opt-in real model approval integration'); test.setTimeout(240000);
  await page.goto('/'); await page.getByLabel('本地访问令牌').fill(process.env.LOCAL_BOOTSTRAP_TOKEN!);
  await page.getByRole('button', { name: '进入工作台' }).click(); await page.getByRole('button', { name: '新建草稿' }).click();
  const name = `工单确认-${decision}-${Date.now()}`; await page.getByLabel('Agent 名称').fill(name);
  for (const [label, value] of [['目标使用者','设备运维人员'],['业务目标','查询 PUMP-001 并申请工单'],['交付内容','设备事实、经用户确认的模拟工单']]) {
    await page.getByRole('textbox', { name: label!, exact: true }).fill(value!); await page.getByLabel(`确认${label}`, { exact: true }).check();
  }
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByRole('combobox', { name: '能力模板', exact: true }).selectOption('equipment-workorder', { timeout: 5000 });
  await page.getByRole('button', { name: '固定为测试版本' }).click();
  await page.getByRole('button', { name: '运行此版本' }).click();
  await expect(page.getByTestId('run-status')).toHaveText('等待确认', { timeout: 150000 });
  const text = await page.getByTestId('run-id').textContent(); const id = text!.replace(/^Run /, '');
  const before = await (await page.request.get(`/api/runs/${id}`)).json();
  expect(before.externalEvidence.filter((c: { operation: string }) => c.operation === 'work-order-create')).toHaveLength(0);
  await page.reload(); await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByTestId('approval-card')).toContainText('PUMP-001');
  await page.getByRole('button', { name: decision === 'approve' ? '确认创建模拟工单' : '拒绝并取消运行', exact: true }).click();
  await expect(page.getByTestId('run-status')).toHaveText(decision === 'approve' ? '已完成' : '已取消', { timeout: 120000 });
  const record = await (await page.request.get(`/api/runs/${id}`)).json();
  const actions = await (await page.request.get(`/api/runs/${id}/actions`)).json();
  const events = await (await page.request.get(`/api/runs/${id}/events`)).json();
  expect(record.externalEvidence.filter((c: { operation: string }) => c.operation === 'work-order-create')).toHaveLength(decision === 'approve' ? 1 : 0);
  expect(record.externalEvidence.filter((c: { operation: string }) => c.operation === 'equipment-status')).toHaveLength(1);
  expect(actions.items).toHaveLength(1); expect(actions.items[0].status).toBe(decision === 'approve' ? 'succeeded' : 'rejected');
  await writeFile(`test-results/approval-${decision}-live.json`, JSON.stringify({ modelMode: 'live-deepseek', run: record, actions: actions.items, events: events.items }, null, 2));
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/approval-${decision}-mobile.png`, fullPage: true });
});
