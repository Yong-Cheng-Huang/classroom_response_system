(() => {
  // 此檔以原始文字注入，避免tsx的__name helper外洩至瀏覽器序列化函式。
  const data = { records: [], domRecords: [], domRecorded: null, frames: 0, last: null, recorded: '', lifecycle: [], sockets: 0, activeSocket: 0, network: [], lastFrameAt: 0 };
  window.__crsMeasurement = data;
  for (const type of ['freeze', 'resume', 'visibilitychange']) document.addEventListener(type, () => data.lifecycle.push({ at: performance.now(), type }));
  const originalFetch=window.fetch;
  window.fetch=function(input,options){
    const path=new URL(typeof input==='string'?input:input.url||String(input),location.href).pathname;
    const tracked=path.startsWith('/api/'),started=performance.now();
    if(tracked)data.network.push({at:started,type:'http-start',path,method:options?.method||'GET'});
    return originalFetch.call(this,input,options).then(response=>{if(tracked)data.network.push({at:performance.now(),type:'http-end',path,status:response.status,started});return response;},error=>{if(tracked)data.network.push({at:performance.now(),type:'http-error',path,started});throw error;});
  };
  const Original = window.WebSocket;
  class Observed extends Original {
    constructor(url, protocols) {
      super(url, protocols);
      const socketId=++data.sockets;data.activeSocket=socketId;data.last=null;data.network.push({at:performance.now(),type:'ws-created',socketId});
      this.addEventListener('open',()=>data.network.push({at:performance.now(),type:'ws-open',socketId}));
      this.addEventListener('close',event=>data.network.push({at:performance.now(),type:'ws-close',socketId,code:event.code}));
      this.addEventListener('message', event => {
        if(socketId!==data.activeSocket)return;
        try { const frame = JSON.parse(String(event.data)); if(frame.type==='clock-tick')data.network.push({at:performance.now(),type:'clock-tick',socketId}); if (frame.type === 'snapshot' || frame.type === 'update') { data.last = frame; data.lastFrameAt=performance.now(); data.frames++;data.network.push({at:data.lastFrameAt,type:frame.type,socketId,revision:frame.revision,epoch:frame.serverEpoch,channel:frame.channelId,role:frame.data.view.role||'LOBBY',phase:frame.data.view.phase}); } } catch {}
      });
    }
  }
  window.WebSocket = Observed;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, inject: () => 1, onCommitFiberUnmount: () => {},
    onCommitFiberRoot(_id, root) {
      const commitAt=performance.now();
      const displayed=document.querySelector('.student-panel')?'STUDENT':document.querySelector('.teacher-activity')?'TEACHER':document.querySelector('.group-grid')?'LOBBY':null;
      if(!displayed)return;
      const stack=[root.current];let v=null;
      while(stack.length&&!v){const fiber=stack.pop();if(!fiber)continue;let hook=fiber.memoizedState;
        for(let i=0;hook&&i<40;i++,hook=hook.next){const value=hook.memoizedState;if(value&&typeof value==='object'&&'phase'in value&&'serverNow'in value&&(value.role||'LOBBY')===displayed){v=value;break;}}
        if(fiber.sibling)stack.push(fiber.sibling);if(fiber.child)stack.push(fiber.child);
      }
      if(!v)return;
      const connected=document.querySelector('[role="status"]')?.textContent==='本機服務已連線',timer=document.querySelector('[data-elapsed-ms]');
      const meta={at:commitAt,connected,phase:v.phase,role:v.role||'LOBBY',activityId:v.activityId,
        groupId:v.groupId||null,participantId:v.participantId||null,groups:(v.groups||[]).map(g=>({id:g.id,memberCount:g.memberCount})),members:(v.members||[]).map(m=>m.id),
        submissions:(v.submissions||v.ownSubmissions||[]).map(x=>({questionId:x.questionId,...((x.groupId||v.groupId)?{groupId:x.groupId||v.groupId}:{})})),questions:v.questions?.length||0,
        visibility:document.visibilityState,discarded:document.wasDiscarded??null,elapsed:timer?Number(timer.getAttribute('data-elapsed-ms')):null,
        domQuestions:document.querySelectorAll('.question-card,.teacher-question-status').length,domAnswerFields:document.querySelectorAll('.question-card textarea').length,domResults:document.querySelectorAll('[aria-label="本組本題結果"]').length,
        domSubmitted:[...document.querySelectorAll('.question-card.question-submitted')].map(e=>e.id.slice(9)),selfCount:(v.members||[]).filter(m=>m.isSelf).length};
      const business=JSON.stringify({...v,serverNow:0}),domKey=business+':'+connected+':'+meta.domQuestions+':'+meta.domResults+':'+meta.domSubmitted.join(',');
      if(data.domRecorded!==domKey){data.domRecorded=domKey;data.domRecords.push({...meta,observedAt:performance.now()});}
      const frame=data.last;if(!frame||business!==JSON.stringify({...frame.data.view,serverNow:0}))return;
      const key=frame.serverEpoch+':'+frame.channelId+':'+frame.revision+':'+domKey;
      if(data.recorded===key)return;data.recorded=key;
      const observedAt=performance.now();data.records.push({...meta,at:observedAt,observerVerificationMs:observedAt-commitAt,frameAt:data.lastFrameAt,socketId:data.activeSocket,revision:frame.revision,epoch:frame.serverEpoch,channel:frame.channelId});
    }
  };
})();
