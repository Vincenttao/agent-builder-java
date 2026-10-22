import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
test('固定版本调试：实际模型与 Java 工具调用、证据、刷新恢复', async ({ page }) => {
  test.skip(process.env.RUN_LIVE_E2E !== '1', 'Opt-in real model integration; never counted as deterministic regression');
  test.setTimeout(180000);
  await page.goto('/'); await page.getByLabel('本地访问令牌').fill(process.env.LOCAL_BOOTSTRAP_TOKEN!);
  await page.getByRole('button', { name: '进入工作台' }).click(); await page.getByRole('button', { name: '新建草稿' }).click();
  const name = `设备运行-${Date.now()}`; await page.getByLabel('Agent 名称').fill(name);
  for (const [label, value] of [['目标使用者', '设备运维人员'], ['业务目标', '查询 PUMP-001 状态'], ['交付内容', '状态、温度、来源']]) {
    await page.getByRole('textbox', { name: label!, exact: true }).fill(value!); await page.getByLabel(`确认${label}`, { exact: true }).check();
  }
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByRole('button', { name: '固定为测试版本' }).click();
  await page.getByRole('button', { name: '运行此版本' }).click({ timeout: 5000 });
  await expect(page.getByTestId('run-status')).toHaveText('已完成', { timeout: 150000 });
  await expect(page.getByTestId('run-answer')).toContainText('86');
  await page.getByText('查看外部调用证据').click(); await expect(page.getByTestId('external-evidence')).toContainText('equipment-status');
  const runId = await page.getByTestId('run-id').textContent();
  const id = runId!.replace(/^Run /, '');
  const record = await (await page.request.get(`/api/runs/${id}`)).json();
  const events = await (await page.request.get(`/api/runs/${id}/events`)).json();
  await writeFile('test-results/debug-run-live.json', JSON.stringify({ run: record, events }, null, 2));
  await page.reload(); await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByTestId('run-status')).toHaveText('已完成'); await expect(page.getByTestId('run-id')).toHaveText(runId!);
  await expect(page.getByTestId('run-answer')).toContainText('86');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/debug-run-mobile.png', fullPage: true });
});
