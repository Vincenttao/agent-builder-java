import {test,expect} from '@playwright/test';
test('local debug opens workbench and sample without a token',async({page})=>{
  test.skip(process.env.LOCAL_DEBUG_AUTH!=='true','Requires a local debug server');
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'需求工作台',exact:true})).toBeVisible();
  await expect(page.getByText('本地调试模式',{exact:true})).toBeVisible();
  await expect(page.getByLabel('本地访问令牌')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'退出',exact:true})).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading',{name:'需求工作台',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'体验预构建样例',exact:true}).click();
  await expect(page.getByRole('tab')).toHaveCount(4);
  await expect(page.getByLabel('本地访问令牌')).toHaveCount(0);
});
