import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import {
  prepareWindowsCandidate,
  repositoryRoot,
  runCommand,
} from './windows/prepareWindowsCandidate.mjs';

const host = process.env.LINNYA_WINDOWS_SSH_HOST;
const user = process.env.LINNYA_WINDOWS_SSH_USER;
const key = process.env.LINNYA_WINDOWS_SSH_KEY;
const interactiveUser = process.env.LINNYA_WINDOWS_INTERACTIVE_USER;
assert.equal(process.platform, 'darwin');
assert.ok(
  host && user && path.isAbsolute(key ?? '') && /^[a-zA-Z0-9._-]+$/.test(interactiveUser ?? ''),
  'Set LINNYA_WINDOWS_SSH_HOST/USER/KEY and LINNYA_WINDOWS_INTERACTIVE_USER'
);
const evidence = createEvidence('windows-knowledge-plugin', {
  files: [
    'scripts/e2e/knowledge-plugin/windows.acceptance.mjs',
    ...[
      'prepareWindowsCandidate.mjs',
      'installedDesktopSession.mjs',
      'windowsScenario.mjs',
      'controller.ps1',
      'user-session.ps1',
    ].map(name => `scripts/e2e/knowledge-plugin/windows/${name}`),
  ],
});
const root = await mkdtemp(path.join(tmpdir(), 'linnya-windows-knowledge-'));
const token = randomUUID().replaceAll('-', '');
const sshArgs = ['-i', key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];
const target = `${user}@${host}`;
const ps = value => `'${value.replaceAll("'", "''")}'`;
const remote = source =>
  runCommand(
    'ssh',
    [
      ...sshArgs,
      target,
      'powershell',
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(source, 'utf16le').toString('base64'),
    ],
    { inherit: false, timeout: 23 * 60_000 }
  );
