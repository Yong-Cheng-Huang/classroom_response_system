// 僅效能觀測：在逐頁 React commit 當時核對計時，不把較晚的全體核對當作恢復時刻。
export type TimerReference={wall:number;mono:number;uncertainty:number;startedAt:number;endedAt:number|null};
export function restorationTiming(sample:{at:number;elapsed:number|null;observerVerificationMs?:number},clock:{offset:number;uncertainty:number},reference:TimerReference,ready:number){
 const restored=sample.at+clock.offset,verification=sample.observerVerificationMs??0;
 const expected=(reference.endedAt??reference.wall+restored-reference.mono)-reference.startedAt;
 const uncertainty=clock.uncertainty+reference.uncertainty+verification+2;
 const timerErrorUpperMs=sample.elapsed===null?Infinity:Math.abs(sample.elapsed-expected)+uncertainty;
 return{restored,timerErrorUpperMs,uncertainty,upperMs:Math.max(0,restored-ready)+clock.uncertainty+verification+1,timerValid:timerErrorUpperMs<=1000};
}
