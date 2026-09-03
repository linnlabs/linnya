import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import catalogSource from '../../../../../config/headless-node-runtime.json';
import {
  parseHeadlessNodeRuntimeCatalog,
  resolveHeadlessNodeRuntime,
} from '..';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('Headless Node runtime', () => {
  it('从共享 catalog 解析非空 executable、LICENSE 与完整 manifest', async () => {
    const runtimeDirectory = await createRuntimeFixture();
    const catalog = parseHeadlessNodeRuntimeCatalog(catalogSource);

    await expect(resolveHeadlessNodeRuntime({
      catalog,
      runtimeDirectory,
      platform: 'darwin',
      architecture: 'arm64',
      verifyPreparedExecutableHash: true,
    })).resolves.toEqual({
      nodeVersion: catalog.nodeVersion,
      manifestPath: path.join(runtimeDirectory, 'runtime-manifest.json'),
      executablePath: path.join(runtimeDirectory, 'bin/node'),
    });
  });

  it('executable 被替换后 fail-closed，不接受 process.execPath/PATH fallback', async () => {
    const runtimeDirectory = await createRuntimeFixture();
    await writeFile(path.join(runtimeDirectory, 'bin/node'), 'tampered', { mode: 0o755 });

    await expect(resolveHeadlessNodeRuntime({
      catalog: parseHeadlessNodeRuntimeCatalog(catalogSource),
      runtimeDirectory,
      platform: 'darwin',
      architecture: 'arm64',
      verifyPreparedExecutableHash: true,
    })).rejects.toThrow(/size|hash/u);
  });

  it('拒绝 catalog 未登记的平台/架构，而不是猜测同类 runtime', async () => {
    const runtimeDirectory = await createRuntimeFixture();

    await expect(resolveHeadlessNodeRuntime({
      catalog: parseHeadlessNodeRuntimeCatalog(catalogSource),
      runtimeDirectory,
      platform: 'linux',
      architecture: 'x64',
      verifyPreparedExecutableHash: true,
    })).rejects.toThrow('不支持 linux/x64');
  });
});

async function createRuntimeFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-headless-node-runtime-'));
  roots.push(root);
  const executableBytes = Buffer.from('headless-node-runtime');
  const catalog = parseHeadlessNodeRuntimeCatalog(catalogSource);
  const target = catalog.targets.find(candidate => (
    candidate.platform === 'darwin' && candidate.architecture === 'arm64'
  ));
  if (!target) throw new Error('测试 catalog 缺少 darwin/arm64');
  await mkdir(path.join(root, 'bin'), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, 'bin/node'), executableBytes, { mode: 0o755 }),
    writeFile(path.join(root, 'LICENSE'), 'Node license\n'),
    writeFile(path.join(root, 'runtime-manifest.json'), `${JSON.stringify({
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
        size_bytes: executableBytes.byteLength,
        sha256: createHash('sha256').update(executableBytes).digest('hex'),
      },
    }, null, 2)}\n`),
  ]);
  return root;
}
