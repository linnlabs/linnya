import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import {
  bindElectronVersion,
  expectedElectronVersion,
} from './harness/electronRuntimeIdentity.mjs';

const fixtureDirectory = fileURLToPath(
  new URL('./fixtures/windows-production-agent-pty/', import.meta.url)
);
const controllerPath = fileURLToPath(
  new URL('./windows-production-agent-pty.e2e.ps1', import.meta.url)
);
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const sourceRuntimeDirectory = path.join(repositoryRoot, 'dist/main/commands/runtime/windows/x64');
const runtimeManifestFileName = 'linnyaCommandProcessOwner.manifest.json';
const fuseCliPath = path.join(repositoryRoot, 'node_modules/@electron/fuses/dist/bin.js');
const asarCliPath = path.join(
  repositoryRoot,
  'node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/bin/asar.js'
);
const outputLimit = 256 * 1024;
const sshHost = process.env.LINNYA_WINDOWS_SSH_HOST;
const sshUser = process.env.LINNYA_WINDOWS_SSH_USER;
const sshKey = process.env.LINNYA_WINDOWS_SSH_KEY;

if (process.platform !== 'darwin') {
  throw new Error('Windows production Agent PTY E2E must be orchestrated from macOS');
}
if (!sshHost || !sshUser || !sshKey || !path.isAbsolute(sshKey)) {
  throw new Error(
    'Windows E2E requires LINNYA_WINDOWS_SSH_HOST, LINNYA_WINDOWS_SSH_USER, ' +
      'and absolute LINNYA_WINDOWS_SSH_KEY'
  );
}

function appendBounded(current, chunk) {
  return `${current}${chunk.toString('utf8')}`.slice(-outputLimit);
}

function runProcess(
  file,
  args,
  { cwd = repositoryRoot, env = process.env, timeoutMs = 120_000 } = {}
) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      detached: true,
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
    child.stdout.on('data', chunk => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on('data', chunk => {
      stderr = appendBounded(stderr, chunk);
    });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`${file} exceeded ${timeoutMs}ms; stderr=${stderr}; stdout=${stdout}`));
        return;
      }
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function runChecked(file, args, options) {
  const result = await runProcess(file, args, options);
  if (result.code !== 0) {
    throw new Error(
      `${file} failed: code=${result.code} signal=${result.signal ?? 'none'} ` +
        `stderr=${result.stderr} stdout=${result.stdout}`
    );
  }
  return result;
}

async function assertWindowsX64Pe(filePath) {
  const binary = await readFile(filePath);
  assert(binary.length >= 64, `${filePath} is too short to be a PE binary`);
  assert.equal(binary.subarray(0, 2).toString('ascii'), 'MZ');
  const peOffset = binary.readUInt32LE(0x3c);
  assert(peOffset + 6 <= binary.length, `${filePath} has an invalid PE offset`);
  assert.equal(binary.subarray(peOffset, peOffset + 4).toString('binary'), 'PE\0\0');
  assert.equal(binary.readUInt16LE(peOffset + 4), 0x8664, `${filePath} is not Windows x64`);
}

