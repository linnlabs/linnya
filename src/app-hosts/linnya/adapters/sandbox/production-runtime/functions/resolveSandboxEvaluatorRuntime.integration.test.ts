import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import runtimeCatalog from '../../../../../../../config/headless-node-runtime.json';
import { resolveSandboxEvaluatorRuntime } from './resolveSandboxEvaluatorRuntime';

const temporaryRoots: string[] = [];
const darwinTarget = requireDarwinTarget();

function requireDarwinTarget(): (typeof runtimeCatalog.targets)[number] {
  const target = runtimeCatalog.targets.find(candidate => (
    candidate.platform === 'darwin' && candidate.architecture === 'arm64'
  ));
  if (!target) throw new Error('Sandbox evaluator test catalog 缺少 darwin/arm64');
  return target;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => (
    rm(root, { recursive: true, force: true })
  )));
});

describe('Sandbox evaluator runtime resolver', () => {
  it('开发态只接纳 catalog 匹配且 hash 完整的专用 Node 与 evaluator bundle', async () => {
    const fixture = await createRuntimeFixture();

    const runtime = await resolveSandboxEvaluatorRuntime({
      packaged: false,
      resourcesPath: '/unused',
      mainBundleDirectory: fixture.mainBundleDirectory,
      platform: 'darwin',
      architecture: 'arm64',
    });

    expect(runtime.nodeVersion).toBe(runtimeCatalog.node_version);
    expect(runtime.launch).toEqual({
      executablePath: fixture.executablePath,
      entryPath: fixture.developmentEvaluatorPath,
      environment: {},
    });
  });

  it('开发 runtime byte 被替换时 fail-closed，不回退 process.execPath 或 PATH', async () => {
    const fixture = await createRuntimeFixture();
    await writeFile(fixture.executablePath, 'tampered-node', { mode: 0o755 });

    await expect(resolveSandboxEvaluatorRuntime({
      packaged: false,
      resourcesPath: '/unused',
      mainBundleDirectory: fixture.mainBundleDirectory,
      platform: 'darwin',
      architecture: 'arm64',
    })).rejects.toThrow(/size|hash/u);
  });

  it('正式包缺 evaluator bundle 时 fail-closed，即使 Node manifest 合法也不安装 runner', async () => {
    const fixture = await createRuntimeFixture({ publishPackagedEvaluator: false });

    await expect(resolveSandboxEvaluatorRuntime({
      packaged: true,
      resourcesPath: fixture.resourcesPath,
      mainBundleDirectory: fixture.mainBundleDirectory,
      platform: 'darwin',
      architecture: 'arm64',
    })).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function createRuntimeFixture(input: {
  readonly publishPackagedEvaluator?: boolean;
} = {}): Promise<{
  readonly resourcesPath: string;
  readonly mainBundleDirectory: string;
  readonly executablePath: string;
  readonly developmentEvaluatorPath: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-headless-runtime-resolver-'));
  temporaryRoots.push(root);
  const resourcesPath = path.join(root, 'resources');
  const mainBundleDirectory = path.join(root, 'dist/main');
  const runtimeDirectory = path.join(root, 'extraResources/headless-node-runtime/darwin/arm64');
  const packagedRuntimeDirectory = path.join(
    resourcesPath,
    'headless-node-runtime/darwin/arm64',
  );
  const developmentEvaluatorPath = path.join(
    mainBundleDirectory,
    'sandbox/sandboxEvaluatorProcess.cjs',
  );
  const packagedEvaluatorPath = path.join(
    resourcesPath,
    'sandbox-runtime/evaluator/sandboxEvaluatorProcess.cjs',
  );
  await Promise.all([
    mkdir(path.join(runtimeDirectory, 'bin'), { recursive: true }),
    mkdir(path.join(packagedRuntimeDirectory, 'bin'), { recursive: true }),
    mkdir(path.dirname(developmentEvaluatorPath), { recursive: true }),
    mkdir(path.dirname(packagedEvaluatorPath), { recursive: true }),
  ]);
  const executableBytes = Buffer.from('headless-node-runtime');
  const manifest = `${JSON.stringify({
    schema_version: 1,
    runtime_id: 'linnya_headless_node_runtime',
    node_version: runtimeCatalog.node_version,
    platform: 'darwin',
    architecture: 'arm64',
    distribution: {
      archive_file_name: darwinTarget.archive_file_name,
      archive_sha256: darwinTarget.archive_sha256,
    },
    prepared_executable: {
      relative_path: darwinTarget.executable_relative_path,
      size_bytes: executableBytes.byteLength,
      sha256: createHash('sha256').update(executableBytes).digest('hex'),
    },
  }, null, 2)}\n`;
  await Promise.all([
    writeFile(path.join(runtimeDirectory, 'bin/node'), executableBytes, { mode: 0o755 }),
    writeFile(path.join(runtimeDirectory, 'LICENSE'), 'Node license\n'),
    writeFile(path.join(runtimeDirectory, 'runtime-manifest.json'), manifest),
    writeFile(path.join(packagedRuntimeDirectory, 'bin/node'), executableBytes, { mode: 0o755 }),
    writeFile(path.join(packagedRuntimeDirectory, 'LICENSE'), 'Node license\n'),
    writeFile(path.join(packagedRuntimeDirectory, 'runtime-manifest.json'), manifest),
    writeFile(developmentEvaluatorPath, 'process.exit(0);\n'),
    ...(input.publishPackagedEvaluator === false
      ? []
      : [writeFile(packagedEvaluatorPath, 'process.exit(0);\n')]),
  ]);
  return {
    resourcesPath,
    mainBundleDirectory,
    executablePath: path.join(runtimeDirectory, 'bin/node'),
    developmentEvaluatorPath,
  };
}
