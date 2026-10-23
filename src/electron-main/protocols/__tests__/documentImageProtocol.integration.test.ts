import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import sharp from 'sharp';
import { afterEach, expect, it, vi } from 'vitest';
import { readDocumentImageAsset } from 'src/app-hosts/linnya/application/markdown-image-assets';
import { createWorkspaceVerifiedImageLoader } from 'src/features/workspace/assets/shared/verified-image';
import { createWorkspaceImagePreviewRouter } from '../../routes/workspaceImagePreviewRouter';
import { handleMediaProtocolRequest } from '../mediaProtocol';

// 仅替换 Electron 的网络适配器；协议、HTTP、归属、SQLite 和真实图片校验必须完整执行。
vi.mock('electron', () => ({ net: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) }, protocol: {} }));

let root: string;
let db: Database.Database;
let server: Server;
afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

it('Main 通过已认证后端显示文档图片，拒绝失去归属或字节损坏的资产', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-document-image-protocol-'));
  const contentRoot = path.join(root, 'content');
  await fs.mkdir(contentRoot);
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE assets (
      id TEXT PRIMARY KEY, media_type TEXT, size_bytes INTEGER, width_px INTEGER,
      height_px INTEGER, sha256 TEXT, storage_status TEXT NOT NULL, local_path TEXT
    );
    CREATE TABLE document_asset_links (document_node_id TEXT, asset_id TEXT);
  `);
  const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: 'green' } }).png().toBuffer();
  const assetId = 'test-document-image';
  const imagePath = path.join(contentRoot, 'image.png');
  await fs.writeFile(imagePath, bytes);
  db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(assetId, 'image/png', bytes.length, 12, 8, createHash('sha256').update(bytes).digest('hex'), 'local', imagePath);
  const own = () => db.prepare('INSERT INTO document_asset_links VALUES (?, ?)').run('test-document', assetId);
  own();
  const loader = createWorkspaceVerifiedImageLoader({
    db, storageBoundaries: [{ boundaryRoot: root, contentRoot }], maxImagePixels: 10000,
  });
  const app = express();
  app.use((req, res, next) => {
    if (req.headers['x-api-token'] !== 'test-renderer-token') { res.sendStatus(401); return; }
    next();
  });
  app.use('/api/v1/markdown', createWorkspaceImagePreviewRouter({
    imagePreview: { readImage: id => readDocumentImageAsset({ db, loader, assetId: id }) },
  }));
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  const backend = { apiPort: address.port, rendererSessionToken: 'test-renderer-token' };
  const request = { url: `media://load/asset-image/${Buffer.from(assetId).toString('base64url')}`, headers: new Headers() };
  const loaded = await handleMediaProtocolRequest(request, backend);
  expect(loaded.status).toBe(200);
  expect(loaded.headers.get('content-type')).toBe('image/png');
  expect(loaded.headers.get('cache-control')).toBe('no-store');
  expect(Buffer.from(await loaded.arrayBuffer())).toEqual(bytes);

  const unauthorized = await handleMediaProtocolRequest(request, { ...backend, rendererSessionToken: 'wrong-token' });
  expect(unauthorized.status).toBe(401);
  await unauthorized.text();
  db.prepare('DELETE FROM document_asset_links').run();
  const unowned = await handleMediaProtocolRequest(request, backend);
  expect(unowned.status).toBe(404);
  expect(await unowned.json()).toEqual({ code: 'conversation.image.asset_not_found' });
  own();
  await fs.writeFile(imagePath, 'corrupt bytes');
  const corrupt = await handleMediaProtocolRequest(request, backend);
  expect(corrupt.status).toBe(422);
  expect(await corrupt.json()).toEqual({ code: 'conversation.image.asset_integrity_failed' });
  expect((await handleMediaProtocolRequest({ ...request, url: 'media://load/asset-image/!' }, backend)).status).toBe(400);
});
