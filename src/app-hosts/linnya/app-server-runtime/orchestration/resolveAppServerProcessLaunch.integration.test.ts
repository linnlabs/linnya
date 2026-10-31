import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import catalogSource from '../../../../../config/headless-node-runtime.json';
import { parseHeadlessNodeRuntimeCatalog } from '../../../../infra/adapters/headless-node-runtime';
import { parseAppServerBootstrap } from '../../app-server-bootstrap';
import { resolveAppServerProcessLaunch } from './resolveAppServerProcessLaunch';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('App Server Node runtime admission', () => {
  it('打包态将重签 Node 的固定路径传入启动计划和 bootstrap', async () => {
    const input = await createRuntimeFixture(true);
    const launch = await resolveAppServerProcessLaunch(input);
    const executablePath = path.join(input.backendFacts.resourcesPath, 'headless-node-runtime/darwin/arm64/bin/node');

    expect(launch.executablePath).toBe(executablePath);
    expect(launch.entryPath).toBe(path.join(input.backendFacts.mainBundleDirectory, 'app-server-entry.cjs'));
    expect(launch.workingDirectory).toBe(input.backendFacts.runtimePathRoots.appDataRoot);
    // 不预建数据目录，直接让 OS 以计划中的 cwd 启动真实进程，覆盖全新安装的 ENOENT。
    const child = await promisify(execFile)(process.execPath, ['-p', 'process.cwd()'], {
      cwd: launch.workingDirectory,
    });
    expect(child.stdout.trim()).toBe(await realpath(launch.workingDirectory));
    const bootstrap = parseAppServerBootstrap(JSON.parse(new TextDecoder().decode(launch.bootstrapBytes)));
    expect(bootstrap.headless_node_executable_path).toBe(executablePath);
    expect(bootstrap.backend_facts.packaged).toBe(true);
  });

  it('开发态仍拒绝与准备清单不同的 Node，不生成可启动计划', async () => {
    await expect(resolveAppServerProcessLaunch(await createRuntimeFixture(false)))
      .rejects.toThrow('executable size 与 manifest 不一致');
  });
});

async function createRuntimeFixture(
  packaged: boolean,
): Promise<Parameters<typeof resolveAppServerProcessLaunch>[0]> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-app-server-node-admission-'));
  roots.push(root);
  const resourcesPath = path.join(root, 'resources');
  const runtimeDirectory = path.join(
    packaged ? resourcesPath : path.join(root, 'extraResources'),
    'headless-node-runtime/darwin/arm64',
  );
  const catalog = parseHeadlessNodeRuntimeCatalog(catalogSource);
  const target = catalog.targets.find(candidate => candidate.platform === 'darwin' && candidate.architecture === 'arm64');
  if (!target) throw new Error('App Server 测试 catalog 缺少 darwin/arm64');
  const preparedBytes = Buffer.from('prepared node runtime');
  await mkdir(path.join(runtimeDirectory, 'bin'), { recursive: true });
  // 这里只验证启动准入的阶段选择；真实 codesign 与进程运行由 packaged E2E 验证。
  await Promise.all([
    writeFile(path.join(runtimeDirectory, 'bin/node'), 'resigned node runtime with changed bytes', { mode: 0o755 }),
    writeFile(path.join(runtimeDirectory, 'LICENSE'), 'Node license\n'),
    writeFile(path.join(runtimeDirectory, 'runtime-manifest.json'), JSON.stringify({
      schema_version: catalog.schemaVersion,
      runtime_id: catalog.runtimeId,
      node_version: catalog.nodeVersion,
      platform: target.platform,
      architecture: target.architecture,
      distribution: {
        archive_file_name: target.archiveFileName,
        archive_sha256: target.archiveSha256,
      },
      prepared_executable: {
        relative_path: target.executableRelativePath,
        size_bytes: preparedBytes.byteLength,
        sha256: createHash('sha256').update(preparedBytes).digest('hex'),
      },
    })),
  ]);
  return {
    hostKind: 'desktop',
    backendConfiguration: {
      qdrant: { host: '127.0.0.1', port: 0 },
      server: { port: 0 },
    },
    backendFacts: {
      applicationVersion: '1.0.0',
      applicationExecutablePath: path.join(root, 'Linnya.app/Contents/MacOS/Linnya'),
      platform: 'darwin',
      architecture: 'arm64',
      packaged,
      distributionIdentity: packaged ? { kind: 'community', packaged: true } : { kind: 'source', packaged: false },
      resourcesPath,
      mainBundleDirectory: path.join(root, 'dist/main'),
      runtimePathRoots: {
        developmentRoot: root,
        appDataRoot: path.join(root, 'app-data'),
        workspaceRoot: path.join(root, 'workspace'),
        workspaceRootIsCustom: true,
      },
      exposeProviderOutboundDebugRoutes: false,
    },
    commandHostEnvironment: { kind: 'host_process_environment', entries: {} },
    textMeasurement: { useBrowserPretext: false, useHarfBuzz: false, availability: { available: false, reason: 'test' } },
    processEnvironment: {},
    commandApprovalPresenter: { available: false },
  };
}
