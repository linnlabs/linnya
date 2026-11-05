import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createManagedImageStoragePaths,
  publishStagedManagedImage,
  type ManagedImageWritableStoragePaths,
} from '../../../shared/managed-image-storage';
import {
  collectOrphanManagedImageAssets,
  recoverPendingManagedImagePublishes,
  recoverPendingManagedImagePublishesFromLedger,
} from '../index';

const STORE_ID = 'f7bb8587-feaa-44df-82e3-4a1c93d9ba30';
const OTHER_STORE_ID = 'db7e7dac-8f65-4c66-987b-d4a40c2dc1c5';

/** 账本保存相对 AppData Root 的持久路径。 */
function toStoragePath(appDataRoot: string, localPath: string): string {
  return path.relative(appDataRoot, localPath).split(path.sep).join('/');
}

async function createPendingPublish(params: {
  readonly paths: ManagedImageWritableStoragePaths;
  readonly publishId: string;
  readonly bytes: string;
}): Promise<{ readonly finalPath: string; readonly receiptPath: string }> {
  const sha256 = createHash('sha256').update(params.bytes).digest('hex');
  const stagingPath = path.join(params.paths.stagingRoot, `${params.publishId}.upload`);
  const finalPath = path.join(params.paths.contentRoot, sha256.slice(0, 2), `${sha256}.png`);
  await fsp.mkdir(params.paths.stagingRoot, { recursive: true });
  await fsp.writeFile(stagingPath, params.bytes);
  const pending = await publishStagedManagedImage({
    paths: params.paths,
    publishId: params.publishId,
    stagingPath,
    finalPath,
    expectedSha256: sha256,
  });
  return { finalPath, receiptPath: pending.receiptPath };
}

function createLifecycleDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      uri TEXT NOT NULL UNIQUE,
      local_path TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE conversation_event_asset_links (asset_id TEXT NOT NULL);
    CREATE TABLE project_asset_links (project_id TEXT NOT NULL, asset_id TEXT NOT NULL);
    CREATE TABLE document_asset_links (document_node_id TEXT NOT NULL, asset_id TEXT NOT NULL);
    CREATE TABLE image_blocks (id TEXT PRIMARY KEY, asset_id TEXT);
    CREATE TABLE audio_blocks (id TEXT PRIMARY KEY, asset_id TEXT);
  `);
  return db;
}

describe('managed image maintenance', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => fsp.rm(dir, { recursive: true, force: true })));
  });

  it('拒绝直接链接外部来源，受管 staging 复制后才发布且不破坏来源', async () => {
    const appDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-managed-ingress-boundary-'));
    tempDirs.push(appDataRoot);
    const paths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
    await fsp.mkdir(paths.stagingRoot, { recursive: true });
    const source = path.join(appDataRoot, 'external.png');
    const bytes = 'synthetic-asset';
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const finalPath = path.join(paths.contentRoot, sha256.slice(0, 2), `${sha256}.png`);
    await fsp.writeFile(source, bytes);
    const publish = (stagingPath: string) => publishStagedManagedImage({
      paths, publishId: 'safe-ingress', stagingPath, finalPath, expectedSha256: sha256,
    });
    await expect(publish(source)).rejects.toThrow('protected staging root');
    await expect(fsp.stat(finalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.stat(paths.pendingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    const staged = path.join(paths.stagingRoot, 'copied.upload');
    await fsp.copyFile(source, staged);
    await publish(staged);
    expect(await fsp.readFile(finalPath, 'utf8')).toBe(bytes);
    expect(await fsp.readFile(source, 'utf8')).toBe(bytes);
  });

  it('只恢复显式 pending 发布，不扫描或删除当前账本不认识的正式内容', async () => {
    const appDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-managed-image-cleanup-'));
    tempDirs.push(appDataRoot);
    const paths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
    const registered = await createPendingPublish({ paths, publishId: 'registered', bytes: 'registered' });
    const orphan = await createPendingPublish({ paths, publishId: 'orphan', bytes: 'orphan' });
    const unknownFormalFile = path.join(paths.contentRoot, 'bb', `${'b'.repeat(64)}.webp`);
    await fsp.mkdir(path.dirname(unknownFormalFile), { recursive: true });
    await fsp.writeFile(unknownFormalFile, 'must-not-be-inferred-as-orphan');
    const processStartedAtMs = Date.now();
    const previousProcessTime = new Date(processStartedAtMs - 60_000);
    await Promise.all([
      fsp.utimes(registered.receiptPath, previousProcessTime, previousProcessTime),
      fsp.utimes(orphan.receiptPath, previousProcessTime, previousProcessTime),
    ]);

    const db = new Database(':memory:');
    db.exec('CREATE TABLE assets (id TEXT PRIMARY KEY, local_path TEXT)');
    db.prepare('INSERT INTO assets (id, local_path) VALUES (?, ?)').run(
      'asset-1',
      toStoragePath(appDataRoot, registered.finalPath),
    );
    const logger = { warn: vi.fn() };
    try {
      const stats = await recoverPendingManagedImagePublishesFromLedger({
        db,
        appDataRoot,
        storeId: STORE_ID,
        logger,
        processStartedAtMs,
        quarantineRetentionMs: 30 * 24 * 60 * 60 * 1_000,
      });

      expect(stats).toEqual({
        scanned: 2,
        completed: 2,
        quarantined: 1,
        quarantineDeleted: 0,
        failed: 0,
      });
      await expect(fsp.readFile(registered.finalPath, 'utf8')).resolves.toBe('registered');
      await expect(fsp.stat(orphan.finalPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fsp.readFile(unknownFormalFile, 'utf8')).resolves.toBe('must-not-be-inferred-as-orphan');
      expect(await fsp.readdir(paths.quarantineRoot)).toHaveLength(1);
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('只有所有 ownership link 消失后才回收受管 asset 与文件', async () => {
    const appDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-managed-app-data-'));
    tempDirs.push(appDataRoot);
    const paths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
    const localPath = path.join(paths.contentRoot, 'aa', `${'a'.repeat(64)}.png`);
    await fsp.mkdir(path.dirname(localPath), { recursive: true });
    await fsp.writeFile(localPath, 'managed-content');
    const db = createLifecycleDatabase();
    db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)').run(
      'asset-linked',
      `/Resources/Attachments/aa/${'a'.repeat(64)}.png`,
      toStoragePath(appDataRoot, localPath),
      1,
    );
    db.prepare('INSERT INTO conversation_event_asset_links VALUES (?)').run('asset-linked');
    db.prepare('INSERT INTO project_asset_links VALUES (?, ?)').run('project-a', 'asset-linked');
    const logger = { warn: vi.fn() };
    try {
      db.prepare('DELETE FROM conversation_event_asset_links').run();
      expect(await collectOrphanManagedImageAssets({
        db,
        appDataRoot,
        storeId: STORE_ID,
        logger,
        createdBeforeMs: 2,
      })).toEqual({ deletedAssets: 0, deletedFiles: 0, failedFiles: 0 });

      db.prepare('DELETE FROM project_asset_links').run();
      expect(await collectOrphanManagedImageAssets({
        db,
        appDataRoot,
        storeId: STORE_ID,
        logger,
        createdBeforeMs: 2,
      })).toEqual({ deletedAssets: 1, deletedFiles: 1, failedFiles: 0 });
      expect(db.prepare('SELECT id FROM assets').all()).toEqual([]);
      await expect(fsp.stat(localPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('时间屏障同时保护本进程 pending 发布和刚登记但尚未绑定 event 的 asset', async () => {
    const appDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-current-app-data-'));
    tempDirs.push(appDataRoot);
    const paths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
    const pending = await createPendingPublish({ paths, publishId: 'current', bytes: 'current-process-content' });
    const localPath = pending.finalPath;
    const db = createLifecycleDatabase();
    db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)').run(
      'asset-current',
      `/Resources/Attachments/cc/${'c'.repeat(64)}.jpg`,
      toStoragePath(appDataRoot, localPath),
      2_000,
    );
    const logger = { warn: vi.fn() };
    try {
      expect(await collectOrphanManagedImageAssets({
        db,
        appDataRoot,
        storeId: STORE_ID,
        logger,
        createdBeforeMs: 1_000,
      })).toEqual({ deletedAssets: 0, deletedFiles: 0, failedFiles: 0 });
      expect(await recoverPendingManagedImagePublishes({
        paths,
        registeredLocalPaths: new Set(),
        createdBeforeMs: Date.now() - 60_000,
        quarantineDeleteBeforeMs: 0,
        logger,
      })).toEqual({
        scanned: 1,
        completed: 0,
        quarantined: 0,
        quarantineDeleted: 0,
        failed: 0,
      });
      expect(db.prepare('SELECT id FROM assets').all()).toEqual([{ id: 'asset-current' }]);
      await expect(fsp.readFile(localPath, 'utf8')).resolves.toBe('current-process-content');
    } finally {
      db.close();
    }
  });

  it('删除旧孤儿账本行后，若 canonical path 仍被当前账本占用则保留文件', async () => {
    const appDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-reused-app-data-'));
    tempDirs.push(appDataRoot);
    const paths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
    const localPath = path.join(paths.contentRoot, 'dd', `${'d'.repeat(64)}.png`);
    await fsp.mkdir(path.dirname(localPath), { recursive: true });
    await fsp.writeFile(localPath, 'reused-content');
    const db = createLifecycleDatabase();
    db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)').run(
      'asset-old-orphan',
      `/Resources/Attachments/dd/${'d'.repeat(64)}.png`,
      toStoragePath(appDataRoot, localPath),
      1,
    );
    db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)').run(
      'asset-current-owner',
      `/Resources/Attachments/dd/${'e'.repeat(64)}.png`,
      toStoragePath(appDataRoot, localPath),
      2,
    );
    db.prepare('INSERT INTO conversation_event_asset_links VALUES (?)').run('asset-current-owner');
    const logger = { warn: vi.fn() };
    try {
      expect(await collectOrphanManagedImageAssets({
        db,
        appDataRoot,
        storeId: STORE_ID,
        logger,
        createdBeforeMs: 3,
      })).toEqual({ deletedAssets: 1, deletedFiles: 0, failedFiles: 0 });
      expect(db.prepare('SELECT id FROM assets').all()).toEqual([{ id: 'asset-current-owner' }]);
      await expect(fsp.readFile(localPath, 'utf8')).resolves.toBe('reused-content');
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('pending 账本里存在无法解析的持久路径时整体中止，不隔离任何文件', async () => {
    const appDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-invalid-ledger-'));
    tempDirs.push(appDataRoot);
    const paths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
    const pending = await createPendingPublish({ paths, publishId: 'kept', bytes: 'kept-content' });
    const previousProcessTime = new Date(Date.now() - 60_000);
    await fsp.utimes(pending.receiptPath, previousProcessTime, previousProcessTime);
    const db = new Database(':memory:');
    db.exec('CREATE TABLE assets (id TEXT PRIMARY KEY, local_path TEXT)');
    db.prepare('INSERT INTO assets (id, local_path) VALUES (?, ?)').run('asset-absolute', pending.finalPath);
    try {
      await expect(recoverPendingManagedImagePublishesFromLedger({
        db,
        appDataRoot,
        storeId: STORE_ID,
        logger: { warn: vi.fn() },
        processStartedAtMs: Date.now(),
        quarantineRetentionMs: 30 * 24 * 60 * 60 * 1_000,
      })).rejects.toMatchObject({ name: 'AssetStoragePathError' });
      await expect(fsp.readFile(pending.finalPath, 'utf8')).resolves.toBe('kept-content');
      await expect(fsp.stat(pending.receiptPath)).resolves.toBeTruthy();
      await expect(fsp.stat(paths.quarantineRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      db.close();
    }
  });

  it('空数据库的新 store 不会触碰另一个 store 的内容', async () => {
    const appDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-isolated-store-'));
    tempDirs.push(appDataRoot);
    const currentPaths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
    const otherPaths = createManagedImageStoragePaths(appDataRoot, OTHER_STORE_ID);
    const otherFile = path.join(otherPaths.contentRoot, 'aa', `${'a'.repeat(64)}.png`);
    await fsp.mkdir(path.dirname(otherFile), { recursive: true });
    await fsp.writeFile(otherFile, 'other-store');
    const logger = { warn: vi.fn() };

    expect(await recoverPendingManagedImagePublishes({
      paths: currentPaths,
      registeredLocalPaths: new Set(),
      createdBeforeMs: Date.now(),
      quarantineDeleteBeforeMs: 0,
      logger,
    })).toEqual({
      scanned: 0,
      completed: 0,
      quarantined: 0,
      quarantineDeleted: 0,
      failed: 0,
    });
    await expect(fsp.readFile(otherFile, 'utf8')).resolves.toBe('other-store');
  });

  it('孤儿账本行指向当前 store 之外或路径无效时只删账本行，保留字节并告警', async () => {
    const appDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-foreign-row-app-data-'));
    tempDirs.push(appDataRoot);
    const otherPaths = createManagedImageStoragePaths(appDataRoot, OTHER_STORE_ID);
    const foreignPath = path.join(otherPaths.contentRoot, 'aa', `${'a'.repeat(64)}.png`);
    const currentPaths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
    const absolutePath = path.join(currentPaths.contentRoot, 'bb', `${'b'.repeat(64)}.png`);
    await Promise.all([
      fsp.mkdir(path.dirname(foreignPath), { recursive: true }),
      fsp.mkdir(path.dirname(absolutePath), { recursive: true }),
    ]);
    await Promise.all([
      fsp.writeFile(foreignPath, 'foreign-preserved'),
      fsp.writeFile(absolutePath, 'absolute-preserved'),
    ]);
    const db = createLifecycleDatabase();
    db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)').run(
      'foreign-orphan',
      `/Resources/Attachments/aa/${'a'.repeat(64)}.png`,
      toStoragePath(appDataRoot, foreignPath),
      1,
    );
    db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)').run(
      'absolute-orphan',
      `/Resources/Attachments/bb/${'b'.repeat(64)}.png`,
      absolutePath,
      1,
    );
    const logger = { warn: vi.fn() };
    try {
      expect(await collectOrphanManagedImageAssets({
        db,
        appDataRoot,
        storeId: STORE_ID,
        logger,
        createdBeforeMs: 2,
      })).toEqual({ deletedAssets: 2, deletedFiles: 0, failedFiles: 2 });
      expect(db.prepare('SELECT id FROM assets').all()).toEqual([]);
      await expect(fsp.readFile(foreignPath, 'utf8')).resolves.toBe('foreign-preserved');
      await expect(fsp.readFile(absolutePath, 'utf8')).resolves.toBe('absolute-preserved');
      expect(logger.warn).toHaveBeenCalledTimes(2);
    } finally {
      db.close();
    }
  });

  it('只按保留期删除隔离区文件，不触碰普通文件或尚未到期内容', async () => {
    const appDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-quarantine-retention-'));
    tempDirs.push(appDataRoot);
    const paths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
    await fsp.mkdir(paths.quarantineRoot, { recursive: true });
    const oldImage = path.join(paths.quarantineRoot, `old--${'a'.repeat(64)}.png`);
    const recentImage = path.join(paths.quarantineRoot, `recent--${'b'.repeat(64)}.webp`);
    const unrelatedFile = path.join(paths.quarantineRoot, 'operator-note.txt');
    await Promise.all([
      fsp.writeFile(oldImage, 'old'),
      fsp.writeFile(recentImage, 'recent'),
      fsp.writeFile(unrelatedFile, 'keep'),
    ]);
    const now = Date.now();
    const oldTime = new Date(now - 60_000);
    await fsp.utimes(oldImage, oldTime, oldTime);
    const logger = { warn: vi.fn() };

    expect(await recoverPendingManagedImagePublishes({
      paths,
      registeredLocalPaths: new Set(),
      createdBeforeMs: now,
      quarantineDeleteBeforeMs: now - 30_000,
      logger,
    })).toEqual({
      scanned: 0,
      completed: 0,
      quarantined: 0,
      quarantineDeleted: 1,
      failed: 0,
    });
    await expect(fsp.stat(oldImage)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.readFile(recentImage, 'utf8')).resolves.toBe('recent');
    await expect(fsp.readFile(unrelatedFile, 'utf8')).resolves.toBe('keep');
  });
});
