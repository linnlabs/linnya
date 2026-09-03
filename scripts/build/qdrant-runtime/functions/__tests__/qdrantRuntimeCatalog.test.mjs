import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  parseQdrantRuntimeCatalog,
  readQdrantRuntimeCatalog,
  resolveQdrantRuntimeTarget,
} = require('../../definitions/qdrant-runtime-catalog.cjs');
const { inspectQdrantExecutable, sha256 } = require('../qdrant-runtime-integrity.cjs');

function toRawCatalog(catalog) {
  return {
    schema_version: catalog.schemaVersion,
    runtime_id: catalog.runtimeId,
    version: catalog.version,
    upstream: {
      repository_url: catalog.upstream.repositoryUrl,
      release_tag: catalog.upstream.releaseTag,
      release_commit: catalog.upstream.releaseCommit,
      license_spdx: catalog.upstream.licenseSpdx,
      license_url: catalog.upstream.licenseUrl,
      license_sha256: catalog.upstream.licenseSha256,
    },
    targets: catalog.targets.map(target => ({
      platform: target.platform,
      architecture: target.architecture,
      output_directory: target.outputDirectory,
      archive_kind: target.archiveKind,
      archive_file_name: target.archiveFileName,
      archive_url: target.archiveUrl,
      archive_sha256: target.archiveSha256,
      archive_entry: target.archiveEntry,
      executable_file_name: target.executableFileName,
      executable_size_bytes: target.executableSizeBytes,
      executable_sha256: target.executableSha256,
    })),
  };
}

describe('Qdrant runtime catalog', () => {
  it('锁定官方 release、许可证和两个当前生产平台', () => {
    const catalog = readQdrantRuntimeCatalog();

    expect(catalog.version).toBe('1.14.1');
    expect(catalog.upstream).toMatchObject({
      repositoryUrl: 'https://github.com/qdrant/qdrant',
      releaseTag: 'v1.14.1',
      releaseCommit: '530430fac2a3ca872504f276d2c91a5c91f43fa0',
      licenseSpdx: 'Apache-2.0',
    });
    expect(resolveQdrantRuntimeTarget(catalog, 'darwin', 'arm64').outputDirectory).toBe(
      'mac-arm64'
    );
    expect(resolveQdrantRuntimeTarget(catalog, 'win32', 'x64').outputDirectory).toBe('win-x64');
  });

  it('拒绝浮动下载地址和重复 target', () => {
    const rawCatalog = toRawCatalog(readQdrantRuntimeCatalog());

    expect(() =>
      parseQdrantRuntimeCatalog({
        ...rawCatalog,
        targets: [
          { ...rawCatalog.targets[0], archive_url: 'https://example.com/qdrant-latest.tar.gz' },
        ],
      })
    ).toThrow('target 无效');
    expect(() =>
      parseQdrantRuntimeCatalog({
        ...rawCatalog,
        targets: [rawCatalog.targets[0], rawCatalog.targets[0]],
      })
    ).toThrow('target 重复');
  });
});

describe('Qdrant prepared executable integrity', () => {
  it('同时校验大小和 SHA-256，不凭文件存在放行', () => {
    const directory = mkdtempSync(join(tmpdir(), 'linnya-qdrant-integrity-'));
    const executablePath = join(directory, 'qdrant');
    const bytes = Buffer.from('locked-qdrant-runtime');
    writeFileSync(executablePath, bytes);
    const target = {
      executableSizeBytes: bytes.byteLength,
      executableSha256: sha256(bytes),
    };

    try {
      expect(inspectQdrantExecutable(executablePath, target).ready).toBe(true);
      writeFileSync(executablePath, Buffer.from('different-runtime'));
      expect(inspectQdrantExecutable(executablePath, target)).toMatchObject({
        ready: false,
        reason: 'size-mismatch',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
