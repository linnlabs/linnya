#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../../..');
const manifestPath = path.join(
  repositoryRoot,
  'src/infra/adapters/command-runtime/plugin-cli-client/native/Cargo.toml',
);
const nativeClientDirectory = path.dirname(manifestPath);

const buildSpecs = Object.freeze({
  'darwin-arm64': Object.freeze({
    rustTarget: 'aarch64-apple-darwin',
    outputPlatform: 'darwin',
    outputArchitecture: 'arm64',
    artifactFileName: 'linnya-plugin-cli-client',
  }),
  'win32-x64': Object.freeze({
    rustTarget: 'x86_64-pc-windows-msvc',
    outputPlatform: 'win32',
    outputArchitecture: 'x64',
    artifactFileName: 'linnya-plugin-cli-client.exe',
  }),
});

function run(file, args, workingDirectory = repositoryRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: workingDirectory,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${file} exited with code ${code ?? 'unknown'}`));
    });
  });
}

function resolveBuildTarget() {
  const targetPlatform = process.env.LINNYA_BUILD_TARGET_PLATFORM ?? process.platform;
  const targetArchitecture = process.env.LINNYA_BUILD_TARGET_ARCH ?? process.arch;
  const key = `${targetPlatform}-${targetArchitecture}`;
  const spec = buildSpecs[key];
  if (!spec) {
    throw new Error(`Unsupported Plugin CLI client target: ${key}`);
  }
  return { targetPlatform, spec };
}

async function main() {
  const { targetPlatform, spec } = resolveBuildTarget();
  const cargoArguments = [
    'build',
    '--locked',
    '--release',
    '--manifest-path',
    manifestPath,
    '--target',
    spec.rustTarget,
  ];
  if (targetPlatform === process.platform) {
    await run('cargo', cargoArguments, nativeClientDirectory);
  } else if (process.platform === 'darwin' && targetPlatform === 'win32') {
    await run('cargo', ['xwin', ...cargoArguments], nativeClientDirectory);
  } else {
    throw new Error(
      `Plugin CLI client cannot build target ${targetPlatform} from host ${process.platform}`,
    );
  }

  const sourceArtifact = path.join(
    repositoryRoot,
    'src/infra/adapters/command-runtime/plugin-cli-client/native/target',
    spec.rustTarget,
    'release',
    spec.artifactFileName,
  );
  const outputDirectory = path.join(
    repositoryRoot,
    // command runner watcher 会以 clean=true 独占 dist/main/commands。
    // Native Plugin CLI client 必须拥有独立输出根，避免开发态 watcher 清理其制品。
    'dist/main/plugin-cli-runtime',
    spec.outputPlatform,
    spec.outputArchitecture,
  );
  await fsp.rm(outputDirectory, { recursive: true, force: true });
  await fsp.mkdir(outputDirectory, { recursive: true });
  const destination = path.join(outputDirectory, spec.artifactFileName);
  await fsp.copyFile(sourceArtifact, destination);
  if (targetPlatform !== 'win32') await fsp.chmod(destination, 0o755);
  console.log(`[plugin-cli-client] built ${targetPlatform}/${spec.outputArchitecture} at ${destination}`);
}

await main();
