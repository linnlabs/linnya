import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { officialPluginReleaseTargets } from '../../../release/plugin-release-targets.mjs';
import { createBundleBuildTraceSet } from '../functions/bundleBuildTraceSet.mjs';

const requiredDesktopBuildTargets = [
  'desktop/app-server',
  'desktop/command-runner',
  'desktop/main-bytecode',
  'desktop/renderer',
  'desktop/sandbox-runner',
  'desktop/task-workers',
  'esbuild/dist/main/loader.cjs',
  'esbuild/dist/main/main.cjs',
  'esbuild/dist/main/measurement-preload.js',
  'esbuild/dist/main/measurement-worker.js',
  'esbuild/dist/main/preload.js',
];

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function readCliValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

function readSourceIdentity() {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  return { revision, dirty: status.trim().length > 0 };
}

function assertTraceDoesNotLeakAbsolutePaths(traceBytes, tracePath) {
  const rendered = traceBytes.toString('utf8');
  const normalizedRoot = repositoryRoot.replaceAll('\\', '/');
  const normalizedHome = os.homedir().replaceAll('\\', '/');
  if (rendered.includes(normalizedRoot) || rendered.includes(normalizedHome)) {
    throw new Error(`bundle trace 泄漏本地仓库路径：${path.basename(tracePath)}`);
  }
}

function verifyOutputHashes(trace) {
  for (const output of trace.outputs) {
    if (typeof output.path !== 'string' || path.isAbsolute(output.path)) {
      throw new Error(`bundle trace output 路径无效：${String(output.path)}`);
    }
    const outputPath = path.resolve(repositoryRoot, output.path);
    const repositoryRelativePath = path.relative(repositoryRoot, outputPath);
    if (
      repositoryRelativePath === '..'
      || repositoryRelativePath.startsWith(`..${path.sep}`)
      || path.isAbsolute(repositoryRelativePath)
    ) {
      throw new Error(`bundle trace output 越出仓库边界：${output.path}`);
    }
    const outputBytes = fs.readFileSync(outputPath);
    if (outputBytes.byteLength !== output.size || sha256(outputBytes) !== output.sha256) {
      throw new Error(`bundle trace output 已漂移：${output.path}`);
    }
  }
}

function writeOrVerify(outputPath, traceSet, verify) {
  const rendered = `${JSON.stringify(traceSet, null, 2)}\n`;
  if (verify) {
    if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== rendered) {
      throw new Error(`bundle trace set 与当前构建不一致：${outputPath}`);
    }
    return;
  }
  fs.writeFileSync(outputPath, rendered, 'utf8');
}

function main() {
  const traceRootArgument = readCliValue('trace-root');
  const platform = readCliValue('platform');
  const architecture = readCliValue('architecture');
  if (
    !traceRootArgument
    || (platform !== 'darwin' && platform !== 'win32')
    || (architecture !== 'arm64' && architecture !== 'x64')
  ) {
    throw new Error(
      '用法：generateBundleBuildTraceSet.mjs --trace-root=<path> --platform=<darwin|win32> --architecture=<arm64|x64> [--verify]',
    );
  }
  const traceRoot = path.resolve(repositoryRoot, traceRootArgument);
  const tracePaths = fs.readdirSync(traceRoot)
    .filter(fileName => fileName.endsWith('.bundle-trace.json'))
    .sort((left, right) => left.localeCompare(right))
    .map(fileName => path.join(traceRoot, fileName));
  const traceFiles = tracePaths.map(tracePath => {
    const bytes = fs.readFileSync(tracePath);
    assertTraceDoesNotLeakAbsolutePaths(bytes, tracePath);
    const trace = JSON.parse(bytes.toString('utf8'));
    verifyOutputHashes(trace);
    return { fileName: path.basename(tracePath), sha256: sha256(bytes), trace };
  });
  const traceSet = createBundleBuildTraceSet({
    identity: { platform, architecture },
    requiredBuildTargets: requiredDesktopBuildTargets,
    requiredBuildTargetPrefixes: officialPluginReleaseTargets.map(target => `plugin-${target.id}/`),
    source: readSourceIdentity(),
    traceFiles,
  });
  const outputPath = path.join(traceRoot, 'bundle-trace-set.json');
  writeOrVerify(outputPath, traceSet, process.argv.includes('--verify'));
  process.stdout.write(
    `[bundle-trace-set] targets=${traceSet.summary.buildTargetCount} outputs=${traceSet.summary.outputCount} npm=${traceSet.summary.npmPackageCount} ${path.relative(repositoryRoot, outputPath)}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
