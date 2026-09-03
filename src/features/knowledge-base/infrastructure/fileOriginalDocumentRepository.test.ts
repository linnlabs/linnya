import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileOriginalDocumentRepository } from './fileOriginalDocumentRepository';

describe('FileOriginalDocumentRepository', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-originals-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('保存 PDF 原始文件，并可读取路径和大小', async () => {
    const sourcePath = path.join(tempDir, 'source.pdf');
    await fs.writeFile(sourcePath, Buffer.from('%PDF-1.7\ncontent'));

    const repository = new FileOriginalDocumentRepository(path.join(tempDir, 'originals'));
    const saved = await repository.save({
      kbId: 'kb-1',
      docId: 'doc-1',
      sourcePath,
      originalFilename: 'source.pdf',
    });

    expect(saved.path).toBe(path.join(tempDir, 'originals', 'kb-1', 'doc-1.pdf'));
    expect(await repository.getPath('kb-1', 'doc-1')).toBe(saved.path);
    expect(await repository.getSizeBytes('kb-1', 'doc-1')).toBe(Buffer.byteLength('%PDF-1.7\ncontent'));
  });

  it('删除单文档和整个知识库目录', async () => {
    const sourcePath = path.join(tempDir, 'source.pdf');
    await fs.writeFile(sourcePath, Buffer.from('%PDF-1.7\ncontent'));

    const repository = new FileOriginalDocumentRepository(path.join(tempDir, 'originals'));
    await repository.save({ kbId: 'kb-1', docId: 'doc-1', sourcePath, originalFilename: 'source.pdf' });
    await repository.save({ kbId: 'kb-1', docId: 'doc-2', sourcePath, originalFilename: 'source.pdf' });

    await expect(repository.delete('kb-1', 'doc-1')).resolves.toBe(true);
    await expect(repository.getPath('kb-1', 'doc-1')).resolves.toBeUndefined();

    await expect(repository.deleteByKnowledgeBase('kb-1')).resolves.toBe(1);
    await expect(repository.getPath('kb-1', 'doc-2')).resolves.toBeUndefined();
  });
});
