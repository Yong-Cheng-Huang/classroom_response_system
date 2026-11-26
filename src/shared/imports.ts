export type ImportView={inspectionToken:string;stage:'SELECT_SHEET'|'READY';sheets?:{id:string;title:string}[];
  questionCount?:number;fieldCount?:number;groupCount:number;needsReplacementConfirmation:boolean};
