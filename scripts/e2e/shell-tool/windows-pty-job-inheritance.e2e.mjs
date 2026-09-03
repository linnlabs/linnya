import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';

const fixtureDirectory = fileURLToPath(
  new URL('./fixtures/pty-job-inheritance/', import.meta.url),
);
const windowsControllerPath = fileURLToPath(
  new URL('./windows-pty-job-inheritance.e2e.ps1', import.meta.url),
);
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const sshHost = process.env.LINNYA_WINDOWS_SSH_HOST;
const sshUser = process.env.LINNYA_WINDOWS_SSH_USER;
const sshKey = process.env.LINNYA_WINDOWS_SSH_KEY;
const windowsNodeArm64Path = process.env.LINNYA_WINDOWS_NODE_ARM64_PATH
  ?? `C:/Users/${sshUser}/AppData/Local/Temp/linnya-napi-spike/node-v24.18.0-win-arm64/node.exe`;
const windowsNodeX64Path = process.env.LINNYA_WINDOWS_NODE_X64_PATH
  ?? `C:/Users/${sshUser}/AppData/Local/Temp/linnya-napi-spike/node-v24.18.0-win-x64/node.exe`;
const OUTPUT_LIMIT = 2 * 1024 * 1024;

const packages = [
  {
    spec: 'node-pty@1.2.0-beta.14',
    archiveName: 'node-pty-1.2.0-beta.14.tgz',
    sha256: '1c00a3190b95ac1639f39215d792366fd9cf91265e41a55fab152b65346baef0',
  },
  {
    spec: 'node-addon-api@7.1.1',
    archiveName: 'node-addon-api-7.1.1.tgz',
    sha256: 'b10455d15a977c0cd17a1cb0eb679e03d939f8ef8d4302eb33e1f78dacc71f82',
  },
];

if (process.platform !== 'darwin') {
  throw new Error('Validation 89 must be controlled from macOS');
}
if (!sshHost || !sshUser || !sshKey || !path.isAbsolute(sshKey)) {
  throw new Error(
    'Validation 89 requires LINNYA_WINDOWS_SSH_HOST, LINNYA_WINDOWS_SSH_USER, '
      + 'and absolute LINNYA_WINDOWS_SSH_KEY',
  );
}

function appendBounded(current, chunk) {
  return `${current}${chunk.toString('utf8')}`.slice(-OUTPUT_LIMIT);
}

function run(file, args, { cwd = repositoryRoot, timeoutMs = 360_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      detached: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') reject(error);
      }
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk); });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`${file} exceeded ${timeoutMs}ms; stderr=${stderr}`));
        return;
      }
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function encodePowerShell(source) {
  return Buffer.from(source, 'utf16le').toString('base64');
}

function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function sha256(filePath) {
  return createHash('sha256').update(await fsp.readFile(filePath)).digest('hex');
}

async function prepareValidationProject(isolatedRoot) {
  const packageRoot = path.join(isolatedRoot, 'packages');
  const projectRoot = path.join(isolatedRoot, 'validation');
  await Promise.all([
    fsp.mkdir(packageRoot, { recursive: true }),
    fsp.mkdir(projectRoot, { recursive: true }),
  ]);
  await fsp.writeFile(
    path.join(projectRoot, 'package.json'),
    `${JSON.stringify({ private: true, name: 'linnya-pty-job-validation' }, null, 2)}\n`,
  );
  for (const packageIdentity of packages) {
    const packed = await run('npm', [
      'pack', '--silent', packageIdentity.spec, '--pack-destination', packageRoot,
    ]);
    assert.equal(packed.code, 0, packed.stderr || packed.stdout);
    const archivePath = path.join(packageRoot, packageIdentity.archiveName);
    assert.equal(await sha256(archivePath), packageIdentity.sha256);
  }
  const installed = await run('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--no-save',
    ...packages.map(packageIdentity => path.join(packageRoot, packageIdentity.archiveName)),
  ], { cwd: projectRoot });
  assert.equal(installed.code, 0, installed.stderr || installed.stdout);
  await fsp.cp(fixtureDirectory, path.join(projectRoot, 'fixture'), { recursive: true });
  const packageMetadata = JSON.parse(
    await fsp.readFile(path.join(projectRoot, 'node_modules/node-pty/package.json'), 'utf8'),
  );
  assert.equal(packageMetadata.version, '1.2.0-beta.14');
  return projectRoot;
}

