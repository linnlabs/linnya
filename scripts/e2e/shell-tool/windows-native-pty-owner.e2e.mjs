import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';

const fixtureDirectory = fileURLToPath(
  new URL('./fixtures/windows-native-pty-owner/', import.meta.url),
);
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const nativeManifest = path.join(
  repositoryRoot,
  'src/infra/adapters/command-runtime/windows/native/Cargo.toml',
);
const sshHost = process.env.LINNYA_WINDOWS_SSH_HOST;
const sshUser = process.env.LINNYA_WINDOWS_SSH_USER;
const sshKey = process.env.LINNYA_WINDOWS_SSH_KEY;
const OUTPUT_LIMIT = 4 * 1024 * 1024;

if (process.platform !== 'darwin') {
  throw new Error('Windows native PTY owner E2E 必须从 macOS 控制端运行');
}
if (!sshHost || !sshUser || !sshKey || !path.isAbsolute(sshKey)) {
  throw new Error(
    '必须设置 LINNYA_WINDOWS_SSH_HOST、LINNYA_WINDOWS_SSH_USER 和绝对路径 '
      + 'LINNYA_WINDOWS_SSH_KEY',
  );
}

function appendBounded(chunks, byteLength, chunk) {
  chunks.push(chunk);
  let total = byteLength + chunk.length;
  while (total > OUTPUT_LIMIT && chunks.length > 1) {
    total -= chunks.shift().length;
  }
  return total;
}

function run(file, args, { cwd = repositoryRoot, timeoutMs = 360_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      detached: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') reject(error);
      }
    }, timeoutMs);
    child.stdout.on('data', chunk => {
      stdoutBytes = appendBounded(stdout, stdoutBytes, chunk);
    });
    child.stderr.on('data', chunk => {
      stderrBytes = appendBounded(stderr, stderrBytes, chunk);
    });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8').trim(),
        stderr: Buffer.concat(stderr).toString('utf8').trim(),
      };
      if (timedOut) {
        reject(new Error(`${file} 超过 ${timeoutMs}ms；stderr=${result.stderr}`));
      } else {
        resolve(result);
      }
    });
  });
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function encodePowerShell(source) {
  return Buffer.from(source, 'utf16le').toString('base64');
}

