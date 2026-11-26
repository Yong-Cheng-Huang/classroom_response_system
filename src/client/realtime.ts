import { SnapshotCursor,type RealtimeFrame,type RealtimeFailure,type RealtimeData,type RealtimeClockTick } from '../shared/realtime.js';
import { tabSession } from './session.js';
import { serverClock } from './clock.js';
type ClockFrame={type:'clock';requestId:string;serverNow:number};

export function openRealtime(scope:'lobby'|'activity',apply:(data:RealtimeData)=>void,onFailure:(message:string)=>void,onConnection:(message:string)=>void=()=>{}){
  let live=true,attempt=0,socket:WebSocket|undefined,controller:AbortController|undefined;
  let retry:ReturnType<typeof setTimeout>|undefined,watchdog:ReturnType<typeof setTimeout>|undefined,calibration:ReturnType<typeof setInterval>|undefined;
  let pendingClock:{id:string;sentAt:number}|undefined;
  const clear=()=>{
    clearTimeout(watchdog);clearInterval(calibration);controller?.abort();controller=undefined;pendingClock=undefined;
    if(socket){socket.onmessage=null;socket.onerror=null;socket.onclose=null;socket.close();socket=undefined;}
  };
  const clock=()=>{
    if(socket?.readyState!==WebSocket.OPEN)return;
    const id=crypto.randomUUID();pendingClock={id,sentAt:performance.now()};socket.send(JSON.stringify({type:'clock',requestId:id}));
  };
  const reconnect=(message:string)=>{
    if(!live)return;
    ++attempt;clear();clearTimeout(retry);onFailure(message);onConnection('連線中斷，正在自動重連…');
    retry=setTimeout(()=>{void connect();},500);
  };
  const connect=async()=>{
    if(!live)return;clearTimeout(retry);const own=++attempt;clear();controller=new AbortController();
    const current=()=>live&&attempt===own;
    // 同來源多分頁的HTTP票證可能排隊；保留握手時間，避免取消仍可成功的恢復。
    watchdog=setTimeout(()=>{if(current())reconnect('即時連線暫時沒有回應，正在重新連接。');},3000);
    try{
      const ticket=await tabSession.request<{ticket:string;protocol:string}>('/api/realtime/ticket','POST',{scope},true,controller.signal);
      if(!current())return;
      socket=new WebSocket(`ws://${location.host}/ws`,[ticket.protocol,'ticket.'+ticket.ticket]);
      const ws=socket,cursor=new SnapshotCursor();let restored=false;
      ws.onmessage=event=>{
        if(!current())return;
        try{
          const frame=JSON.parse(String(event.data)) as RealtimeFrame|RealtimeFailure|ClockFrame|RealtimeClockTick;
          if(frame.type==='error'){onFailure(frame.message);void tabSession.refresh();reconnect(frame.message);return;}
          if(frame.type==='clock-tick'){serverClock.tick(frame.serverNow);return;}
          if(frame.type==='clock'){
            if(pendingClock?.id===frame.requestId){serverClock.sample(frame.serverNow,pendingClock.sentAt);pendingClock=undefined;}return;
          }
          if(frame.type!=='snapshot'&&frame.type!=='update')return;
          const result=cursor.accept(frame);
          if(result==='resync'){ws.send(JSON.stringify({type:'snapshot'}));return;}
          if(result==='applied'){
            serverClock.sample(frame.data.view.serverNow);apply(frame.data);
            if(!restored){restored=true;clearTimeout(watchdog);onConnection('本機服務已連線');clock();calibration=setInterval(clock,1000);void tabSession.refresh();}
          }
        }catch{reconnect('同步資料暫時無法套用，正在重新連接。');}
      };
      ws.onerror=()=>{if(current())reconnect('即時通道中斷，正在檢查本機連線。');};
      ws.onclose=()=>{if(current())reconnect('即時通道已中斷，正在自動恢復。');};
    }catch(error){if(current())reconnect(error instanceof Error?error.message:'暫時無法開啟即時通道。');}
  };
  const visible=()=>{
    if(!live)return;
    if(socket?.readyState===WebSocket.OPEN){clock();socket.send(JSON.stringify({type:'snapshot'}));}
    else if(!socket||socket.readyState===WebSocket.CLOSED)void connect();
  };
  const visibility=()=>{if(document.visibilityState==='visible')visible();};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('online',visible);
  void connect();
  return()=>{live=false;++attempt;clearTimeout(retry);clear();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('online',visible);};
}