async function runSshPowerShell(sshArgs, sshTarget, source, timeoutMs = 60_000) {
  const result = await run('ssh', [
    ...sshArgs,
    sshTarget,
    'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    encodePowerShell(`$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)\n${source}`),
  ], { timeoutMs });
  if (result.code !== 0) {
    throw new Error(`remote PowerShell failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function controllerInvocationSource({
  remoteController,
  remoteValidationRoot,
  remoteIdentity,
  runToken,
}) {
  return `
$identityPath = ${quotePowerShell(remoteIdentity)}
$identity = [pscustomobject]@{
  version = 1
  runToken = ${quotePowerShell(runToken)}
  processId = $PID
  startTimeUtcTicks = ([Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().Ticks).ToString()
}
[IO.File]::WriteAllText($identityPath + '.pending', ($identity | ConvertTo-Json -Compress))
[IO.File]::Move($identityPath + '.pending', $identityPath)
try {
  & ${quotePowerShell(remoteController)} -ValidationRoot ${quotePowerShell(remoteValidationRoot)} -NodeArm64Path ${quotePowerShell(windowsNodeArm64Path)} -NodeX64Path ${quotePowerShell(windowsNodeX64Path)}
} finally {
  Remove-Item -LiteralPath $identityPath -Force -ErrorAction SilentlyContinue
}
`;
}

function exactTeardownSource(remoteIdentity, runToken) {
  return `
$path = ${quotePowerShell(remoteIdentity)}
if (Test-Path -LiteralPath $path) {
  $identity = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
  if ($identity.version -ne 1 -or $identity.runToken -ne ${quotePowerShell(runToken)}) {
    throw 'Validation 89 teardown identity mismatch'
  }
  try {
    $process = [Diagnostics.Process]::GetProcessById([int]$identity.processId)
    try {
      if ($process.StartTime.ToUniversalTime().Ticks.ToString() -eq [string]$identity.startTimeUtcTicks) {
        Stop-Process -Id $process.Id -Force
        $process.WaitForExit(10000)
      }
    } finally { $process.Dispose() }
  } catch [ArgumentException] {}
}
`;
}

const isolatedRoot = await createIsolatedRunRoot();
const sshTarget = `${sshUser}@${sshHost}`;
const sshArgs = ['-i', sshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];
const runToken = randomUUID().replaceAll('-', '');
const remoteTemp = `C:/Users/${sshUser}/AppData/Local/Temp`;
const remoteArchive = `${remoteTemp}/linnya-pty-job-${runToken}.tar.gz`;
const remoteController = `${remoteTemp}/linnya-pty-job-${runToken}.ps1`;
const remoteRunRoot = `${remoteTemp}/Linnya PTY Job ${runToken}`;
const remoteValidationRoot = `${remoteRunRoot}/validation`;
const remoteIdentity = `${remoteTemp}/linnya-pty-job-${runToken}.identity.json`;
let primaryError;
let teardownError;
let result;
try {
  const projectRoot = await prepareValidationProject(isolatedRoot.path);
  const stagingRoot = path.join(isolatedRoot.path, 'staging');
  await fsp.mkdir(stagingRoot, { recursive: true });
  await fsp.cp(projectRoot, path.join(stagingRoot, 'validation'), { recursive: true });
  const archivePath = path.join(isolatedRoot.path, `pty-job-${runToken}.tar.gz`);
  const archived = await run('tar', ['-czf', archivePath, '-C', stagingRoot, 'validation']);
  assert.equal(archived.code, 0, archived.stderr || archived.stdout);

  for (const [localPath, remotePath] of [
    [archivePath, remoteArchive],
    [windowsControllerPath, remoteController],
  ]) {
    const copied = await run('scp', [
      ...sshArgs,
      localPath,
      `${sshTarget}:/C:${remotePath.slice('C:'.length)}`,
    ]);
    assert.equal(copied.code, 0, copied.stderr || copied.stdout);
  }
  await runSshPowerShell(sshArgs, sshTarget, `
New-Item -ItemType Directory -Path ${quotePowerShell(remoteRunRoot)} -Force | Out-Null
& tar.exe -xzf ${quotePowerShell(remoteArchive)} -C ${quotePowerShell(remoteRunRoot)}
if ($LASTEXITCODE -ne 0) { throw "tar exit=$LASTEXITCODE" }
`);

  const execution = await run('ssh', [
    ...sshArgs,
    sshTarget,
    'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encodePowerShell(
      `$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)\n`
        + controllerInvocationSource({
          remoteController,
          remoteValidationRoot,
          remoteIdentity,
          runToken,
        }),
    ),
  ], { timeoutMs: 360_000 });
  assert.equal(execution.code, 0, execution.stderr || execution.stdout);
  const resultLine = execution.stdout.split(/\r?\n/u).filter(Boolean).at(-1);
  result = JSON.parse(resultLine);
  assert.equal(result.success, true);
  assert.equal(result.userIsAdministrator, false);
  assert.equal(result.nestedOuterJob, true);
  assert.deepEqual(result.results.map(item => item.architecture), ['arm64', 'x64']);
  assert.deepEqual(result.ownerCrash.map(item => item.architecture), ['arm64', 'x64']);
  for (const architecture of result.results) {
    assert.equal(architecture.natural.treeEmpty, true);
    assert.equal(architecture.cancel.treeEmpty, true);
    assert.equal(architecture.runnerCrash.ownerHandleCloseKilledTree, true);
    assert.equal(architecture.stress.rounds, 20);
  }
  for (const ownerCrash of result.ownerCrash) {
    assert.equal(ownerCrash.ownerHandleCloseKilledTree, true);
  }
} catch (error) {
  primaryError = error;
} finally {
  try {
    await runSshPowerShell(
      sshArgs,
      sshTarget,
      exactTeardownSource(remoteIdentity, runToken),
    );
    await runSshPowerShell(sshArgs, sshTarget, `
$deadline = [DateTime]::UtcNow.AddSeconds(20)
if (Test-Path -LiteralPath ${quotePowerShell(remoteRunRoot)}) {
  while ((Test-Path -LiteralPath ${quotePowerShell(remoteRunRoot)}) -and [DateTime]::UtcNow -lt $deadline) {
    try {
      Remove-Item -LiteralPath ${quotePowerShell(remoteRunRoot)} -Recurse -Force -ErrorAction Stop
      break
    } catch [System.IO.IOException] {} catch [System.UnauthorizedAccessException] {}
    Start-Sleep -Milliseconds 50
  }
}
if (Test-Path -LiteralPath ${quotePowerShell(remoteRunRoot)}) { throw 'Validation 89 run root remained locked' }
Remove-Item -LiteralPath ${quotePowerShell(remoteArchive)} -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath ${quotePowerShell(remoteController)} -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath ${quotePowerShell(remoteIdentity)} -Force -ErrorAction SilentlyContinue
exit 0
`);
  } catch (error) {
    teardownError = error;
  }
  try {
    await isolatedRoot.cleanup();
  } catch (error) {
    teardownError = teardownError
      ? new AggregateError([teardownError, error], 'Remote and local teardown failed')
      : error;
  }
}

if (primaryError && teardownError) {
  throw new AggregateError([primaryError, teardownError], 'Validation 89 failed and teardown also failed');
}
if (primaryError) throw primaryError;
if (teardownError) throw teardownError;

console.log(JSON.stringify({
  success: true,
  runToken,
  nodePtyVersion: '1.2.0-beta.14',
  result,
}));
