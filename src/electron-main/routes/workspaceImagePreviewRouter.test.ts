import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceImagePreview,
  type WorkspaceImagePreviewPort,
} from 'src/features/workspace/assets/features/image-preview';
import { createConversationAttachmentStoragePaths } from 'src/features/conversation/attachments/shared/storage-paths';
import { createWorkspaceVerifiedImageLoader } from 'src/features/workspace/assets/shared/verified-image';
import { createWorkspaceImagePreviewRouter } from './workspaceImagePreviewRouter';

const STORE_ID = 'ed800f4d-8829-4f2c-9843-192eb376cf73';

interface PreviewFixture {
  readonly root: string;
  readonly contentRoot: string;
  readonly db: Database.Database;
  readonly imagePreview: WorkspaceImagePreviewPort;
}

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

async function listen(imagePreview: WorkspaceImagePreviewPort): Promise<{
  readonly server: Server;
  readonly baseUrl: string;
}> {
  const app = express();
  app.use('/api/v1/conversation', createWorkspaceImagePreviewRouter({ imagePreview }));
  app.use('/api/v1/workspace', createWorkspaceImagePreviewRouter({ imagePreview }));
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

describe('workspace image preview router', () => {
  const servers: Server[] = [];
  const fixtures: PreviewFixture[] = [];

  async function createFixture(): Promise<PreviewFixture> {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-image-preview-router-'));
    const contentRoot = createConversationAttachmentStoragePaths(root, STORE_ID).contentRoot;
    await fsp.mkdir(contentRoot, { recursive: true });
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE assets (
        id TEXT PRIMARY KEY,
        media_type TEXT,
        size_bytes INTEGER,
        width_px INTEGER,
        height_px INTEGER,
        sha256 TEXT,
        storage_status TEXT NOT NULL,
        local_path TEXT
      )
    `);
    const imagePreview = createWorkspaceImagePreview({
      verifiedImageLoader: createWorkspaceVerifiedImageLoader({
        db,
        storageBoundaries: [{ boundaryRoot: root, contentRoot }],
        maxImagePixels: 1_000_000,
      }),
    });
    const fixture = { root, contentRoot, db, imagePreview };
    fixtures.push(fixture);
    return fixture;
  }

  async function start(imagePreview: WorkspaceImagePreviewPort): Promise<string> {
    const running = await listen(imagePreview);
    servers.push(running.server);
    return running.baseUrl;
  }

  async function addAsset(params: {
    readonly fixture: PreviewFixture;
    readonly assetId: string;
    readonly bytes: Buffer;
    readonly sha256?: string;
  }): Promise<void> {
    const actualSha256 = createHash('sha256').update(params.bytes).digest('hex');
    const localPath = path.join(
      params.fixture.contentRoot,
      actualSha256.slice(0, 2),
      `${actualSha256}.png`,
    );
    await fsp.mkdir(path.dirname(localPath), { recursive: true });
    await fsp.writeFile(localPath, params.bytes);
    params.fixture.db.prepare(`
      INSERT INTO assets (
        id, media_type, size_bytes, width_px, height_px, sha256,
        storage_status, local_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.assetId,
      'image/png',
      params.bytes.length,
      12,
      8,
      params.sha256 ?? actualSha256,
      'local',
      localPath,
    );
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map(closeServer));
    for (const fixture of fixtures.splice(0)) {
      fixture.db.close();
      await fsp.rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('只按 asset ID 返回已复核 bytes 和安全响应头', async () => {
    const fixture = await createFixture();
    const bytes = await createPngBytes();
    await addAsset({ fixture, assetId: 'asset-preview-ok', bytes });
    const baseUrl = await start(fixture.imagePreview);

    const response = await fetch(
      `${baseUrl}/api/v1/conversation/assets/images/asset-preview-ok/content`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe(String(bytes.length));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);

    const workspaceResponse = await fetch(
      `${baseUrl}/api/v1/workspace/assets/images/asset-preview-ok/content`,
    );
    expect(workspaceResponse.status).toBe(200);
    expect(Buffer.from(await workspaceResponse.arrayBuffer())).toEqual(bytes);
  });

  it('把资源不可用和完整性失败映射成稳定 JSON，不返回账本细节', async () => {
    const fixture = await createFixture();
    const bytes = await createPngBytes();
    await addAsset({
      fixture,
      assetId: 'asset-preview-corrupt',
      bytes,
      sha256: 'b'.repeat(64),
    });
    const baseUrl = await start(fixture.imagePreview);

    const missing = await fetch(
      `${baseUrl}/api/v1/conversation/assets/images/asset-preview-missing/content`,
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      code: 'conversation.image.asset_not_found',
    });

    const corrupt = await fetch(
      `${baseUrl}/api/v1/conversation/assets/images/asset-preview-corrupt/content`,
    );
    expect(corrupt.status).toBe(422);
    await expect(corrupt.json()).resolves.toEqual({
      code: 'conversation.image.asset_integrity_failed',
    });
  });

  it('拒绝 query 旁路，并为未知读取故障返回通用 preview code', async () => {
    const readImage = vi.fn();
    const queryBaseUrl = await start({ readImage });
    const invalid = await fetch(
      `${queryBaseUrl}/api/v1/conversation/assets/images/asset-preview/content?path=/tmp/image.png`,
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      code: 'conversation.image.invalid_request',
    });
    expect(readImage).not.toHaveBeenCalled();

    const failureBaseUrl = await start({
      readImage: vi.fn().mockRejectedValue(new Error('test-only preview failure')),
    });
    const failure = await fetch(
      `${failureBaseUrl}/api/v1/conversation/assets/images/asset-preview/content`,
    );
    expect(failure.status).toBe(500);
    await expect(failure.json()).resolves.toEqual({
      code: 'conversation.image.preview_failed',
    });
  });
});
