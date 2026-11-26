import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';

// 獨立測試設定檔；直接啟動原生 Chrome，避免 automation 預設強制各 target 可見。
export async function nativeChrome(profile:string,headed:boolean){
  const executable=process.env.CRS_CHROME_EXECUTABLE??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const child=spawn(executable,[`--user-data-dir=${profile}`,'--remote-debugging-port=0','--no-first-run','--no-default-browser-check',...(!headed?['--headless=new']:[]),'about:blank'],{stdio:'ignore'});
  let spawnError:Error|undefined;child.once('error',error=>{spawnError=error;});
  const stop=async()=>{
    if(child.exitCode!==null||child.signalCode!==null||spawnError)return;
    const exit=once(child,'exit');child.kill('SIGTERM');const timeout=setTimeout(()=>child.kill('SIGKILL'),3000);
    try{await exit;}finally{clearTimeout(timeout);}
  };
  try{
    const activePort=join(profile,'DevToolsActivePort'),deadline=Date.now()+10000;
    while(!existsSync(activePort)){
      if(spawnError||child.exitCode!==null||Date.now()>deadline)throw new Error('隔離 Chrome 未能啟動，請檢查測試執行檔設定。');
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    const port=readFileSync(activePort,'utf8').split('\n')[0];
    const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{noDefaults:true,isLocal:true});
    const context=browser.contexts()[0];if(!context)throw new Error('沒有隔離 Chrome 設定檔。');
    return{browser,context,async close(){try{await browser.close();}finally{await stop();}}};
  }catch(error){await stop();throw error;}
}
