import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { ACTION_LEDGER_SCHEMAS } from 'src/domains/action-ledger/infrastructure/sqlite/actionLedger.schema';
import { DOCUMENT_REFERENCE_SCHEMAS } from 'src/domains/document-references';
import { SEMANTIC_LAYER_SCHEMAS } from 'src/domains/semantic-layer/infrastructure/sqlite/semanticLayer.schema';
import { PROJECT_SAVED_FILTER_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/saved-filters';
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
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '');
    CREATE TABLE workspace_nodes (
      id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, type TEXT NOT NULL, name TEXT NOT NULL, icon TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER, last_opened_at INTEGER,
      access_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_workspace_nodes_project ON workspace_nodes(project_id, deleted_at);
    CREATE TABLE conversations (conversation_id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE runs (id TEXT PRIMARY KEY, parent_run_id TEXT, agent_spec_id TEXT);
    INSERT INTO projects VALUES ('p1', '读书');
    INSERT INTO conversations VALUES ('conv', '整理资料');
    INSERT INTO runs VALUES ('root', NULL, 'default'), ('child', 'root', 'research_v1');
  `);
  for (const statement of [...ACTION_LEDGER_SCHEMAS, ...SEMANTIC_LAYER_SCHEMAS, ...DOCUMENT_REFERENCE_SCHEMAS, ...PROJECT_SAVED_FILTER_SCHEMAS]) db.exec(statement);
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

  it('query --save 存成筛选：标签、字段、选项换成 ID；--suggest 进建议；条件相同不重复保存', async () => {
    const { db, run } = setup();
    await defineReading(run);
    const save = await run(['query', '--tag', '论文', '--where', '状态=待读', '--group', '状态', '--save', '待读论文']);
    expect(save.access).toMatchObject({ conversationFiles: 'write' });
    expect(save.stdout.split('\n')[1]).toBe('已保存为项目概览文件页的筛选“待读论文”（看板）。');
    const rows = db.prepare('SELECT name, origin, pinned, conversation_id, definition_json FROM project_saved_filters').all() as {
      name: string; origin: string; pinned: number; conversation_id: string; definition_json: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: '待读论文', origin: 'agent', pinned: 1, conversation_id: 'conv' });
    const tag = db.prepare("SELECT id FROM semantic_tags WHERE name = '论文'").get() as { id: string };
    const status = db.prepare("SELECT id, options_json FROM semantic_properties WHERE name = '状态'").get() as { id: string; options_json: string };
    const waiting = (JSON.parse(status.options_json) as { id: string; name: string }[]).find(option => option.name === '待读');
    expect(JSON.parse(rows[0].definition_json)).toMatchObject({
      tags: [tag.id], where: [{ field: status.id, op: 'eq', value: waiting?.id }], layout: { kind: 'board', group_by: status.id },
    });

    const again = await run(['query', '--where', '状态=待读', '--tag', '论文', '--save', '另一个']);
    expect(again.stdout).toContain('已有条件相同的筛选“待读论文”，没有重复保存。');
    const suggest = await run(['query', '--where', '已读=false', '--save', '没读的', '--suggest']);
    expect(suggest.stdout).toContain('已放进项目概览文件页的“Agent 建议”：“没读的”');
    expect(db.prepare("SELECT pinned FROM project_saved_filters WHERE name = '没读的'").get()).toEqual({ pinned: 0 });
    expect((await run(['query', '--suggest'])).stderr).toContain('--suggest 要和 --save 名称一起用');

    // 用户要保存时，同名的建议被固定并换成这次的条件，不并排出现两个。
    const promote = await run(['query', '--where', '已读=false', '--tag', '论文', '--save', '没读的']);
    expect(promote.stdout).toContain('已把 Agent 建议“没读的”固定为项目概览文件页的筛选“没读的”');
    const unread = db.prepare("SELECT pinned, definition_json FROM project_saved_filters WHERE name = '没读的'").all() as {
      pinned: number; definition_json: string;
    }[];
    expect(unread).toHaveLength(1);
    expect(unread[0]?.pinned).toBe(1);
    expect(JSON.parse(unread[0]?.definition_json ?? '{}')).toMatchObject({ tags: [tag.id] });
    // 已固定的同名筛选不覆盖。
    const clash = await run(['query', '--where', '状态=在读', '--save', '待读论文']);
    expect(clash.stdout).toContain('已有同名筛选“待读论文”，没有覆盖');
    expect(db.prepare('SELECT count(*) AS n FROM project_saved_filters').get()).toEqual({ n: 2 });
  });

  it('schema 管理：不加 --yes 只预览，执行后可整批撤回；保存的筛选一起改写与恢复；记下 Agent 与对话', async () => {
    const { db, run } = setup();
    await defineReading(run);
    await run(['schema', 'add-tag', '文献', '--field', '作者'], { agentRunId: 'child' });
    expect(db.prepare("SELECT created_by_kind, created_conversation_id, created_agent_id FROM semantic_tags WHERE name = '文献'").get())
      .toEqual({ created_by_kind: 'subrun', created_conversation_id: 'conv', created_agent_id: 'research_v1' });
    await run(['props', 'tag', 'workspace:/论文/Attention', '--tag', '文献', '--rev', '0'], { agentRunId: 'child' });
    await run(['query', '--tag', '文献', '--save', '文献清单']);

    const preview = await run(['schema', 'merge-tags', '文献', '论文']);
    expect(preview.access).toMatchObject({ conversationFiles: 'none' });
    expect(preview.stdout).toContain('将把标签“文献”合并到“论文”');
    expect(preview.stdout).toContain('- 1 份文档改带“论文”，字段值不变');
    expect(preview.stdout).toContain('- 改写保存的筛选：“文献清单”（读书）');
    expect(preview.stdout).toContain('加 --yes 执行');
    expect(db.prepare("SELECT COUNT(*) AS n FROM semantic_tags WHERE name = '文献' AND deleted_at IS NULL").get()).toEqual({ n: 1 });

    const merged = await run(['schema', 'merge-tags', '文献', '论文', '--yes'], { agentRunId: 'child' });
    expect(merged.access).toMatchObject({ conversationFiles: 'write' });
    expect(merged.stdout).toContain('已执行：合并标签：文献 → 论文（1 份文档），改写了 1 个保存的筛选');
    const changeId = /改动编号 (\S+)；/u.exec(merged.stdout)?.[1];
    expect(changeId).toBeTruthy();
    expect((await run(['props', 'get', 'workspace:/论文/Attention'])).stdout).toContain('论文');

    const changes = await run(['schema', 'changes']);
    expect(changes.stdout).toContain(`${changeId}  合并标签：文献 → 论文（1 份文档），改写 1 个保存的筛选  research_v1，对话“整理资料”`);

    const undoPreview = await run(['schema', 'undo', changeId!]);
    expect(undoPreview.stdout).toContain('将撤回：合并标签：文献 → 论文');
    const undone = await run(['schema', 'undo', changeId!, '--yes']);
    expect(undone.stdout).toContain('已撤回：合并标签：文献 → 论文');
    expect(db.prepare("SELECT COUNT(*) AS n FROM semantic_tags WHERE name = '文献' AND deleted_at IS NULL").get()).toEqual({ n: 1 });
    const again = await run(['schema', 'undo', changeId!, '--yes']);
    expect(again).toMatchObject({ exitCode: 1 });
    expect(again.stderr).toContain('already_undone');
  });

  it('schema 改类型与改选项：预览列出能转与转不了的值；旧名=新名 改名', async () => {
    const { run } = setup();
    await defineReading(run);
    await run(['props', 'tag', 'workspace:/论文/Attention', 'workspace:/论文/BERT', '--tag', '论文', '--rev', '0,0']);
    await run(['props', 'set', 'workspace:/论文/Attention', 'workspace:/论文/BERT', '状态=在读', '--rev', '1,1']);
    await run(['props', 'set', 'workspace:/论文/Attention', '年份=2017', '--rev', '2']);
    const retype = await run(['schema', 'retype-field', '年份', '--type', 'select']);
    expect(retype.stdout).toContain('- 1 个已填的值：1 个能转，0 个转不了，0 个会变空');
    expect(retype.stdout).toContain('能转：“2017” → 2017（Attention）');
    const options = await run(['schema', 'set-options', '状态', '--option', '待读,在读=正在读']);
    expect(options.stdout).toContain('删除选项 “读完”，0 份文档用到它们的值清除');
    const renamed = await run(['schema', 'set-options', '状态', '--option', '待读,在读=正在读,读完', '--yes']);
    expect(renamed.stdout).toContain('字段“状态”的选项：改名 在读→正在读');
    expect((await run(['props', 'get', 'workspace:/论文/BERT'])).stdout).toContain('正在读');
    const missing = await run(['schema', 'set-options', '状态', '--option', '不存在=新']);
    expect(missing).toMatchObject({ exitCode: 1 });
    expect(missing.stderr).toContain('没有选项“不存在”');
  });

  it('条件解析：两字符运算符优先，空值表示为空/不为空', () => {
    expect(parseQueryFilter('年份>=2020')).toEqual({ field: '年份', op: 'gte', raw: '2020' });
    expect(parseQueryFilter('作者!=')).toEqual({ field: '作者', op: 'not_empty', raw: null });
    expect(parseQueryFilter('作者=')).toEqual({ field: '作者', op: 'empty', raw: null });
    expect(parseQueryFilter('标题~a=b')).toEqual({ field: '标题', op: 'contains', raw: 'a=b' });
    expect(() => parseQueryFilter('年份>')).toThrow('缺少值');
  });
});
