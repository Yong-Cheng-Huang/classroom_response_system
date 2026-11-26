// G1 測試權威端；只保存合成租約，不使用或遷移正式資料庫。
import Database from 'better-sqlite3';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { candidateHtml, candidateScript } from './g1-candidate-client.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
type Lease = { id: string; token_hash: string; secret_hash: string; role: string; group_id: number | null;
  generation: number; instance: string | null; expires_at: number; revoked: number };
type Envelope = { token: string; secret: string; generation: number; instanceId: string };

export class CandidateAuthority {
  private database: Database.Database;
  private server: Server | undefined;
  private port = 0;
  private paused = new Set<ServerResponse>();
  private nextHtml: ((response: ServerResponse) => void) | undefined;
  phase: 'READY' | 'RUNNING' = 'READY';
  isolateOpener = true;
  truncateNextResumeReply = false;
  constructor(private readonly path: string) { this.database = this.open(); }
  private open() {
    const db = new Database(this.path);
    db.pragma('journal_mode=WAL'); db.pragma('synchronous=FULL');
    db.exec(`CREATE TABLE IF NOT EXISTS leases (
      id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, secret_hash TEXT NOT NULL,
      role TEXT NOT NULL, group_id INTEGER, generation INTEGER NOT NULL DEFAULT 0,
      instance TEXT, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
    ) STRICT`);
    return db;
  }
  seed(secret: string, role: 'TEACHER' | 'STUDENT', group: number | null) {
    const token = randomBytes(32).toString('hex'), id = randomUUID();
    this.database.prepare('INSERT INTO leases VALUES (?,?,?,?,?,0,NULL,?,0)').run(id,hash(token),hash(secret),role,group,Date.now()+43200000);
    return {token,id};
  }
  inspect(id: string) {
    const row = this.database.prepare('SELECT id,role,group_id,generation,instance,expires_at,revoked FROM leases WHERE id=?').get(id);
    if (!row) throw new Error('找不到合成租約'); return row as Omit<Lease,'token_hash'|'secret_hash'>;
  }
  leaseCount() { return (this.database.prepare('SELECT count(*) AS n FROM leases').get() as {n:number}).n; }
  private authenticate(input: Envelope) {
    if (typeof input.token !== 'string' || !/^[0-9a-f]{64}$/.test(input.token)
      || typeof input.secret !== 'string' || !/^[0-9a-f]{64}$/.test(input.secret)) return undefined;
    const row = this.database.prepare('SELECT * FROM leases WHERE token_hash=? AND secret_hash=?').get(hash(input.token),hash(input.secret)) as Lease | undefined;
    if (!row || row.revoked || Date.now() >= row.expires_at) return undefined;
    return row;
  }
  private handle(path: string, input: Envelope) {
    if (path === '/join') return { status: this.phase === 'READY' ? 200 : 403, body: {phase:this.phase} };
    const row = this.authenticate(input);
    if (!row) return { status:403, body:{code:'INVALID_PROOF'} };
    if (path === '/status') return { status:200, body:{generation:row.generation} };
    if (!Number.isSafeInteger(input.generation) || typeof input.instanceId !== 'string' || !/^[0-9a-f-]{36}$/.test(input.instanceId)) return {status:400,body:{code:'INVALID_INPUT'}};
    if (path === '/resume') {
      if (row.instance !== input.instanceId) {
        if (row.generation !== input.generation) return {status:409,body:{code:'STALE_HANDOFF'}};
        this.database.prepare('UPDATE leases SET generation=generation+1,instance=? WHERE id=? AND generation=?')
          .run(input.instanceId,row.id,input.generation);
        row.generation++; row.instance=input.instanceId;
      } else if (input.generation !== row.generation && input.generation !== row.generation-1) {
        return {status:409,body:{code:'STALE_HANDOFF'}};
      }
    } else if (path !== '/action') return {status:404,body:{code:'NOT_FOUND'}};
    if (path === '/action' && (row.generation !== input.generation || row.instance !== input.instanceId)) return {status:403,body:{code:'STALE_INSTANCE'}};
    return {status:200,body:{id:row.id,role:row.role,group:row.group_id,generation:row.generation}};
  }
  async start() {
    this.server = createServer((request,response) => {
      void (async () => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (request.method === 'GET') {
          if (url.pathname !== '/') {response.writeHead(204);response.end();return;}
          if (this.isolateOpener) response.setHeader('Cross-Origin-Opener-Policy','noopener-allow-popups');
          response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
          if (this.nextHtml) {
            const onPause=this.nextHtml; this.nextHtml=undefined;
            this.paused.add(response); response.once('close',()=>this.paused.delete(response));
            response.write('<!doctype html><title>G1 首次腳本暫停</title><p>'+'等待測試腳本'.repeat(1024)+'</p>');
            onPause(response);return;
          }
          response.end(candidateHtml);return;
        }
        const chunks: Buffer[]=[];let size=0;
        for await (const chunk of request) {size+=chunk.length;if(size>4096) throw new Error('請求過長');chunks.push(chunk);}
        const input=JSON.parse(Buffer.concat(chunks).toString()) as Envelope;
        const result=this.database.transaction(()=>this.handle(url.pathname,input)).immediate();
        if (url.pathname === '/resume' && result.status === 200 && this.truncateNextResumeReply) {
          // 已落盤但回覆內容不完整，避免 Chrome 自動重試掩蓋此故障點。
          this.truncateNextResumeReply=false;
          response.writeHead(200,{'Content-Type':'application/json'});response.end('{"incomplete":');return;
        }
        response.writeHead(result.status,{'Content-Type':'application/json','Cache-Control':'no-store'});
        response.end(JSON.stringify(result.body));
      })().catch(()=>{if(!response.headersSent)response.writeHead(400,{'Content-Type':'application/json'});response.end('{"code":"PROBE_ERROR"}');});
    });
    await new Promise<void>((done,fail)=>{this.server!.once('error',fail);this.server!.listen(this.port,'127.0.0.1',()=>done());});
    const address=this.server.address();if(!address||typeof address==='string')throw new Error('無法取得探針來源');this.port=address.port;
    return `http://127.0.0.1:${this.port}`;
  }
  holdNextDocument() {
    let release: (() => void) | undefined;
    const committed=new Promise<void>(done=>{this.nextHtml=response=>{release=()=>response.end('<script>'+candidateScript+'</script>');done();};});
    return {committed,release:()=>{if(!release)throw new Error('文件尚未到達');release();}};
  }
  async stop() {
    for(const response of this.paused)response.destroy();
    if(this.server?.listening){
      const closed=new Promise<void>((done,fail)=>this.server!.close(error=>error?fail(error):done()));
      // Chrome 的預先連線也須結束；此為測試服務重開，不是正式寬限政策。
      this.server.closeAllConnections();
      await closed;
    }
    if(this.database.open)this.database.close();
  }
  async restart() {await this.stop();this.database=this.open();return this.start();}
}
