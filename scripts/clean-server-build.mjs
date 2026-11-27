import {rmSync} from 'node:fs';
// 只清可重建的後端輸出，避免已刪除的模組殘留；資料目錄不在此處。
rmSync(new URL('../dist/server/',import.meta.url),{recursive:true,force:true});
