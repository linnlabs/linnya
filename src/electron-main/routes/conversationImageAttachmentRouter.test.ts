import { createServer, request as createHttpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationImageDraftStageResponseSchema } from '@app/schemas';
import {
  createConversationImageIngress,
  ConversationImageIngressError,
  type ConversationImageIngressPolicy,
  type ConversationImageIngressPort,
} from 'src/features/conversation/attachments/features/image-ingress';
import { createConversationImageAttachmentRouter } from './conversationImageAttachmentRouter';

const DEFAULT_POLICY: ConversationImageIngressPolicy = {
  maxImageBytes: 1024 * 1024,
  maxImagePixels: 1_000_000,
  maxAttachmentsPerMessage: 10,
  maxTotalBytesPerMessage: 2 * 1024 * 1024,
};
const STORE_ID = 'ed800f4d-8829-4f2c-9843-192eb376cf73';

async function createPngBytes(): Promise<Buffer> {
  return sharp({
    create: {
      width: 12,
      height: 8,
      channels: 3,
      background: { r: 34, g: 139, b: 94 },
    },
  }).png().toBuffer();
}

function createBlob(bytes: Uint8Array, type?: string): Blob {
  return new Blob([Uint8Array.from(bytes)], type ? { type } : undefined);
}

async function listen(params: {
  readonly imageIngress: Pick<ConversationImageIngressPort, 'stageImageBytes' | 'releaseDraft'>;
  readonly maxImageBytes: number;
}): Promise<{ readonly server: Server; readonly baseUrl: string }> {
  const app = express();
  app.use('/api/v1/conversation', createConversationImageAttachmentRouter(params));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

describe('conversation image attachment router', () => {
  const servers: Server[] = [];
  const tempDirs: string[] = [];

  async function createIngress(
    draftId: string,
    policy: ConversationImageIngressPolicy = DEFAULT_POLICY,
  ): Promise<{ readonly root: string; readonly ingress: ConversationImageIngressPort }> {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-image-router-'));
    tempDirs.push(root);
    return {
      root,
      ingress: await createConversationImageIngress({
        appDataRoot: root,
        storeId: STORE_ID,
        policy,
        createDraftId: () => draftId,
      }),
    };
  }

  async function start(params: {
    readonly imageIngress: Pick<ConversationImageIngressPort, 'stageImageBytes' | 'releaseDraft'>;
    readonly maxImageBytes?: number;
  }): Promise<string> {
    const running = await listen({
      imageIngress: params.imageIngress,
      maxImageBytes: params.maxImageBytes ?? DEFAULT_POLICY.maxImageBytes,
    });
    servers.push(running.server);
    return running.baseUrl;
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map(closeServer));
    await Promise.all(tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })));
  });

  it('忽略 multipart MIME，按真实图片事实签发安全 draft，并支持幂等 release', async () => {
    const { root, ingress } = await createIngress('draft-http-success');
    const baseUrl = await start({ imageIngress: ingress });
    const png = await createPngBytes();
    const form = new FormData();
    form.append('file', createBlob(png, 'image/gif'), '实际是-png.jpeg');

    const response = await fetch(`${baseUrl}/api/v1/conversation/attachments/images`, {
      method: 'POST',
      body: form,
    });
    const body = ConversationImageDraftStageResponseSchema.parse(await response.json());

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      draft: {
        draftId: 'draft-http-success',
        kind: 'image',
        fileName: '实际是-png.jpeg',
      },
      mediaType: 'image/png',
      byteLength: png.length,
      width: 12,
      height: 8,
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(body)).not.toContain(root);

    const releaseUrl = `${baseUrl}/api/v1/conversation/attachments/images/${body.draft.draftId}`;
    expect((await fetch(releaseUrl, { method: 'DELETE' })).status).toBe(204);
    expect((await fetch(releaseUrl, { method: 'DELETE' })).status).toBe(204);
    expect(ingress.resolveDraft(body.draft.draftId)).toBeNull();
  });

  it('拒绝多文件、缺文件和超过 multipart 上限的请求，且不签发 draft', async () => {
    const { ingress } = await createIngress('draft-http-invalid');
    const baseUrl = await start({ imageIngress: ingress, maxImageBytes: 8 });

    const multiple = new FormData();
    multiple.append('file', createBlob(Buffer.from('first')), 'first.png');
    multiple.append('file', createBlob(Buffer.from('second')), 'second.png');
    const multipleResponse = await fetch(`${baseUrl}/api/v1/conversation/attachments/images`, {
      method: 'POST',
      body: multiple,
    });
    expect(multipleResponse.status).toBe(400);
    await expect(multipleResponse.json()).resolves.toEqual({
      code: 'conversation.image.invalid_request',
    });

    const missing = new FormData();
    missing.append('metadata', 'not-a-file');
    const missingResponse = await fetch(`${baseUrl}/api/v1/conversation/attachments/images`, {
      method: 'POST',
      body: missing,
    });
    expect(missingResponse.status).toBe(400);
    await expect(missingResponse.json()).resolves.toEqual({
      code: 'conversation.image.invalid_request',
    });

    const tooLarge = new FormData();
    tooLarge.append('file', createBlob(Buffer.alloc(9)), 'large.png');
    const tooLargeResponse = await fetch(`${baseUrl}/api/v1/conversation/attachments/images`, {
      method: 'POST',
      body: tooLarge,
    });
    expect(tooLargeResponse.status).toBe(413);
    await expect(tooLargeResponse.json()).resolves.toEqual({
      code: 'conversation.image.too_large',
    });
    expect(ingress.resolveDraft('draft-http-invalid')).toBeNull();
  });

  it('把真实格式、解码和文件名失败映射成稳定错误码', async () => {
    const { ingress } = await createIngress('draft-http-content-error');
    const baseUrl = await start({ imageIngress: ingress });

    const unsupported = new FormData();
    unsupported.append('file', createBlob(Buffer.from('GIF89a', 'ascii')), 'image.gif');
    const unsupportedResponse = await fetch(`${baseUrl}/api/v1/conversation/attachments/images`, {
      method: 'POST',
      body: unsupported,
    });
    expect(unsupportedResponse.status).toBe(415);
    await expect(unsupportedResponse.json()).resolves.toEqual({
      code: 'conversation.image.unsupported_format',
    });

    const invalid = new FormData();
    invalid.append(
      'file',
      createBlob(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])),
      'broken.png',
    );
    const invalidResponse = await fetch(`${baseUrl}/api/v1/conversation/attachments/images`, {
      method: 'POST',
      body: invalid,
    });
    expect(invalidResponse.status).toBe(422);
    await expect(invalidResponse.json()).resolves.toEqual({
      code: 'conversation.image.invalid_image',
    });

    const fileNameFailurePort = {
      stageImageBytes: vi.fn().mockRejectedValue(
        new ConversationImageIngressError('invalid_file_name', 'test-only'),
      ),
      releaseDraft: vi.fn(),
    };
    const fileNameBaseUrl = await start({ imageIngress: fileNameFailurePort });
    const fileNameForm = new FormData();
    fileNameForm.append('file', createBlob(await createPngBytes()), 'bad.png');
    const fileNameResponse = await fetch(
      `${fileNameBaseUrl}/api/v1/conversation/attachments/images`,
      { method: 'POST', body: fileNameForm },
    );
    expect(fileNameResponse.status).toBe(400);
    await expect(fileNameResponse.json()).resolves.toEqual({
      code: 'conversation.image.invalid_file_name',
    });

    const stagingFailureBaseUrl = await start({
      imageIngress: {
        stageImageBytes: vi.fn().mockRejectedValue(new Error('test-only staging failure')),
        releaseDraft: vi.fn(),
      },
    });
    const stagingFailureForm = new FormData();
    stagingFailureForm.append('file', createBlob(await createPngBytes()), 'valid.png');
    const stagingFailureResponse = await fetch(
      `${stagingFailureBaseUrl}/api/v1/conversation/attachments/images`,
      { method: 'POST', body: stagingFailureForm },
    );
    expect(stagingFailureResponse.status).toBe(500);
    await expect(stagingFailureResponse.json()).resolves.toEqual({
      code: 'conversation.image.staging_failed',
    });
  });

  it('连接在 multipart 完成前中断时不调用 staging', async () => {
    const stageImageBytes = vi.fn();
    const baseUrl = await start({
      imageIngress: {
        stageImageBytes,
        releaseDraft: vi.fn(),
      },
    });
    const url = new URL(`${baseUrl}/api/v1/conversation/attachments/images`);
    const boundary = 'phase4-aborted-upload';

    await new Promise<void>((resolve) => {
      const request = createHttpRequest({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      });
      request.on('error', () => resolve());
      request.write(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="partial.png"\r\nContent-Type: image/png\r\n\r\n`,
      );
      request.write(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      setImmediate(() => request.destroy());
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(stageImageBytes).not.toHaveBeenCalled();
  });
});
