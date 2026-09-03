import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import { bindElectronVersion } from './harness/electronRuntimeIdentity.mjs';

const fixtureDirectory = fileURLToPath(
  new URL('./fixtures/windows-current-host-cli-corpus/', import.meta.url)
);
const controllerPath = fileURLToPath(
  new URL('./windows-current-host-cli-corpus.e2e.ps1', import.meta.url)
);
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const runtimeDirectory = path.join(repositoryRoot, 'dist/main/commands/runtime/windows/x64');
const sshHost = process.env.LINNYA_WINDOWS_SSH_HOST;
const sshUser = process.env.LINNYA_WINDOWS_SSH_USER;
const sshKey = process.env.LINNYA_WINDOWS_SSH_KEY;
const outputLimit = 256 * 1024;

if (process.platform !== 'darwin')
  throw new Error('Windows corpus must be orchestrated from macOS');
if (!sshHost || !sshUser || !sshKey || !path.isAbsolute(sshKey)) {
  throw new Error('Windows corpus requires LINNYA_WINDOWS_SSH_HOST/USER/KEY');
}

function appendBounded(current, chunk) {
  return `${current}${chunk.toString('utf8')}`.slice(-outputLimit);
}

function run(file, args, { cwd = repositoryRoot, env = process.env, timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', chunk => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on('data', chunk => {
      stderr = appendBounded(stderr, chunk);
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`${file} exceeded ${timeoutMs}ms`));
      else resolve({ code, signal, stdout, stderr });
    });
  });
}

async function runChecked(file, args, options) {
  const result = await run(file, args, options);
  if (result.code !== 0) {
    throw new Error(
      `${file} failed: code=${result.code} stderr=${result.stderr} stdout=${result.stdout}`
    );
  }
  return result;
}

async function createProject(root) {
  const project = path.join(root, 'project');
  await mkdir(path.join(project, 'commands'), { recursive: true });
  await runChecked('pnpm', ['run', 'build:schemas']);
  await runChecked('pnpm', ['run', 'build:command-runner']);
  await runChecked('node', ['scripts/build/commands/build-windows-command-native-runtime.mjs'], {
    env: { ...process.env, LINNYA_BUILD_TARGET_PLATFORM: 'win32', LINNYA_BUILD_TARGET_ARCH: 'x64' },
  });
  await cp(runtimeDirectory, path.join(project, 'runtime/windows/x64'), { recursive: true });
  await runChecked('pnpm', [
    'exec',
    'esbuild',
    path.join(fixtureDirectory, 'main.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    '--external:electron',
    '--external:better-sqlite3',
    '--external:node-pty',
    '--external:sharp',
    '--external:tiktoken',
    '--external:harfbuzzjs',
    '--external:yoga-layout',
    '--external:pdfjs-dist',
    '--external:pdfjs-dist/legacy/build/pdf',
    '--external:@node-rs/jieba',
    '--alias:@plugin/backend=./src/plugin-sdk/backend',
    `--outfile=${path.join(project, 'main.cjs')}`,
  ]);
  await copyFile(
    path.join(repositoryRoot, 'dist/main/commands/commandRunnerUtilityProcess.cjs'),
    path.join(project, 'commands/commandRunnerUtilityProcess.cjs')
  );
  await copyFile(
    path.join(
      repositoryRoot,
      'packages/plugins/slides/src/backend/codegen/compose/flex-layout/yogaRuntimeLoader.cjs'
    ),
    path.join(project, 'yogaRuntimeLoader.cjs')
  );
  await mkdir(path.join(project, 'host-cli-fixtures'));
  await Promise.all(
    ['host-cli-cmd.cmd', 'host-cli-bat.bat'].map(name =>
      copyFile(path.join(fixtureDirectory, name), path.join(project, 'host-cli-fixtures', name))
    )
  );
  const manifest = bindElectronVersion(
    JSON.parse(await readFile(path.join(fixtureDirectory, 'package.json'), 'utf8'))
  );
  const runtimeManifest = JSON.parse(
    await readFile(path.join(runtimeDirectory, 'linnyaCommandProcessOwner.manifest.json'), 'utf8')
  );
  manifest.version = runtimeManifest.application_version;
  await writeFile(path.join(project, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await runChecked(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--include=optional',
      '--os=win32',
      '--cpu=x64',
      '--package-lock=false',
    ],
    { cwd: project }
  );
  const sqliteRoot = path.join(project, 'node_modules/better-sqlite3');
  await stat(path.join(sqliteRoot, 'prebuilds/win32-x64.node'));
  return project;
}

function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function cleanupAndVerifyRemote(sshArgs, target, paths) {
  const source = [
    "$ErrorActionPreference = 'Stop'",
    `$root = ${quotePowerShell(paths.runRoot)}`,
    `$archive = ${quotePowerShell(paths.archive)}`,
    `$controller = ${quotePowerShell(paths.controller)}`,
    `$appProcessId = ${paths.appProcessId ?? '$null'}`,
    "$extendedRoot = '\\\\?\\' + [IO.Path]::GetFullPath($root)",
    '$deadline = [DateTime]::UtcNow.AddSeconds(15)',
    '$deleteError = $null',
    'while (Test-Path -LiteralPath $root) {',
    '  try {',
    '    [IO.Directory]::Delete($extendedRoot, $true)',
    '  } catch [System.IO.IOException] {',
    '    $deleteError = $_.Exception',
    '  } catch [System.UnauthorizedAccessException] {',
    '    $deleteError = $_.Exception',
    '  }',
    '  if (-not (Test-Path -LiteralPath $root)) { break }',
    '  if ([DateTime]::UtcNow -ge $deadline) { break }',
    '  Start-Sleep -Milliseconds 50',
    '}',
    'Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue',
    'Remove-Item -LiteralPath $controller -Force -ErrorAction SilentlyContinue',
    '$appProcess = if ($null -eq $appProcessId) { @() } else {',
    '  @(Get-Process -Id $appProcessId -ErrorAction SilentlyContinue)',
    '}',
    '$facts = [ordered]@{',
    '  runRoot = [int](Test-Path -LiteralPath $root)',
    '  archive = [int](Test-Path -LiteralPath $archive)',
    '  controller = [int](Test-Path -LiteralPath $controller)',
    '  appProcess = [int]$appProcess.Count',
    '}',
    'if ($facts.runRoot -or $facts.archive -or $facts.controller -or $facts.appProcess) {',
    "  $detail = if ($null -eq $deleteError) { '' } else { '; delete=' + $deleteError.Message }",
    "  throw ('remote cleanup postcondition failed: ' + ($facts | ConvertTo-Json -Compress) + $detail)",
    '}',
    '$facts | ConvertTo-Json -Compress',
  ].join('\n');
  const encoded = Buffer.from(source, 'utf16le').toString('base64');
  const result = await runChecked('ssh', [
    ...sshArgs,
    target,
    'powershell',
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    encoded,
  ]);
  return JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));
}

