import {
  chmodSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DatabaseService } from 'src/electron-main/services/database';
import {
  HOST_SCHEMA_BASELINE_VERSION,
  HostMigrationStepError,
  SCHEMA_VERSION,
  runMigrationStep,
} from 'src/electron-main/services/database/migrations';
import { acquireWorkspaceRuntimeOwnership } from '../../backend-runtime/features/workspace-ownership/acquireWorkspaceRuntimeOwnership';
import { describeAppServerStartupFailure } from '../functions/describeAppServerStartupFailure';

// 损坏数据全部在系统临时目录现场生成，测完删除；不读写任何工作目录的 _dev_data。
let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'linnya-startup-failure-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function initializeFailure(databasePath: string): Error {
  const service = new DatabaseService(databasePath);
  try {
    service.initialize();
  } catch (error: unknown) {
    if (error instanceof Error) return error;
    throw new Error(`initialize 抛出了非 Error：${String(error)}`);
  } finally {
    service.close();
  }
  throw new Error('expected initialize to fail');
}

function createCurrentDatabase(databasePath: string): void {
  const service = new DatabaseService(databasePath);
  service.initialize();
  service.close();
  // 把 WAL 全部写回主文件并改回 rollback journal，后面的破坏才落在真正会被读到的页上。
  const db = new Database(databasePath);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.pragma('journal_mode = DELETE');
  db.close();
}

function readPageLayout(databasePath: string): {
  readonly pageSize: number;
  readonly pageCount: number;
  readonly schemaPages: readonly number[];
} {
  const db = new Database(databasePath, { readonly: true });
  try {
    const pageSize = Number(db.pragma('page_size', { simple: true }));
    const pageCount = Number(db.pragma('page_count', { simple: true }));
    const schemaPages = db.prepare<[], { pageno: number }>(
      "SELECT pageno FROM dbstat WHERE name = 'sqlite_schema'",
    ).all().map(row => row.pageno);
    return { pageSize, pageCount, schemaPages };
  } finally {
    db.close();
  }
}

function overwritePages(databasePath: string, pageSize: number, pages: readonly number[]): void {
  const fd = openSync(databasePath, 'r+');
  try {
    const garbage = Buffer.alloc(pageSize, 0xff);
    for (const page of pages) writeSync(fd, garbage, 0, pageSize, (page - 1) * pageSize);
  } finally {
    closeSync(fd);
  }
}

