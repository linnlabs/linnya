#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../../..');
const nativeManifestPath = path.join(
  repositoryRoot,
  'src/infra/adapters/command-runtime/windows/native/Cargo.toml',
);
const packageJsonPath = path.join(repositoryRoot, 'package.json');
const artifactFileName = 'linnyaCommandProcessOwner.node';
const runtimeManifestFileName = 'linnyaCommandProcessOwner.manifest.json';

const architectureSpecs = Object.freeze({
  x64: Object.freeze({
    rustTarget: 'x86_64-pc-windows-msvc',
    peMachine: 0x8664,
  }),
  arm64: Object.freeze({
    rustTarget: 'aarch64-pc-windows-msvc',
    peMachine: 0xaa64,
  }),
});

function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,
    });
    if (!options.capture) {
      child.once('error', reject);
      child.once('close', code => {
        if (code === 0) resolve('');
        else reject(new Error(`${file} exited with code ${code ?? 'unknown'}`));
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(
        `${file} exited with code ${code ?? 'unknown'}: ${stderr.trim()}`,
      ));
    });
  });
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf8'));
}

function readRequiredString(record, key, label) {
  const value = record?.[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

async function readBuildIdentity() {
  const [metadataText, packageJson] = await Promise.all([
    run('cargo', [
      'metadata',
      '--no-deps',
      '--format-version=1',
      '--manifest-path',
      nativeManifestPath,
    ], { capture: true }),
    readJson(packageJsonPath),
  ]);
  const metadata = JSON.parse(metadataText);
  if (!Array.isArray(metadata.packages) || metadata.packages.length !== 1) {
    throw new Error('Windows command native Cargo metadata must contain one package');
  }
  const nativePackage = metadata.packages[0];
  const packageName = readRequiredString(
    nativePackage,
    'name',
    'Windows command native package name',
  );
  if (packageName !== 'linnya_command_process_owner') {
    throw new Error(`Unexpected Windows command native package: ${packageName}`);
  }
  return {
    runtimeVersion: readRequiredString(
      nativePackage,
      'version',
      'Windows command native package version',
    ),
    applicationVersion: readRequiredString(
      packageJson,
      'version',
      'Linnya application version',
    ),
    targetDirectory: path.resolve(readRequiredString(
      metadata,
      'target_directory',
      'Cargo target directory',
    )),
  };
}

function readPeMachine(bytes) {
  if (bytes.byteLength < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    throw new Error('Windows command native artifact is not a PE image');
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (
    peOffset + 6 > bytes.byteLength
    || bytes[peOffset] !== 0x50
    || bytes[peOffset + 1] !== 0x45
    || bytes[peOffset + 2] !== 0
    || bytes[peOffset + 3] !== 0
  ) {
    throw new Error('Windows command native artifact has an invalid PE header');
  }
  return bytes.readUInt16LE(peOffset + 4);
}

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.pending-${process.pid}-${randomUUID()}`;
  await fsp.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await fsp.rename(temporaryPath, filePath);
}

async function buildWindowsRuntime(architecture) {
  const spec = architectureSpecs[architecture];
  if (!spec) throw new Error(`Unsupported Windows command runtime architecture: ${architecture}`);
  const identity = await readBuildIdentity();
  const cargoArguments = [
    'build',
    '--locked',
    '--release',
    '--manifest-path',
    nativeManifestPath,
    '--target',
    spec.rustTarget,
  ];

  // Windows 使用原生 MSVC 工具链；macOS 只做已验证的 xwin 交叉构建。
  // 两条路径使用同一个 Cargo.lock，且正式构建永不启用故障注入 feature。
  if (process.platform === 'win32') await run('cargo', cargoArguments);
  else if (process.platform === 'darwin') await run('cargo', ['xwin', ...cargoArguments]);
  else throw new Error(`Unsupported build host for Windows command runtime: ${process.platform}`);

  const sourceArtifactPath = path.join(
    identity.targetDirectory,
    spec.rustTarget,
    'release',
    'linnya_command_process_owner.dll',
  );
  const artifactBytes = await fsp.readFile(sourceArtifactPath);
  const actualMachine = readPeMachine(artifactBytes);
  if (actualMachine !== spec.peMachine) {
    throw new Error(
      `Windows command native PE architecture mismatch: expected=0x${spec.peMachine.toString(16)} `
        + `actual=0x${actualMachine.toString(16)}`,
    );
  }

  const outputDirectory = path.join(
    repositoryRoot,
    'dist/main/commands/runtime/windows',
    architecture,
  );
  await fsp.rm(outputDirectory, { recursive: true, force: true });
  await fsp.mkdir(outputDirectory, { recursive: true });
  const artifactPath = path.join(outputDirectory, artifactFileName);
  const manifestPath = path.join(outputDirectory, runtimeManifestFileName);
  await fsp.writeFile(artifactPath, artifactBytes, { flag: 'wx' });
  await writeJsonAtomically(manifestPath, {
    schema_version: 1,
    runtime_id: 'linnya_command_process_owner',
    runtime_version: identity.runtimeVersion,
    application_version: identity.applicationVersion,
    platform: 'win32',
    architecture,
    minimum_node_api_version: 8,
    binding_contract_version: 1,
    signature_evidence: { kind: 'development_unsigned' },
    artifact: {
      file_name: artifactFileName,
      size_bytes: artifactBytes.byteLength,
      sha256: createHash('sha256').update(artifactBytes).digest('hex'),
    },
  });
  console.log(
    `[windows-command-native-runtime] built ${architecture} runtime at ${outputDirectory}`,
  );
}

async function main() {
  const targetPlatform = process.env.LINNYA_BUILD_TARGET_PLATFORM;
  const targetArchitecture = process.env.LINNYA_BUILD_TARGET_ARCH;
  if (!targetPlatform || !targetArchitecture) {
    throw new Error(
      'LINNYA_BUILD_TARGET_PLATFORM and LINNYA_BUILD_TARGET_ARCH are required; '
        + 'the packaging entrypoint must declare its target explicitly',
    );
  }
  if (targetPlatform !== 'win32') {
    console.log(
      `[windows-command-native-runtime] target=${targetPlatform}/${targetArchitecture}; skipped`,
    );
    return;
  }
  await buildWindowsRuntime(targetArchitecture);
}

await main();
