"""產生原始需求／決策／情境的實作前後可追蹤索引；不把索引存在當作通過。"""
from pathlib import Path
import json,re,hashlib
root=Path(__file__).resolve().parent.parent
change=root/'openspec/changes/build-local-classroom-response-system'
original=(root/'docs/requirements.md').read_text();assert hashlib.sha256((root/'docs/requirements.md').read_bytes()).hexdigest()=='498bc69163997b0570963f4712d7196edd1f9e39590ec05d51e884aaa4e2f413'
design=(change/'design.md').read_text()
files={
'IA':['tests/integration/identity.test.ts','tests/unit/validation.test.ts','tests/browser/identity.spec.ts','tests/integration/acceptance-security.test.ts','docs/evidence/identity-verification.json'],
'AL':['tests/integration/activity.test.ts','tests/integration/activity-replacement.test.ts','tests/integration/state-crash.test.ts','tests/browser/teacher.spec.ts','docs/evidence/activity-verification.json'],
'GI':['tests/unit/guided-notes.test.ts','tests/integration/imports.test.ts','tests/browser/google.spec.ts','tests/browser/teacher.spec.ts','docs/evidence/guided-notes-import-verification.json'],
'TC':['tests/browser/teacher.spec.ts','tests/browser/exports.spec.ts','docs/evidence/teacher-verification.json'],
'SP':['tests/browser/student.spec.ts','tests/unit/drafts.test.ts','tests/unit/validation.test.ts','docs/evidence/student-verification.json'],
'RR':['tests/unit/restoration-measurement.test.ts','tests/browser/clock-pulse.spec.ts','tests/browser/measurement-http.spec.ts','tests/integration/read-model.test.ts','tests/integration/response-flush.test.ts','tests/browser/measurement.spec.ts','docs/evidence/acceptance-42.json','docs/evidence/performance-acceptance.json','tests/integration/realtime.test.ts','tests/unit/realtime.test.ts','tests/browser/recovery.spec.ts','docs/evidence/recovery-verification.json'],
'SR':['tests/integration/submissions.test.ts','tests/integration/submission-crash.test.ts','tests/browser/ranking.spec.ts','docs/evidence/ranking-verification.json'],
'AR':['tests/integration/results.test.ts','tests/unit/projections.test.ts','tests/browser/results.spec.ts','docs/evidence/results-verification.json'],
'GE':['tests/integration/exports.test.ts','tests/integration/export-crash.test.ts','tests/browser/exports.spec.ts','docs/evidence/exports-live.json','docs/evidence/exports-live-boundaries.json'],
'PS':['docs/local-operation-guide.md','docs/evidence/integration-verification.json','tests/integration/upgrade-reset.test.ts','tests/integration/response-flush.test.ts','tests/integration/database.test.ts','tests/integration/state-crash.test.ts','tests/integration/export-crash.test.ts','tests/integration/google.test.ts','tests/integration/acceptance-security.test.ts','docs/evidence/export-verification.json']}
requirements={};scenarios=[]
for spec in sorted((change/'specs').glob('*/spec.md')):
 text=spec.read_text();parts=re.split(r'^### Requirement: ',text,flags=re.M)[1:]
 for part in parts:
  title=part.splitlines()[0];code=title.split()[0];requirement={'id':code,'標題':title,'規格':str(spec.relative_to(root)),'證據':files[code[:2]],'情境':[]}
  for scenario in re.split(r'^#### Scenario: ',part,flags=re.M)[1:]:
   name=scenario.splitlines()[0];body=scenario[len(name):].strip();row={'需求':code,'情境':name,'驗收敘述':body,'證據':files[code[:2]],'狀態':'相關功能回歸已通過（見檔案與執行紀錄）；不等同完整整合時限通過'}
   if code in ['RR02','RR05','RR07','RR08','PS08']:row['狀態']='整合證據尚未完整；見整合驗收報告與缺失'
   if code=='PS08':row['狀態']='交付指南與逐情境證據／缺失已列；13.3時限未通過，不宣告整體驗收完成'
   if code=='RR07':row['狀態']='同一原生Chrome零售Stable 158.0.8127.89，2老師＋40學生真Sheets完整功能流程通過；時限仍由RR08另驗'
   if '真正暫停' in name:row['證據']=row['證據']+['tests/browser/pause.spec.ts','docs/evidence/paused-browser.json'];row['狀態']='D39受控Chrome凍結與12小時不復活已通過；真正丟棄與OS休眠未實驗，不冒稱通過'
   requirement['情境'].append(name);scenarios.append(row)
  assert requirement['情境'],code;requirements[code]=requirement
