import { randomBytes,randomUUID } from 'node:crypto';
import type { IncomingMessage,ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket,WebSocketServer } from 'ws';
import type { ApiPorts } from './api.js';
import type { OrderedCommandQueue } from './command-queue.js';
import { assertRequestOrigin } from './identity-http.js';
import { jsonCommand,onlyKeys } from './http-body.js';
import { projectActivity,projectLobby,type ActivityReadModel } from './projections.js';
import { AppError,publicError } from '../shared/errors.js';
import type { TabProof } from '../shared/session.js';
import type { RealtimeData,RealtimeFrame } from '../shared/realtime.js';

type Ticket={proof:TabProof;scope:'lobby'|'activity';expiresAt:number};
type Owner={sessionId:string;generation:number;instanceId:string};
type Channel={lastClockTick:number;owner?:Owner;lastPong:number;lastPing:number;awaitingPong:boolean;socket:WebSocket;ticket:Ticket;channelId:string;revision:number;activityId:string|null;fingerprint:string};
export class RealtimeService {
  private readonly serverEpoch=randomUUID();
  private tickets=new Map<string,Ticket>();
  private channels=new Set<Channel>();
  private readonly sockets=new WebSocketServer({noServer:true,maxPayload:1024,handleProtocols:()=> 'crs.v1'});
  private stopping=false;
  private batching=false;
  private scheduled:ReturnType<typeof setTimeout>|undefined;
  private batchModel:{value:ActivityReadModel|null}|undefined;
  private readonly now:()=>number;
  private readonly timer:ReturnType<typeof setInterval>;
  constructor(private readonly ports:ApiPorts,private readonly commands:OrderedCommandQueue){
    this.now=ports.now??Date.now;
    // 固定頻率檢查授權及已提交狀態；不將內部交易數作為可見版本。
    this.timer=setInterval(()=>this.flush(),100);this.timer.unref();
  }
  private data(ticket:Ticket):RealtimeData{
    const identity=this.ports.identity;if(!identity)throw new AppError('FEATURE_NOT_READY');
    const subject=ticket.scope==='activity'?identity.principal(ticket.proof):null;
    if(!this.batching)this.ports.beforeRead?.();
    if(!this.ports.readModel)throw new AppError('FEATURE_NOT_READY');
    if(this.batching&&!this.batchModel)this.batchModel={value:this.ports.readModel()};
    const model=this.batchModel?this.batchModel.value:this.ports.readModel();
    return subject?{scope:'activity',view:projectActivity(model,subject,this.now())}:{scope:'lobby',view:projectLobby(model,this.now())};
  }
  async http(request:IncomingMessage,response:ServerResponse,url:URL,operationId:string){
    if(url.pathname!=='/api/realtime/ticket')return false;
    if(request.method!=='POST')throw new AppError('METHOD_NOT_ALLOWED');
    assertRequestOrigin(request);if(url.search)throw new AppError('INVALID_REQUEST');
    const result=await jsonCommand(request,this.commands,body=>{
      onlyKeys(body,['scope']);if(body.scope!=='lobby'&&body.scope!=='activity')throw new AppError('INVALID_REQUEST');
      const identity=this.ports.identity;if(!identity)throw new AppError('FEATURE_NOT_READY');
      const ticket:Ticket={scope:body.scope,proof:identity.proof(request,body.scope==='activity'),expiresAt:this.now()+10000};
      this.data(ticket);for(const [key,value]of this.tickets)if(value.expiresAt<=this.now())this.tickets.delete(key);
      // 同一分頁最多保留一張尚未使用的票證。
      for(const [key,value]of this.tickets)if(value.proof.secret===ticket.proof.secret)this.tickets.delete(key);
      if(this.tickets.size>=1024)throw new AppError('EXTERNAL_UNAVAILABLE');
      const token=randomBytes(32).toString('hex');this.tickets.set(token,ticket);
      return{ticket:token,expiresAt:ticket.expiresAt,protocol:'crs.v1'};
    });
    response.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify({ok:true,data:result,operationId}));return true;
  }
  upgrade(request:IncomingMessage,socket:Duplex,head:Buffer){
    try{
      assertRequestOrigin(request);
      const url=new URL(request.url??'/',`http://${request.headers.host}`);
      if(url.pathname!=='/ws'||url.search)throw new AppError('UNAUTHORIZED');
      const protocols=request.headers['sec-websocket-protocol']?.split(',').map(value=>value.trim())??[];
      if(protocols.length!==2||protocols[0]!=='crs.v1'||!/^ticket\.[a-f0-9]{64}$/u.test(protocols[1]!))throw new AppError('UNAUTHORIZED');
      const key=protocols[1]!.slice(7),ticket=this.tickets.get(key);this.tickets.delete(key);
      if(!ticket||ticket.expiresAt<=this.now())throw new AppError('UNAUTHORIZED');
      this.data(ticket); // 在 upgrade 時重新驗證，不以票證核發當下的權限代替。
      this.sockets.handleUpgrade(request,socket,head,ws=>{
        try{
        const subject=ticket.scope==='activity'?this.ports.identity!.channelConnected(ticket.proof):null;
        const channel:Channel={lastClockTick:this.now(),...(subject?{owner:{sessionId:subject.sessionId,generation:ticket.proof.generation,instanceId:ticket.proof.instanceId}}:{}),lastPong:this.now(),lastPing:this.now(),awaitingPong:false,socket:ws,ticket,channelId:randomUUID(),revision:0,activityId:null,fingerprint:''};
        this.channels.add(channel);
        ws.on('error',()=>{this.detach(channel);ws.terminate();});
        ws.on('close',()=>this.detach(channel));
        ws.on('pong',()=>{channel.lastPong=this.now();channel.awaitingPong=false;});
        ws.on('message',(raw,binary)=>{
          try{const value=JSON.parse(raw.toString());
            if(binary||!value||typeof value!=='object'||Array.isArray(value))throw new AppError('INVALID_REQUEST');
            if(value.type==='clock'&&Object.keys(value).length===2&&typeof value.requestId==='string'&&/^[a-f0-9-]{36}$/u.test(value.requestId)){
              this.data(channel.ticket);ws.send(JSON.stringify({type:'clock',requestId:value.requestId,serverNow:this.now()}));return;
            }
            if(Object.keys(value).length!==1||value.type!=='snapshot')throw new AppError('INVALID_REQUEST');
            this.send(channel,true);
          }catch(error){this.fail(channel,error);}
        });
        // 同步建立訂閱並讀取快照，中間不 await，事件不能越過快照銜接點。
        this.send(channel,true);
        }catch(error){const failure=publicError(error,'').body.error;ws.send(JSON.stringify({type:'error',...failure}));ws.close(1008,'身分或通道已失效');}
      });
    }catch{socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');}
  }
  private detach(channel:Channel){
    if(!this.channels.delete(channel)||this.stopping||!channel.owner)return;
    const owner=channel.owner;
    const remaining=[...this.channels].some(other=>other.owner?.sessionId===owner.sessionId&&other.owner.generation===owner.generation&&other.owner.instanceId===owner.instanceId&&other.socket.readyState===WebSocket.OPEN);
    if(!remaining)this.ports.identity?.channelDisconnected(owner);
  }
  private fail(channel:Channel,error:unknown){
    this.detach(channel);
    const failure=publicError(error,'').body.error;
    if(channel.socket.readyState===WebSocket.OPEN){channel.socket.send(JSON.stringify({type:'error',...failure}));channel.socket.close(1008,'身分或通道已失效');}
  }
  private send(channel:Channel,force=false){
    try{
      if(channel.socket.readyState!==WebSocket.OPEN)return;
      const data=this.data(channel.ticket);
      // serverNow 不是業務變更；他組提交不影響學生指紋，也不產生事件或序號。
      const fingerprint=JSON.stringify({...data,view:{...data.view,serverNow:0}});
      if(!force&&fingerprint===channel.fingerprint)return;
      if(channel.socket.bufferedAmount>1024*1024){this.detach(channel);channel.socket.terminate();return;}
      const activityId=data.view.activityId;
      const frame:RealtimeFrame={type:force||channel.revision===0||channel.activityId!==activityId?'snapshot':'update',
        serverEpoch:this.serverEpoch,channelId:channel.channelId,revision:++channel.revision,activityId,data};
      channel.fingerprint=fingerprint;channel.activityId=activityId;
      channel.socket.send(JSON.stringify(frame));
    }catch(error){this.fail(channel,error);}
  }
  requestFlush(){
    if(this.stopping||this.scheduled)return;
    // 突發命令合併為最新快照，避免每個回覆重推全部分頁；不延後權威交易。
    this.scheduled=setTimeout(()=>{this.scheduled=undefined;this.flush();},25);
  }
  flush(){
    if(this.stopping)return;
    clearTimeout(this.scheduled);this.scheduled=undefined;
    // 只共用此同步批次的資料；角色、期限與分頁證明仍由data逐通道驗證。
    this.batching=true;this.batchModel=undefined;
    try{
    try{this.ports.identity?.sweep();this.ports.beforeRead?.();}
    catch(error){for(const channel of this.channels)this.fail(channel,error);return;}
    for(const channel of this.channels){
      this.send(channel);
      if(!this.channels.has(channel)||channel.socket.readyState!==WebSocket.OPEN)continue;
      const now=this.now();
      // 授權已由send重驗；輕量脈衝喚醒背景DOM，不依賴受節流的頁面interval。
      if(channel.ticket.scope==='activity'&&now-channel.lastClockTick>=500){channel.lastClockTick=now;channel.socket.send(JSON.stringify({type:'clock-tick',serverNow:now}));}
      // 原生 WS ping/pong 不依賴背景分頁的 JavaScript timer。
      if(channel.awaitingPong&&now-channel.lastPing>=6000){this.detach(channel);channel.socket.terminate();continue;}
      if(!channel.awaitingPong&&now-channel.lastPing>=2000){channel.awaitingPong=true;channel.lastPing=now;channel.socket.ping();}
    }
    }finally{this.batching=false;this.batchModel=undefined;}
  }
  close(){this.stopping=true;clearInterval(this.timer);clearTimeout(this.scheduled);this.scheduled=undefined;this.tickets.clear();for(const socket of this.sockets.clients)socket.terminate();this.channels.clear();this.sockets.close();}
}
