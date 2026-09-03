import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { DatabaseService } from '../../../../electron-main/services/database';
import { BetterSqliteKnowledgeGraphRepository } from '../infrastructure/better-sqlite-knowledge-graph.repository';
import { GraphProgressService } from '../application/graphProgressService';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('GraphProgressService (M4)', () => {
  let tempDir: string;
  let dbPath: string;
  let databaseService: DatabaseService;
  let repo: BetterSqliteKnowledgeGraphRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-kg-progress-'));
    dbPath = path.join(tempDir, 'workspace.sqlite');

    databaseService = new DatabaseService(dbPath);
    databaseService.initialize();

    // 预置 KB 记录（图谱表有 kb_id 外键）
    const db = databaseService.getDb();
    db.prepare(`
      INSERT INTO knowledge_bases (
        id, name, description, tags_json,
        embedding_model_id, rerank_model_id, vision_model_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'kb-test',
      '测试知识库',
      '用于图谱进度单测',
      null,
      null,
      null,
      null,
      Date.now() / 1000,
      Date.now() / 1000
    );

    repo = new BetterSqliteKnowledgeGraphRepository(databaseService);
  });

  afterEach(() => {
    databaseService.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('应支持“queued 扩分母导致进度回落”，并对推送做节流', async () => {
    const pushed: Array<{ kbId: string; percent: number; totalUnits: number; doneUnits: number }> = [];
    const service = new GraphProgressService(repo, {
      throttleMs: 5,
      onProgressUpdated: (p) => pushed.push({ kbId: p.kbId, percent: p.percent, totalUnits: p.totalUnits, doneUnits: p.doneUnits }),
    });

    // doc-a 入队 100
    await service.onDocQueued('kb-test', 'doc-a', 100);
    await sleep(10);
    expect(pushed.at(-1)?.totalUnits).toBe(100);
    expect(pushed.at(-1)?.doneUnits).toBe(0);
    expect(pushed.at(-1)?.percent).toBe(0);

    // doc-a 做到 50%
    await repo.updateDocProgress('kb-test', 'doc-a', 50, 'running');
    service.onDocProgress('kb-test');
    await sleep(10);
    expect(pushed.at(-1)?.totalUnits).toBe(100);
    expect(pushed.at(-1)?.doneUnits).toBe(50);
    expect(pushed.at(-1)?.percent).toBe(50);

    // doc-b 入队 100 -> 分母 200，进度回落到 25%
    await service.onDocQueued('kb-test', 'doc-b', 100);
    await sleep(10);
    expect(pushed.at(-1)?.totalUnits).toBe(200);
    expect(pushed.at(-1)?.doneUnits).toBe(50);
    expect(pushed.at(-1)?.percent).toBe(25);
  });
});


