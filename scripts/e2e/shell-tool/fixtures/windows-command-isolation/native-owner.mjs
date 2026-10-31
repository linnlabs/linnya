import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 必须在普通交互式 Windows 用户中运行；账户服务由控制端单独初始化。
const [bindingPath, helperPath, root] = process.argv.slice(2);
assert.ok(bindingPath && helperPath && root, 'expected native binding, worker helper and fixture root');
const binding = createRequire(import.meta.url)(bindingPath);
const current = path.join(root, 'current');
mkdirSync(current, { recursive: true });
writeFileSync(path.join(root, 'secret.txt'), 'SYNTHETIC_SECRET');
writeFileSync(path.join(current, 'input.txt'), 'INPUT');
const hidden = path.join(root, 'hidden');
const external = `${root}-external`;
mkdirSync(hidden, { recursive: true });
mkdirSync(external, { recursive: true });
writeFileSync(path.join(hidden, 'secret.txt'), 'SYNTHETIC_SECRET');
writeFileSync(path.join(external, 'input.txt'), 'EXTERNAL');
for (const [target, name] of [[hidden, 'internal-link'], [external, 'external-link']]) {
  if (!existsSync(path.join(current, name))) symlinkSync(target, path.join(current, name), 'junction');
}
// 回归真实漏洞：子文件的显式 Users:R 曾绕过父目录的继承 deny。
execFileSync('icacls.exe', [path.join(root, 'secret.txt'), '/grant', '*S-1-5-32-545:(R)']);
const environment = Object.entries(process.env).filter(([name]) => !name.startsWith('='))
  .map(([name, value]) => ({ name, value }));
const policy = ({ approved = false, writable = true } = {}) => ({
  helperPath,
  protectedRoots: [root],
  readableRoots: approved ? [root] : [current],
  writeRoots: writable ? [approved ? root : current] : [],
});
const invocation = source => ({ executablePath: process.execPath, argv: ['-e', source], cwd: current, environment });

