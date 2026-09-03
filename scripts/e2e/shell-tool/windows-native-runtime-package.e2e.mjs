import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import { bindElectronVersion } from './harness/electronRuntimeIdentity.mjs';

const fixtureDirectory = fileURLToPath(
  new URL('./fixtures/windows-native-runtime-package/', import.meta.url),
);
const windowsControllerPath = fileURLToPath(
  new URL('./windows-native-runtime-package.e2e.ps1', import.meta.url),
);
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const afterSignHookPath = path.join(
  repositoryRoot,
  'build/after-sign-runtime-assets.cjs',
);
const afterSignDriverPath = path.join(fixtureDirectory, 'after-sign-driver.mjs');
const sourceRuntimeDirectory = path.join(
  repositoryRoot,
  'dist/main/commands/runtime/windows/x64',
);
const sourceSandboxRuntimeDirectory = path.join(
  repositoryRoot,
  'extraResources/headless-node-runtime/win32/x64',
);
const sourceSandboxEvaluatorPath = path.join(
  repositoryRoot,
  'dist/main/sandbox/sandboxEvaluatorProcess.cjs',
);
const sandboxRuntimeCatalogPath = path.join(
  repositoryRoot,
  'config/headless-node-runtime.json',
);
const artifactFileName = 'linnyaCommandProcessOwner.node';
const manifestFileName = 'linnyaCommandProcessOwner.manifest.json';
const sshHost = process.env.LINNYA_WINDOWS_SSH_HOST;
const sshUser = process.env.LINNYA_WINDOWS_SSH_USER;
const sshKey = process.env.LINNYA_WINDOWS_SSH_KEY;
const OUTPUT_LIMIT = 256 * 1024;

if (process.platform !== 'darwin') {
  throw new Error('Windows native runtime packaged E2E must be controlled from macOS');
}
if (!sshHost || !sshUser || !sshKey || !path.isAbsolute(sshKey)) {
  throw new Error(
    'Windows E2E requires LINNYA_WINDOWS_SSH_HOST, LINNYA_WINDOWS_SSH_USER, '
      + 'and absolute LINNYA_WINDOWS_SSH_KEY',
  );
}

function run(file, args, { cwd = repositoryRoot, env = process.env, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
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
    child.stdout.on('data', chunk => {
      stdout = `${stdout}${chunk.toString('utf8')}`.slice(-OUTPUT_LIMIT);
    });
    child.stderr.on('data', chunk => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-OUTPUT_LIMIT);
    });
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
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(
        `${file} failed: code=${code ?? 'unknown'} signal=${signal ?? 'none'} `
          + `stderr=${stderr} stdout=${stdout}`,
      ));
    });
  });
}