async function validateWindows(project, root) {
  const output = path.join(root, 'output');
  await runChecked('pnpm', [
    'exec',
    'electron-builder',
    '--projectDir',
    project,
    '--dir',
    '--win',
    '--x64',
    `--config.directories.output=${output}`,
  ]);
  const token = randomUUID().replaceAll('-', '');
  const archive = path.join(root, `windows-host-cli-${token}.tar.gz`);
  await runChecked('tar', ['-czf', archive, '-C', output, 'win-unpacked']);
  const target = `${sshUser}@${sshHost}`;
  const sshArgs = ['-i', sshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];
  const remoteArchive = `C:/Users/${sshUser}/AppData/Local/Temp/linnya-host-cli-${token}.tar.gz`;
  const remoteController = `C:/Users/${sshUser}/AppData/Local/Temp/linnya-host-cli-${token}.ps1`;
  const remoteRunRoot = `C:/Users/${sshUser}/AppData/Local/Temp/linnya-windows-host-cli-${token}`;
  let appProcessId;
  try {
    await runChecked('scp', [
      ...sshArgs,
      archive,
      `${target}:/C:/Users/${sshUser}/AppData/Local/Temp/linnya-host-cli-${token}.tar.gz`,
    ]);
    await runChecked('scp', [
      ...sshArgs,
      controllerPath,
      `${target}:/C:/Users/${sshUser}/AppData/Local/Temp/linnya-host-cli-${token}.ps1`,
    ]);
    const remote = await runChecked(
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
        '-File',
        remoteController,
        '-ArchivePath',
        remoteArchive,
        '-RunRoot',
        remoteRunRoot,
      ],
      { timeoutMs: 240_000 }
    );
    const result = JSON.parse(remote.stdout.trim().split(/\r?\n/u).at(-1));
    appProcessId = result.appProcessId;
    return result;
  } finally {
    await cleanupAndVerifyRemote(sshArgs, target, {
      runRoot: remoteRunRoot,
      archive: remoteArchive,
      controller: remoteController,
      appProcessId,
    });
  }
}

const isolated = await createIsolatedRunRoot('windows-current-host-cli-corpus');
try {
  const project = await createProject(isolated.path);
  const result = await validateWindows(project, isolated.path);
  assert.equal(result.success, true);
  assert.equal(result.platform, 'win32');
  assert.equal(result.architecture, 'x64');
  assert.equal(Number.isInteger(result.appProcessId), true);
  assert.equal(result.shell, 'powershell-5.1');
  assert.equal(result.pythonAliasExecuted, false);
  assert.deepEqual(
    result.cases.map(item => [item.id, item.exitCode]),
    [
      ['app-owner-environment', 0],
      ['powershell', 0],
      ['where-exe', 0],
      ['curl-exe', 0],
      ['tar-exe', 0],
      ['cmd-shim', 0],
      ['bat-shim', 37],
      ['missing', 1],
      ['python-store-alias', 0],
    ]
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await isolated.cleanup();
}
