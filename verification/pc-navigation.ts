import type {Page} from '@playwright/test';
/** Click through the visible hierarchy; no hidden compatibility controls. */
export async function navigate(page:Page,name:string){
 const names:Record<string,string>={'业务配置':'应用设置','处理流程':'编排','工程概览':'概览','版本与导出':'版本与发布'};const target=names[name]??name;
 if(['应用设置','编排','文件与指令','Coding 助手'].includes(target))await page.getByRole('button',{name:'开发',exact:true}).click();
 if(target==='调试运行')await page.getByRole('button',{name:'测试',exact:true}).click();
 await page.locator('#workspace').getByRole('button',{name:target,exact:true}).click();
}