async function removeRemoteFiles(sshArgs, sshTarget, remotePaths) {
  const source = remotePaths
    .map(remotePath => `Remove-Item -LiteralPath '${remotePath.replaceAll("'", "''")}' -Force -ErrorAction SilentlyContinue`)
    .join('; ');
  await run('ssh', [
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

async function main() {
  const isolatedRoot = await createIsolatedRunRoot();
  let success = false;
  try {
    await run('node', [
      'scripts/build/prepare-headless-node-runtime.cjs',
      '--allow-cross-target',
    ], {
      env: {
        ...process.env,
        LINNYA_BUILD_TARGET_PLATFORM: 'win32',
        LINNYA_BUILD_TARGET_ARCH: 'x64',
      },
    });
    await run('pnpm', ['run', 'build:sandbox-runner']);
    await run('node', ['scripts/build/commands/build-windows-command-native-runtime.mjs'], {
      env: {
        ...process.env,
        LINNYA_BUILD_TARGET_PLATFORM: 'win32',
        LINNYA_BUILD_TARGET_ARCH: 'x64',
      },
    });
    const projectDirectory = path.join(isolatedRoot.path, 'project with 空格');
    const runtimeTarget = path.join(projectDirectory, 'runtime/x64');
    const validationTarget = path.join(projectDirectory, 'validation');
    const sandboxRuntimeTarget = path.join(projectDirectory, 'headless-node-runtime/win32/x64');
    const sandboxTarget = path.join(projectDirectory, 'sandbox');
    const configTarget = path.join(projectDirectory, 'config');
    await Promise.all([
      fsp.mkdir(runtimeTarget, { recursive: true }),
      fsp.mkdir(validationTarget, { recursive: true }),
      fsp.mkdir(sandboxRuntimeTarget, { recursive: true }),
      fsp.mkdir(sandboxTarget, { recursive: true }),
      fsp.mkdir(configTarget, { recursive: true }),
    ]);
    const sourceManifest = JSON.parse(await fsp.readFile(
      path.join(sourceRuntimeDirectory, manifestFileName),
      'utf8',
    ));
    assert.equal(typeof sourceManifest.runtime_version, 'string');
    assert.equal(typeof sourceManifest.application_version, 'string');
    const fixturePackage = bindElectronVersion(JSON.parse(await fsp.readFile(
      path.join(fixtureDirectory, 'package.json'),
      'utf8',
    )));
    fixturePackage.version = sourceManifest.application_version;
    await Promise.all([
      fsp.writeFile(
        path.join(projectDirectory, 'package.json'),
        `${JSON.stringify(fixturePackage, null, 2)}\n`,
      ),
      fsp.cp(sourceRuntimeDirectory, runtimeTarget, { recursive: true }),
      fsp.cp(sourceSandboxRuntimeDirectory, sandboxRuntimeTarget, { recursive: true }),
      fsp.copyFile(
        sourceSandboxEvaluatorPath,
        path.join(sandboxTarget, 'sandboxEvaluatorProcess.cjs'),
      ),
      fsp.copyFile(
        sandboxRuntimeCatalogPath,
        path.join(configTarget, 'headless-node-runtime.json'),
      ),
      fsp.copyFile(
        afterSignHookPath,
        path.join(validationTarget, 'after-sign-runtime-assets.cjs'),
      ),
      fsp.copyFile(
        afterSignDriverPath,
        path.join(validationTarget, 'after-sign-driver.mjs'),
      ),
    ]);
    await run('pnpm', [
      'exec',
      'esbuild',
      path.join(fixtureDirectory, 'main.ts'),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--target=node20',
      '--external:electron',
      `--define:LINNYA_EXPECTED_WINDOWS_NATIVE_RUNTIME_VERSION=${JSON.stringify(sourceManifest.runtime_version)}`,
      `--outfile=${path.join(projectDirectory, 'main.cjs')}`,
    ]);
    const outputDirectory = path.join(isolatedRoot.path, 'package-output');
    await run('pnpm', [
      'exec',
      'electron-builder',
      '--projectDir',
      projectDirectory,
      '--dir',
      '--win',
      '--x64',
      `--config.directories.output=${outputDirectory}`,
    ], {
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    });

    const unpackedDirectory = path.join(outputDirectory, 'win-unpacked');
    const packagedRuntimeDirectory = path.join(
      unpackedDirectory,
      'resources/command-runtime/windows/x64',
    );
    const [artifactBytes, manifestText] = await Promise.all([
      fsp.readFile(path.join(packagedRuntimeDirectory, artifactFileName)),
      fsp.readFile(path.join(packagedRuntimeDirectory, manifestFileName), 'utf8'),
    ]);
    const manifest = JSON.parse(manifestText);
    assert.equal(manifest.signature_evidence.kind, 'development_unsigned');
    assert.equal(manifest.artifact.size_bytes, artifactBytes.byteLength);
    assert.equal(
      manifest.artifact.sha256,
      createHash('sha256').update(artifactBytes).digest('hex'),
    );

    const token = randomUUID().replaceAll('-', '');
    const archivePath = path.join(isolatedRoot.path, `native-runtime-${token}.tar.gz`);
    await run('tar', ['-czf', archivePath, '-C', outputDirectory, 'win-unpacked']);
    const sshTarget = `${sshUser}@${sshHost}`;
    const sshArgs = ['-i', sshKey, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];
    const remoteArchive = `C:/Users/${sshUser}/AppData/Local/Temp/linnya-native-runtime-${token}.tar.gz`;
    const remoteController = `C:/Users/${sshUser}/AppData/Local/Temp/linnya-native-runtime-${token}.ps1`;
    try {
      await run('scp', [
        ...sshArgs,
        archivePath,
        `${sshTarget}:/C:/Users/${sshUser}/AppData/Local/Temp/linnya-native-runtime-${token}.tar.gz`,
      ]);
      await run('scp', [
        ...sshArgs,
        windowsControllerPath,
        `${sshTarget}:/C:/Users/${sshUser}/AppData/Local/Temp/linnya-native-runtime-${token}.ps1`,
      ]);
      const remoteResult = await run('ssh', [
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
      ]);
      const summary = JSON.parse(remoteResult.stdout.trim().split(/\r?\n/u).at(-1));
      assert.equal(summary.success, true);
      assert.equal(summary.platform, 'win32');
      assert.equal(summary.architecture, 'x64');
      assert.equal(summary.normalOutput, 'packaged-native-runtime-ok');
      assert.equal(summary.repairedOutput, 'packaged-native-runtime-ok');
      assert.equal(summary.directoryUnlockedAfterExit, true);
      assert.equal(summary.developmentAfterSignVerified, true);
      console.log(JSON.stringify({
        success: true,
        electron: summary.electron,
        appVersion: summary.appVersion,
        artifactSize: summary.artifactSize,
        artifactSha256: summary.artifactSha256,
        failures: summary.failures,
        developmentAfterSignVerified: summary.developmentAfterSignVerified,
        directoryUnlockedAfterExit: summary.directoryUnlockedAfterExit,
      }));
    } finally {
      await removeRemoteFiles(sshArgs, sshTarget, [remoteArchive, remoteController]);
    }
    success = true;
  } finally {
    await isolatedRoot.cleanup();
    if (!success) console.error('Windows native runtime packaged E2E failed after cleanup');
  }
}

await main();
