import type { Spreadsheet,GridRange,Cell } from '../../src/server/guided-notes.js';
export function sheetFixture(fixture:{cells:Record<string,string>;merges:string[]},sheetId=1,title='學習單'):Spreadsheet{
  const point=(value:string)=>{const match=value.match(/^([A-Z]+)(\d+)$/u)!;return{row:Number(match[2])-1,column:[...match[1]!].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1};};
  const rows:{values:Cell[]}[]=[];
  for(const [address,text]of Object.entries(fixture.cells)){
    const {row,column}=point(address);while(rows.length<=row)rows.push({values:[]});const values=rows[row]!.values;while(values.length<=column)values.push({});values[column]={formattedValue:text,userEnteredValue:{stringValue:text},userEnteredFormat:{textFormat:{fontSize:12}}};
  }
  const merges:GridRange[]=fixture.merges.map(value=>{const [a,b]=value.split(':');const start=point(a!),end=point(b??a!);return{startRowIndex:start.row,endRowIndex:end.row+1,startColumnIndex:start.column,endColumnIndex:end.column+1};});
  return{spreadsheetId:'fixture-copy',properties:{defaultFormat:{textFormat:{fontSize:12}}},sheets:[{properties:{sheetId,title},merges,data:[{rowData:rows,rowMetadata:rows.map(()=>({pixelSize:24})),columnMetadata:Array.from({length:11},()=>({pixelSize:80}))}]}]};
}
