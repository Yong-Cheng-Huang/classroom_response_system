import {readFileSync} from 'node:fs';
import type {BrowserContext,Page} from '@playwright/test';
export type AppliedSample={observerVerificationMs?:number;at:number;frameAt:number;socketId:number;connected:boolean;revision:number;epoch:string;channel:string;phase:string;role:string;activityId:string|null;groupId:string|null;participantId:string|null;groups:{id:string;memberCount:number}[];members:string[];submissions:{questionId:string;groupId?:string}[];questions:number;visibility:string;discarded:boolean|null;elapsed:number|null;domQuestions:number;domAnswerFields:number;domResults:number;domSubmitted:string[];selfCount:number};
export type DomAppliedSample=Omit<AppliedSample,'frameAt'|'socketId'|'revision'|'epoch'|'channel'>&{observedAt:number};
// 僅測試注入：記錄 React commit 完成後的狀態與 DOM，不改產品狀態或瀏覽器節流。
export async function installReactMeasurement(context:BrowserContext){await context.addInitScript({content:readFileSync(new URL('./react-measurement.browser.js',import.meta.url),'utf8')});}
export async function calibrate(page:Page){let best={offset:0,uncertainty:Infinity};for(let i=0;i<3;i++){const a=performance.now(),b=await page.evaluate(()=>performance.now()),c=performance.now();const sample={offset:(a+c)/2-b,uncertainty:(c-a)/2};if(sample.uncertainty<best.uncertainty)best=sample;}return best;}
export async function samples(page:Page):Promise<AppliedSample[]>{return page.evaluate(()=>structuredClone((window as any).__crsMeasurement?.records??[]));}
