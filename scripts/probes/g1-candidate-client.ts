// G1 隔離實驗的瀏覽器端；不由正式前端載入。
export const candidateScript = String.raw`
(() => {
  const prefix = 'crs-g1:';
  const instanceId = crypto.randomUUID();
  const transitions = [];
  let state = 'NEW', identity = null;
  const transition = next => { transitions.push({from:state,to:next}); state=next; };
  const credential = () => JSON.parse(sessionStorage.getItem('g1-credential') || 'null');
  const clear = () => {sessionStorage.removeItem('g1-credential');sessionStorage.removeItem('g1-draft');identity=null;};
  if (!/^crs-g1:[0-9a-f]{64}$/.test(window.name)) {
    if (credential()) transition('DUPLICATE');
    clear();
    window.name=prefix+Array.from(crypto.getRandomValues(new Uint8Array(32)), b=>b.toString(16).padStart(2,'0')).join('');
    transition('NEW');
  }
  const request = async (path, body) => {
    const response = await fetch(path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  const envelope = () => ({...credential(),secret:window.name.slice(prefix.length),instanceId});
  const resume = async () => {
    if (!credential()) {transition('NEW');return;}
    transition('RELOAD_HANDOFF');
    try {
      let input = envelope();
      let result = await request('/resume',input);
      if (result.status === 409) {
        // 僅持有兩份有效憑證者可讀版本；重整碰到前次回覆遺失時重新 CAS。
        const current = await request('/status',input);
        if (current.status === 200) {
          input={...input,generation:current.body.generation};
          result=await request('/resume',input);
        }
      }
      if (result.status !== 200) {clear();transition('INVALID');return;}
      sessionStorage.setItem('g1-credential',JSON.stringify({token:input.token,generation:result.body.generation}));
      identity=result.body;
      transition('OWNED');
    } catch {transition('DISCONNECTED');}
  };
  window.candidate = {
    ready: null,
    resume,
    async seed(token) {sessionStorage.setItem('g1-credential',JSON.stringify({token,generation:0}));await resume();},
    setDraft(value) {sessionStorage.setItem('g1-draft',value);},
    action(extra={}) {return request('/action',{...envelope(),...extra});},
    join() {return request('/join',{});},
    snapshot() {return {state,identity,instanceId,hasCapability:/^crs-g1:[0-9a-f]{64}$/.test(window.name),
      hasCredential:!!credential(),draft:sessionStorage.getItem('g1-draft'),transitions:[...transitions]};}
  };
  window.candidate.ready=resume();
})();
`;

export const candidateHtml = '<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>G1 分頁憑證候選實驗</title><p>僅供隔離實驗，沒有正式登入。</p><script>' + candidateScript + '</script></html>';
