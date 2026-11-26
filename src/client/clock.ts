// 每個分頁一個伺服器時間估計；不使用客戶端 Date.now 作為權威。
export class ServerClock {
  private anchor:{serverAt:number;monoAt:number;rtt:number}|null=null;
  private listeners=new Set<()=>void>();
  constructor(private readonly mono:()=>number=()=>performance.now()){}
  sample(serverNow:number,sentAt?:number){
    if(!Number.isFinite(serverNow))return;
    const monoAt=this.mono(),rtt=sentAt===undefined?0:Math.max(0,monoAt-sentAt);
    this.anchor={serverAt:serverNow+rtt/2,monoAt,rtt};for(const listener of this.listeners)listener();
  }
  tick(serverNow:number){
    if(!Number.isFinite(serverNow))return;
    if(!this.anchor){this.sample(serverNow);return;}
    // 沿用已校準錨點，只通知畫面重畫，避免推送延遲污染RTT校準。
    this.anchor={...this.anchor};for(const listener of this.listeners)listener();
  }
  now(fallback:number){return this.anchor?this.anchor.serverAt+this.mono()-this.anchor.monoAt:fallback;}
  snapshot=()=>this.anchor;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
}
export const serverClock=new ServerClock();