assert len(requirements)==78;assert len(scenarios)==122
rows=[];source_lines=original.splitlines()
for match in re.finditer(r'^\| L(\d+) \| (.*?) \| (.*?) \| (.*?) \|$',design,re.M):
 line=int(match[1]);assert source_lines[line-1]==match[2],(line,source_lines[line-1],match[2]);ids=list(dict.fromkeys(re.findall(r'\b(?:IA|AL|GI|TC|SP|RR|SR|AR|GE|PS)\d{2}\b',match[3])));assert ids
 evidence=list(dict.fromkeys(p for code in ids for p in requirements[code]['證據']));rows.append({'原始行號':line,'原文':match[2],'規格':ids,'證據':evidence,'狀態':'已逐字對應；各情境及未達標項另列'})
covered={r['原始行號'] for r in rows};uncovered=[]
for n,line in enumerate(source_lines,1):
 if 4<=n<=188 and line.strip() and not re.match(r'^\d+(?:\.\d+)*(?:\.?\s|$)',line) and n not in covered:uncovered.append({'行號':n,'原文':line})
assert not uncovered,uncovered
decisions=[]
for m in re.finditer(r'^\| (D\d{2}) \| (.*?) \| (.*?) \|$',design,re.M):
 ids=list(dict.fromkeys(re.findall(r'\b(?:IA|AL|GI|TC|SP|RR|SR|AR|GE|PS)\d{2}\b',m[3])));evidence=list(dict.fromkeys(p for code in ids for p in requirements[code]['證據']))
 if not evidence:evidence=['docs/phase1-implementation.md','docs/integration-acceptance.md']
 decisions.append({'決策':m[1],'已確認內容':m[2],'規格與任務':m[3],'證據':evidence,'稽核註記':'D39／D40為使用者明確確認；時限仍須完整同版60輪證據' if m[1] in ['D25','D26','D27','D28','D37','D39','D40'] else '依原決策及列出實作／測試追蹤，沒有改寫原需求'})
assert len(decisions)==40,len(decisions)
for paths in files.values():
 for path in paths:assert (root/path).exists(),path
for row in scenarios:row['執行紀錄']=['docs/evidence/integration-logs/unit-integration.log','docs/evidence/integration-logs/browser.log']
report={'日期':'2026-11-27 Asia/Taipei','統計':{'原始內容列':len(rows),'需求':len(requirements),'情境':len(scenarios),'決策':len(decisions),'未對應原文':len(uncovered)},'原始需求SHA256':hashlib.sha256((root/'docs/requirements.md').read_bytes()).hexdigest(),'說明':'原文逐字校驗；列出實際測試檔與既有執行證據，不以索引／模板存在宣稱情境通過。完整整合缺失與新執行結果見integration-acceptance.md。','原始需求':rows,'決策':decisions,'功能規格':list(requirements.values()),'驗收情境':scenarios,'關卡':{'G1':'第二憑證／交接已驗證，歷史初輪NOT_PROVEN保留','G2與U01':'D38已確認；真SIGKILL與本階段恢復測試另列','U02':'使用者本階段確認D39，暫停恢復實測與正常效能分列','U03':'僅維持保護隔離；解除政策未確認，不阻擋既有保護流程'}}
(root/'docs/evidence/integration-traceability.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
lines=['# 整合驗收追蹤表','','2026-11-27。原始需求逐字校驗，內容列、78 項需求、122 個情境與 D01～D40 全部建立索引。D39、D40 是本階段確認；原 requirements.md 未改。**索引存在不代表整合驗收通過**，時限、環境及暫停實驗的缺口見 [整合報告](integration-acceptance.md)。完整情境及 Given／When／Then、各列證據清單見 [機器可讀追蹤檔](evidence/integration-traceability.json)。','','## 原始需求逐條對照','','| 原文行號 | 原始文字 | 規格 | 相關實測／回歸 |','|---|---|---|---|']
for r in rows:lines.append('| L'+str(r['原始行號'])+' | '+r['原文'].replace('|','\\|')+' | '+ '、'.join(r['規格'])+' | '+ '、'.join(f'[{Path(p).name}](../{p})' for p in r['證據'])+' |')
lines+=['','## 每項驗收情境','','| 規格 | 情境 | 目前判讀 |','|---|---|---|']
for s in scenarios:lines.append('| '+s['需求']+' | '+s['情境']+' | '+s['狀態']+' |')
lines+=['','## 補充決策稽核','','| 決策 | 確認內容 | 規格／任務 |','|---|---|---|']
for d in decisions:lines.append('| '+d['決策']+' | '+d['已確認內容']+' | '+d['規格與任務']+' |')
(root/'docs/integration-traceability.md').write_text('\n'.join(lines)+'\n');print(json.dumps(report['統計'],ensure_ascii=False))
