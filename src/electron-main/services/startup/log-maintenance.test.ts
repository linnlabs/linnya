import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { Logger } from '../../../shared/logger';
import {
  buildBackendLogFileName,
  prepareActiveLogFileForStartupSync,
  runStartupLogMaintenanceOnce,
} from './log-maintenance';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-log-maintenance-'));
}

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('log-maintenance', () => {
  it('buildBackendLogFileName uses day-based backend log naming', () => {
    expect(buildBackendLogFileName(new Date(2026, 2, 23, 12, 0, 0))).toBe('backend-2026-03-23.log');
  });

  it('prepareActiveLogFileForStartupSync truncates oversized active log to tail', () => {
    const dir = makeTempDir();
    createdDirs.push(dir);

    const filePath = path.join(dir, 'backend-2026-03-23.log');
    const content = Array.from({ length: 40 }, (_v, idx) => `line-${idx.toString().padStart(2, '0')}`).join('\n');
    fs.writeFileSync(filePath, content, 'utf8');

    const result = prepareActiveLogFileForStartupSync({
      logFilePath: filePath,
      maxBytes: 64
    });

    const truncated = fs.readFileSync(filePath, 'utf8');
    expect(result.existed).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.originalBytes).toBeGreaterThan(result.keptBytes);
    expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(64);
    expect(truncated).toContain('line-39');
  });

  it('runStartupLogMaintenanceOnce deletes expired historical log files but keeps active log', async () => {
    const dir = makeTempDir();
    createdDirs.push(dir);

    const now = new Date('2026-03-23T08:00:00.000Z');
    const activeName = 'backend-2026-03-23.log';
    const staleName = 'backend-2026-03-10.log';
    const freshName = 'backend-2026-03-22.log';

    fs.writeFileSync(path.join(dir, activeName), 'active', 'utf8');
    fs.writeFileSync(path.join(dir, staleName), 'stale', 'utf8');
    fs.writeFileSync(path.join(dir, freshName), 'fresh', 'utf8');
    fs.writeFileSync(path.join(dir, 'note.txt'), 'ignore', 'utf8');

    const staleTime = new Date('2026-03-10T08:00:00.000Z');
    const freshTime = new Date('2026-03-22T08:00:00.000Z');
    fs.utimesSync(path.join(dir, staleName), staleTime, staleTime);
    fs.utimesSync(path.join(dir, freshName), freshTime, freshTime);
    fs.utimesSync(path.join(dir, activeName), staleTime, staleTime);

    const stats = await runStartupLogMaintenanceOnce({
      logger: new Logger('LogMaintenanceTest'),
      logDirectory: dir,
      activeLogFileName: activeName,
      retentionDays: 7,
      now
    });

    expect(stats.scannedFiles).toBe(3);
    expect(stats.deletedFiles).toBe(1);
    expect(stats.failedFiles).toBe(0);
    expect(fs.existsSync(path.join(dir, activeName))).toBe(true);
    expect(fs.existsSync(path.join(dir, freshName))).toBe(true);
    expect(fs.existsSync(path.join(dir, staleName))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'note.txt'))).toBe(true);
  });
});
