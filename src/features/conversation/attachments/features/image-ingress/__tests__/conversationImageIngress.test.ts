import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createConversationImageIngress,
  createConversationAttachmentStoragePaths,
  ConversationImageIngressError,
  type ConversationImageIngressPolicy,
} from '../index';

const DEFAULT_POLICY: ConversationImageIngressPolicy = {
  maxImageBytes: 1024 * 1024,
  maxImagePixels: 1_000_000,
  maxAttachmentsPerMessage: 2,
  maxTotalBytesPerMessage: 2 * 1024 * 1024,
};
const STORE_ID = '0f81bb43-dd9a-49e4-a3a1-bfb3bbb13ea7';

async function createImageBytes(
  format: 'jpeg' | 'png' | 'webp',
  width = 12,
  height = 8,
): Promise<Buffer> {
  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 34, g: 139, b: 94 },
    },
  });
  return pipeline[format]().toBuffer();
}

async function writeSource(
  root: string,
  fileName: string,
  bytes: Buffer,
): Promise<string> {
  const sourcePath = path.join(root, 'source', fileName);
  await fsp.mkdir(path.dirname(sourcePath), { recursive: true });
  await fsp.writeFile(sourcePath, bytes);
  return sourcePath;
}

function expectIngressCode(error: unknown, code: ConversationImageIngressError['code']): boolean {
  return error instanceof ConversationImageIngressError && error.code === code;
}

