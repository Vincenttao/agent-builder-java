import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
test('审阅基线并执行项目验收，刷新后仍可查看逐项证据', async ({ page }) => {
  test.skip(process.env.RUN_LIVE_E2E !== '1', 'Opt-in live model validation'); test.setTimeout(300000);
  await page.goto('/'); await page.getByLabel('本地访问令牌').fill(process.env.LOCAL_BOOTSTRAP_TOKEN!);
  await page.getByRole('button', { name: '进入工作台' }).click(); await page.getByRole('button', { name: '新建草稿' }).click();
  const name = `独立验收-${Date.now()}`; await page.getByLabel('Agent 名称').fill(name);
  for (const [label, value] of [['目标使用者','设备运维人员'],['业务目标','查询设备事实并提供运维建议'],['交付内容','结构化设备报告、缺参追问、工具失败说明']]) {
    await page.getByRole('textbox', { name: label!, exact: true }).fill(value!); await page.getByLabel(`确认${label}`, { exact: true }).check();
  }
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('baseline-review')).toContainText('TC-003', { timeout: 5000 });
  await expect(page.getByRole('button', { name: '确认验收基线', exact: true })).toBeDisabled();
  await page.getByLabel('我已审阅需求、测试场景和预期结果').check();
  await page.getByRole('button', { name: '确认验收基线', exact: true }).click();
  await expect(page.getByTestId('baseline-review')).toContainText('基线已确认');
  await page.getByRole('button', { name: '固定为测试版本' }).click();
  await page.getByRole('button', { name: '运行验收用例', exact: true }).click();
  await expect(page.getByTestId('validation-id')).toBeVisible();
  const id = (await page.getByTestId('validation-id').innerText()).replace('验证任务 ', '');
  await page.reload(); await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByTestId('validation-status')).toHaveText('通过', { timeout: 240000 });
  const report = await (await page.request.get(`/api/validations/${id}/report`)).json();
  expect(report.cases).toHaveLength(3); expect(report.cases.every((c: { status: string }) => c.status === 'passed')).toBe(true);
  expect(report.binding.modelProfile.executionMode).toBe('live-mock');
  const evidence = await Promise.all(report.cases.map(async (c: { evidenceId: string }) => (await page.request.get(`/api/validations/${id}/evidence/${c.evidenceId}`)).json()));
  await writeFile('test-results/project-validation-live.json', JSON.stringify({ report, evidence }, null, 2));
  await page.getByText('TC-001 · 通过', { exact: true }).click();
  await page.getByRole('button', { name: '查看证据 TC-001', exact: true }).click();
  await expect(page.getByTestId('validation-evidence')).toContainText('PUMP-001');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/project-validation-mobile.png', fullPage: true });
});