const controller = `C:/Users/${user}/AppData/Local/Temp/linnya-knowledge-${token}.ps1`;
const archive = `C:/Users/${user}/AppData/Local/Temp/linnya-knowledge-${token}.tar.gz`;
const reports = `C:/Users/${user}/AppData/Local/Temp/linnya-knowledge-${token}-reports.tar.gz`;
const taskName = `Linnya-Knowledge-${token}`;
let remoteRoot;
let remoteTouched = false;
let failed;
try {
  const common = await remote("[Console]::Write([Environment]::GetFolderPath('CommonDocuments'))");
  assert.ok(path.win32.isAbsolute(common));
  remoteRoot = path.win32.join(common, `linnya-knowledge-${token}`);
  const prepared = await evidence.check('同一源码构建真实Windows安装目录与插件artifact', () =>
    prepareWindowsCandidate(root)
  );
  evidence.json('candidate', prepared.candidate);
  const transfer = path.join(root, 'transfer');
  await mkdir(transfer);
  await cp(prepared.unpacked, path.join(transfer, 'win-unpacked'), { recursive: true });
  for (const name of ['scenario.mjs', 'candidate.json', 'images.json'])
    await cp(path.join(root, name), path.join(transfer, name));
  // Windows PowerShell 5 按 BOM 识别 UTF-8；中文注释不能以系统 ANSI 解码而吞掉下一行。
  await writeFile(
    path.join(transfer, 'user-session.ps1'),
    '\ufeff' + (await readFile(path.join(import.meta.dirname, 'windows/user-session.ps1'), 'utf8'))
  );
  const localArchive = path.join(root, 'candidate.tar.gz');
  await runCommand('tar', ['-czf', localArchive, '-C', transfer, '.']);
  remoteTouched = true;
  await runCommand('scp', [...sshArgs, localArchive, `${target}:/${archive}`]);
  await runCommand('scp', [
    ...sshArgs,
    path.join(import.meta.dirname, 'windows/controller.ps1'),
    `${target}:/${controller}`,
  ]);
  const session = JSON.parse(
    (
      await remote(
        `& ${ps(controller)} -ArchivePath ${ps(archive)} -RunRoot ${ps(remoteRoot)} -InteractiveUser ${ps(interactiveUser)} -TaskName ${ps(taskName)}`
      )
    )
      .split(/\r?\n/)
      .at(-1)
  );
  evidence.json('windows-session', session);
  assert.equal(session.success, true, JSON.stringify(session));
} catch (error) {
  failed = error;
  evidence.error(error);
} finally {
  if (remoteTouched) {
    try {
      // 只读回执先带回，再收尾唯一token范围；失败也保留真实Desktop日志与截图。
      await remote(
        `$ErrorActionPreference='Stop'; if(Test-Path -LiteralPath ${ps(remoteRoot)}) { Set-Location -LiteralPath ${ps(remoteRoot)}; $files=@(@('result.json','session.json','scenario.stdout.log','scenario.stderr.log','evidence') | Where-Object {Test-Path -LiteralPath $_}); if($files.Count -eq 0){throw 'No Windows evidence was produced'}; & tar.exe -czf ${ps(reports)} @files; if($LASTEXITCODE -ne 0){throw 'Evidence archive failed'} }`
      );
      const localReports = path.join(root, 'reports.tar.gz');
      await runCommand('scp', [...sshArgs, `${target}:/${reports}`, localReports]);
      const readback = path.join(root, 'readback');
      await mkdir(readback);
      await runCommand('tar', ['-xzf', localReports, '-C', readback]);
      async function attach(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) await attach(file);
          else evidence.artifact(file);
        }
      }
      await attach(readback);
      const result = JSON.parse(await readFile(path.join(readback, 'result.json'), 'utf8'));
      for (const item of result.checks)
        evidence.record(
          item.name,
          item.status,
          item.error ? { kind: 'error', message: item.error } : undefined
        );
      assert.equal(result.success, true, result.error);
    } catch (error) {
      failed ??= error;
      evidence.error(error);
    }
    try {
      const facts = JSON.parse(
        await remote(`
$ErrorActionPreference='Stop'
$root=${ps(remoteRoot)}
$prefix=[IO.Path]::GetFullPath($root).TrimEnd('\\')+'\\'
$owned=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) })
$exitDeadline=[DateTime]::UtcNow.AddSeconds(10)
while($owned.Count -gt 0 -and [DateTime]::UtcNow -lt $exitDeadline){Start-Sleep -Milliseconds 100;$owned=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) })}
foreach($process in $owned){Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue}
$task=Get-ScheduledTask -TaskName ${ps(taskName)} -ErrorAction SilentlyContinue
if($task){Stop-ScheduledTask -TaskName ${ps(taskName)}; Unregister-ScheduledTask -TaskName ${ps(taskName)} -Confirm:$false}
$deadline=[DateTime]::UtcNow.AddSeconds(15)
while(Test-Path -LiteralPath $root){try{[IO.Directory]::Delete(('\\\\?\\'+$root),$true)}catch [IO.IOException]{}catch [UnauthorizedAccessException]{};if([DateTime]::UtcNow -ge $deadline){break};Start-Sleep -Milliseconds 50}
foreach($file in @(${ps(archive)},${ps(controller)},${ps(reports)})){Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue}
$left=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) })
@{runRoot=[int](Test-Path -LiteralPath $root);processes=$left.Count;terminated=$owned.Count;scheduledTask=@(Get-ScheduledTask -TaskName ${ps(taskName)} -ErrorAction SilentlyContinue).Count;archives=@(@(${ps(archive)},${ps(controller)},${ps(reports)}) | Where-Object {Test-Path -LiteralPath $_}).Count} | ConvertTo-Json -Compress
`)
      );
      evidence.json('windows-cleanup', facts);
      assert.equal(facts.runRoot + facts.processes + facts.scheduledTask + facts.archives, 0);
      // 正常退出后不应靠controller杀掉残留进程来冒充产品收尾通过。
      if (!failed) assert.equal(facts.terminated, 0, 'App left processes requiring forced cleanup');
    } catch (error) {
      failed ??= error;
      evidence.error(error);
    }
  }
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: !failed, ...evidence.finish(), sourceRoot: repositoryRoot }));
}
if (failed) throw failed;
