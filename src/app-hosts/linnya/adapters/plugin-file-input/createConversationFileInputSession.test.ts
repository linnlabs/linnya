import { mkdtemp, mkdir, open, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveConversationWorkDirectoryIdentity } from 'src/domains/conversation-files';
import type { ConversationWorkDirectoryAdmissionPort } from '../../application/conversation-lifecycle';
import { createConversationFileInputSession } from './createConversationFileInputSession';
import { PLUGIN_INPUT_MAX_BYTES } from './createPluginFileStage';

const cleanups: Array<() => Promise<void>> = [];
let onFirstChunk: (() => void) | undefined;
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
    const stream = actual.createReadStream(...args);
    // 仍是实际文件流；取消点绑定真实复制进展，不能依赖可能迟到的 OS 目录通知。
    stream.once('data', () => onFirstChunk?.());
    return stream;
  } };
});
afterEach(async () => {
  onFirstChunk = undefined;
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plugin-conversation-input-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'conversation');
  const temporaryDirectory = path.join(root, 'uploads', 'temp');
  await mkdir(sourceRoot);
  await mkdir(temporaryDirectory, { recursive: true });
  let reading = false;
  const admission: ConversationWorkDirectoryAdmissionPort = {
    async withAdmission(input, admitted) {
      expect(input.conversationId).toBe('current-conversation');
      reading = true;
      try {
        return await admitted({
          identity: deriveConversationWorkDirectoryIdentity(input.conversationId),
          absolutePath: sourceRoot,
          status: 'existing',
        });
      } finally {
        reading = false;
      }
    },
  };
  const controller = new AbortController();
  const session = createConversationFileInputSession({
    conversationId: 'current-conversation',
    admission,
    temporaryDirectory,
    signal: controller.signal,
  });
  cleanups.push(() => session.close());
  return { root, sourceRoot, temporaryDirectory, session, controller, isReading: () => reading };
}

describe('conversation import source ownership', () => {
  it('成功接纳只转交副本；业务拒绝清理副本，两种情况源文件保持不变', async () => {
    const f = await fixture();
    const source = path.join(f.sourceRoot, '资料.md');
    await writeFile(source, '# retained source');
    const accepted = await f.session.stage('conversation:/资料.md');
    expect(accepted.file).toMatchObject({ name: '资料.md', size: 17 });
    expect(path.dirname(accepted.file.path)).toBe(f.temporaryDirectory);
    expect(await readFile(accepted.file.path, 'utf8')).toBe('# retained source');
    accepted.acceptFile();
    const rejected = await f.session.stage('conversation:/资料.md');
    await f.session.close();
    expect(await readdir(f.temporaryDirectory)).toEqual([path.basename(accepted.file.path)]);
    await expect(readFile(rejected.file.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(source, 'utf8')).toBe('# retained source');
  });

  it('拒绝越界 locator、链接和超过上传上限的文件，不留下暂存副本', async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, 'outside.md'), 'outside');
    await symlink(path.join(f.root, 'outside.md'), path.join(f.sourceRoot, 'link.md'));
    await expect(f.session.stage('conversation:/../outside.md')).rejects.toThrow();
    await expect(f.session.stage('conversation:/link.md')).rejects.toMatchObject({
      code: 'READ_FILE_NOT_REGULAR_FILE',
    });
    const oversized = await open(path.join(f.sourceRoot, 'oversized.pdf'), 'w');
    await oversized.truncate(PLUGIN_INPUT_MAX_BYTES + 1);
    await oversized.close();
    await expect(f.session.stage('conversation:/oversized.pdf')).rejects.toMatchObject({
      code: 'READ_FILE_FILE_TOO_LARGE',
    });
    expect(await readdir(f.temporaryDirectory)).toEqual([]);
    expect(await readFile(path.join(f.root, 'outside.md'), 'utf8')).toBe('outside');
  });

  it('真实复制期间父执行取消，等待流和暂存清理完成再释放 admission', async () => {
    const f = await fixture();
    const source = path.join(f.sourceRoot, 'large.pdf');
    const file = await open(source, 'w');
    await file.truncate(PLUGIN_INPUT_MAX_BYTES);
    await file.write('original');
    await file.close();
    let observedAdmission = false;
    onFirstChunk = () => {
      observedAdmission = f.isReading();
      f.controller.abort(new Error('parent execution cancelled'));
    };
    await expect(f.session.stage('conversation:/large.pdf')).rejects.toThrow();
    expect(observedAdmission).toBe(true);
    expect(f.isReading()).toBe(false);
    expect(await readdir(f.temporaryDirectory)).toEqual([]);
    const original = await open(source, 'r');
    try {
      expect((await original.stat()).size).toBe(PLUGIN_INPUT_MAX_BYTES);
      const prefix = Buffer.alloc(8);
      await original.read(prefix, 0, 8, 0);
      expect(prefix.toString()).toBe('original');
    } finally {
      await original.close();
    }
  });
});
