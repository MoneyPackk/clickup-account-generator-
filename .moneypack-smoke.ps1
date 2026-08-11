$ErrorActionPreference = 'Stop'
$project = 'C:\Users\blazi\.pandaos\demo-project'
$expected = 'C:\Users\blazi\.npm-global\moneypack.cmd'

Write-Host '[1/8] Canonical command resolution'
$resolved = @(where.exe moneypack)
if ($resolved.Count -ne 1 -or $resolved[0] -ine $expected) { throw "Unexpected moneypack resolution: $($resolved -join ', ')" }
Write-Host "PASS: $($resolved[0])"

Write-Host '[2/8] JavaScript syntax'
& node --check "$project\moneypack-tui.js"
if ($LASTEXITCODE) { throw 'TUI syntax check failed' }
& node --check "$project\moneypack-harness.js"
if ($LASTEXITCODE) { throw 'Harness syntax check failed' }
Write-Host 'PASS'

Write-Host '[3/8] TUI module load and exports'
& node -e "const t=require('./moneypack-tui'); const need=['run','submit','paint']; for(const k of need) if(typeof t[k]!=='function') throw Error('missing '+k); console.log('PASS:',need.join(', '))"
if ($LASTEXITCODE) { throw 'TUI module test failed' }

Write-Host '[4/8] Harness policy and execution'
& node -e "const h=require('./moneypack-harness'); (async()=>{const a=h.decision('read_file',{});const d=h.decision('shell',{command:'rm -rf /'});const k=h.decision('process_kill',{pid:4});const red=h.redact({Authorization:'Bearer secret',nested:{api_key:'secret'}});if(!a.allowed||d.allowed||k.allowed||red.Authorization!=='[REDACTED]'||red.nested.api_key!=='[REDACTED]')throw Error('policy mismatch');const x=await h.execute('read_file',{path:'smoke'},async()=> 'ok');if(x!=='ok')throw Error('execution mismatch');const y=await h.execute('shell',{command:'rm -rf /'},async()=>{throw Error('must not run')});if(!y.includes('blocked'))throw Error('deny mismatch');console.log('PASS: allow, execute, deny')})().catch(e=>{console.error(e);process.exit(1)})"
if ($LASTEXITCODE) { throw 'Harness behavior test failed' }

Write-Host '[5/8] Audit events'
$auditDir = (& node -e "process.stdout.write(require('./moneypack-harness').auditDir)")
$audit = Get-ChildItem -LiteralPath $auditDir -Filter '*.jsonl' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (!$audit) { throw "Audit file was not created in $auditDir" }
$tail = Get-Content $audit.FullName -Tail 10
if (!($tail -match 'tool.completed') -or !($tail -match 'tool.denied')) { throw 'Required audit events missing' }
Write-Host "PASS: $($audit.FullName)"

Write-Host '[6/8] Non-interactive launcher guard'
$out = (& cmd.exe /d /c "`"$expected`" 2>&1" | Out-String)
if ($out -notmatch 'interactive terminal') { throw "Unexpected launcher output: $out" }
Write-Host 'PASS: launcher reached TUI and rejected redirected input as designed'

Write-Host '[7/8] Session save/list/restore regression'
& node -e "const fs=require('fs'),path=require('path'),cli=require('./surplus-cli'),tui=require('./moneypack-tui');const id='session-smoke-'+Date.now(),history=[{role:'user',content:'session regression test'},{role:'assistant',content:'resume confirmed'}];cli.saveSession(id,'test-model',history);const listed=cli.listSessions().some(s=>s.id===id),r=tui.restoreSession(id);if(!listed||!r.ok||tui.state.sessionId!==id||tui.state.model!=='test-model'||tui.state.history.length!==2)throw Error('session regression failed');fs.unlinkSync(path.join(cli.SESSION_DIR,id+'.json'));console.log('PASS: save, list, restore, model/history hydration')"
if ($LASTEXITCODE) { throw 'Session regression test failed' }

Write-Host '[8/8] Legacy launcher compatibility alias'
$legacy = 'C:\Users\blazi\bin\MoneyPackTUI.cmd'
$legacyOut = (& cmd.exe /d /c "`"$legacy`" 2>&1" | Out-String)
if ($legacyOut -notmatch 'interactive terminal') { throw "Legacy alias did not reach canonical TUI: $legacyOut" }
$content = Get-Content -LiteralPath $legacy -Raw
if ($content -notmatch [regex]::Escape($expected)) { throw 'Legacy launcher does not redirect to canonical launcher' }
Write-Host 'PASS: MoneyPackTUI redirects to moneypack.cmd'

Write-Host 'ALL SMOKE TESTS PASSED'
