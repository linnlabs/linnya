import { createProjectLifecycle } from 'src/domains/projects';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceGrepResultSchema, WorkspaceWriteFileResultSchema } from '@app/schemas';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { WORKSPACE_VFS_SEARCH_INDEX_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/search-index.schema';
import { saveWorkspaceNodeTextSnapshot } from 'src/features/workspace/infrastructure/sqlite/node-text-snapshot/nodeTextSnapshot.service';
import { searchWorkspaceVfsNodes } from 'src/features/workspace/vfs/orchestration/searchWorkspaceVfsNodes';
import { grepWorkspaceVfsSearchIndex } from 'src/features/workspace/vfs/orchestration/workspaceVfsSearchIndex';
import { invalidateWorkspaceVfsSearchIndexNodes } from 'src/features/workspace/vfs';
import { GrepTool } from './GrepTool';
import { WriteFileTool } from '../write_file/WriteFileTool';
import { attachCitationSourceResolver } from 'src/domains/citation';
import type { ToolContext } from '../../types';

let database: DatabaseService;
let projectId: string;
const grep = new GrepTool();

beforeEach(() => {
  database = new DatabaseService(':memory:');
  database.initialize();
  projectId = createProjectLifecycle(database.getDb()).create({ name: 'Grep coverage' });
});

afterEach(() => database.close());

function insertText(id: string, name: string, text: string, parentId: string | null = null): void {
  const db = database.getDb();
  db.prepare(`
    INSERT INTO workspace_nodes (id, project_id, parent_id, type, name, created_at, updated_at)
    VALUES (?, ?, ?, 'fixture_text', ?, 1, 1)
  `).run(id, projectId, parentId, name);
  // 使用正式 VFS 事实快照，而不是伪造 read/grep 的返回，避免依赖特定插件。
  saveWorkspaceNodeTextSnapshot({ db, nodeId: id, contentType: 'text/plain', text, updatedAt: 1 });
}

async function run(args: Record<string, unknown>) {
  const raw = await grep.run(args, {
    databaseService: database,
    workspaceProjectId: projectId,
    conversationId: 'grep-coverage',
  });
  return WorkspaceGrepResultSchema.parse(JSON.parse(raw));
}

function removeIndex(): void {
  database.getDb().exec(`
    DROP TABLE workspace_vfs_search_grams;
    DROP TABLE workspace_vfs_search_lines;
    DROP TABLE workspace_vfs_search_files;
  `);
}

describe('Workspace grep current text and honest coverage', () => {
  it('目录首次和缓存复查都报告前缀未搜全，单文件定位覆盖截断点和全文尾部', async () => {
    const boundaryPrefix = 'x'.repeat(119998);
    insertText('long', 'long.txt', `${boundaryPrefix}BOUNDARY\n${'y'.repeat(130000)}\nTAIL-65218`);

    const first = await run({ pattern: 'TAIL-65218' });
    expect(first.data).toMatchObject({
      total_count: 0, truncated: true,
      index: { available: true, indexed_nodes: 1, skipped_fresh_nodes: 0, truncated_files: 1 },
    });
    expect(first.observation).toContain('在已搜索范围内未找到');
    expect(first.observation).toContain('具体文件 locator/inode');
    const repeated = await run({ pattern: 'TAIL-65218' });
    expect(repeated.data).toMatchObject({
      total_count: 0, truncated: true,
      index: { indexed_nodes: 0, skipped_fresh_nodes: 1, truncated_files: 1 },
    });
    expect(repeated.observation).toBe(first.observation);

    const exact = await run({ pattern: 'TAIL-65218', locator: 'workspace:/long.txt' });
    expect(exact.data).toMatchObject({
      total_count: 1, truncated: false, index: { available: false },
      matches: [{ line: 3, column: 1, preview: 'TAIL-65218', inode: 'workspace:long' }],
    });
    const boundary = await run({ pattern: 'BOUNDARY', inode: 'workspace:long' });
    expect(boundary.data).toMatchObject({
      total_count: 1, truncated: false,
      matches: [{ line: 1, column: 119999 }],
    });
    const absent = await run({ pattern: 'ABSENT', inode: 'workspace:long' });
    expect(absent.data.truncated).toBe(false);
    expect(absent.observation).toBe('grep: 未找到 "ABSENT"。');
    // 历史错误结果仍可解析；覆盖正确性由本次 producer 的实际行为保证。
    expect(WorkspaceGrepResultSchema.parse({
      ...first, data: { ...first.data, truncated: false },
    }).data.truncated).toBe(false);
  });

  it('缺覆盖记录的旧前缀索引和旧版本都重建，即使 updated_at 没变化', async () => {
    insertText('old', 'old.txt', `${'a'.repeat(120100)}\nTAIL`);
    await run({ pattern: 'TAIL' });
    const db = database.getDb();
    // 模拟升级前 lines/grams 已存在，但不存在文件覆盖表；应用启动补建新表。
    db.exec('DROP TABLE workspace_vfs_search_files');
    for (const sql of WORKSPACE_VFS_SEARCH_INDEX_SCHEMAS) db.exec(sql);
    const rebuilt = await run({ pattern: 'TAIL' });
    expect(rebuilt.data).toMatchObject({
      truncated: true, index: { indexed_nodes: 1, skipped_fresh_nodes: 0, truncated_files: 1 },
    });
    db.prepare('UPDATE workspace_vfs_search_files SET index_version = 0').run();
    expect((await run({ pattern: 'TAIL' })).data.index).toMatchObject({ indexed_nodes: 1, skipped_fresh_nodes: 0 });
    expect(db.prepare('SELECT updated_at FROM workspace_nodes WHERE id = ?').get('old')).toEqual({ updated_at: 1 });
    expect((await run({ pattern: 'TAIL', inode: 'workspace:old' })).data.total_count).toBe(1);
  });

  it('重命名仍以 inode 更新索引地址，写入失效后搜索当前内容，显式失效删除覆盖记录', async () => {
    insertText('mutable', 'before.txt', 'old phrase');
    await run({ pattern: 'old phrase' });
    const db = database.getDb();
    db.prepare('UPDATE workspace_nodes SET name = ? WHERE id = ?').run('renamed.txt', 'mutable');
    const renamed = await run({ pattern: 'old phrase' });
    expect(renamed.data).toMatchObject({
      matches: [{ locator: 'workspace:/renamed.txt' }], index: { skipped_fresh_nodes: 1 },
    });
    saveWorkspaceNodeTextSnapshot({ db, nodeId: 'mutable', contentType: 'text/plain', text: 'new phrase', updatedAt: 2 });
    db.prepare('UPDATE workspace_nodes SET updated_at = 2 WHERE id = ?').run('mutable');
    const current = await run({ pattern: 'new phrase', inode: 'workspace:mutable' });
    expect(current.data).toMatchObject({ total_count: 1, truncated: false });
    const reindexed = await run({ pattern: 'new phrase' });
    expect(reindexed.data).toMatchObject({ total_count: 1, index: { indexed_nodes: 1 } });
    expect((await run({ pattern: 'old phrase' })).data).toMatchObject({ total_count: 0, truncated: false });
    invalidateWorkspaceVfsSearchIndexNodes({ db, projectId, nodeIds: ['mutable'] });
    for (const table of ['workspace_vfs_search_files', 'workspace_vfs_search_lines', 'workspace_vfs_search_grams']) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
    expect((await run({ pattern: 'new phrase' })).data.index).toMatchObject({ indexed_nodes: 1 });
  });

  it.each([true, false])('节点预算和读取失败不会被零命中吞掉（indexed=%s）', async indexed => {
    if (!indexed) removeIndex();
    insertText('first', 'a.txt', 'unrelated');
    insertText('second', 'b.txt', 'NEEDLE');
    const bounded = await run({ pattern: 'NEEDLE', max_indexed_nodes: 1 });
    expect(bounded.data).toMatchObject({ total_count: 0, truncated: true });
    expect(bounded.observation).toContain('在已搜索范围内未找到');
    expect((await run({ pattern: 'NEEDLE' })).data).toMatchObject({ total_count: 1, truncated: false });
    const db = database.getDb();
    db.prepare('DELETE FROM workspace_node_text_snapshots WHERE node_id = ?').run('second');
    db.prepare('UPDATE workspace_nodes SET updated_at = 2 WHERE id = ?').run('second');
    expect((await run({ pattern: 'NEEDLE' })).data).toMatchObject({ total_count: 0, truncated: true });
    await expect(run({ pattern: 'NEEDLE', inode: 'workspace:second' })).rejects.toThrow('Unsupported workspace file type');
  });

  it('无索引目录也受相同前缀预算，并能通过指定文件搜索尾部', async () => {
    removeIndex();
    insertText('long', 'long.txt', `${'a'.repeat(320000)}\nTAIL`);
    const directory = await run({ pattern: 'TAIL' });
    expect(directory.data).toMatchObject({ total_count: 0, truncated: true, index: { available: false } });
    expect(directory.observation).toContain('不能据此认定其余内容没有匹配');
    expect((await run({ pattern: 'TAIL', locator: 'workspace:/long.txt' })).data)
      .toMatchObject({ total_count: 1, truncated: false });
  });

  it('trigram 候选预算耗尽但零精确匹配时仍显示不完整，可定位单文件继续', async () => {
    insertText('candidates', 'candidates.txt', `${'abc bcd cde\n'.repeat(60)}abcde`);
    const directory = await run({ pattern: 'abcde', max_results: 1 });
    expect(directory.data).toMatchObject({ total_count: 0, truncated: true, index: { truncated_files: 0 } });
    expect(directory.observation).toContain('在已搜索范围内未找到');
    const exact = await run({ pattern: 'abcde', locator: 'workspace:/candidates.txt', max_results: 1 });
    expect(exact.data).toMatchObject({ total_count: 1, truncated: false, matches: [{ line: 61 }] });
  });

  it.each([true, false])('结果上限只在确有省略时标记截断（indexed=%s）', async indexed => {
    if (!indexed) removeIndex();
    insertText('matches', 'matches.txt', 'MATCH\nmatch');
    expect((await run({ pattern: 'match', max_results: 2 })).data).toMatchObject({ total_count: 2, truncated: false });
    expect((await run({ pattern: 'match', max_results: 1 })).data).toMatchObject({ total_count: 1, truncated: true });
    expect((await run({ pattern: 'MATCH', case_sensitive: true, max_results: 1 })).data)
      .toMatchObject({ total_count: 1, truncated: false });
  });

  it('空文件也保存可复用覆盖记录，删除文件后清除无行的索引元信息', async () => {
    insertText('empty', 'empty.txt', '');
    expect((await run({ pattern: 'ABSENT' })).data).toMatchObject({ truncated: false, index: { indexed_nodes: 1 } });
    expect((await run({ pattern: 'ABSENT' })).data.index).toMatchObject({ skipped_fresh_nodes: 1 });
    database.getDb().prepare('UPDATE workspace_nodes SET deleted_at = 3 WHERE id = ?').run('empty');
    await run({ pattern: 'ABSENT' });
    expect(database.getDb().prepare('SELECT COUNT(*) AS count FROM workspace_vfs_search_files').get()).toEqual({ count: 0 });
  });

  it('write_file 的 Markdown pending current 立即可搜，不复用旧索引正文', async () => {
    const context: ToolContext = {
      databaseService: database,
      workspaceService: new WorkspaceService(database.getDb()),
      workspaceProjectId: projectId,
      conversationId: 'grep-coverage',
    };
    attachCitationSourceResolver(context, { resolveSources: async () => [], resolveSourcesByUrl: async () => [] });
    const writer = new WriteFileTool();
    const created = WorkspaceWriteFileResultSchema.parse(JSON.parse(await writer.run({
      locator: 'workspace:/article.md', content: 'Initial finding 1234.',
    }, context)));
    expect((await run({ pattern: 'Initial finding' })).data).toMatchObject({ total_count: 1, truncated: false });
    await writer.run({ locator: 'workspace:/article.md', content: 'Revised finding 5678.' }, context);
    const current = await run({ pattern: 'Revised finding', inode: created.data.inode });
    expect(current.data).toMatchObject({ total_count: 1, truncated: false });
    expect((await run({ pattern: 'Initial finding' })).data).toMatchObject({ total_count: 0, truncated: false });
    expect((await run({ pattern: 'Revised finding' })).data).toMatchObject({ total_count: 1, truncated: false });
  });

  it.each([
    { existing: false, nested: false },
    { existing: true, nested: false },
    { existing: true, nested: true },
  ])('索引中途写入失败只回滚该文件（已有索引=$existing，外层事务=$nested）', async ({ existing, nested }) => {
    insertText('atomic', 'atomic.txt', 'Old complete index.');
    if (existing) await run({ pattern: 'Old' });
    const db = database.getDb();
    const readIndex = () => ({
      files: db.prepare('SELECT * FROM workspace_vfs_search_files ORDER BY inode').all(),
      lines: db.prepare('SELECT * FROM workspace_vfs_search_lines ORDER BY id').all(),
      grams: db.prepare('SELECT * FROM workspace_vfs_search_grams ORDER BY line_id, gram').all(),
    });
    const previous = readIndex();
    saveWorkspaceNodeTextSnapshot({ db, nodeId: 'atomic', contentType: 'text/plain',
      text: 'First line is inserted successfully.\nSecond line has err and must fail.', updatedAt: 2 });
    db.prepare('UPDATE workspace_nodes SET updated_at = 2 WHERE id = ?').run('atomic');
    db.exec(`CREATE TEMP TRIGGER fail_index_gram BEFORE INSERT ON workspace_vfs_search_grams
      WHEN NEW.gram = 'err' BEGIN SELECT RAISE(ABORT, 'synthetic-index-gram-write-failed'); END`);
    if (nested) {
      db.exec('CREATE TEMP TABLE caller_changes (value TEXT NOT NULL)');
      db.prepare('SAVEPOINT caller_owned').run();
      db.prepare('INSERT INTO caller_changes VALUES (?)').run('unrelated caller write');
    }
    await expect(grepWorkspaceVfsSearchIndex({ db, projectId, pattern: 'Second' }))
      .rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_TRIGGER', message: 'synthetic-index-gram-write-failed' });
    // 写入事务不包含正文读取/更新；只恢复先前完整索引，不能提交新行的部分结果。
    expect(readIndex()).toEqual(previous);
    expect(db.inTransaction).toBe(nested);
    if (nested) {
      expect(db.prepare('SELECT value FROM caller_changes').all()).toEqual([{ value: 'unrelated caller write' }]);
      db.prepare('ROLLBACK TO SAVEPOINT caller_owned').run();
      db.prepare('RELEASE SAVEPOINT caller_owned').run();
      expect(db.prepare('SELECT value FROM caller_changes').all()).toEqual([]);
      expect(readIndex()).toEqual(previous);
      expect(db.inTransaction).toBe(false);
    }
    db.exec('DROP TRIGGER fail_index_gram');
    expect((await run({ pattern: 'Second' })).data).toMatchObject({ total_count: 1, truncated: false });
    expect((await run({ pattern: 'Old' })).data).toMatchObject({ total_count: 0, truncated: false });
  });

  it('文件索引 savepoint 不提交调用方已有事务，外层回滚仍能撤销整个重建', async () => {
    insertText('nested', 'nested.txt', 'Nested result.');
    const db = database.getDb();
    db.prepare('SAVEPOINT caller_owned').run();
    try {
      expect((await run({ pattern: 'Nested' })).data).toMatchObject({ total_count: 1, truncated: false });
      expect(db.inTransaction).toBe(true);
      expect(db.prepare('SELECT COUNT(*) AS n FROM workspace_vfs_search_files').get()).toEqual({ n: 1 });
      db.prepare('ROLLBACK TO SAVEPOINT caller_owned').run();
      expect(db.prepare('SELECT COUNT(*) AS n FROM workspace_vfs_search_files').get()).toEqual({ n: 0 });
      expect(db.prepare('SELECT COUNT(*) AS n FROM workspace_vfs_search_lines').get()).toEqual({ n: 0 });
      expect(db.prepare('SELECT COUNT(*) AS n FROM workspace_vfs_search_grams').get()).toEqual({ n: 0 });
    } finally {
      db.prepare('RELEASE SAVEPOINT caller_owned').run();
    }
  });

  it('内部目录预算变化使旧索引重建，不把较短索引缓存伪装成新覆盖范围', async () => {
    insertText('budget', 'budget.txt', '1234567890NEEDLE');
    const small = await searchWorkspaceVfsNodes({ db: database.getDb(), projectId, pattern: 'NEEDLE', maxFileChars: 10 });
    expect(small).toMatchObject({ ok: true, matches: [], truncated: true });
    const larger = await searchWorkspaceVfsNodes({ db: database.getDb(), projectId, pattern: 'NEEDLE', maxFileChars: 20 });
    expect(larger).toMatchObject({ ok: true, matches: [{ line: 1, column: 11 }], truncated: false, index: { indexedNodes: 1 } });
  });
});
