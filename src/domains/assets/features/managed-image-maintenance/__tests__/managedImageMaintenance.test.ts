import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLegacyAppManagedImageStoragePaths,
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
    db.prepare('INSERT INTO assets (id, local_path) VALUES (?, ?)').run('asset-1', registered.finalPath);
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
    const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-managed-workspace-'));
    const appDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-managed-app-data-'));
    tempDirs.push(workspaceRoot, appDataRoot);
    const paths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
    const localPath = path.join(paths.contentRoot, 'aa', `${'a'.repeat(64)}.png`);
    await fsp.mkdir(path.dirname(localPath), { recursive: true });
    await fsp.writeFile(localPath, 'managed-content');
    const db = createLifecycleDatabase();
    db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)').run(
      'asset-linked',
      `/Resources/Attachments/aa/${'a'.repeat(64)}.png`,
      localPath,
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
        workspaceRoot,
        logger,
        createdBeforeMs: 2,
      })).toEqual({ deletedAssets: 0, deletedFiles: 0, failedFiles: 0 });

      db.prepare('DELETE FROM project_asset_links').run();
      expect(await collectOrphanManagedImageAssets({
        db,
        appDataRoot,
        storeId: STORE_ID,
        workspaceRoot,
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
    const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-current-workspace-'));
    const appDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-current-app-data-'));
    tempDirs.push(workspaceRoot, appDataRoot);
    const paths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
    const pending = await createPendingPublish({ paths, publishId: 'current', bytes: 'current-process-content' });
    const localPath = pending.finalPath;
    const db = createLifecycleDatabase();
    db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)').run(
      'asset-current',
      `/Resources/Attachments/cc/${'c'.repeat(64)}.jpg`,
      localPath,
      2_000,
    );
    const logger = { warn: vi.fn() };
    try {
      expect(await collectOrphanManagedImageAssets({
        db,
        appDataRoot,
        storeId: STORE_ID,
        workspaceRoot,
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
    const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-reused-workspace-'));
    const appDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-reused-app-data-'));
    tempDirs.push(workspaceRoot, appDataRoot);
    const paths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
    const localPath = path.join(paths.contentRoot, 'dd', `${'d'.repeat(64)}.png`);
    await fsp.mkdir(path.dirname(localPath), { recursive: true });
    await fsp.writeFile(localPath, 'reused-content');
    const db = createLifecycleDatabase();
    db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)').run(
      'asset-old-orphan',
      `/Resources/Attachments/dd/${'d'.repeat(64)}.png`,
      localPath,
      1,
    );
    db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)').run(
      'asset-current-owner',
      `/Resources/Attachments/dd/${'e'.repeat(64)}.png`,
      localPath,
      2,
    );
    db.prepare('INSERT INTO conversation_event_asset_links VALUES (?)').run('asset-current-owner');
    const logger = { warn: vi.fn() };
    try {
      expect(await collectOrphanManagedImageAssets({
        db,
        appDataRoot,
        storeId: STORE_ID,
        workspaceRoot,
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

  it('空数据库的新 store 不会触碰旧 AppData v1 或另一个 store 的内容', async () => {
    const appDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-isolated-store-'));
    tempDirs.push(appDataRoot);
    const currentPaths = createManagedImageStoragePaths(appDataRoot, STORE_ID);
    const otherPaths = createManagedImageStoragePaths(
      appDataRoot,
      'db7e7dac-8f65-4c66-987b-d4a40c2dc1c5',
    );
    const legacyPaths = createLegacyAppManagedImageStoragePaths(appDataRoot);
    const otherFile = path.join(otherPaths.contentRoot, 'aa', `${'a'.repeat(64)}.png`);
    const legacyFile = path.join(legacyPaths.contentRoot, 'bb', `${'b'.repeat(64)}.png`);
    await Promise.all([
      fsp.mkdir(path.dirname(otherFile), { recursive: true }),
      fsp.mkdir(path.dirname(legacyFile), { recursive: true }),
    ]);
    await Promise.all([
      fsp.writeFile(otherFile, 'other-store'),
      fsp.writeFile(legacyFile, 'legacy-store'),
    ]);
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
    await expect(fsp.readFile(legacyFile, 'utf8')).resolves.toBe('legacy-store');
  });

  it('旧 v1 asset 失去当前账本引用时只删账本行，不自动删除无 store 身份的字节', async () => {
    const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-legacy-row-workspace-'));
    const appDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-legacy-row-app-data-'));
    tempDirs.push(workspaceRoot, appDataRoot);
    const legacyPaths = createLegacyAppManagedImageStoragePaths(appDataRoot);
    const localPath = path.join(legacyPaths.contentRoot, 'aa', `${'a'.repeat(64)}.png`);
    await fsp.mkdir(path.dirname(localPath), { recursive: true });
    await fsp.writeFile(localPath, 'legacy-preserved');
    const db = createLifecycleDatabase();
    db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)').run(
      'legacy-orphan',
      `/Resources/Attachments/aa/${'a'.repeat(64)}.png`,
      localPath,
      1,
    );
    const logger = { warn: vi.fn() };
    try {
      expect(await collectOrphanManagedImageAssets({
        db,
        appDataRoot,
        storeId: STORE_ID,
        workspaceRoot,
        logger,
        createdBeforeMs: 2,
      })).toEqual({ deletedAssets: 1, deletedFiles: 0, failedFiles: 0 });
      expect(db.prepare('SELECT id FROM assets').all()).toEqual([]);
      await expect(fsp.readFile(localPath, 'utf8')).resolves.toBe('legacy-preserved');
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
