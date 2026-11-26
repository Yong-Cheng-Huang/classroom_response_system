import type { OwnSubmission } from './views.js';
// 成功接受不等於搶答第一；學生回覆不含名次、接收序號或提交時間。
export type SubmissionAccepted = { accepted:true;requestId:string;submission:OwnSubmission };