async function createBuildProject(isolatedRoot) {
  const projectDirectory = path.join(isolatedRoot, 'project');
  await mkdir(path.join(projectDirectory, 'commands'), { recursive: true });
  await runChecked('pnpm', ['run', 'build:schemas']);
  await runChecked('pnpm', ['run', 'build:command-runner']);
  // runner build 会清理 commands 输出目录，所以 native owner 必须在它之后生成。
  await runChecked('node', ['scripts/build/commands/build-windows-command-native-runtime.mjs'], {
    env: {
      ...process.env,
      LINNYA_BUILD_TARGET_PLATFORM: 'win32',
      LINNYA_BUILD_TARGET_ARCH: 'x64',
    },
    timeoutMs: 120_000,
  });
  const runtimeManifest = JSON.parse(
    await readFile(path.join(sourceRuntimeDirectory, runtimeManifestFileName), 'utf8')
  );
  assert.equal(typeof runtimeManifest.application_version, 'string');
  await cp(sourceRuntimeDirectory, path.join(projectDirectory, 'runtime/windows/x64'), {
    recursive: true,
  });

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
    '--external:@node-rs/jieba',
    '--alias:@plugin/backend=./src/plugin-sdk/backend',
    `--outfile=${path.join(projectDirectory, 'main.cjs')}`,
  ]);
  await copyFile(
    path.join(repositoryRoot, 'dist/main/commands/commandRunnerUtilityProcess.cjs'),
    path.join(projectDirectory, 'commands/commandRunnerUtilityProcess.cjs')
  );
  await copyFile(
    path.join(
      repositoryRoot,
      'packages/plugins/slides/src/backend/codegen/compose/flex-layout/yogaRuntimeLoader.cjs'
    ),
    path.join(projectDirectory, 'yogaRuntimeLoader.cjs')
  );
  await copyFile(
    path.join(
      repositoryRoot,
      'src/features/text-measurement/infrastructure/system/harfbuzzRuntimeLoader.cjs'
    ),
    path.join(projectDirectory, 'harfbuzzRuntimeLoader.cjs')
  );
  await mkdir(path.join(projectDirectory, 'command-fixtures'), { recursive: true });
  await copyFile(
    path.join(fixtureDirectory, 'interactive-cli.ps1'),
    path.join(projectDirectory, 'command-fixtures/interactive-cli.ps1')
  );
  const packageManifest = bindElectronVersion(
    JSON.parse(await readFile(path.join(fixtureDirectory, 'package.json'), 'utf8'))
  );
  packageManifest.version = runtimeManifest.application_version;
  await writeFile(
    path.join(projectDirectory, 'package.json'),
    `${JSON.stringify(packageManifest, null, 2)}\n`
  );

  // 生产图的启动闭包包含 Windows 原生 Sharp；必须按目标平台安装，不能复制开发机包。
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
    { cwd: projectDirectory, timeoutMs: 120_000 }
  );
  const sqliteRoot = path.join(projectDirectory, 'node_modules/better-sqlite3');
  await assertWindowsX64Pe(path.join(sqliteRoot, 'prebuilds/win32-x64.node'));
  await assertWindowsX64Pe(
    path.join(projectDirectory, 'node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node')
  );
  return projectDirectory;
}

async function inspectPackage(outputDirectory) {
  const executablePath = path.join(
    outputDirectory,
    'win-unpacked/Linnya Windows Production Agent Pty Validation.exe'
  );
  const resourcesPath = path.join(outputDirectory, 'win-unpacked/resources');
  const asarPath = path.join(resourcesPath, 'app.asar');
  const fuse = await runChecked(process.execPath, [fuseCliPath, 'read', '--app', executablePath]);
  assert.match(fuse.stdout, /RunAsNode is Disabled/u);
  const asar = await runChecked(process.execPath, [asarCliPath, 'list', asarPath]);
  const asarEntries = new Set(asar.stdout.split(/\r?\n/u));
  for (const entry of [
    '/main.cjs',
    '/commands/commandRunnerUtilityProcess.cjs',
    '/yogaRuntimeLoader.cjs',
    '/node_modules/better-sqlite3/lib/index.js',
    '/package.json',
  ]) {
    assert(asarEntries.has(entry), `app.asar is missing ${entry}`);
  }
  const inspectionDirectory = path.join(outputDirectory, 'asar-inspection');
  await mkdir(inspectionDirectory, { recursive: true });
  try {
    await runChecked(process.execPath, [asarCliPath, 'extract-file', asarPath, 'package.json'], {
      cwd: inspectionDirectory,
    });
    await runChecked(process.execPath, [asarCliPath, 'extract-file', asarPath, 'main.cjs'], {
      cwd: inspectionDirectory,
    });
    const packagedManifest = JSON.parse(
      await readFile(path.join(inspectionDirectory, 'package.json'), 'utf8')
    );
    assert.equal(packagedManifest.main, 'main.cjs');
    const packagedMain = await readFile(path.join(inspectionDirectory, 'main.cjs'), 'utf8');
    assert(
      packagedMain.includes('runProductionAgentPtyScenario'),
      'packaged main.cjs is missing the production Agent PTY scenario'
    );
  } finally {
    await rm(inspectionDirectory, { recursive: true, force: true });
  }
  const sqliteBinaryPath = path.join(
    resourcesPath,
    'app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node'
  );
  await assertWindowsX64Pe(sqliteBinaryPath);
  await assertWindowsX64Pe(
    path.join(
      resourcesPath,
      'app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node'
    )
  );
  for (const filePath of [
    path.join(resourcesPath, 'command-runtime/windows/x64/linnyaCommandProcessOwner.node'),
    path.join(resourcesPath, `command-runtime/windows/x64/${runtimeManifestFileName}`),
    path.join(resourcesPath, 'command-fixtures/interactive-cli.ps1'),
  ]) {
    await stat(filePath);
  }
  return executablePath;
}

