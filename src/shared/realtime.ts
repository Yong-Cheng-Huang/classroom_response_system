import type { ActivityView,LobbyView } from './views.js';
import type { ErrorCode } from './errors.js';
export type RealtimeData = {scope:'lobby';view:LobbyView}|{scope:'activity';view:ActivityView};
export type RealtimeFrame = {type:'snapshot'|'update';serverEpoch:string;channelId:string;revision:number;activityId:string|null;data:RealtimeData};
export type RealtimeClockTick={type:'clock-tick';serverNow:number};
export type RealtimeFailure = {type:'error';code:ErrorCode;message:string};

// 每個 socket 各自建立接收器；關閉後丟棄，舊 socket 的事件不得交給新接收器。
export class SnapshotCursor {
  private current:RealtimeFrame|null=null;
  get value(){return this.current;}
  accept(frame:RealtimeFrame):'applied'|'ignored'|'resync'{
    const prior=this.current;
    if(!Number.isSafeInteger(frame.revision)||frame.revision<1)return 'resync';
    if(!prior){if(frame.type!=='snapshot')return 'resync';this.current=frame;return 'applied';}
    if(frame.serverEpoch!==prior.serverEpoch||frame.channelId!==prior.channelId)return 'ignored';
    if(frame.revision<=prior.revision)return 'ignored';
    if(frame.type!=='snapshot'&&(frame.revision!==prior.revision+1||frame.activityId!==prior.activityId))return 'resync';
    this.current=frame;return 'applied';
  }
}
