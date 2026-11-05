/**
 * 数据库启动阶段把进度交给宿主：新库没有升级；已有库逐个 Host 迁移步骤报告进度。
 */
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { DatabaseService } from '../../database';
import type { DatabaseStartupProgressEvent } from '../databaseStartupProgress';
import { SCHEMA_VERSION } from '../migrations';

let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-db-startup-progress-'));
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

function recordProgress() {
  const events: DatabaseStartupProgressEvent[] = [];
  return {
    events,
    port: {
      async report(event: DatabaseStartupProgressEvent) {
        events.push(event);
      },
    },
  };
}

it('a fresh database reports one non-upgrade step', async () => {
  const service = new DatabaseService(path.join(directory, 'workspace.sqlite'));
  const progress = recordProgress();
  await service.initializeWithStartupProgress({ progress: progress.port });
  try {
    expect(progress.events).toEqual([
      { state: 'started', upgrading: false, completedSteps: 0, totalSteps: 1 },
      { state: 'finished', upgrading: false, completedSteps: 1, totalSteps: 1 },
    ]);
    expect(service.getDb().pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  } finally {
    service.close();
  }
});

it('an older database reports each host migration step before finishing', async () => {
  const dbPath = path.join(directory, 'workspace.sqlite');
  const created = new DatabaseService(dbPath);
  created.initialize();
  created.close();
  const raw = new Database(dbPath);
  raw.pragma(`user_version = ${SCHEMA_VERSION - 1}`);
  raw.close();

  const service = new DatabaseService(dbPath);
  const progress = recordProgress();
  await service.initializeWithStartupProgress({ progress: progress.port });
  try {
    expect(progress.events).toEqual([
      { state: 'started', upgrading: true, completedSteps: 0, totalSteps: 2 },
      { state: 'progress', upgrading: true, completedSteps: 1, totalSteps: 2 },
      { state: 'finished', upgrading: true, completedSteps: 2, totalSteps: 2 },
    ]);
    expect(service.getDb().pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  } finally {
    service.close();
  }
});

it('a failed progress delivery closes the connection before any migration step', async () => {
  const dbPath = path.join(directory, 'workspace.sqlite');
  const created = new DatabaseService(dbPath);
  created.initialize();
  created.close();
  const raw = new Database(dbPath);
  raw.pragma(`user_version = ${SCHEMA_VERSION - 1}`);
  raw.close();

  const service = new DatabaseService(dbPath);
  await expect(service.initializeWithStartupProgress({
    progress: { report: () => Promise.reject(new Error('control pipe closed')) },
  })).rejects.toThrow('control pipe closed');
  expect(() => service.getDb()).toThrow();
  const reopened = new Database(dbPath);
  try {
    expect(reopened.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION - 1);
  } finally {
    reopened.close();
  }
});