describe('App Server 启动失败归类（真实 SQLite 文件）', () => {
  it('文件头被改写：SQLITE_NOTADB 归为数据文件损坏', () => {
    const databasePath = path.join(root, 'workspace.sqlite');
    createCurrentDatabase(databasePath);
    const fd = openSync(databasePath, 'r+');
    writeSync(fd, Buffer.alloc(100, 0x5a), 0, 100, 0);
    closeSync(fd);

    const failure = describeAppServerStartupFailure(initializeFailure(databasePath));
    expect(failure).toEqual({ reason: 'corrupt', code: 'SQLITE_NOTADB', migration_from_version: null });
  });

  it('schema 页被写坏：打开即报 SQLITE_CORRUPT，归为数据文件损坏', () => {
    const databasePath = path.join(root, 'workspace.sqlite');
    createCurrentDatabase(databasePath);
    const { pageSize, schemaPages } = readPageLayout(databasePath);
    // 第 1 页保留文件头，写坏 schema 的其余页。
    overwritePages(databasePath, pageSize, schemaPages.filter(page => page !== 1));

    const failure = describeAppServerStartupFailure(initializeFailure(databasePath));
    expect(failure.reason).toBe('corrupt');
    expect(failure.code).toMatch(/^SQLITE_CORRUPT/);
  });

  it('只有数据页被写坏、schema 完好：启动不受影响，只有读到坏页的操作失败', () => {
    const databasePath = path.join(root, 'workspace.sqlite');
    createCurrentDatabase(databasePath);
    const { pageSize, pageCount, schemaPages } = readPageLayout(databasePath);
    const dataPages = Array.from({ length: pageCount }, (_, index) => index + 1)
      .filter(page => page !== 1 && !schemaPages.includes(page))
      .slice(0, 32);
    expect(dataPages.length).toBeGreaterThan(0);
    overwritePages(databasePath, pageSize, dataPages);

    const service = new DatabaseService(databasePath);
    try {
      expect(() => service.initialize()).not.toThrow();
      expect(() => service.getDb().pragma('quick_check')).toThrow();
    } finally {
      service.close();
    }
  });

  it('数据来自更新的版本：在写入前拒绝，原文件逐字节不变', () => {
    const databasePath = path.join(root, 'workspace.sqlite');
    const db = new Database(databasePath);
    db.exec('CREATE TABLE marker (id INTEGER PRIMARY KEY)');
    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    db.close();
    const before = readBytes(databasePath);

    const failure = describeAppServerStartupFailure(initializeFailure(databasePath));
    expect(failure).toEqual({ reason: 'newer_data', code: null, migration_from_version: null });
    expect(readBytes(databasePath).equals(before)).toBe(true);
  });

  it('数据来自基线之前的版本：归为更早版本，原文件逐字节不变', () => {
    const databasePath = path.join(root, 'workspace.sqlite');
    const db = new Database(databasePath);
    db.exec('CREATE TABLE marker (id INTEGER PRIMARY KEY)');
    db.pragma(`user_version = ${HOST_SCHEMA_BASELINE_VERSION - 1}`);
    db.close();
    const before = readBytes(databasePath);

    const failure = describeAppServerStartupFailure(initializeFailure(databasePath));
    expect(failure.reason).toBe('older_data');
    expect(readBytes(databasePath).equals(before)).toBe(true);
  });

  it('数据目录只读：无法建立数据库文件，归为无法读写数据目录', () => {
    const directory = path.join(root, 'readonly');
    mkdirSync(directory);
    chmodSync(directory, 0o500);
    try {
      const failure = describeAppServerStartupFailure(
        initializeFailure(path.join(directory, 'workspace.sqlite')),
      );
      expect(failure.reason).toBe('cannot_access');
      expect(failure.code).toMatch(/^SQLITE_(CANTOPEN|READONLY)/);
    } finally {
      chmodSync(directory, 0o700);
    }
  });

  it('同一数据目录已有运行中的 Linnya：归为被占用', () => {
    const owner = acquireWorkspaceRuntimeOwnership(root);
    try {
      let failure: unknown = null;
      try {
        acquireWorkspaceRuntimeOwnership(root).release();
      } catch (error: unknown) {
        failure = error;
      }
      if (!(failure instanceof Error)) throw new Error('expected ownership conflict');
      expect(describeAppServerStartupFailure(failure)).toEqual({
        reason: 'busy',
        code: 'SQLITE_BUSY',
        migration_from_version: null,
      });
    } finally {
      owner.release();
    }
  });

  it('迁移步骤本身出错：归为数据升级失败，带出失败的步骤，版本号停在上一步', () => {
    const db = new Database(path.join(root, 'workspace.sqlite'));
    try {
      // v70→v71 遇到不在受管目录内的附件路径会整体失败；这一步事务回滚。
      db.exec(`
        CREATE TABLE assets (
          id TEXT PRIMARY KEY,
          uri TEXT NOT NULL UNIQUE,
          media_type TEXT,
          size_bytes INTEGER,
          width_px INTEGER,
          height_px INTEGER,
          sha256 TEXT,
          storage_status TEXT NOT NULL,
          local_path TEXT,
          created_at INTEGER NOT NULL
        );
        INSERT INTO assets (id, uri, storage_status, local_path, created_at)
          VALUES ('legacy', '/Resources/Attachments/legacy', 'local', '/elsewhere/legacy.png', 1);
      `);
      db.pragma('user_version = 70');
      let failure: unknown = null;
      try {
        runMigrationStep(db, 70);
      } catch (error: unknown) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(HostMigrationStepError);
      if (!(failure instanceof Error)) throw new Error('unreachable');
      const description = describeAppServerStartupFailure(failure);
      expect(description.reason).toBe('migration_failed');
      expect(description.migration_from_version).toBe(70);
      expect(db.pragma('user_version', { simple: true })).toBe(70);
      expect(db.prepare('SELECT local_path FROM assets').get()).toEqual({
        local_path: '/elsewhere/legacy.png',
      });
    } finally {
      db.close();
    }
  });
});

describe('App Server 启动失败归类（错误链）', () => {
  it('迁移途中磁盘已满：环境原因优先，同时保留迁移步骤', () => {
    const cause = Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
    expect(describeAppServerStartupFailure(new HostMigrationStepError(72, cause))).toEqual({
      reason: 'disk_full',
      code: 'SQLITE_FULL',
      migration_from_version: 72,
    });
  });

  it('沿 cause 链找到被包装的原始错误', () => {
    const cause = Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR_WRITE' });
    const wrapped = Object.assign(new Error('Backend 启动失败'), { cause });
    expect(describeAppServerStartupFailure(wrapped)).toMatchObject({
      reason: 'io_error',
      code: 'SQLITE_IOERR_WRITE',
    });
  });

  it('系统 errno：ENOSPC 是磁盘已满，EACCES 是无法读写', () => {
    const enospc = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    const eacces = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    expect(describeAppServerStartupFailure(enospc).reason).toBe('disk_full');
    expect(describeAppServerStartupFailure(eacces).reason).toBe('cannot_access');
  });

  it('其他错误如实报告原因未知，保留可识别的错误码', () => {
    expect(describeAppServerStartupFailure(new Error('unexpected'))).toEqual({
      reason: 'unknown',
      code: null,
      migration_from_version: null,
    });
    const constraint = Object.assign(new Error('constraint'), { code: 'SQLITE_CONSTRAINT' });
    expect(describeAppServerStartupFailure(constraint)).toEqual({
      reason: 'unknown',
      code: 'SQLITE_CONSTRAINT',
      migration_from_version: null,
    });
  });
});

function readBytes(filePath: string): Buffer {
  return readFileSync(filePath);
}
