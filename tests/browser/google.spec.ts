import {test,expect} from '@playwright/test';
import {singleImportFixture} from '../helpers/single-import.js';
import {csvTeacher} from '../helpers/csv-browser.js';
test('服務帳戶設定：沒有個人Google授權入口，未配置不影響老師登入，沒有其他匯入方式',async({context})=>{
 const f=await singleImportFixture(false,true);try{const a=await context.newPage(),b=await context.newPage();for(const p of [a,b]){await csvTeacher(p,f);await expect(p.getByLabel('學習單存取設定',{exact:true}).getByText(/服務帳戶尚未配置/)).toBeVisible();await expect(p.getByRole('button',{name:'連結 Google',exact:true})).toHaveCount(0);await expect(p.getByRole('link',{name:/前往 Google 授權/})).toHaveCount(0);await expect(p.getByLabel('匯入方式',{exact:true})).toHaveCount(0);}
 await a.getByRole('button',{name:'登出',exact:true}).click();await expect(b.getByRole('heading',{name:'老師已登入',exact:true})).toBeVisible();
 }finally{await f.close();}
});
