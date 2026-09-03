import { promises as fsp } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  TOOL_OUTPUT_BLOCK_CHAR_CAPACITY,
  TOOL_OUTPUT_BODY_FILE_NAME,
  TOOL_OUTPUT_INDEX_FILE_NAME,
} from '../definitions/toolOutputBlob';
import {
  createToolOutputTextBlobWriter,
  type ToolOutputTextBlobWritableFile,
} from '../orchestration/createToolOutputTextBlobWriter';
import { readToolOutputTextWindow } from '../orchestration/readToolOutputTextWindow';

const roots = new Set<string>();

class FailingWritableFile implements ToolOutputTextBlobWritableFile {
  constructor(
    private readonly file: FileHandle,
    private readonly failAtPosition: number | undefined,
  ) {}

  async write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ readonly bytesWritten: number }> {
    if (this.failAtPosition !== undefined && position >= this.failAtPosition) {
      throw new Error('injected staging write failure');
    }
    return this.file.write(buffer, offset, length, position);
  }

  async truncate(length: number): Promise<void> {
    await this.file.truncate(length);
  }

  async sync(): Promise<void> {
    await this.file.sync();
  }

  async close(): Promise<void> {
    await this.file.close();
  }
}

afterEach(async () => {
  await Promise.all([...roots].map(root => fsp.rm(root, { recursive: true, force: true })));
  roots.clear();
});

async function createFixture(input: {
  readonly failingFileName: typeof TOOL_OUTPUT_BODY_FILE_NAME | typeof TOOL_OUTPUT_INDEX_FILE_NAME;
  readonly failAtPosition: number;
}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-tool-output-prefix-'));
  roots.add(root);
  const blobsDirectory = path.join(root, 'blobs');
  const writer = await createToolOutputTextBlobWriter({
    blobsDirectory,
    source: {
      kind: 'tool_output_text',
      conversation_id: 'conversation-prefix-test',
      instance_id: 'instance-prefix-test',
      tool_name: 'shell',
    },
  }, {
    openStagingFile: async filePath => new FailingWritableFile(
      await fsp.open(filePath, 'wx'),
      path.basename(filePath) === input.failingFileName ? input.failAtPosition : undefined,
    ),
  });
  return { root, blobsDirectory, writer };
}

async function readPublishedPrefix(input: {
  readonly blobsDirectory: string;
  readonly blobId: string;
}): Promise<string> {
  const windows: string[] = [];
  let offset = 0;
  while (true) {
    const window = await readToolOutputTextWindow({
      blobDirectory: path.join(input.blobsDirectory, input.blobId),
      blobId: input.blobId,
      conversationId: 'conversation-prefix-test',
      instanceId: 'instance-prefix-test',
      args: { offset, limit: 12_000 },
    });
    windows.push(window.windowText);
    if (window.nextOffset === null) return windows.join('');
    offset = window.nextOffset;
  }
}

describe('ToolOutputTextBlobWriter committed prefix', () => {
  it('第二个正文 block 写入失败时发布第一个共同提交的可读前缀', async () => {
    const fixture = await createFixture({
      failingFileName: TOOL_OUTPUT_BODY_FILE_NAME,
      failAtPosition: TOOL_OUTPUT_BLOCK_CHAR_CAPACITY * 2,
    });
    const firstBlock = 'a'.repeat(TOOL_OUTPUT_BLOCK_CHAR_CAPACITY);

    await fixture.writer.append(firstBlock);
    await expect(
      fixture.writer.append('b'.repeat(TOOL_OUTPUT_BLOCK_CHAR_CAPACITY)),
    ).rejects.toThrow('injected staging write failure');

    const first = await fixture.writer.finalizeCommittedPrefix();
    const second = await fixture.writer.finalizeCommittedPrefix();
    expect(second).toBe(first);
    expect(first).toMatchObject({
      status: 'published',
      persistedCharacters: TOOL_OUTPUT_BLOCK_CHAR_CAPACITY,
      persistedLines: 1,
    });
    if (first.status !== 'published') throw new Error('expected published prefix');
    await expect(readPublishedPrefix({
      blobsDirectory: fixture.blobsDirectory,
      blobId: first.blob.blobId,
    })).resolves.toBe(firstBlock);
  });

  it('第二个索引记录写入失败时截回多写入的正文', async () => {
    const fixture = await createFixture({
      failingFileName: TOOL_OUTPUT_INDEX_FILE_NAME,
      failAtPosition: 64,
    });
    const firstBlock = `${'a'.repeat(TOOL_OUTPUT_BLOCK_CHAR_CAPACITY - 2)}\nZ`;

    await fixture.writer.append(firstBlock);
    await expect(
      fixture.writer.append('b'.repeat(TOOL_OUTPUT_BLOCK_CHAR_CAPACITY)),
    ).rejects.toThrow('injected staging write failure');
    const prefix = await fixture.writer.finalizeCommittedPrefix();

    expect(prefix).toMatchObject({
      status: 'published',
      persistedCharacters: TOOL_OUTPUT_BLOCK_CHAR_CAPACITY,
      persistedLines: 2,
    });
    if (prefix.status !== 'published') throw new Error('expected published prefix');
    await expect(readPublishedPrefix({
      blobsDirectory: fixture.blobsDirectory,
      blobId: prefix.blob.blobId,
    })).resolves.toBe(firstBlock);
  });

  it('没有共同提交 block 时返回明确状态且 abort 清理 staging', async () => {
    const fixture = await createFixture({
      failingFileName: TOOL_OUTPUT_BODY_FILE_NAME,
      failAtPosition: 0,
    });
    await expect(
      fixture.writer.append('x'.repeat(TOOL_OUTPUT_BLOCK_CHAR_CAPACITY)),
    ).rejects.toThrow('injected staging write failure');

    await expect(fixture.writer.finalizeCommittedPrefix()).resolves.toEqual({
      status: 'not_created',
      reason: 'no_committed_block',
    });
    await fixture.writer.abort();
    await expect(fsp.readdir(fixture.blobsDirectory)).resolves.toEqual([]);
  });

  it('失败边界切断代理项时回退高代理项并重写最后索引记录', async () => {
    const fixture = await createFixture({
      failingFileName: TOOL_OUTPUT_BODY_FILE_NAME,
      failAtPosition: TOOL_OUTPUT_BLOCK_CHAR_CAPACITY * 2,
    });
    const splitPairPrefix = `${'a'.repeat(TOOL_OUTPUT_BLOCK_CHAR_CAPACITY - 1)}\ud83d`;

    await fixture.writer.append(splitPairPrefix);
    await expect(
      fixture.writer.append(`\ude00${'b'.repeat(TOOL_OUTPUT_BLOCK_CHAR_CAPACITY - 1)}`),
    ).rejects.toThrow('injected staging write failure');
    const prefix = await fixture.writer.finalizeCommittedPrefix();

    expect(prefix).toMatchObject({
      status: 'published',
      persistedCharacters: TOOL_OUTPUT_BLOCK_CHAR_CAPACITY - 1,
      persistedLines: 1,
    });
    if (prefix.status !== 'published') throw new Error('expected published prefix');
    await expect(readPublishedPrefix({
      blobsDirectory: fixture.blobsDirectory,
      blobId: prefix.blob.blobId,
    })).resolves.toBe('a'.repeat(TOOL_OUTPUT_BLOCK_CHAR_CAPACITY - 1));
  });
});