async function removeRemoteFiles(sshArgs, sshTarget, remotePaths) {
  const source = remotePaths
    .map(
      remotePath =>
        `Remove-Item -LiteralPath '${remotePath.replaceAll("'", "''")}' -Force -ErrorAction SilentlyContinue`
    )
    .join('; ');
  await runChecked('ssh', [
    ...sshArgs,
    sshTarget,
    'powershell',
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    source,
  ]);
}

function assertSummary(summary) {
  assert.equal(summary.success, true);
  assert.equal(summary.version, 1);
  assert.equal(summary.platform, 'win32');
  assert.equal(summary.architecture, 'x64');
  assert.equal(summary.electron, expectedElectronVersion);
  assert(summary.durableCommandRows >= 11 && summary.durableCommandRows <= 24);
  assert.equal(summary.terminalOutcome, 'terminated');
  assert.equal(summary.terminalReason, 'cancelled');
  assert.equal(summary.lastProcessAction, 'poll');
  assert.equal(summary.terminalHandleReplayed, true);
  assert.equal(summary.screenColumns, 100);
  assert.equal(summary.screenRows, 31);
  assert(summary.rawTerminalBytes > 0);
  assert.equal(summary.userDataIsolated, true);
  assert.equal(summary.externallyObservedProcesses, 1);
  assert.equal(summary.externallyExitedProcesses, 1);
  assert.equal(summary.allObservedProcessesInJob, true);
}

async function runWindowsValidation(projectDirectory, buildRoot) {
  const outputDirectory = path.join(buildRoot, 'windows-output');
  await runChecked(
    'pnpm',
    [
      'exec',
      'electron-builder',
      '--projectDir',
      projectDirectory,
      '--dir',
      '--win',
      '--x64',
      `--config.directories.output=${outputDirectory}`,
    ],
    { timeoutMs: 180_000 }
  );
  await inspectPackage(outputDirectory);

  const token = randomUUID().replaceAll('-', '');
  const archivePath = path.join(buildRoot, `windows-production-agent-pty-${token}.tar.gz`);
  await runChecked('tar', ['-czf', archivePath, '-C', outputDirectory, 'win-unpacked'], {
    timeoutMs: 120_000,
  });

  const sshTarget = `${sshUser}@${sshHost}`;
  const sshArgs = ['-i', sshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];
  const remoteBase = `C:/Users/${sshUser}/AppData/Local/Temp/linnya-agent-${token}`;
  const remoteArchive = `${remoteBase}.tar.gz`;
  const remoteController = `${remoteBase}.ps1`;
  try {
    await runChecked(
      'scp',
      [
        ...sshArgs,
        archivePath,
        `${sshTarget}:/C:/Users/${sshUser}/AppData/Local/Temp/linnya-agent-${token}.tar.gz`,
      ],
      { timeoutMs: 120_000 }
    );
    await runChecked('scp', [
      ...sshArgs,
      controllerPath,
      `${sshTarget}:/C:/Users/${sshUser}/AppData/Local/Temp/linnya-agent-${token}.ps1`,
    ]);
    const result = await runChecked(
      'ssh',
      [
        ...sshArgs,
        sshTarget,
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
        '-ExpectedElectronVersion',
        expectedElectronVersion,
      ],
      { timeoutMs: 180_000 }
    );
    const summary = JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));
    assertSummary(summary);
    return summary;
  } finally {
    await removeRemoteFiles(sshArgs, sshTarget, [remoteArchive, remoteController]);
  }
}

const isolated = await createIsolatedRunRoot('windows-production-agent-pty');
let success = false;
try {
  const projectDirectory = await createBuildProject(isolated.path);
  const summary = await runWindowsValidation(projectDirectory, path.join(isolated.path, 'build'));
  success = true;
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await isolated.cleanup();
  if (!success) {
    process.stderr.write('Windows production Agent PTY E2E failed after isolated cleanup\n');
  }
}
