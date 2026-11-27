// 測試用獨立狀態機：能處理引號內的逗號／換行，不以 split 當作 CSV 解析。
export function parseCsv(text:string):string[][] {
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
  const source=text.replace(/^\uFEFF/u,'');
  for(let i=0;i<source.length;i++){
    const c=source[i]!;
    if(quoted){if(c==='"'){if(source[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=c;}
    else if(c==='"'){if(cell)throw new Error('非法CSV欄位');quoted=true;}
    else if(c===','){row.push(cell);cell='';}
    else if(c==='\r'||c==='\n'){if(c==='\r'&&source[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw new Error('CSV引號未閉合');if(row.length||cell){row.push(cell);rows.push(row);}return rows;
}