describe('workspace image ingress', () => {
  const tempDirs: string[] = [];

  async function createRoot(): Promise<string> {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-image-ingress-'));
    tempDirs.push(root);
    return root;
  }

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('按真实解码结果签发草稿，并让受管副本脱离用户原文件生命周期', async () => {
    const root = await createRoot();
    const png = await createImageBytes('png');
    const sourcePath = await writeSource(root, '伪装成-jpeg.jpg', png);
    const ingress = await createConversationImageIngress({
      appDataRoot: root,
      storeId: STORE_ID,
      policy: DEFAULT_POLICY,
      createDraftId: () => 'draft-real-format',
    });

    const draft = await ingress.stageImage({ sourcePath });
    expect(draft).toMatchObject({
      draftId: 'draft-real-format',
      mediaType: 'image/png',
      width: 12,
      height: 8,
      byteLength: png.length,
      fileName: '伪装成-jpeg.jpg',
    });

    await fsp.unlink(sourcePath);
    const committed = await ingress.commitDraftFile(draft.draftId);
    await expect(fsp.readFile(committed.localPath)).resolves.toEqual(png);
    expect(committed.uri).toBe(
      `/Resources/Attachments/${draft.sha256.slice(0, 2)}/${draft.sha256}.png`,
    );
    await ingress.releaseDraft(draft.draftId);
    const paths = createConversationAttachmentStoragePaths(root, STORE_ID);
    await expect(fsp.readdir(paths.pendingRoot)).resolves.toEqual([]);
    await expect(fsp.readdir(paths.stagingRoot)).resolves.toEqual([]);
  });

  it('path 与 bytes 入口共用真实解码和受管 staging 事实', async () => {
    const root = await createRoot();
    const png = await createImageBytes('png');
    const ingress = await createConversationImageIngress({
      appDataRoot: root,
      storeId: STORE_ID,
      policy: DEFAULT_POLICY,
      createDraftId: () => 'draft-bytes',
    });

    const draft = await ingress.stageImageBytes({
      bytes: png,
      fileName: 'browser-upload.jpeg',
    });

    expect(draft).toMatchObject({
      draftId: 'draft-bytes',
      mediaType: 'image/png',
      byteLength: png.length,
      width: 12,
      height: 8,
      fileName: 'browser-upload.jpeg',
    });
    const committed = await ingress.commitDraftFile(draft.draftId);
    await expect(fsp.readFile(committed.localPath)).resolves.toEqual(png);
  });

  it('bytes 入口验证失败时不登记 draft 或留下 staging 文件', async () => {
    const root = await createRoot();
    const paths = createConversationAttachmentStoragePaths(root, STORE_ID);
    const ingress = await createConversationImageIngress({
      appDataRoot: root,
      storeId: STORE_ID,
      policy: DEFAULT_POLICY,
      createDraftId: () => 'draft-invalid-bytes',
    });

    await expect(ingress.stageImageBytes({
      bytes: await createImageBytes('png'),
      fileName: '../escape.png',
    })).rejects.toSatisfy(
      (error: unknown) => expectIngressCode(error, 'invalid_file_name'),
    );
    await expect(ingress.stageImageBytes({
      bytes: Buffer.from('GIF89a', 'ascii'),
      fileName: 'not-supported.gif',
    })).rejects.toSatisfy(
      (error: unknown) => expectIngressCode(error, 'unsupported_image_format'),
    );

    expect(ingress.resolveDraft('draft-invalid-bytes')).toBeNull();
    await expect(fsp.readdir(paths.stagingRoot)).resolves.toEqual([]);
  });

  it('拒绝不支持格式、损坏图片、单图字节超限与像素超限', async () => {
    const root = await createRoot();
    const ingress = await createConversationImageIngress({
      appDataRoot: root,
      storeId: STORE_ID,
      policy: { ...DEFAULT_POLICY, maxImageBytes: 256, maxTotalBytesPerMessage: 512 },
      createDraftId: (() => {
        let sequence = 0;
        return () => `draft-invalid-${sequence += 1}`;
      })(),
    });
    const gifPath = await writeSource(root, 'a.gif', Buffer.from('GIF89a', 'ascii'));
    const brokenPngPath = await writeSource(
      root,
      'broken.png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
    );
    const tooLargePath = await writeSource(root, 'large.png', Buffer.alloc(257));

    await expect(ingress.stageImage({ sourcePath: gifPath })).rejects.toSatisfy(
      (error: unknown) => expectIngressCode(error, 'unsupported_image_format'),
    );
    await expect(ingress.stageImage({ sourcePath: brokenPngPath })).rejects.toSatisfy(
      (error: unknown) => expectIngressCode(error, 'invalid_image'),
    );
    await expect(ingress.stageImage({ sourcePath: tooLargePath })).rejects.toSatisfy(
      (error: unknown) => expectIngressCode(error, 'image_too_large'),
    );

    const pixelRoot = await createRoot();
    const pixelPath = await writeSource(pixelRoot, 'pixels.webp', await createImageBytes('webp', 20, 20));
    const pixelIngress = await createConversationImageIngress({
      appDataRoot: pixelRoot,
      storeId: STORE_ID,
      policy: { ...DEFAULT_POLICY, maxImagePixels: 399 },
    });
    await expect(pixelIngress.stageImage({ sourcePath: pixelPath })).rejects.toSatisfy(
      (error: unknown) => expectIngressCode(error, 'image_pixel_limit_exceeded'),
    );
  });

  it('在消息边界校验图片数量和总字节，并保持 draft 顺序', async () => {
    const root = await createRoot();
    const firstBytes = await createImageBytes('jpeg', 10, 10);
    const secondBytes = await createImageBytes('png', 10, 10);
    const maxImageBytes = Math.max(firstBytes.length, secondBytes.length);
    const ingress = await createConversationImageIngress({
      appDataRoot: root,
      storeId: STORE_ID,
      policy: {
        ...DEFAULT_POLICY,
        maxImageBytes,
        maxTotalBytesPerMessage: firstBytes.length + secondBytes.length - 1,
      },
      createDraftId: (() => {
        const ids = ['draft-first', 'draft-second'];
        return () => ids.shift() ?? 'draft-extra';
      })(),
    });
    const first = await ingress.stageImage({
      sourcePath: await writeSource(root, 'first.jpeg', firstBytes),
    });
    const second = await ingress.stageImage({
      sourcePath: await writeSource(root, 'second.png', secondBytes),
    });

    expect(ingress.resolveDraftBatch([second.draftId])).toEqual([second]);
    expect(() => ingress.resolveDraftBatch([first.draftId, second.draftId])).toThrowError(
      expect.objectContaining({ code: 'message_images_too_large' }),
    );
    expect(() => ingress.resolveDraftBatch([first.draftId, second.draftId, first.draftId])).toThrowError(
      expect.objectContaining({ code: 'too_many_attachments' }),
    );
  });

  it('相同内容的并发草稿收敛到同一个最终文件，单 draft 提交可幂等重试', async () => {
    const root = await createRoot();
    const bytes = await createImageBytes('webp');
    const ids = ['draft-a', 'draft-b'];
    const ingress = await createConversationImageIngress({
      appDataRoot: root,
      storeId: STORE_ID,
      policy: DEFAULT_POLICY,
      createDraftId: () => ids.shift() ?? 'draft-c',
    });
    const sourcePath = await writeSource(root, 'same.webp', bytes);
    const first = await ingress.stageImage({ sourcePath });
    const second = await ingress.stageImage({ sourcePath });

    const [firstCommit, secondCommit] = await Promise.all([
      ingress.commitDraftFile(first.draftId),
      ingress.commitDraftFile(second.draftId),
    ]);
    expect(firstCommit.localPath).toBe(secondCommit.localPath);
    expect(await ingress.commitDraftFile(first.draftId)).toEqual(firstCommit);
    await expect(fsp.readFile(firstCommit.localPath)).resolves.toEqual(bytes);

    const contentDir = path.dirname(firstCommit.localPath);
    expect(await fsp.readdir(contentDir)).toEqual([path.basename(firstCommit.localPath)]);
  });

  it('提交前复核草稿 hash；app 关闭后下次初始化清理旧 staging 但保留最终内容', async () => {
    const root = await createRoot();
    const paths = createConversationAttachmentStoragePaths(root, STORE_ID);
    const sourcePath = await writeSource(root, 'original.png', await createImageBytes('png'));
    const ingress = await createConversationImageIngress({
      appDataRoot: root,
      storeId: STORE_ID,
      policy: DEFAULT_POLICY,
      createDraftId: () => 'draft-changed',
    });
    const draft = await ingress.stageImage({ sourcePath });
    await fsp.writeFile(path.join(paths.stagingRoot, `${draft.draftId}.upload`), await createImageBytes('jpeg'));

    await expect(ingress.commitDraftFile(draft.draftId)).rejects.toSatisfy(
      (error: unknown) => expectIngressCode(error, 'draft_file_changed'),
    );

    const finalMarker = path.join(paths.contentRoot, 'aa', `${'a'.repeat(64)}.png`);
    await fsp.mkdir(path.dirname(finalMarker), { recursive: true });
    await fsp.writeFile(finalMarker, 'final');
    await createConversationImageIngress({ appDataRoot: root, storeId: STORE_ID, policy: DEFAULT_POLICY });
    await expect(fsp.readdir(paths.stagingRoot)).resolves.toEqual([]);
    await expect(fsp.readFile(finalMarker, 'utf8')).resolves.toBe('final');
  });

  it('用户释放未提交草稿时同时删除受管临时副本和进程内身份', async () => {
    const root = await createRoot();
    const paths = createConversationAttachmentStoragePaths(root, STORE_ID);
    const ingress = await createConversationImageIngress({
      appDataRoot: root,
      storeId: STORE_ID,
      policy: DEFAULT_POLICY,
      createDraftId: () => 'draft-release',
    });
    const draft = await ingress.stageImage({
      sourcePath: await writeSource(root, 'release.jpeg', await createImageBytes('jpeg')),
    });

    await ingress.releaseDraft(draft.draftId);

    expect(ingress.resolveDraft(draft.draftId)).toBeNull();
    await expect(fsp.readdir(paths.stagingRoot)).resolves.toEqual([]);
  });

});
