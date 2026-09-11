import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import runtimePreparation from './prepare-headless-node-runtime.cjs';
import catalogReader from '../definitions/headless-node-runtime-catalog.cjs';

const roots = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'linnya-node-prepare-'));
  roots.push(rootDir);
  const catalog = catalogReader.readHeadlessNodeRuntimeCatalog();
  const target = catalog.targets[0];
  const targetDirectory = runtimePreparation.resolvePreparedRuntimeDirectory(rootDir, target);
  const executablePath = path.join(targetDirectory, target.executableRelativePath);
  const bytes = Buffer.from('fixture node binary');
  await mkdir(path.dirname(executablePath), { recursive: true });
  await writeFile(executablePath, bytes, { mode: 0o755 });
  await writeFile(path.join(targetDirectory, 'LICENSE'), 'fixture license');
  const manifest = {
    schema_version: catalog.schemaVersion, runtime_id: catalog.runtimeId, node_version: catalog.nodeVersion,
    platform: target.platform, architecture: target.architecture,
    distribution: { archive_file_name: target.archiveFileName, archive_sha256: target.archiveSha256 },
    prepared_executable: { relative_path: target.executableRelativePath, size_bytes: bytes.length, sha256: runtimePreparation.sha256(bytes) },
  };
  const manifestPath = path.join(targetDirectory, 'runtime-manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { rootDir, catalog, target, targetDirectory, executablePath, manifestPath, manifest };
}

describe('准备 Headless Node runtime', () => {
  it('完整且匹配锁定版本时不下载、不解压、不替换现有文件', async () => {
    const input = await fixture();
    const original = await stat(input.executablePath);
    const originalManifest = await readFile(input.manifestPath, 'utf8');
    const fetch = vi.fn(() => { throw new Error('unexpected download'); });
    vi.stubGlobal('fetch', fetch);
    const result = await runtimePreparation.prepareHeadlessNodeRuntime({
      rootDir: input.rootDir, platform: input.target.platform, architecture: input.target.architecture,
      allowCrossTarget: true,
    });
    expect(result.changed).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect((await stat(input.executablePath)).ino).toBe(original.ino);
    expect(await readFile(input.manifestPath, 'utf8')).toBe(originalManifest);
  });

  it('版本过期或可执行文件损坏时不复用', async () => {
    const input = await fixture();
    await writeFile(input.manifestPath, JSON.stringify({ ...input.manifest, node_version: '0.0.0' }));
    expect(await runtimePreparation.inspectPreparedHeadlessNodeRuntime(input)).toBeNull();
    await writeFile(input.manifestPath, JSON.stringify(input.manifest));
    await writeFile(input.executablePath, 'damaged node binary');
    expect(await runtimePreparation.inspectPreparedHeadlessNodeRuntime(input)).toBeNull();
  });
});
