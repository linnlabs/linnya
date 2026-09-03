import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

import { app } from 'electron';

import {
  WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME,
  WINDOWS_OWNED_PIPE_NATIVE_MANIFEST_FILE_NAME,
  WindowsNativeRuntimeLoadError,
} from '../../../../../src/infra/adapters/local-process-runtime/windows/definitions/windowsNativeRuntimeManifest';
import {
  createWindowsOwnedPipeNativeBindingLoader,
  type WindowsOwnedPipeNativeBindingLoaderOptions,
} from '../../../../../src/infra/adapters/local-process-runtime/windows/functions/loadWindowsOwnedPipeNativeBinding';
import { createWindowsJobOwnedPipeProcessLauncher } from '../../../../../src/infra/adapters/local-process-runtime/windows';

const RESULT_PATH = process.env.LINNYA_WINDOWS_NATIVE_RUNTIME_RESULT_PATH;
const RUN_ROOT = process.env.LINNYA_WINDOWS_NATIVE_RUNTIME_RUN_ROOT;
declare const LINNYA_EXPECTED_WINDOWS_NATIVE_RUNTIME_VERSION: string;

const EXPECTED_OUTPUT = 'packaged-native-runtime-ok';

if (!RESULT_PATH || !path.isAbsolute(RESULT_PATH)) {
  throw new Error('LINNYA_WINDOWS_NATIVE_RUNTIME_RESULT_PATH must be absolute');
}
if (!RUN_ROOT || !path.isAbsolute(RUN_ROOT)) {
  throw new Error('LINNYA_WINDOWS_NATIVE_RUNTIME_RUN_ROOT must be absolute');
}

function publishResult(value: unknown): Promise<void> {
  const pendingPath = `${RESULT_PATH}.${process.pid}.pending`;
  return fsp.writeFile(pendingPath, JSON.stringify(value))
    .then(() => fsp.rename(pendingPath, RESULT_PATH));
}

function readAll(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.once('end', () => resolve(Buffer.concat(chunks)));
    stream.once('error', reject);
  });
}

function createLoaderOptions(manifestPath: string): WindowsOwnedPipeNativeBindingLoaderOptions {
  return {
    manifestPath,
    expectedRuntimeVersion: LINNYA_EXPECTED_WINDOWS_NATIVE_RUNTIME_VERSION,
    expectedApplicationVersion: app.getVersion(),
    trust: { kind: 'development' },
  };
}

async function runRealCommand(manifestPath: string): Promise<{
  readonly output: string;
  readonly exitCode: number;
}> {
  const binding = await createWindowsOwnedPipeNativeBindingLoader(
    createLoaderOptions(manifestPath),
  ).load();
  const launch = createWindowsJobOwnedPipeProcessLauncher(binding);
  const ownedProcess = await launch({
    executablePath: process.env.ComSpec
      ?? path.win32.join('C:/', 'Windows', 'System32', 'cmd.exe'),
    argv: ['/d', '/s', '/c', `echo ${EXPECTED_OUTPUT}`],
    cwd: RUN_ROOT,
    environment: Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => (
        entry[1] !== undefined
      )),
    ),
  });
  const stdout = readAll(ownedProcess.stdout);
  const stderr = readAll(ownedProcess.stderr);
  try {
    const exit = await ownedProcess.rootExit;
    await ownedProcess.rootClose;
    const stderrText = (await stderr).toString('utf8').trim();
    if (stderrText.length > 0) throw new Error(`command stderr: ${stderrText}`);
    return {
      output: (await stdout).toString('utf8').trim(),
      exitCode: exit.exitCode ?? -1,
    };
  } finally {
    await ownedProcess.release();
  }
}

async function expectLoadError(manifestPath: string): Promise<string> {
  try {
    await createWindowsOwnedPipeNativeBindingLoader(
      createLoaderOptions(manifestPath),
    ).load();
  } catch (error) {
    if (error instanceof WindowsNativeRuntimeLoadError) return error.code;
    throw error;
  }
  throw new Error(`expected runtime load failure: ${manifestPath}`);
}

async function readManifest(manifestPath: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('runtime manifest must be an object');
  }
  return Object.fromEntries(Object.entries(value));
}

async function copyRuntime(sourceDirectory: string, name: string): Promise<string> {
  const targetDirectory = path.join(RUN_ROOT, 'scenarios', name);
  await fsp.cp(sourceDirectory, targetDirectory, { recursive: true });
  return targetDirectory;
}

async function writeManifest(
  runtimeDirectory: string,
  transform: (manifest: Record<string, unknown>) => Record<string, unknown>,
): Promise<string> {
  const manifestPath = path.join(
    runtimeDirectory,
    WINDOWS_OWNED_PIPE_NATIVE_MANIFEST_FILE_NAME,
  );
  const manifest = transform(await readManifest(manifestPath));
  await fsp.writeFile(manifestPath, JSON.stringify(manifest));
  return manifestPath;
}

