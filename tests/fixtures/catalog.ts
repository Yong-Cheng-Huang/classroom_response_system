import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type SheetFixture = { dataset: string; source?: string; sourceSpreadsheetId?: string; sheetId: string; xlsxSha256?: string; cells: Record<string, string>; merges: string[] };
const load = (name: string): SheetFixture => JSON.parse(readFileSync(fileURLToPath(new URL(`./${name}.json`, import.meta.url)), 'utf8'));
export const f1 = load('f1');
export const f2 = load('f2');

// 只生成範本格式的測試輸入，不是正式匯入解析器。
export function syntheticF3(): SheetFixture {
  const sheet: SheetFixture = { dataset: 'F3', sheetId: 'synthetic', cells: { B2: '合成負載學習單', B4: '題號', C4: '題目', G4: '作答' }, merges: ['B2:H2', 'C4:F4', 'G4:H4'] };
  let row = 5;
  for (let i = 0; i < 60; i++) {
    const fields = i < 20 ? 1 : i < 40 ? 2 : 4;
    sheet.cells[`B${row}`] = String(i + 1);
    if (fields > 1) sheet.merges.push(`B${row}:B${row + fields - 1}`);
    for (let j = 0; j < fields; j++) {
      const current = row + j;
      sheet.cells[`C${current}`] = `合成第 ${i + 1} 題，第 ${j + 1} 個作答欄位。`;
      sheet.merges.push(`C${current}:F${current}`);
      if (fields === 1) sheet.merges.push(`G${current}:H${current}`);
      else sheet.cells[`G${current}`] = `（${j + 1}）`;
    }
    row += fields + 1;
  }
  return sheet;
}

export function writableTestSpreadsheetId(value: string | undefined) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || [f1.sourceSpreadsheetId, f2.sourceSpreadsheetId].includes(value)) throw new Error('寫入測試須指定可寫副本，禁止使用原始範本。');
  return value;
}
