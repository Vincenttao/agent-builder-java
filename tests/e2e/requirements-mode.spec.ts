import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

test('AC-02 guided and form modes keep one requirement state', async ({ page }) => {
  const token = process.env.LOCAL_BOOTSTRAP_TOKEN;
  if (!token) throw new Error('LOCAL_BOOTSTRAP_TOKEN required for browser acceptance');
  const base = process.env.APP_ORIGIN ?? 'http://127.0.0.1:8080';
  await page.goto('/');
  await page.getByLabel('本地访问令牌').fill(token);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByRole('heading', { name: '需求工作台' })).toBeVisible();

  await page.getByRole('button', { name: '新建草稿' }).click();
  const name = `AC02-mode-${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Agent 名称').fill(name);
  await page.getByRole('button', { name: '引导填写' }).click();
  await page.getByRole('textbox', { name: '目标使用者' }).fill('银行 AI 平台开发人员');
  await page.getByRole('checkbox', { name: '确认目标使用者' }).check();
  await page.getByRole('textbox', { name: '业务目标' }).fill('查询模拟账户余额，不执行交易');
  await page.getByRole('button', { name: '表单', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '目标使用者' })).toHaveValue('银行 AI 平台开发人员');
  await expect(page.getByRole('checkbox', { name: '确认目标使用者' })).toBeChecked();
  await expect(page.getByRole('textbox', { name: '业务目标' })).toHaveValue('查询模拟账户余额，不执行交易');

  await page.getByRole('textbox', { name: '业务目标' }).fill('查询模拟账户余额和币种，不执行交易');
  await page.getByRole('button', { name: '引导填写' }).click();
  await expect(page.getByRole('textbox', { name: '业务目标' })).toHaveValue('查询模拟账户余额和币种，不执行交易');
  await expect(page.getByRole('checkbox', { name: '确认业务目标' })).not.toBeChecked();
  await page.getByRole('textbox', { name: '交付内容' }).fill('账户余额、币种和查询时间');
  const formToGuidedValue = await page.getByRole('textbox', { name: '交付内容' }).inputValue();
  await page.getByRole('button', { name: '引导填写' }).click();
  await expect(page.getByRole('textbox', { name: '交付内容' })).toHaveValue(formToGuidedValue);
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('已保存 · 修订 1', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('combobox', { name: '选择项目' }).selectOption({ label: `${name} · r1` });
  await expect(page.getByRole('textbox', { name: '目标使用者' })).toHaveValue('银行 AI 平台开发人员');
  await expect(page.getByRole('textbox', { name: '业务目标' })).toHaveValue('查询模拟账户余额和币种，不执行交易');
  await expect(page.getByRole('textbox', { name: '交付内容' })).toHaveValue('账户余额、币种和查询时间');
  await expect(page.getByRole('checkbox', { name: '确认目标使用者' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '确认业务目标' })).not.toBeChecked();

  const project = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
  const containers = execFileSync('docker', ['compose', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  expect(containers).toHaveLength(2);
  const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
  const evidence = { schemaVersion: 1, requirement: 'TD-15/AC-02 Requirement fields and confirmation state survive guided/form switches and reload',
    executionMode: 'live-browser-isolated-docker', measuredAt: new Date().toISOString(), base, composeProject: project, draftName: name,
    assertions: { guidedToFormPreservedValues: true, guidedToFormPreservedConfirmation: true, formToGuidedPreservedEdits: true,
      editedFieldConfirmationReset: true, savedDraftSurvivedReload: true }, targetImageIds, verdict: 'passed' };
  await mkdir('docs/implementation/evidence', { recursive: true });
  await writeFile('docs/implementation/evidence/TD15-AC02-mode-switch.json', JSON.stringify(evidence, null, 2) + '\n');
});

test('AC-03 changing a read-only goal to work-order creation exposes confirmation and missing-resource requirements', async ({ page }) => {
  const token = process.env.LOCAL_BOOTSTRAP_TOKEN;
  if (!token) throw new Error('LOCAL_BOOTSTRAP_TOKEN required for browser acceptance');
  await page.goto('/');
  await page.getByLabel('本地访问令牌').fill(token);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await page.getByRole('button', { name: '新建草稿' }).click();
  await page.getByLabel('Agent 名称').fill(`AC03-impact-${randomUUID().slice(0, 8)}`);
  await page.getByRole('textbox', { name: '目标使用者' }).fill('设备维护人员');
  await page.getByRole('textbox', { name: '业务目标' }).fill('只查询设备状态，不进行写操作');
  await page.getByRole('textbox', { name: '交付内容' }).fill('设备状态、温度和查询时间');
  await page.getByRole('button', { name: '引导填写' }).click();
  await page.getByRole('textbox', { name: '业务目标' }).fill('查询设备状态，并允许创建维修工单');
  const impact = page.getByRole('region', { name: '需求影响提示' });
  await expect(impact).toContainText('执行前需要用户确认');
  await expect(impact).toContainText('工单写入接口');
  await expect(page.getByRole('textbox', { name: '目标使用者' })).toHaveValue('设备维护人员');
  await expect(page.getByRole('textbox', { name: '交付内容' })).toHaveValue('设备状态、温度和查询时间');
  await page.getByRole('button', { name: '表单', exact: true }).click();
  await expect(page.getByRole('region', { name: '需求影响提示' })).toContainText('执行前需要用户确认');
  const project = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
  const containers = execFileSync('docker', ['compose', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  expect(containers).toHaveLength(2);
  const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
  const evidence = { schemaVersion: 1, requirement: 'TD-15/AC-03 Write intent adds confirmation and resource requirements while retaining unrelated requirement fields',
    executionMode: 'live-browser-isolated-docker', measuredAt: new Date().toISOString(), base: process.env.APP_ORIGIN, composeProject: project,
    targetImageIds, assertions: { confirmationRequirementShown: true, missingWriteInterfaceShown: true, audienceRetained: true, outputRetained: true, hintSurvivedFormSwitch: true },
    verdict: 'passed', branches: ['write-confirmation-added', 'resource-gap', 'unrelated-fields-retained'].map(branchId => ({ caseId: 'AC-03', branchId, status: 'passed' })) };
  await mkdir('docs/implementation/evidence', { recursive: true });
  await writeFile('docs/implementation/evidence/TD15-AC03-requirement-impact.json', JSON.stringify(evidence, null, 2) + '\n');
});