function quoteWindowsArgument(value) {
  const text = String(value);
  if (text.length > 0 && !/[\s"]/u.test(text)) return text;
  let result = '"';
  let pendingBackslashes = 0;
  for (const character of text) {
    if (character === '\\') {
      pendingBackslashes += 1;
    } else if (character === '"') {
      result += '\\'.repeat(pendingBackslashes * 2 + 1) + '"';
      pendingBackslashes = 0;
    } else {
      result += '\\'.repeat(pendingBackslashes) + character;
      pendingBackslashes = 0;
    }
  }
  return result + '\\'.repeat(pendingBackslashes * 2) + '"';
}

async function runRemotePowerShell(sshArgs, sshTarget, source, timeoutMs = 60_000) {
  const result = await run('ssh', [
    ...sshArgs,
    sshTarget,
    'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    encodePowerShell(
      `$ErrorActionPreference = 'Stop'\n`
        + '[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)\n'
        + source,
    ),
  ], { timeoutMs });
  if (result.code !== 0) {
    throw new Error(`远端 PowerShell 失败：${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function controllerSource({
  nodePath,
  nodeArguments,
  runToken,
  controllerIdentity,
  workerIdentity,
}) {
  return [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)',
    'function Publish-Identity([string]$Path, [string]$Role, [Diagnostics.Process]$Process) {',
    '  $identity = [pscustomobject]@{',
    '    version = 1',
    `    runToken = ${quotePowerShell(runToken)}`,
    '    role = $Role',
    '    processId = $Process.Id',
    '    creationFileTime = $Process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()',
    '  } | ConvertTo-Json -Compress',
    "  $pending = $Path + '.pending'",
    '  [IO.File]::WriteAllText($pending, $identity)',
    '  if (Test-Path -LiteralPath $Path) { Remove-Item -Force -LiteralPath $Path }',
    '  [IO.File]::Move($pending, $Path)',
    '}',
    `$controllerIdentity = ${quotePowerShell(controllerIdentity)}`,
    `$workerIdentity = ${quotePowerShell(workerIdentity)}`,
    '$controller = [Diagnostics.Process]::GetCurrentProcess()',
    "Publish-Identity $controllerIdentity 'controller' $controller",
    '$worker = $null',
    'try {',
    '  $startInfo = New-Object Diagnostics.ProcessStartInfo',
    `  $startInfo.FileName = ${quotePowerShell(nodePath)}`,
    `  $startInfo.Arguments = ${quotePowerShell(nodeArguments)}`,
    '  $startInfo.UseShellExecute = $false',
    '  $startInfo.CreateNoWindow = $true',
    '  $startInfo.RedirectStandardOutput = $true',
    '  $startInfo.RedirectStandardError = $true',
    "  $startInfo.EnvironmentVariables['UV_THREADPOOL_SIZE'] = '4'",
    '  $worker = New-Object Diagnostics.Process',
    '  $worker.StartInfo = $startInfo',
    "  if (-not $worker.Start()) { throw 'remote Node worker did not start' }",
    "  Publish-Identity $workerIdentity 'worker' $worker",
    '  $stdout = $worker.StandardOutput.ReadToEndAsync()',
    '  $stderr = $worker.StandardError.ReadToEndAsync()',
    '  $worker.WaitForExit()',
    '  [Console]::Out.Write($stdout.GetAwaiter().GetResult())',
    '  [Console]::Error.Write($stderr.GetAwaiter().GetResult())',
    '  exit $worker.ExitCode',
    '} finally {',
    '  Remove-Item -Force -LiteralPath $workerIdentity -ErrorAction SilentlyContinue',
    '  Remove-Item -Force -LiteralPath $controllerIdentity -ErrorAction SilentlyContinue',
    '  if ($null -ne $worker) { $worker.Dispose() }',
    '  $controller.Dispose()',
    '}',
  ].join('\n');
}

function teardownSource(runToken, identityPaths) {
  return [
    'function Stop-ExactIdentity([string]$Path) {',
    '  if (-not (Test-Path -LiteralPath $Path)) { return }',
    '  $identity = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json',
    `  if ($identity.version -ne 1 -or $identity.runToken -ne ${quotePowerShell(runToken)}) {`,
    '    throw "teardown identity 不匹配：$Path"',
    '  }',
    '  try {',
    '    $process = [Diagnostics.Process]::GetProcessById([int]$identity.processId)',
    '    try {',
    '      $same = $process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -eq [string]$identity.creationFileTime',
    '      if ($same) {',
    '        Stop-Process -Id $process.Id -Force',
    '        if (-not $process.WaitForExit(10000)) { throw "精准进程未退出：$Path" }',
    '      }',
    '    } finally { $process.Dispose() }',
    '  } catch [System.ArgumentException] { } catch [System.InvalidOperationException] { }',
    '}',
    `foreach ($path in @(${identityPaths.map(quotePowerShell).join(', ')})) {`,
    '  Stop-ExactIdentity $path',
    '  Remove-Item -Force -LiteralPath $path -ErrorAction SilentlyContinue',
    '}',
    'exit 0',
  ].join('\n');
}

const isolatedRoot = await createIsolatedRunRoot();
const sshTarget = `${sshUser}@${sshHost}`;
const sshArgs = ['-i', sshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];
const runToken = randomUUID().replaceAll('-', '');
const remoteTemp = `C:/Users/${sshUser}/AppData/Local/Temp`;
const remoteRoot = `${remoteTemp}/Linnya Native PTY ${runToken}`;
const remoteArchive = `${remoteTemp}/linnya-native-pty-${runToken}.tar.gz`;
const identityPaths = [];
let primaryError;
let teardownError;
let results;

try {
  const [cargoMetadataResult, applicationPackageText] = await Promise.all([
    run('cargo', [
      'metadata', '--no-deps', '--format-version=1', '--manifest-path', nativeManifest,
    ]),
    fsp.readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  ]);
  assert.equal(cargoMetadataResult.code, 0, cargoMetadataResult.stderr);
  const cargoMetadata = JSON.parse(cargoMetadataResult.stdout);
  const applicationPackage = JSON.parse(applicationPackageText);
  assert.equal(cargoMetadata.packages.length, 1);
  const runtimeVersion = cargoMetadata.packages[0].version;
  const applicationVersion = applicationPackage.version;
  assert.equal(typeof runtimeVersion, 'string');
  assert.equal(typeof applicationVersion, 'string');

  const stagingRoot = path.join(isolatedRoot.path, 'validation');
  await fsp.mkdir(stagingRoot, { recursive: true });
  await fsp.cp(fixtureDirectory, path.join(stagingRoot, 'fixture'), { recursive: true });

  const productionAdapterBundle = path.join(
    stagingRoot,
    'fixture',
    'production-adapter-suite.cjs',
  );
  const bundle = await run('pnpm', [
    'exec', 'esbuild',
    path.join(fixtureDirectory, 'production-adapter-suite.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${productionAdapterBundle}`,
  ]);
  assert.equal(bundle.code, 0, bundle.stderr || bundle.stdout);

  const artifacts = [];
  const productionArtifacts = [];
  for (const [architecture, target] of [
    ['x64', 'x86_64-pc-windows-msvc'],
    ['arm64', 'aarch64-pc-windows-msvc'],
  ]) {
    const build = await run('cargo', [
      'xwin', 'build', '--locked', '--manifest-path', nativeManifest, '--release', '--target', target,
      '--features', 'test-fault-injection',
    ]);
    assert.equal(build.code, 0, build.stderr || build.stdout);
    const source = path.join(
      path.dirname(nativeManifest),
      `target/${target}/release/linnya_command_process_owner.dll`,
    );
    const destination = path.join(stagingRoot, `linnyaCommandProcessOwner.${architecture}.node`);
    await fsp.copyFile(source, destination);
    artifacts.push({ architecture, destination });

    const productionBuild = await run('cargo', [
      'xwin', 'build', '--locked', '--manifest-path', nativeManifest, '--release', '--target', target,
    ]);
    assert.equal(productionBuild.code, 0, productionBuild.stderr || productionBuild.stdout);
    const productionDirectory = path.join(stagingRoot, `production-${architecture}`);
    await fsp.mkdir(productionDirectory, { recursive: true });
    const productionArtifact = path.join(
      productionDirectory,
      'linnyaCommandProcessOwner.node',
    );
    await fsp.copyFile(source, productionArtifact);
    const productionBytes = await fsp.readFile(productionArtifact);
    const manifestPath = path.join(
      productionDirectory,
      'linnyaCommandProcessOwner.manifest.json',
    );
    await fsp.writeFile(manifestPath, JSON.stringify({
      schema_version: 1,
      runtime_id: 'linnya_command_process_owner',
      runtime_version: runtimeVersion,
      application_version: applicationVersion,
      platform: 'win32',
      architecture,
      minimum_node_api_version: 8,
      binding_contract_version: 1,
      signature_evidence: { kind: 'development_unsigned' },
      artifact: {
        file_name: 'linnyaCommandProcessOwner.node',
        size_bytes: productionBytes.byteLength,
        sha256: createHash('sha256').update(productionBytes).digest('hex'),
      },
    }));
    productionArtifacts.push({ architecture });
  }

  const archive = path.join(isolatedRoot.path, `native-pty-${runToken}.tar.gz`);
  const archived = await run('tar', ['-czf', archive, '-C', isolatedRoot.path, 'validation']);
  assert.equal(archived.code, 0, archived.stderr || archived.stdout);
  const copied = await run('scp', [
    ...sshArgs,
    archive,
    `${sshTarget}:/C:${remoteArchive.slice(2)}`,
  ]);
  assert.equal(copied.code, 0, copied.stderr || copied.stdout);
  await runRemotePowerShell(sshArgs, sshTarget, [
    `New-Item -ItemType Directory -Force -Path ${quotePowerShell(remoteRoot)} | Out-Null`,
    `& tar.exe -xzf ${quotePowerShell(remoteArchive)} -C ${quotePowerShell(remoteRoot)}`,
    'if ($LASTEXITCODE -ne 0) { throw "tar exit=$LASTEXITCODE" }',
  ].join('\n'));

  results = [];
  for (const { architecture } of artifacts) {
    const nodePath = process.env[`LINNYA_WINDOWS_NODE_${architecture.toUpperCase()}_PATH`]
      ?? `${remoteTemp}/linnya-napi-spike/node-v22.23.1-win-${architecture}/node.exe`;
    const remoteValidation = `${remoteRoot}/validation`;
    const remoteScript = `${remoteValidation}/fixture/remote-suite.mjs`;
    const remoteFixture = `${remoteValidation}/fixture/pty-child.cjs`;
    const remoteBinding = `${remoteValidation}/linnyaCommandProcessOwner.${architecture}.node`;
    const suiteRoot = `${remoteValidation}/suite-${architecture}-中文`;
    const controllerIdentity = `${remoteTemp}/native-pty-${runToken}-${architecture}-controller.json`;
    const workerIdentity = `${remoteTemp}/native-pty-${runToken}-${architecture}-worker.json`;
    identityPaths.unshift(controllerIdentity);
    identityPaths.unshift(workerIdentity);
    const nodeArguments = [
      '--expose-gc', remoteScript, remoteBinding, remoteFixture, suiteRoot, architecture,
    ].map(quoteWindowsArgument).join(' ');
    const execution = await run('ssh', [
      ...sshArgs,
      sshTarget,
      'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encodePowerShell(controllerSource({
        nodePath,
        nodeArguments,
        runToken,
        controllerIdentity,
        workerIdentity,
      })),
    ], { timeoutMs: 600_000 });
    assert.equal(execution.code, 0, execution.stderr || execution.stdout);
    const result = JSON.parse(execution.stdout.split(/\r?\n/u).filter(Boolean).at(-1));
    assert.equal(result.success, true);
    assert.equal(result.architecture, architecture);
    assert.equal(result.inputCancellation.poolSize, 4);
    results.push(result);
  }
  for (const { architecture } of productionArtifacts) {
    const nodePath = process.env[`LINNYA_WINDOWS_NODE_${architecture.toUpperCase()}_PATH`]
      ?? `${remoteTemp}/linnya-napi-spike/node-v22.23.1-win-${architecture}/node.exe`;
    const remoteValidation = `${remoteRoot}/validation`;
    const remoteManifest = `${remoteValidation}/production-${architecture}/linnyaCommandProcessOwner.manifest.json`;
    const remoteScript = `${remoteValidation}/fixture/production-adapter-suite.cjs`;
    const remoteFixture = `${remoteValidation}/fixture/pty-child.cjs`;
    const suiteRoot = `${remoteValidation}/production-suite-${architecture}-中文`;
    const controllerIdentity = `${remoteTemp}/native-pty-${runToken}-production-${architecture}-controller.json`;
    const workerIdentity = `${remoteTemp}/native-pty-${runToken}-production-${architecture}-worker.json`;
    identityPaths.unshift(controllerIdentity);
    identityPaths.unshift(workerIdentity);
    const nodeArguments = [
      remoteScript,
      remoteManifest,
      remoteFixture,
      suiteRoot,
      runtimeVersion,
      applicationVersion,
      architecture,
    ].map(quoteWindowsArgument).join(' ');
    const execution = await run('ssh', [
      ...sshArgs,
      sshTarget,
      'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encodePowerShell(controllerSource({
        nodePath,
        nodeArguments,
        runToken,
        controllerIdentity,
        workerIdentity,
      })),
    ], { timeoutMs: 600_000 });
    assert.equal(execution.code, 0, execution.stderr || execution.stdout);
    const result = JSON.parse(execution.stdout.split(/\r?\n/u).filter(Boolean).at(-1));
    assert.equal(result.success, true);
    assert.equal(result.architecture, architecture);
    assert.equal(result.productionAdapter, true);
    results.push(result);
  }
} catch (error) {
  primaryError = error;
} finally {
  const cleanupFailures = [];
  try {
    await runRemotePowerShell(
      sshArgs,
      sshTarget,
      teardownSource(runToken, identityPaths),
    );
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    await runRemotePowerShell(sshArgs, sshTarget, [
      // Windows Defender/loader 可能在 worker 退出后短暂保留刚加载的 .node 文件句柄；
      // 只重试本轮精确目录，不按进程名扫描，也不把瞬时占用误报成业务树残留。
      '$deadline = [DateTime]::UtcNow.AddSeconds(60)',
      `while ((Test-Path -LiteralPath ${quotePowerShell(remoteRoot)}) -and [DateTime]::UtcNow -lt $deadline) {`,
      `  try { Remove-Item -Recurse -Force -LiteralPath ${quotePowerShell(remoteRoot)} -ErrorAction Stop; break }`,
      // PowerShell provider 会把同一种文件占用包装成多种异常；这里的作用域已经是
      // 本轮 UUID 精确目录，统一重试后仍由 deadline 和 Test-Path 负责 fail closed。
      '  catch { Start-Sleep -Milliseconds 50 }',
      '}',
      `if (Test-Path -LiteralPath ${quotePowerShell(remoteRoot)}) { throw '远端 PTY 测试目录仍被占用' }`,
      `Remove-Item -Force -LiteralPath ${quotePowerShell(remoteArchive)} -ErrorAction SilentlyContinue`,
    ].join('\n'));
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    await isolatedRoot.cleanup();
  } catch (error) {
    cleanupFailures.push(error);
  }
  if (cleanupFailures.length === 1) {
    [teardownError] = cleanupFailures;
  } else if (cleanupFailures.length > 1) {
    teardownError = new AggregateError(cleanupFailures, 'Windows native PTY 多项收尾失败');
  }
}

if (primaryError && teardownError) {
  throw new AggregateError([primaryError, teardownError], 'Windows native PTY 验证与收尾同时失败');
}
if (primaryError) throw primaryError;
if (teardownError) throw teardownError;

console.log(JSON.stringify({ success: true, runToken, results }));
