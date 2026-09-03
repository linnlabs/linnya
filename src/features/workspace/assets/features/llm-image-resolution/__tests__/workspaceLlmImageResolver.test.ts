import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WorkspaceLlmImageResolutionError,
  type WorkspaceLlmImageReference,
} from '../definitions/workspaceLlmImageResolution';
import { createWorkspaceLlmImageResolver } from '../orchestration/createWorkspaceLlmImageResolver';
import { createConversationAttachmentStoragePaths } from 'src/features/conversation/attachments/shared/storage-paths';
import { createWorkspaceVerifiedImageLoader } from '../../../shared/verified-image';

interface AssetFixture {
  readonly reference: WorkspaceLlmImageReference;
  readonly bytes: Buffer;
  readonly localPath: string;
}

const roots: string[] = [];
const databases: Database.Database[] = [];
const STORE_ID = '25aa551d-d0d9-4aa8-b47a-279692fd2c88';

afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(roots.splice(0).map(root => fsp.rm(root, { recursive: true, force: true })));
});

async function createFixture() {
  const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-llm-image-resolver-'));
  roots.push(workspaceRoot);
  const contentRoot = createConversationAttachmentStoragePaths(workspaceRoot, STORE_ID).contentRoot;
  await fsp.mkdir(contentRoot, { recursive: true });

  const db = new Database(':memory:');
  databases.push(db);
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

  const resolver = createWorkspaceLlmImageResolver({
    verifiedImageLoader: createWorkspaceVerifiedImageLoader({
      db,
      storageBoundaries: [{ boundaryRoot: workspaceRoot, contentRoot }],
      maxImagePixels: 1_000_000,
    }),
  });
  return { workspaceRoot, contentRoot, db, resolver };
}

async function makePng(width = 6, height = 4): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 30, g: 80, b: 140, alpha: 1 },
    },
  }).png().toBuffer();
}