function deadline(promise, stage, milliseconds = 45_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout: ${stage}`)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

async function start(source, permissions, { pty = false, full = false } = {}) {
  const owner = full
    ? binding.createWindowsOwnedPipeProcess(invocation(source))
    : await deadline(pty
      ? binding.createWindowsIsolatedPtyProcess(invocation(source), permissions, 80, 24)
      : binding.createWindowsIsolatedPipeProcess(invocation(source), permissions), 'create');
  const identity = pty ? undefined : owner.rootProcessIdentityForTest();
  const output = [];
  let resolveRoot;
  let rejectRoot;
  const rootExit = new Promise((resolve, reject) => { resolveRoot = resolve; rejectRoot = reject; });
  const events = new Map();
  let observationError;
  owner.startObservers(([event, data, code, error]) => {
    events.set(event, (events.get(event) ?? 0) + 1);
    if (data) output.push(Buffer.from(data));
    if (event === 'root_exit') resolveRoot(code);
    if (event === 'observer_error') {
      observationError = new Error(error);
      rejectRoot(observationError);
    }
    return true;
  });
  if (pty) owner.resize(100, 36);
  owner.resumeAfterObserversReady();
  return {
    owner,
    identity,
    diagnostics: () => ({ identity, events: Object.fromEntries(events), output: Buffer.concat(output).toString('utf8') }),
    text: () => Buffer.concat(output).toString('utf8'),
    async finish(expectedCode = 0) {
      let code;
      try { code = await deadline(rootExit, 'root exit'); }
      catch (error) { throw new Error(`${error}; events=${JSON.stringify(Object.fromEntries(events))}; output=${Buffer.concat(output).toString('utf8')}`, { cause: error }); }
      finally {
        // root exit 不能替代树清理；PTY release 必须先发生，终端输出才能到 EOF。
        await deadline(owner.terminateAndWaitTreeEmpty(), 'tree empty');
        await deadline(owner.release(), 'release');
      }
      if (observationError) throw observationError;
      assert.equal(code, expectedCode, Buffer.concat(output).toString('utf8'));
      assert.equal(events.get('root_exit'), 1);
      if (pty) assert.equal(events.get('terminal_eof'), 1);
      else {
        assert.equal(events.get('stdout_eof'), 1);
        assert.equal(events.get('stderr_eof'), 1);
      }
      return Buffer.concat(output).toString('utf8');
    },
  };
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitFor(test, label) {
  await deadline((async () => { while (!test()) await delay(30); })(), label);
}

if (process.argv[5] === '--holder') {
  const holder = await start(`const fs=require('fs');setInterval(()=>fs.appendFileSync('crash-heartbeat.txt','x'),30);`, policy());
  console.log('HOLDER_READY');
  setInterval(() => holder.text(), 1000);
  await new Promise(() => {});
}

if (process.argv[5] === '--full-only') {
  const full = await start(`const fs=require('fs');if(fs.readFileSync('../secret.txt','utf8')!=='SYNTHETIC_SECRET')throw Error('full read');console.log('FULL_WITHOUT_ISOLATION');`, undefined, { full: true });
  assert.match(await full.finish(), /FULL_WITHOUT_ISOLATION/);
  console.log('PASS full access with account service stopped and missing isolation helper');
  process.exit(0);
}

if (['--dynamic-only', '--raw-move-negative'].includes(process.argv[5])) {
  const watcher = await start(`const fs=require('fs');let rounds=0;console.log('DYNAMIC_READY');setInterval(()=>{for(const name of ['../dynamic-credential.txt','../dynamic-import.txt','../dynamic-moved.txt']){try{fs.readFileSync(name);throw Error('DYNAMIC LEAK '+name)}catch(e){if(!['EACCES','EPERM','ENOENT'].includes(e.code))throw e}}if(++rounds===40)process.exit(0)},30);`, policy({ writable: false }));
  await waitFor(() => watcher.text().includes('DYNAMIC_READY'), 'dynamic read readiness');
  writeFileSync(path.join(root, '.credential.tmp'), 'SYNTHETIC', { mode: 0o600 });
  renameSync(path.join(root, '.credential.tmp'), path.join(root, 'dynamic-credential.txt'));
  execFileSync('icacls.exe', [path.join(external, 'input.txt'), '/grant', '*S-1-5-32-545:(R)']);
  copyFileSync(path.join(external, 'input.txt'), path.join(root, 'dynamic-import.txt'));
  const moving = path.join(external, 'moving.txt');
  writeFileSync(moving, 'SYNTHETIC');
  execFileSync('icacls.exe', [moving, '/grant', '*S-1-5-32-545:(R)']);
  if (process.argv[5] === '--raw-move-negative') {
    // NTFS 保留外部文件的旧 ACL。这个负对照证明 Host 入库不能直接 move/link 外部 inode。
    renameSync(moving, path.join(root, 'dynamic-moved.txt'));
    await assert.rejects(watcher.finish(), /DYNAMIC LEAK/);
    console.log('NEGATIVE CONTROL: raw external rename preserves unsafe ACL; protected staging is required');
    process.exit(0);
  }
  const staging = path.join(root, '.incoming.tmp');
  copyFileSync(moving, staging);
  renameSync(staging, path.join(root, 'dynamic-moved.txt'));
  await watcher.finish();
  console.log('PASS live storage: atomic credentials and imported file remain protected');
  process.exit(0);
}

if (process.argv[5] === '--churn-only') {
  // 文件变动来自另一个 Host 进程，不用同步 I/O 填满被测 native owner 的 JS 事件循环。
  const writer = spawn(process.execPath, ['-e', `
    const fs=require('fs'),path=require('path');let rounds=0;
    const timer=setInterval(()=>{for(let index=0;index<12;index++){
      const file=path.join(process.argv[1],'.temporary-'+index+'.txt');
      fs.writeFileSync(file,'SYNTHETIC');fs.rmSync(file);
    }rounds++},10);
    process.on('message',()=>{clearInterval(timer);console.log(rounds);process.disconnect()});
    process.send('ready');
  `, root], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let writerOutput = '';
  writer.stdout.on('data', data => { writerOutput += data; });
  writer.stderr.on('data', data => { process.stderr.write(data); });
  const writerExit = new Promise(resolve => writer.once('exit', resolve));
  await deadline(new Promise(resolve => writer.once('message', resolve)), 'writer ready');
  try {
    for (let index = 0; index < 5; index += 1) {
      const command = await start(`console.log('ROOT_BOOTED');const fs=require('fs');try{fs.readFileSync('../secret.txt');throw Error('LEAK')}catch(e){if(!['EACCES','EPERM'].includes(e.code))throw e}console.log('DENIED');`, policy());
      console.log('CHURN_CREATED', index, JSON.stringify(command.identity));
      const diagnostic = setTimeout(() => console.log('CHURN_PROGRESS', JSON.stringify(command.diagnostics())), 5000);
      assert.match(await command.finish(), /DENIED/);
      clearTimeout(diagnostic);
    }
  } finally {
    writer.send('stop');
    assert.equal(await deadline(writerExit, 'writer exit'), 0);
  }
  const rounds = Number(writerOutput.trim());
  assert.ok(rounds > 0);
  console.log(`PASS concurrent file creation/removal while preparing and releasing commands: ${rounds} batches`);
  process.exit(0);
}

const blockedRead = `
const fs=require('fs'),cp=require('child_process');
if(fs.readFileSync('input.txt','utf8')!=='INPUT')throw Error('input mismatch');
try{fs.readFileSync('../secret.txt');throw Error('SECRET LEAK')}catch(e){if(e.code!=='EACCES'&&e.code!=='EPERM')throw e;console.log('SECRET_DENIED')}
try{fs.readFileSync('internal-link/secret.txt');throw Error('JUNCTION LEAK')}catch(e){if(e.code!=='EACCES'&&e.code!=='EPERM')throw e;console.log('JUNCTION_DENIED')}
if(fs.readFileSync('external-link/input.txt','utf8')!=='EXTERNAL')throw Error('external read');
try{fs.writeFileSync('external-link/escaped.txt','BAD');throw Error('JUNCTION WRITE LEAK')}catch(e){if(e.code!=='EACCES'&&e.code!=='EPERM')throw e;console.log('JUNCTION_WRITE_DENIED')}
const child=cp.spawnSync(process.execPath,['-e',"const fs=require('fs');try{fs.readFileSync('../secret.txt');process.exit(99)}catch(e){if(e.code!=='EACCES'&&e.code!=='EPERM')throw e;console.log('CHILD_DENIED')}"],{encoding:'utf8'});
if(child.error)throw child.error;if(child.status!==0)throw Error(child.stderr);process.stdout.write(child.stdout);
`;
let running = await start(blockedRead + `fs.writeFileSync('output.txt','OK');console.log('WRITE_OK');`, policy());
assert.match(await running.finish(), /WRITE_OK/);
console.log('PASS standard: explicit child ACL, Node child, current directory write, lifecycle');

running = await start(blockedRead + `try{fs.writeFileSync('readonly.txt','BAD');throw Error('WRITE LEAK')}catch(e){if(e.code!=='EACCES'&&e.code!=='EPERM')throw e;console.log('WRITE_DENIED')}`, policy({ writable: false }));
assert.match(await running.finish(), /WRITE_DENIED/);
console.log('PASS read-only: protected reads and writes denied');

const approved = await start(`
const fs=require('fs');let count=0;
const interval=setInterval(()=>{if(fs.readFileSync('../secret.txt','utf8')!=='SYNTHETIC_SECRET')throw Error('bad canary');count++;},40);
console.log('APPROVED_RUNNING');setTimeout(()=>{clearInterval(interval);console.log('APPROVED_READS='+count)},5000);
`, policy({ approved: true }));
const denied = await start(blockedRead, policy());
assert.doesNotMatch(approved.text(), /APPROVED_READS=/, 'denied command must start while approved command is running');
assert.match(await denied.finish(), /SECRET_DENIED/);
assert.match(await approved.finish(), /APPROVED_READS=/);
running = await start(blockedRead, policy());
assert.match(await running.finish(), /SECRET_DENIED/);
console.log('PASS parallel approved/denied identities and subsequent unapproved command');

running = await start(blockedRead + `if(!process.stdin.isTTY)throw Error('not TTY');process.stdin.once('data',d=>{console.log('PTY_INPUT='+d.toString().trim());console.log('PTY_SIZE='+process.stdout.columns+'x'+process.stdout.rows);process.exit(0)});`, policy(), { pty: true });
await running.owner.writeInput(Buffer.from('hello\r'));
const terminal = await running.finish();
assert.match(terminal, /PTY_INPUT=hello/);
assert.match(terminal, /PTY_SIZE=100x36/);
console.log('PASS native ConPTY: input, resize, protected reads and release');

running = await start(`const fs=require('fs');if(fs.readFileSync('../secret.txt','utf8')!=='SYNTHETIC_SECRET')throw Error('full read');console.log('FULL_ACCESS');`, undefined, { full: true });
assert.match(await running.finish(), /FULL_ACCESS/);
assert.equal(readFileSync(path.join(current, 'output.txt'), 'utf8'), 'OK');
console.log('PASS full access and retained command artifact');

rmSync(path.join(current, 'cancel-heartbeat.txt'), { force: true });
running = await start(`const fs=require('fs'),cp=require('child_process');cp.spawn(process.execPath,['-e',"const fs=require('fs');setInterval(()=>fs.appendFileSync('cancel-heartbeat.txt','x'),30)"],{stdio:'ignore'});console.log('CANCEL_READY');setInterval(()=>{},1000);`, policy());
await waitFor(() => existsSync(path.join(current, 'cancel-heartbeat.txt')), 'cancel heartbeat');
await running.owner.terminateAndWaitTreeEmpty();
await running.finish(1);
const stoppedSize = statSync(path.join(current, 'cancel-heartbeat.txt')).size;
await delay(300);
assert.equal(statSync(path.join(current, 'cancel-heartbeat.txt')).size, stoppedSize);
console.log('PASS cancellation: descendants stop before permissions/account release');

rmSync(path.join(current, 'crash-heartbeat.txt'), { force: true });
const holder = spawn(process.execPath, [fileURLToPath(import.meta.url), bindingPath, helperPath, root, '--holder'], { stdio: ['ignore', 'pipe', 'pipe'] });
let holderOutput = '';
let holderError = '';
holder.stdout.on('data', bytes => { holderOutput += bytes; });
holder.stderr.on('data', bytes => { holderError += bytes; });
await waitFor(() => holderOutput.includes('HOLDER_READY'), `holder readiness (${holderError})`);
await waitFor(() => existsSync(path.join(current, 'crash-heartbeat.txt')), 'crash heartbeat');
const holderClosed = new Promise(resolve => holder.once('close', resolve));
holder.kill('SIGKILL');
await deadline(holderClosed, 'holder termination');
await delay(1500);
const crashSize = statSync(path.join(current, 'crash-heartbeat.txt')).size;
await delay(300);
assert.equal(statSync(path.join(current, 'crash-heartbeat.txt')).size, crashSize);
running = await start(blockedRead, policy());
assert.match(await running.finish(), /SECRET_DENIED/);
console.log('PASS owner crash: service stops command and next launch recovers ACL journal');

await assert.rejects(binding.createWindowsIsolatedPipeProcess({
  ...invocation(''), executablePath: path.join(root, 'missing-executable.exe'),
}, policy()), /worker_/);
await delay(500);
running = await start(blockedRead, policy());
assert.match(await running.finish(), /SECRET_DENIED/);
console.log('PASS failed process creation: next command remains protected');

const bulk = path.join(root, 'bulk');
mkdirSync(bulk, { recursive: true });
for (let index = 0; index < 1000; index += 1) writeFileSync(path.join(bulk, `${index}.txt`), 'SYNTHETIC');
const began = Date.now();
running = await start(blockedRead, policy());
const created = Date.now();
await running.finish();
console.log(`PASS 1000 stored files: prepare=${created - began}ms total=${Date.now() - began}ms`);

const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const auditSource = `
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$bytes=Get-ItemPropertyValue 'HKCU:\\Software\\Linnlabs\\CommandIsolation\\Filesystem' -Name LeasesV1
$journal=[Text.Encoding]::UTF8.GetString([byte[]]$bytes)|ConvertFrom-Json
$files=@(Get-Item '${root.replaceAll("'", "''")}')+@(Get-ChildItem '${root.replaceAll("'", "''")}' -Recurse -Force)
$unknown=@($files|ForEach-Object{(Get-Acl $_.FullName).Access|Where-Object{$_.IdentityReference.Value -like 'S-1-5-21-*'}})
@{records=@($journal.records).Count;orphanAces=$unknown.Count}|ConvertTo-Json -Compress
`;
const audit = JSON.parse(execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(auditSource, 'utf16le').toString('base64')], { encoding: 'utf8' }));
assert.deepEqual(audit, { records: 0, orphanAces: 0 });
console.log('PASS recovery journal empty and no orphan account ACEs on stored files');
