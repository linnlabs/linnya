import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { ACTION_LEDGER_SCHEMAS } from 'src/domains/action-ledger/infrastructure/sqlite/actionLedger.schema';
import { DOCUMENT_REFERENCE_SCHEMAS } from 'src/domains/document-references';
import { SEMANTIC_LAYER_SCHEMAS } from 'src/domains/semantic-layer/infrastructure/sqlite/semanticLayer.schema';
import { parseQueryFilter } from '../functions/parseSemanticCommands';
import { createCoreCli } from '../orchestration/createCoreCli';

const databases: Database.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function setup() {
  const db = new Database(':memory:');
  databases.push(db);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE workspace_nodes (
      id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, type TEXT NOT NULL, name TEXT NOT NULL, icon TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER, last_opened_at INTEGER,
      access_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_workspace_nodes_project ON workspace_nodes(project_id, deleted_at);
    CREATE TABLE conversations (conversation_id TEXT PRIMARY KEY);
    CREATE TABLE runs (id TEXT PRIMARY KEY, parent_run_id TEXT, agent_spec_id TEXT);
    INSERT INTO projects VALUES ('p1');
    INSERT INTO runs VALUES ('root', NULL, 'default'), ('child', 'root', 'research_v1');
  `);
  for (const statement of [...ACTION_LEDGER_SCHEMAS, ...SEMANTIC_LAYER_SCHEMAS, ...DOCUMENT_REFERENCE_SCHEMAS]) db.exec(statement);
  const insert = db.prepare('INSERT INTO workspace_nodes (id, project_id, parent_id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insert.run('folder', 'p1', null, 'folder', '论文', 1, 1);
  insert.run('a', 'p1', 'folder', 'document', 'Attention', 2, 30);
  insert.run('b', 'p1', 'folder', 'document', 'BERT', 3, 20);
  insert.run('c', 'p1', null, 'document', '读书笔记', 4, 10);
  db.prepare('INSERT INTO document_references VALUES (?, ?, ?, ?)').run('c', 'r1', 'a', 'inline');
  db.prepare('INSERT INTO document_references VALUES (?, ?, ?, ?)').run('c', 'r2', 'a', 'inline');
  const cli = createCoreCli(db, 4000, { readFile: async () => { throw new Error('unused'); } });
  const run = async (argv: string[], context: { agentRunId?: string; readOnly?: boolean } = {}) => {
    const preparation = cli.prepare({ argv, invocationId: 'i', conversationRoot: '/tmp/none' });
    if (preparation.status === 'completed') return { ...preparation.result, access: null };
    const result = await preparation.plan.execute({
      projectId: 'p1', conversationId: 'conv', hostContext: {}, signal: new AbortController().signal,
      ...(context.agentRunId ? { agentRunId: context.agentRunId } : {}),
    });
    return { ...result, access: preparation.plan.access };
  };
  return { db, run };
}

async function defineReading(run: ReturnType<typeof setup>['run']) {
  expect((await run(['schema', 'add-field', '作者', '--type', 'text'])).exitCode).toBe(0);
  await run(['schema', 'add-field', '年份', '--type', 'number']);
  await run(['schema', 'add-field', '状态', '--type', 'select', '--option', '待读,在读,读完']);
  await run(['schema', 'add-field', '已读', '--type', 'checkbox']);
  const tag = await run(['schema', 'add-tag', '论文', '--field', '作者', '--field', '年份', '--field', '状态', '--field', '已读=false']);
  expect(tag.stdout).toContain('已新建标签 论文：作者、年份、状态、已读=否');
}

describe('linnya schema / props / query / links', () => {
  it('schema 列出定义；相近名称被拒并给出复用提示', async () => {
    const { run } = setup();
    await defineReading(run);
    const list = await run(['schema']);
    expect(list.stdout).toContain('- 论文：作者、年份、状态、已读=否');
    expect(list.stdout).toContain('- 状态  单选：待读 / 在读 / 读完');
    expect(list.access).toMatchObject({ internalDataAccess: 'required', conversationFiles: 'none' });
    const similar = await run(['schema', 'add-tag', '论文集']);
    expect(similar).toMatchObject({ exitCode: 1 });
    expect(similar.stderr).toContain('similar_name');
    expect(similar.stderr).toContain('相近：论文');
    expect(similar.stderr).toContain('--allow-similar');
  });

  it('不给 --rev 只预览且不写入；按给出的版本写入并记到发起命令的运行上', async () => {
    const { db, run } = setup();
    await defineReading(run);
    const preview = await run(['props', 'tag', 'workspace:/论文/Attention', 'workspace:/论文/BERT', '--tag', '论文']);
    expect(preview.access).toMatchObject({ conversationFiles: 'none' });
    expect(preview.stdout).toContain('预览，未写入');
    expect(preview.stdout).toContain('workspace:/论文/Attention  版本 0  +论文  已读：（空） → 否');
    expect(preview.stdout).toContain("linnya props tag workspace:/论文/Attention workspace:/论文/BERT --tag 论文 --rev 0,0");
    expect(db.prepare('SELECT COUNT(*) AS n FROM semantic_object_tags').get()).toEqual({ n: 0 });

    const write = await run(['props', 'tag', 'workspace:/论文/Attention', 'workspace:/论文/BERT', '--tag', '论文', '--rev', '0,0'], { agentRunId: 'child' });
    expect(write.access).toMatchObject({ conversationFiles: 'write' });
    expect(write.stdout).toContain('已写入 2 份文档');
    expect(db.prepare("SELECT actor_kind, run_id, root_run_id, parent_run_id, action FROM action_ledger_entries ORDER BY id").all()).toEqual([
      { actor_kind: 'subrun', run_id: 'child', root_run_id: 'root', parent_run_id: 'root', action: 'tag' },
      { actor_kind: 'subrun', run_id: 'child', root_run_id: 'root', parent_run_id: 'root', action: 'tag' },
    ]);

    const set = await run(['props', 'set', 'workspace:/论文/Attention', '作者=Vaswani', '年份=2017', '状态=读完', '--rev', '1']);
    expect(set.stdout).toContain('作者：（空） → Vaswani');
    const get = await run(['props', 'get', 'workspace:/论文/Attention']);
    expect(get.stdout).toBe('workspace:/论文/Attention  版本 2\n标签：论文\n作者：Vaswani\n年份：2017\n状态：读完\n已读：否\n');
    const cleared = await run(['props', 'set', 'workspace:/论文/Attention', '作者=', '--rev', '2']);
    expect(cleared.stdout).toContain('作者：Vaswani → （空）');
  });

  it('批量写入中一份失败时整体回滚，错误带路径与当前版本', async () => {
    const { db, run } = setup();
    await defineReading(run);
    await run(['props', 'tag', 'workspace:/论文/Attention', '--tag', '论文', '--rev', '0']);
    const conflict = await run(['props', 'tag', 'workspace:/论文/BERT', 'workspace:/论文/Attention', '--tag', '论文', '--rev', '0,0']);
    expect(conflict.exitCode).toBe(1);
    expect(conflict.stderr).toContain('revision_conflict workspace:/论文/Attention');
    expect(conflict.stderr).toContain('当前版本：1');
    expect(db.prepare("SELECT object_id FROM semantic_object_tags").all()).toEqual([{ object_id: 'a' }]);
    const unknown = await run(['props', 'set', 'workspace:/论文/Attention', '作着=x', '--rev', '1']);
    expect(unknown.stderr).toContain('unknown_property');
    expect(unknown.stderr).toContain('可用：作者');
    const missing = await run(['props', 'get', 'workspace:/论文/不存在']);
    expect(missing.stderr).toContain('object_not_found');
  });

  it('query 按标签与条件筛选、排序、分组；links 列出双向引用', async () => {
    const { run } = setup();
    await defineReading(run);
    await run(['props', 'tag', 'workspace:/论文/Attention', 'workspace:/论文/BERT', '--tag', '论文', '--rev', '0,0']);
    await run(['props', 'set', 'workspace:/论文/Attention', '年份=2017', '状态=读完', '已读=是', '--rev', '1']);
    await run(['props', 'set', 'workspace:/论文/BERT', '年份=2018', '状态=待读', '--rev', '1']);
    const query = await run(['query', '--tag', '论文', '--where', '年份>=2017', '--sort', '-年份', '--group', '状态']);
    expect(query.stderr).toBe('');
    expect(query.stdout.split('\n')).toEqual([
      '共 2 份',
      'workspace:/论文/BERT  [论文]  年份=2018 · 状态=待读 · 已读=否',
      'workspace:/论文/Attention  [论文]  年份=2017 · 状态=读完 · 已读=是',
      '按“状态”分组：待读 1 · 读完 1',
      '',
    ]);
    const unchecked = await run(['query', '--where', '已读=false', '--json']);
    expect(JSON.parse(unchecked.stdout)).toMatchObject({ total: 1, rows: [{ path: 'workspace:/论文/BERT', values: { 状态: '待读' } }] });
    const typo = await run(['query', '--where', '年纷>1']);
    expect(typo.stderr).toContain('可用：作者');
    const links = await run(['links', 'workspace:/论文/Attention']);
    expect(links.stdout).toBe('workspace:/论文/Attention\n引用它的文档（1）：\n- workspace:/读书笔记  2 处\n它引用的文档（0）：\n');
  });

  it('条件解析：两字符运算符优先，空值表示为空/不为空', () => {
    expect(parseQueryFilter('年份>=2020')).toEqual({ field: '年份', op: 'gte', raw: '2020' });
    expect(parseQueryFilter('作者!=')).toEqual({ field: '作者', op: 'not_empty', raw: null });
    expect(parseQueryFilter('作者=')).toEqual({ field: '作者', op: 'empty', raw: null });
    expect(parseQueryFilter('标题~a=b')).toEqual({ field: '标题', op: 'contains', raw: 'a=b' });
    expect(() => parseQueryFilter('年份>')).toThrow('缺少值');
  });
});