async function addAsset(params: {
  readonly db: Database.Database;
  readonly contentRoot: string;
  readonly assetId: string;
  readonly attachmentId?: string;
  readonly bytes?: Buffer;
  readonly mediaType?: string | null;
  readonly byteLength?: number | null;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly sha256?: string | null;
  readonly storageStatus?: string;
  readonly localPath?: string | null;
  readonly writeFile?: boolean;
}): Promise<AssetFixture> {
  const bytes = params.bytes ?? await makePng();
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  const sha256 = params.sha256 === undefined ? actualHash : params.sha256;
  const mediaType = params.mediaType === undefined ? 'image/png' : params.mediaType;
  const byteLength = params.byteLength === undefined ? bytes.length : params.byteLength;
  const width = params.width === undefined ? 6 : params.width;
  const height = params.height === undefined ? 4 : params.height;
  const localPath = params.localPath === undefined
    ? path.join(params.contentRoot, actualHash.slice(0, 2), `${actualHash}.png`)
    : params.localPath;

  if (localPath && params.writeFile !== false) {
    await fsp.mkdir(path.dirname(localPath), { recursive: true });
    await fsp.writeFile(localPath, bytes);
  }
  params.db.prepare(`
    INSERT INTO assets (
      id, media_type, size_bytes, width_px, height_px, sha256,
      storage_status, local_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.assetId,
    mediaType,
    byteLength,
    width,
    height,
    sha256,
    params.storageStatus ?? 'local',
    localPath,
  );

  return {
    reference: {
      id: params.attachmentId ?? `attachment-${params.assetId}`,
      resourceId: params.assetId,
      mediaType: mediaType === 'image/jpeg' || mediaType === 'image/webp' ? mediaType : 'image/png',
      byteLength: byteLength ?? bytes.length,
      width: width ?? 6,
      height: height ?? 4,
      sha256: sha256 ?? actualHash,
    },
    bytes,
    localPath: localPath ?? '',
  };
}

function expectResolutionFailure(
  promise: Promise<unknown>,
  code: 'attachment_unavailable' | 'attachment_integrity_failed',
  failure: string,
) {
  return expect(promise).rejects.toMatchObject({
    name: 'WorkspaceLlmImageResolutionError',
    code,
    failure,
  });
}

describe('workspace LLM image resolver', () => {
  it('按 durable 顺序返回已复核 bytes，且输出不含路径或 hash', async () => {
    const fixture = await createFixture();
    const first = await addAsset({ ...fixture, assetId: 'asset-1' });
    const second = await addAsset({
      ...fixture,
      assetId: 'asset-2',
      bytes: await makePng(3, 2),
      width: 3,
      height: 2,
    });

    const resolved = await fixture.resolver.resolveImages([second.reference, first.reference]);

    expect(resolved.map(image => image.id)).toEqual([
      second.reference.id,
      first.reference.id,
    ]);
    expect(Buffer.from(resolved[0].bytes)).toEqual(second.bytes);
    expect(Buffer.from(resolved[1].bytes)).toEqual(first.bytes);
    expect(resolved[0]).not.toHaveProperty('localPath');
    expect(resolved[0]).not.toHaveProperty('sha256');
  });

  it('空批次不要求 managed content root 存在', async () => {
    const fixture = await createFixture();
    await fsp.rm(fixture.contentRoot, { recursive: true, force: true });

    await expect(fixture.resolver.resolveImages([])).resolves.toEqual([]);
  });

  it('缺 row、non-local、缺文件和非普通文件均返回 unavailable', async () => {
    const missingRow = await createFixture();
    const reference: WorkspaceLlmImageReference = {
      id: 'attachment-missing',
      resourceId: 'asset-missing',
      mediaType: 'image/png',
      byteLength: 10,
      width: 1,
      height: 1,
      sha256: 'a'.repeat(64),
    };
    await expectResolutionFailure(
      missingRow.resolver.resolveImages([reference]),
      'attachment_unavailable',
      'asset_not_found',
    );

    const nonLocal = await createFixture();
    const nonLocalAsset = await addAsset({
      ...nonLocal,
      assetId: 'asset-remote',
      storageStatus: 'remote',
    });
    await expectResolutionFailure(
      nonLocal.resolver.resolveImages([nonLocalAsset.reference]),
      'attachment_unavailable',
      'asset_not_local',
    );

    const missingFile = await createFixture();
    const missingFileAsset = await addAsset({
      ...missingFile,
      assetId: 'asset-no-file',
      writeFile: false,
    });
    await expectResolutionFailure(
      missingFile.resolver.resolveImages([missingFileAsset.reference]),
      'attachment_unavailable',
      'file_missing',
    );

    const directory = await createFixture();
    const directoryPath = path.join(directory.contentRoot, 'directory-asset');
    await fsp.mkdir(directoryPath, { recursive: true });
    const directoryAsset = await addAsset({
      ...directory,
      assetId: 'asset-directory',
      localPath: directoryPath,
      writeFile: false,
    });
    await expectResolutionFailure(
      directory.resolver.resolveImages([directoryAsset.reference]),
      'attachment_unavailable',
      'file_not_regular',
    );
  });

  it('拒绝 managed root 外路径与指向 root 外的符号链接', async () => {
    const escaped = await createFixture();
    const outsidePath = path.join(escaped.workspaceRoot, 'outside.png');
    const escapedAsset = await addAsset({
      ...escaped,
      assetId: 'asset-escaped',
      localPath: outsidePath,
    });
    await expectResolutionFailure(
      escaped.resolver.resolveImages([escapedAsset.reference]),
      'attachment_integrity_failed',
      'managed_path_escape',
    );

    const linked = await createFixture();
    const outsideTarget = path.join(linked.workspaceRoot, 'outside-target.png');
    const bytes = await makePng();
    await fsp.writeFile(outsideTarget, bytes);
    const linkPath = path.join(linked.contentRoot, 'aa', 'linked.png');
    await fsp.mkdir(path.dirname(linkPath), { recursive: true });
    await fsp.symlink(outsideTarget, linkPath);
    const linkedAsset = await addAsset({
      ...linked,
      assetId: 'asset-linked',
      bytes,
      localPath: linkPath,
      writeFile: false,
    });
    await expectResolutionFailure(
      linked.resolver.resolveImages([linkedAsset.reference]),
      'attachment_integrity_failed',
      'managed_path_escape',
    );

    const linkedRoot = await createFixture();
    const outsideContentRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-outside-content-'));
    roots.push(outsideContentRoot);
    await fsp.rm(linkedRoot.contentRoot, { recursive: true, force: true });
    await fsp.symlink(outsideContentRoot, linkedRoot.contentRoot);
    const linkedRootAsset = await addAsset({
      ...linkedRoot,
      assetId: 'asset-linked-root',
    });
    await expectResolutionFailure(
      linkedRoot.resolver.resolveImages([linkedRootAsset.reference]),
      'attachment_integrity_failed',
      'managed_path_escape',
    );
  });

  it('逐项拒绝 durable、长度、hash、MIME、尺寸与解码不一致', async () => {
    const incomplete = await createFixture();
    const incompleteAsset = await addAsset({
      ...incomplete,
      assetId: 'asset-incomplete',
      width: null,
    });
    await expectResolutionFailure(
      incomplete.resolver.resolveImages([incompleteAsset.reference]),
      'attachment_integrity_failed',
      'ledger_incomplete',
    );

    const durable = await createFixture();
    const durableAsset = await addAsset({ ...durable, assetId: 'asset-durable' });
    await expectResolutionFailure(
      durable.resolver.resolveImages([{ ...durableAsset.reference, width: 99 }]),
      'attachment_integrity_failed',
      'durable_ref_mismatch',
    );

    const length = await createFixture();
    const bytes = await makePng();
    const lengthAsset = await addAsset({
      ...length,
      assetId: 'asset-length',
      bytes,
      byteLength: bytes.length + 1,
    });
    await expectResolutionFailure(
      length.resolver.resolveImages([lengthAsset.reference]),
      'attachment_integrity_failed',
      'byte_length_mismatch',
    );

    const hash = await createFixture();
    const hashAsset = await addAsset({
      ...hash,
      assetId: 'asset-hash',
      sha256: 'b'.repeat(64),
    });
    await expectResolutionFailure(
      hash.resolver.resolveImages([hashAsset.reference]),
      'attachment_integrity_failed',
      'hash_mismatch',
    );

    const mime = await createFixture();
    const mimeAsset = await addAsset({
      ...mime,
      assetId: 'asset-mime',
      mediaType: 'image/jpeg',
    });
    await expectResolutionFailure(
      mime.resolver.resolveImages([mimeAsset.reference]),
      'attachment_integrity_failed',
      'media_type_mismatch',
    );

    const dimensions = await createFixture();
    const dimensionsAsset = await addAsset({
      ...dimensions,
      assetId: 'asset-dimensions',
      width: 7,
    });
    await expectResolutionFailure(
      dimensions.resolver.resolveImages([dimensionsAsset.reference]),
      'attachment_integrity_failed',
      'dimensions_mismatch',
    );

    const damaged = await createFixture();
    const damagedBytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('not-a-decodable-png'),
    ]);
    const damagedAsset = await addAsset({
      ...damaged,
      assetId: 'asset-damaged',
      bytes: damagedBytes,
    });
    await expectResolutionFailure(
      damaged.resolver.resolveImages([damagedAsset.reference]),
      'attachment_integrity_failed',
      'image_decode_failed',
    );
  });

  it('批次中任一图片失败时不返回部分结果', async () => {
    const fixture = await createFixture();
    const valid = await addAsset({ ...fixture, assetId: 'asset-valid' });
    const invalid = await addAsset({
      ...fixture,
      assetId: 'asset-invalid',
      bytes: await makePng(2, 2),
      width: 2,
      height: 2,
      writeFile: false,
    });

    await expect(fixture.resolver.resolveImages([
      valid.reference,
      invalid.reference,
    ])).rejects.toBeInstanceOf(WorkspaceLlmImageResolutionError);
  });
});
