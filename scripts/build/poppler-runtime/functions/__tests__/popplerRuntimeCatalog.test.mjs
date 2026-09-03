import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  parsePopplerRuntimeCatalog,
  readPopplerRuntimeCatalog,
  resolvePopplerRuntimeTarget,
} = require('../../definitions/poppler-runtime-catalog.cjs');
const { calculateRuntimeTree } = require('../poppler-runtime-integrity.cjs');

function toRawCatalog(catalog) {
  return {
    schema_version: catalog.schemaVersion,
    runtime_id: catalog.runtimeId,
    distribution: {
      repository_url: catalog.distribution.repositoryUrl,
      release_tag: catalog.distribution.releaseTag,
      poppler_license_expression: catalog.distribution.popplerLicenseExpression,
      source_repository_url: catalog.distribution.sourceRepositoryUrl,
    },
    targets: catalog.targets.map(target => ({
      platform: target.platform,
      architecture: target.architecture,
      version: target.version,
      output_directory: target.outputDirectory,
      archive_file_name: target.archiveFileName,
      archive_url: target.archiveUrl,
      archive_size_bytes: target.archiveSizeBytes,
      archive_sha256: target.archiveSha256,
      file_count: target.fileCount,
      tree_sha256: target.treeSha256,
      executable_file_name: target.executableFileName,
      executable_size_bytes: target.executableSizeBytes,
      executable_sha256: target.executableSha256,
    })),
  };
}

describe('Poppler runtime catalog', () => {
  it('把 PDF 转图运行时锁定为 Linnya release 的两个生产平台', () => {
    const catalog = readPopplerRuntimeCatalog();

    expect(catalog.distribution).toMatchObject({
      repositoryUrl: 'https://github.com/linnlabs/linnya',
      releaseTag: 'poppler-runtime-v1',
      popplerLicenseExpression: 'GPL-2.0-only OR GPL-3.0-only',
    });
    expect(resolvePopplerRuntimeTarget(catalog, 'darwin', 'arm64')).toMatchObject({
      version: '25.05.0',
      outputDirectory: 'mac-arm64',
    });
    expect(resolvePopplerRuntimeTarget(catalog, 'win32', 'x64')).toMatchObject({
      version: '24.07.0',
      outputDirectory: 'win-x64',
    });
  });

  it('拒绝浮动来源和重复 target', () => {
    const rawCatalog = toRawCatalog(readPopplerRuntimeCatalog());

    expect(() =>
      parsePopplerRuntimeCatalog({
        ...rawCatalog,
        targets: [
          { ...rawCatalog.targets[0], archive_url: 'https://example.com/poppler-latest.zip' },
        ],
      })
    ).toThrow('target 无效');
    expect(() =>
      parsePopplerRuntimeCatalog({
        ...rawCatalog,
        targets: [rawCatalog.targets[0], rawCatalog.targets[0]],
      })
    ).toThrow('target 重复');
  });
});

describe('Poppler runtime tree integrity', () => {
  it('文件内容或文件集合变化都会改变 tree hash', () => {
    const directory = mkdtempSync(join(tmpdir(), 'linnya-poppler-integrity-'));
    mkdirSync(join(directory, 'lib'));
    writeFileSync(join(directory, 'pdftocairo'), 'locked-executable');
    writeFileSync(join(directory, 'lib', 'runtime.dylib'), 'locked-library');

    try {
      const baseline = calculateRuntimeTree(directory);
      writeFileSync(join(directory, 'lib', 'runtime.dylib'), 'changed-library');
      expect(calculateRuntimeTree(directory).treeSha256).not.toBe(baseline.treeSha256);

      writeFileSync(join(directory, 'extra-file'), 'unexpected');
      expect(calculateRuntimeTree(directory).fileCount).toBe(baseline.fileCount + 1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
