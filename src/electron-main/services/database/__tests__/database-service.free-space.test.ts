/**
 * 新建库开启增量回收（auto_vacuum = INCREMENTAL），删除释放的页可以分批归还磁盘；
 * 已有库保持原设定，不在启动时整库重写。
 */
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { DatabaseService } from '../../database';
import { SCHEMA_VERSION } from '../migrations';
import { reclaimFreePagesInBatches } from '../reclaimFreePagesInBatches';

let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-db-free-space-'));
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

function fillAndDelete(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS free_space_probe (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO free_space_probe (body) VALUES (?)');
  const body = 'x'.repeat(3000);
  db.transaction(() => {
    for (let index = 0; index < 6000; index += 1) insert.run(body);
  })();
  db.exec('DELETE FROM free_space_probe');
}

it('a fresh database uses incremental auto-vacuum and returns freed pages to the file system in batches', async () => {
  const dbPath = path.join(directory, 'workspace.sqlite');
  const service = new DatabaseService(dbPath);
  service.initialize();
  try {
    const db = service.getDb();
    expect(db.pragma('auto_vacuum', { simple: true })).toBe(2);
    fillAndDelete(db);
    const freeBefore = service.readFreePageCount();
    expect(freeBefore).toBeGreaterThan(4000);

    const reclaimed = await reclaimFreePagesInBatches(service, new AbortController().signal);

    expect(reclaimed).toBeGreaterThan(0);
    expect(service.readFreePageCount()).toBeLessThanOrEqual(512);
    expect(freeBefore - service.readFreePageCount()).toBe(reclaimed);
    db.pragma('wal_checkpoint(TRUNCATE)');
    const pageSize = db.pragma('page_size', { simple: true }) as number;
    const pageCount = db.pragma('page_count', { simple: true }) as number;
    expect(fs.statSync(dbPath).size).toBe(pageSize * pageCount);
  } finally {
    service.close();
  }
});

it('an existing database keeps its auto-vacuum mode and reclaim is a no-op', async () => {
  const dbPath = path.join(directory, 'workspace.sqlite');
  const legacy = new Database(dbPath);
  legacy.exec('CREATE TABLE legacy_probe (id INTEGER PRIMARY KEY)');
  legacy.pragma(`user_version = ${SCHEMA_VERSION}`);
  legacy.close();
  const service = new DatabaseService(dbPath);
  service.initialize();
  try {
    const db = service.getDb();
    expect(db.pragma('auto_vacuum', { simple: true })).toBe(0);
    fillAndDelete(db);
    const freeBefore = service.readFreePageCount();
    expect(await reclaimFreePagesInBatches(service, new AbortController().signal)).toBe(0);
    expect(service.readFreePageCount()).toBe(freeBefore);
  } finally {
    service.close();
  }
});

it('stops between batches once cancelled', async () => {
  const dbPath = path.join(directory, 'workspace.sqlite');
  const service = new DatabaseService(dbPath);
  service.initialize();
  try {
    fillAndDelete(service.getDb());
    const controller = new AbortController();
    const freeBefore = service.readFreePageCount();
    const target = {
      readFreePageCount: () => service.readFreePageCount(),
      reclaimFreePages: (maxPages: number) => {
        const freed = service.reclaimFreePages(maxPages);
        controller.abort();
        return freed;
      },
    };
    const reclaimed = await reclaimFreePagesInBatches(target, controller.signal, {
      minimumFreePages: 1,
      retainedFreePages: 0,
      batchPages: 100,
    });
    expect(reclaimed).toBe(100);
    expect(service.readFreePageCount()).toBe(freeBefore - 100);
  } finally {
    service.close();
  }
});
