import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CONVERSATION_IMAGE_MAX_BYTES } from '@app/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedImageIngressPort } from 'src/domains/assets/features/managed-image-ingress';
import { createInMemoryToolResultAssetClaimRegistry } from 'src/domains/assets/features/tool-result-claims';
import {
  PHYSICAL_TEXT_FILE_MAX_BYTES,
  readPhysicalFileForTool,
} from 'src/app-hosts/linnya/application/file-read';
import { createNodePhysicalFileReader } from './createNodePhysicalFileReader';

describe('Node physical file reader', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(root => (
      fsp.rm(root, { recursive: true, force: true })
    )));
  });

  async function createRoot(): Promise<string> {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-physical-file-read-'));
    temporaryRoots.push(root);
    return root;
  }

  it('读取 strict UTF-8 文本、移除 BOM，并按原请求文件名投影 content type', async () => {
    const root = await createRoot();
    const filePath = path.join(root, '说明.md');
    await fsp.writeFile(filePath, Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('# 标题\n', 'utf8'),
    ]));

    await expect(createNodePhysicalFileReader().readFile({
      absolutePath: filePath,
      scope: { kind: 'host' },
    })).resolves.toMatchObject({
      kind: 'text',
      fileName: '说明.md',
      contentType: 'text/markdown',
      text: '# 标题\n',
    });
  });

  it('拒绝非法 UTF-8、ASCII PDF、ZIP/Office 容器和目录', async () => {
    const root = await createRoot();
    const cases = [
      { name: 'invalid.txt', bytes: Buffer.from([0xc3, 0x28]), code: 'READ_FILE_TEXT_ENCODING_UNSUPPORTED' },
      { name: 'paper.txt', bytes: Buffer.from('%PDF-1.7\n%%EOF'), code: 'READ_FILE_UNSUPPORTED_FORMAT' },
      { name: 'renamed.txt', bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), code: 'READ_FILE_UNSUPPORTED_FORMAT' },
    ] as const;
    const reader = createNodePhysicalFileReader();
    for (const item of cases) {
      const filePath = path.join(root, item.name);
      await fsp.writeFile(filePath, item.bytes);
      await expect(reader.readFile({
        absolutePath: filePath,
        scope: { kind: 'host' },
      })).rejects.toMatchObject({ code: item.code });
    }

    await expect(reader.readFile({
      absolutePath: root,
      scope: { kind: 'host' },
    })).rejects.toMatchObject({ code: 'READ_FILE_NOT_REGULAR_FILE' });
  });

  it('在分配正文缓冲区前按 stat 拒绝超出文本和图片字节上限的文件', async () => {
    const root = await createRoot();
    const textPath = path.join(root, 'large.txt');
    await fsp.writeFile(textPath, '');
    await fsp.truncate(textPath, PHYSICAL_TEXT_FILE_MAX_BYTES + 1);

    const imagePath = path.join(root, 'large-image.bin');
    const imageHandle = await fsp.open(imagePath, 'w');
    try {
      await imageHandle.write(Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]), 0, 8, 0);
      await imageHandle.truncate(CONVERSATION_IMAGE_MAX_BYTES + 1);
    } finally {
      await imageHandle.close();
    }

    const reader = createNodePhysicalFileReader();
    for (const filePath of [textPath, imagePath]) {
      await expect(reader.readFile({
        absolutePath: filePath,
        scope: { kind: 'host' },
      })).rejects.toMatchObject({ code: 'READ_FILE_FILE_TOO_LARGE' });
    }
  });

  it.runIf(process.platform !== 'win32')(
    'host 跟随 symlink 但保留请求 basename；conversation 拒绝 leaf link 和父目录逃逸',
    async () => {
      const root = await createRoot();
      const conversationRoot = path.join(root, 'conversation');
      const outsideRoot = path.join(root, 'outside');
      await Promise.all([
        fsp.mkdir(conversationRoot),
        fsp.mkdir(outsideRoot),
      ]);
      const target = path.join(outsideRoot, 'target.txt');
      const alias = path.join(conversationRoot, 'alias.md');
      await fsp.writeFile(target, 'target text');
      await fsp.symlink(target, alias);

      const reader = createNodePhysicalFileReader();
      await expect(reader.readFile({
        absolutePath: alias,
        scope: { kind: 'host' },
      })).resolves.toMatchObject({
        kind: 'text',
        fileName: 'alias.md',
        resolvedPath: await fsp.realpath(target),
        contentType: 'text/markdown',
      });
      await expect(reader.readFile({
        absolutePath: alias,
        scope: { kind: 'conversation', rootPath: conversationRoot },
      })).rejects.toMatchObject({ code: 'READ_FILE_NOT_REGULAR_FILE' });

      const linkedDirectory = path.join(conversationRoot, 'linked-directory');
      await fsp.symlink(outsideRoot, linkedDirectory, 'dir');
      await expect(reader.readFile({
        absolutePath: path.join(linkedDirectory, 'target.txt'),
        scope: { kind: 'conversation', rootPath: conversationRoot },
      })).rejects.toMatchObject({ code: 'READ_FILE_LOCATOR_INVALID' });
    },
  );

  it('图片复用 managed ingress 和 tool-call claim，并保留调用方 locator identity', async () => {
    const root = await createRoot();
    const imagePath = path.join(root, 'slide.payload');
    await fsp.writeFile(imagePath, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X2NDFAAAAABJRU5ErkJggg==',
      'base64',
    ));
    const ingestLocalImage = vi.fn<ManagedImageIngressPort['ingestLocalImage']>()
      .mockResolvedValue({
        assetId: 'asset-slide',
        uri: 'asset://local/asset-slide',
        mediaType: 'image/png',
        byteLength: 68,
        width: 1,
        height: 1,
        sha256: 'a'.repeat(64),
        localPath: '/managed/asset-slide.png',
        createdAt: 1,
      });
    const claims = createInMemoryToolResultAssetClaimRegistry({
      createClaimId: () => 'claim-slide',
    });
    const locator = 'file:///tmp/submitted-slide.payload';

    const result = await readPhysicalFileForTool({
      reader: createNodePhysicalFileReader(),
      imageIngress: { ingestLocalImage },
      claims,
      conversationId: 'conversation-1',
      toolCallId: 'tool-call-1',
      locator,
      absolutePath: imagePath,
      scope: { kind: 'host' },
      hasExplicitTextWindow: false,
      hasAttachedImageContent: () => false,
    });

    expect(result).toMatchObject({
      kind: 'image',
      locator,
      contentType: 'image/png',
      width: 1,
      height: 1,
    });
    if (result.kind !== 'image') throw new Error('expected image');
    if (result.attachmentStatus !== 'attached') throw new Error('expected a new image attachment');
    expect(ingestLocalImage).toHaveBeenCalledWith({ sourcePath: await fsp.realpath(imagePath) });
    expect(claims.consumeClaims({
      conversationId: 'conversation-1',
      toolCallId: 'tool-call-1',
      selections: [{ selectionId: result.selection.id, uri: result.selection.uri }],
    })).toEqual([{ selectionId: result.selection.id, assetId: 'asset-slide' }]);
  });
});
