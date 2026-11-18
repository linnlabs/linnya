import { mkdtemp, readFile, rm } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { FileSotRepository } from './sotRepository';
import { BlockType, type DocumentSoT } from '../domain/block';

it('首次保存原文等待目录创建完成，不因异步构造导致丢失本次写入', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'knowledge-sot-first-write-'));
  const directory = path.join(root, 'source');
  const originalMkdir = fs.mkdir;
  let release: () => void = () => {};
  const ready = new Promise<void>(resolve => { release = resolve; });
  const mkdir = vi.spyOn(fs, 'mkdir').mockImplementation(async (...args) => {
    await ready;
    return originalMkdir(...args);
  });
  const source: DocumentSoT = { doc_id: 'source', doc_title: '原文', metadata: {},
    content_blocks: { block: { block_type: BlockType.PARAGRAPH, text: '不可丢失的原文' } }, structure: { root: ['block'] } };
  let writing: Promise<void> | undefined;
  try {
    const repository = new FileSotRepository(directory);
    let finished = false;
    writing = repository.save('source', source).finally(() => { finished = true; });
    // 提前订阅拒绝，旧实现不应成为测试运行器的未处理拒绝。
    void writing.catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(finished).toBe(false);
    release();
    await writing;
    expect(JSON.parse(await readFile(path.join(directory, 'source.source.json'), 'utf8'))).toEqual(source);
  } finally {
    release();
    await writing?.catch(() => undefined);
    mkdir.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
