// 僅供 G1 可行性驗證：不是正式身分模組，不讀取應用資料庫或真實憑證。
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, platform, arch, release } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

type Snapshot = {
  navigationType: string; key: string; entryId: string; instanceId: string;
  storage: Record<string, string>; historyState: unknown; windowName: string; lockHeld: boolean;
};

const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>G1 隔離技術驗證</title>
<p>僅使用合成識別；不是課堂系統登入。</p><script>
const instanceId = crypto.randomUUID();
let releaseLock; let lockHeld = false;
const lockReady = new Promise(resolve => {
  navigator.locks.request('g1-owner', {ifAvailable:true}, lock => {
    lockHeld = !!lock; resolve();
    if (lock) return new Promise(done => {releaseLock = () => {lockHeld=false;done();};});
  }).catch(() => resolve());
});
window.g1 = {
  async snapshot() { await lockReady; return {
    navigationType: performance.getEntriesByType('navigation')[0].type,
    key: navigation.currentEntry.key, entryId: navigation.currentEntry.id, instanceId,
    storage: {...sessionStorage}, historyState: history.state, windowName: window.name, lockHeld
  };},
  release() {releaseLock?.();}
};
</script></html>`;

const root = mkdtempSync(join(tmpdir(), 'classroom-g1-'));
let pauseNextDocument = false;
let documentPaused: (() => void) | undefined;
const pausedResponses = new Set<ServerResponse>();
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  if (pauseNextDocument) {
    pauseNextDocument = false;
    pausedResponses.add(response);
    response.once('close', () => pausedResponses.delete(response));
    // 已 commit 的文件，刻意尚未送出任何應用 JS；模擬快速重整／慢速腳本。
    response.write('<!doctype html><meta charset="utf-8"><title>G1 首次腳本暫停</title><p>' + '僅測試'.repeat(1024) + '</p>');
    documentPaused?.();
    return;
  }
  response.end(html);
});
let context: BrowserContext | undefined;
const snapshot = (page: Page): Promise<Snapshot> => page.evaluate('window.g1.snapshot()');
const observations: Record<string, unknown> = {};
try {
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/`;
  const extension = join(root, 'duplicate-driver'); mkdirSync(extension);
  // 此擴充功能只在測試 Chrome 內呼叫原生 tabs.duplicate；不提供分頁 ID 給網頁。
  writeFileSync(join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'G1原生複製測試工具', version: '1.0', permissions: ['tabs'] }));
  writeFileSync(join(extension, 'control.html'), '<!doctype html><title>G1測試控制</title>');
  context = await chromium.launchPersistentContext(join(root, 'profile'), {
    channel: 'chrome', headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging'],
  });
  context.setDefaultTimeout(10000);
  const browser = context.browser()!;
  const cdp = await browser.newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extension });
  const control = await context.newPage();
  await control.goto(`chrome-extension://${id}/control.html`);
  const original = await context.newPage(); await original.goto(url);
  await original.evaluate(() => {
    sessionStorage.setItem('sessionId', 'g1-合成學生身分');
    sessionStorage.setItem('tabId', 'g1-合成分頁識別');
    sessionStorage.setItem('token', 'g1-不是正式憑證');
    sessionStorage.setItem('draft', 'g1-合成草稿');
    history.replaceState({ handoffVersion: 1 }, ''); window.name = 'g1-分頁名稱';
  });
  await original.reload();
  const originalReload = await snapshot(original); observations.originalReload = originalReload;

  const copyReady = context.waitForEvent('page');
  await control.evaluate(async target => {
    // 僅測試驅動器具有 chrome.tabs 權限；產品網頁沒有此 API。
    const api = (globalThis as unknown as { chrome: { tabs: {
      query(query: object): Promise<{ id: number; url: string }[]>;
      duplicate(id: number): Promise<{ id: number }>;
    } } }).chrome;
    const tab = (await api.tabs.query({})).find(tab => tab.url === target);
    if (!tab) throw new Error('找不到隔離測試原頁');
    await api.tabs.duplicate(tab.id);
  }, url);
  const copy = await copyReady; await copy.waitForLoadState();
  const nativeCopy = await snapshot(copy); observations.nativeCopy = nativeCopy;
  await copy.reload();
  const copyReload = await snapshot(copy); observations.copyReload = copyReload;

  // 在原頁關閉後，既有副本再重整，檢查是否能冒充原頁交接並取得排他鎖。
  await original.close(); await copy.reload();
  const copyAfterOriginalClosed = await snapshot(copy); observations.copyAfterOriginalClosed = copyAfterOriginalClosed;
  await copy.close();

  // 首次副本文件尚未執行任何應用 JS 就被重新整理：不能假設副本一定先完成清除。
  const source = await context.newPage(); await source.goto(url);
  await source.evaluate(() => {
    sessionStorage.setItem('sessionId', 'g1-合成老師身分');
    sessionStorage.setItem('token', 'g1-不是正式老師憑證');
    history.replaceState({ handoffVersion: 2 }, ''); window.name = 'g1-第二個原頁名稱';
  });
  await source.reload(); const sourceBeforeRace = await snapshot(source);
  observations.sourceBeforeRace = sourceBeforeRace;
  const blocked = new Promise<void>(done => { documentPaused = done; });
  pauseNextDocument = true;
  const raceCopyReady = context.waitForEvent('page');
  const raceTabId = await control.evaluate(async target => {
    const api = (globalThis as unknown as { chrome: { tabs: {
      query(query: object): Promise<{ id: number; url: string }[]>;
      duplicate(id: number): Promise<{ id: number }>;
    } } }).chrome;
    const tab = (await api.tabs.query({})).find(tab => tab.url === target);
    if (!tab) throw new Error('找不到競爭測試原頁');
    return (await api.tabs.duplicate(tab.id)).id;
  }, url);
  await Promise.race([blocked, new Promise<never>((_, fail) => setTimeout(() => fail(new Error('未攔截副本首次文件')), 10000).unref())]);
  const raceCopy = await raceCopyReady;
  await raceCopy.waitForURL(url, { waitUntil: 'commit' });
  observations.copyBeforeFirstScript = await raceCopy.evaluate('({key:navigation.currentEntry.key, storage:{...sessionStorage}, applicationScriptExecuted:typeof window.g1!=="undefined"})');
  await source.close();
  await control.evaluate(async tabId => {
    const api = (globalThis as unknown as { chrome: { tabs: { reload(id: number): Promise<void> } } }).chrome;
    await api.tabs.reload(tabId);
  }, raceTabId);
  await raceCopy.waitForLoadState();
  const copyReloadWithoutFirstScript = await snapshot(raceCopy);
  observations.copyReloadWithoutFirstScript = copyReloadWithoutFirstScript;
  const findings = {
    copiedSessionStorage: JSON.stringify(originalReload.storage) === JSON.stringify(nativeCopy.storage),
    copiedHistoryState: JSON.stringify(originalReload.historyState) === JSON.stringify(nativeCopy.historyState),
    copiedNavigationKey: originalReload.key === nativeCopy.key,
    nativeCopyHasEmptyWindowName: nativeCopy.windowName === '',
    copyCanClaimReload: copyReload.navigationType === 'reload',
    copyCanAcquireLockAfterOriginalClosed: copyAfterOriginalClosed.lockHeld,
    originalAndCopyHaveDifferentMemoryInstances: originalReload.instanceId !== nativeCopy.instanceId,
    firstScriptBypassRetainsOriginalStorage: JSON.stringify(sourceBeforeRace.storage) === JSON.stringify(copyReloadWithoutFirstScript.storage),
    firstScriptBypassHasSameKey: sourceBeforeRace.key === copyReloadWithoutFirstScript.key,
    firstScriptBypassCanClaimReloadAndLock: copyReloadWithoutFirstScript.navigationType === 'reload' && copyReloadWithoutFirstScript.lockHeld,
  };
  const report = {
    recordedAt: new Date().toISOString(), chrome: browser.version(), node: process.version,
    environment: { platform: platform(), arch: arch(), release: release(), headless: true },
    method: '隔離設定檔；測試擴充功能只觸發 Chrome 原生 tabs.duplicate，產品不使用擴充功能或 CDP。',
    observations, findings,
    gate: 'NOT_PROVEN',
    note: '這些是觀測結果，不是所有可行方案皆不可能的證明，也不是 IA03 全部情境通過。',
  };
  const output = resolve('docs/evidence/g1-probe.json'); mkdirSync(resolve('docs/evidence'), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ chrome: report.chrome, findings, gate: report.gate, evidence: 'docs/evidence/g1-probe.json' }, null, 2));
} finally {
  await context?.close();
  for (const response of pausedResponses) response.destroy();
  await new Promise<void>(done => server.close(() => done()));
  rmSync(root, { recursive: true, force: true });
}
