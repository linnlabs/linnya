import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ExportBatchFileNameInvalidError,
  ExportBatchLimitExceededError,
  ExportDirectoryPathRequiredError,
  ExportFilesRequiredError,
} from '../../../../features/system/export/definitions/exportErrors';
import {
  BATCH_EXPORT_LIMITS,
  assertPathInsideDirectory,
  normalizeExportDirectoryPath,
  resolveExportTargetPath,
  resolveUniqueExportFilePath,
  validateBatchExportFileName,
  validateBatchExportFiles,
} from './export-path-rules';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-export-rules-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('export path rules', () => {
  it('accepts plain markdown basenames', () => {
    expect(validateBatchExportFileName('a.md')).toBe('a.md');
    expect(validateBatchExportFileName('Name(1).md')).toBe('Name(1).md');
    expect(validateBatchExportFileName('中文文档.md')).toBe('中文文档.md');
  });

  it('rejects file names that can escape or confuse filesystem semantics', () => {
    const invalidNames = [
      '',
      '   ',
      '../x.md',
      'a/b.md',
      'a\\b.md',
      '/tmp/x.md',
      'CON.md',
      'file.',
      'file.md ',
      'bad:name.md',
      `bad${String.fromCharCode(0)}name.md`,
      'report.txt',
    ];

    for (const invalidName of invalidNames) {
      expect(() => validateBatchExportFileName(invalidName), invalidName).toThrow(ExportBatchFileNameInvalidError);
    }
  });

  it('requires an absolute export directory path', () => {
    expect(() => normalizeExportDirectoryPath('relative/export')).toThrow(ExportDirectoryPathRequiredError);
    expect(normalizeExportDirectoryPath(path.resolve('/tmp/export'))).toBe(path.resolve('/tmp/export'));
  });

  it('validates batch shape and caps', () => {
    expect(() => validateBatchExportFiles([])).toThrow(ExportFilesRequiredError);
    expect(() => validateBatchExportFiles(new Array(BATCH_EXPORT_LIMITS.maxFiles + 1).fill({ fileName: 'a.md', content: '' })))
      .toThrow(ExportBatchLimitExceededError);

    const oversizedContent = 'a'.repeat(BATCH_EXPORT_LIMITS.maxSingleFileBytes + 1);
    expect(() => validateBatchExportFiles([{ fileName: 'a.md', content: oversizedContent }]))
      .toThrow(ExportBatchLimitExceededError);

    expect(validateBatchExportFiles([{ fileName: 'a.md', content: '# A' }])).toEqual([{ fileName: 'a.md', content: '# A' }]);
  });

  it('keeps resolved target paths inside the authorized directory', () => {
    const dir = path.resolve('/tmp/export');
    expect(resolveExportTargetPath(dir, 'a.md')).toBe(path.join(dir, 'a.md'));
    expect(() => assertPathInsideDirectory(path.resolve('/tmp/elsewhere/a.md'), dir))
      .toThrow(ExportBatchFileNameInvalidError);
  });

  it('resolves unique names against the batch and disk state', async () => {
    const dir = await createTempDir();
    const existingPath = path.join(dir, 'a.md');
    await fs.writeFile(existingPath, 'existing', 'utf8');

    const usedNamesSet = new Set<string>();
    const firstPath = await resolveUniqueExportFilePath({
      directoryRealPath: dir,
      desiredFileName: 'a.md',
      usedNamesSet,
    });
    const secondPath = await resolveUniqueExportFilePath({
      directoryRealPath: dir,
      desiredFileName: 'a.md',
      usedNamesSet,
    });

    expect(path.basename(firstPath)).toBe('a(1).md');
    expect(path.basename(secondPath)).toBe('a(2).md');
  });
});