async function runSuite(): Promise<unknown> {
  if (process.platform !== 'win32' || process.arch !== 'x64' || !app.isPackaged) {
    throw new Error('suite requires packaged Windows x64 Electron');
  }
  const runtimeDirectory = path.join(
    process.resourcesPath,
    'command-runtime/windows/x64',
  );
  const manifestPath = path.join(
    runtimeDirectory,
    WINDOWS_OWNED_PIPE_NATIVE_MANIFEST_FILE_NAME,
  );
  const artifactPath = path.join(
    runtimeDirectory,
    WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME,
  );
  const runtimeRealPath = await fsp.realpath(runtimeDirectory);
  if (runtimeRealPath.split(/[\\/]+/u).includes('app.asar')) {
    throw new Error('native runtime was packaged inside app.asar');
  }
  const artifactBytes = await fsp.readFile(artifactPath);
  const packagedManifest = await readManifest(manifestPath);

  const normal = await runRealCommand(manifestPath);

  const missingDirectory = await copyRuntime(runtimeDirectory, 'missing-current-artifact');
  const missingArtifact = path.join(
    missingDirectory,
    WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME,
  );
  await fsp.rm(missingArtifact);
  const fallbackDirectory = path.join(RUN_ROOT, 'fallback with 空格');
  await fsp.mkdir(fallbackDirectory, { recursive: true });
  await fsp.writeFile(
    path.join(fallbackDirectory, WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME),
    artifactBytes,
  );
  const originalCwd = process.cwd();
  const originalPath = process.env.PATH;
  let missingCode: string;
  try {
    process.chdir(fallbackDirectory);
    process.env.PATH = fallbackDirectory;
    missingCode = await expectLoadError(path.join(
      missingDirectory,
      WINDOWS_OWNED_PIPE_NATIVE_MANIFEST_FILE_NAME,
    ));
  } finally {
    process.chdir(originalCwd);
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }

  const changedByteDirectory = await copyRuntime(runtimeDirectory, 'changed-byte');
  const changedArtifactPath = path.join(
    changedByteDirectory,
    WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME,
  );
  const changedBytes = await fsp.readFile(changedArtifactPath);
  changedBytes[changedBytes.byteLength - 1] ^= 0xff;
  await fsp.writeFile(changedArtifactPath, changedBytes);
  const changedByteCode = await expectLoadError(path.join(
    changedByteDirectory,
    WINDOWS_OWNED_PIPE_NATIVE_MANIFEST_FILE_NAME,
  ));

  const wrongArchitectureDirectory = await copyRuntime(runtimeDirectory, 'wrong-architecture');
  const wrongArchitectureCode = await expectLoadError(await writeManifest(
    wrongArchitectureDirectory,
    manifest => ({ ...manifest, architecture: 'arm64' }),
  ));

  const oldApplicationDirectory = await copyRuntime(runtimeDirectory, 'old-application');
  const oldApplicationCode = await expectLoadError(await writeManifest(
    oldApplicationDirectory,
    manifest => ({ ...manifest, application_version: '0.0.37' }),
  ));

  const oldRuntimeDirectory = await copyRuntime(runtimeDirectory, 'old-runtime');
  const oldRuntimeCode = await expectLoadError(await writeManifest(
    oldRuntimeDirectory,
    manifest => ({ ...manifest, runtime_version: '0.0.9' }),
  ));

  const repairedDirectory = await copyRuntime(runtimeDirectory, 'repaired');
  const repaired = await runRealCommand(path.join(
    repairedDirectory,
    WINDOWS_OWNED_PIPE_NATIVE_MANIFEST_FILE_NAME,
  ));

  return {
    success: true,
    packaged: app.isPackaged,
    platform: process.platform,
    architecture: process.arch,
    electron: process.versions.electron,
    appVersion: app.getVersion(),
    runtimeRealPath,
    artifactSize: artifactBytes.byteLength,
    artifactSha256: createHash('sha256').update(artifactBytes).digest('hex'),
    manifestArtifact: packagedManifest.artifact,
    normal,
    repaired,
    failures: {
      missingCurrentArtifact: missingCode,
      changedByte: changedByteCode,
      wrongArchitecture: wrongArchitectureCode,
      oldApplication: oldApplicationCode,
      oldRuntime: oldRuntimeCode,
    },
  };
}

void app.whenReady().then(async () => {
  try {
    await publishResult(await runSuite());
    app.exit(0);
  } catch (error) {
    await publishResult({
      success: false,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    app.exit(1);
  }
});
