import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SlidesCliExitCode } from '../definitions/slidesCli';
import { openSlidesCliDatabase } from './openSlidesCliDatabase';

describe('openSlidesCliDatabase', () => {
  it('数据库不存在时返回稳定分类且不泄漏路径', () => {
    const databasePath = path.join(os.tmpdir(), `missing-workspace-${randomUUID()}.sqlite`);
    let thrown: unknown;

    try {
      openSlidesCliDatabase(Database, databasePath);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual(expect.objectContaining({
      code: 'slides.cli.database_unavailable',
      exitCode: SlidesCliExitCode.PRESENTATION_UNAVAILABLE,
      message: 'Workspace database could not be opened for reading',
    }));
    expect(thrown).toBeInstanceOf(Error);
    if (thrown instanceof Error) {
      expect(thrown.message).not.toContain(databasePath);
    }
  });
});
