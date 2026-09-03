import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isBundleTraceEnabled,
  writeEsbuildBundleTrace,
} from './bundle-trace/functions/bundleBuildTrace.mjs';

const require = createRequire(import.meta.url);
const esbuildBinPath = require.resolve('esbuild/bin/esbuild');
const esbuildVersion = require('esbuild/package.json').version;
const header = readFileSync(esbuildBinPath).subarray(0, 4);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const isJavaScriptEntrypoint = header[0] === 0x23 && header[1] === 0x21;
const isNativeBinary =
  (header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46)
  || (header[0] === 0xcf && header[1] === 0xfa && header[2] === 0xed && header[3] === 0xfe)
  || (header[0] === 0xfe && header[1] === 0xed && header[2] === 0xfa && header[3] === 0xcf)
  || (header[0] === 0xca && header[1] === 0xfe && header[2] === 0xba && header[3] === 0xbe)
  || (header[0] === 0x4d && header[1] === 0x5a);

if (!isJavaScriptEntrypoint && !isNativeBinary) {
  throw new Error(`Unsupported esbuild entrypoint format: ${esbuildBinPath}`);
}

const command = isJavaScriptEntrypoint ? process.execPath : esbuildBinPath;
const requestedArgs = process.argv.slice(2);
const traceEnabled = isBundleTraceEnabled();
const explicitMetafileArgument = requestedArgs.find(argument => argument.startsWith('--metafile='));
const temporaryMetafileDirectory = traceEnabled && !explicitMetafileArgument
  ? mkdtempSync(path.join(tmpdir(), 'linnya-esbuild-trace-'))
  : undefined;
const metafilePath = explicitMetafileArgument
  ? path.resolve(process.cwd(), explicitMetafileArgument.slice('--metafile='.length))
  : temporaryMetafileDirectory
    ? path.join(temporaryMetafileDirectory, 'metafile.json')
    : undefined;
const esbuildArgs = metafilePath && !explicitMetafileArgument
  ? [...requestedArgs, `--metafile=${metafilePath}`]
  : requestedArgs;
const args = isJavaScriptEntrypoint
  ? [esbuildBinPath, ...esbuildArgs]
  : esbuildArgs;

const child = spawn(command, args, {
  stdio: 'inherit',
});

function removeTemporaryMetafileDirectory() {
  if (temporaryMetafileDirectory) {
    rmSync(temporaryMetafileDirectory, { recursive: true, force: true });
  }
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on('error', (error) => {
  console.error(`[run-esbuild] failed to start esbuild: ${error.message}`);
  removeTemporaryMetafileDirectory();
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  try {
    if (signal) {
      console.error(`[run-esbuild] esbuild exited with signal ${signal}`);
      process.exitCode = 1;
      return;
    }
    if (code !== 0) {
      process.exitCode = code ?? 1;
      return;
    }
    if (traceEnabled && metafilePath) {
      const outputArgument = requestedArgs.find(argument => (
        argument.startsWith('--outfile=') || argument.startsWith('--outdir=')
      ));
      if (!outputArgument) {
        throw new Error('启用 bundle trace 的 esbuild 构建必须声明 --outfile 或 --outdir');
      }
      const outputPath = path.resolve(process.cwd(), outputArgument.slice(outputArgument.indexOf('=') + 1));
      const relativeOutputPath = path.relative(repositoryRoot, outputPath).replaceAll('\\', '/');
      const buildTarget = process.env.LINNYA_BUNDLE_TRACE_TARGET
        ?? `esbuild/${relativeOutputPath.toLowerCase()}`;
      writeEsbuildBundleTrace({
        buildTarget,
        metafile: JSON.parse(readFileSync(metafilePath, 'utf8')),
        repositoryRoot,
        toolVersion: esbuildVersion,
        workingDirectory: process.cwd(),
      });
    }
    process.exitCode = 0;
  } catch (error) {
    console.error(`[run-esbuild] bundle trace failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    removeTemporaryMetafileDirectory();
  }
});
