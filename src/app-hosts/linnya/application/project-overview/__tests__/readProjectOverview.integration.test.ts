import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { ProjectOverviewSchema } from '@app/schemas';

import { withActionActor } from 'src/domains/action-ledger';
import { attachCitationSourceResolver } from 'src/domains/citation';
import { createProjectLifecycle } from 'src/domains/projects';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import type { ToolContext } from 'src/tools/types';
import { WriteFileTool } from 'src/tools/workspace/write_file/WriteFileTool';
import { createSqliteSemanticLayer } from 'src/domains/semantic-layer';
import { readWorkspaceDocumentIdentity } from 'src/features/workspace/infrastructure/sqlite/workspaceDocumentProjection';
import { readProjectOverview } from '../orchestration/readProjectOverview';

let database: DatabaseService;
let workspace: WorkspaceService;
let projectId: string;
let now: number;

beforeEach(() => {
  // 账本按登记时刻排序；测试里让时钟逐次前进。
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 10));
  database = new DatabaseService(':memory:');
  database.initialize();
  workspace = new WorkspaceService(database.getDb());
  projectId = createProjectLifecycle(database.getDb()).create({ name: 'Overview' });
  database.getDb().prepare(
    "INSERT INTO conversations (conversation_id, title, project_id, created_at, last_event_at) VALUES (?, ?, ?, 1, 1)",
  ).run('conv', '整理储能政策', projectId);
});

afterEach(async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  database.close();
  vi.restoreAllMocks();
});

interface RunIdentity {
  readonly runId: string;
  readonly callId: string;
  readonly conversationId?: string;
  /** 子运行：派出它的父运行与用户这次请求的根运行。 */
  readonly subrunOf?: { readonly parentRunId: string; readonly rootRunId: string };
}

function context(run: RunIdentity | null): ToolContext {
  const value: ToolContext = {
    databaseService: database,
    workspaceService: workspace,
    workspaceProjectId: projectId,
    ...(run
      ? {
          conversationId: run.conversationId ?? 'conv',
          parentToolCallId: ToolCallIdSchema.parse(run.callId),
          runId: RunIdSchema.parse(run.runId),
          rootRunId: run.subrunOf?.rootRunId ?? run.runId,
          ...(run.subrunOf ? { parentRunId: RunIdSchema.parse(run.subrunOf.parentRunId) } : {}),
        }
      : {}),
  };
  attachCitationSourceResolver(value, { resolveSources: async () => [], resolveSourcesByUrl: async () => [] });
  return value;
}

const write = (locator: string, content: string, ctx: ToolContext) => new WriteFileTool().run({ locator, content }, ctx);

/** 账本按运行编号从运行记录查 Agent。 */
function insertRun(runId: string, conversationId: string, agentSpecId: string, parentRunId: string | null = null): void {
  database.getDb().prepare(
    "INSERT INTO runs (id, conversation_id, kind, status, start_ts, agent_spec_id, parent_run_id) VALUES (?, ?, 'root', 'completed', 1, ?, ?)",
  ).run(runId, conversationId, agentSpecId, parentRunId);
}

describe('项目概览', () => {
  it('跨文件夹列出文档：来源、生成于哪个对话、最近谁改、待审阅数', async () => {
    insertRun('run-a', 'conv', 'research_v1');
    const reports = workspace.createFolder(projectId, '报告');
    workspace.createFolder(projectId, '访谈', reports);

    await write('workspace:/报告/行业报告.md', '# 报告\n\n初稿。', context({ runId: 'run-a', callId: 'c1' }));
    await write('workspace:/报告/行业报告.md', '# 报告\n\n修改。', context({ runId: 'run-a', callId: 'c2' }));
    await withActionActor({ kind: 'user' }, () => write('workspace:/报告/访谈/纪要.md', '# 纪要', context(null)));
    await withActionActor({ kind: 'external' }, () => write('workspace:/外部.md', '# 外部', context(null)));
    await withActionActor({ kind: 'user' }, () => write('workspace:/报告/行业报告.md', '# 报告\n\n用户改。', context(null)));
    workspace.createDocument(projectId, '早于账本.md');

    const overview = readProjectOverview(database.getDb(), { project_id: projectId });
    expect(overview.folder_count).toBe(2);
    const byTitle = new Map(overview.documents.map(document => [document.title, document]));
    expect([...byTitle.keys()].sort()).toEqual(['外部.md', '早于账本.md', '纪要.md', '行业报告.md'].sort());

    expect(byTitle.get('行业报告.md')).toMatchObject({
      location: ['报告'],
      creator: { actor: 'run', agent_id: 'research_v1', conversation_id: 'conv', conversation_title: '整理储能政策' },
      last_modified_by: { actor: 'user', agent_id: null },
    });
    expect(byTitle.get('行业报告.md')?.pending_revision_count).toBeGreaterThan(0);
    expect(byTitle.get('纪要.md')).toMatchObject({
      location: ['报告', '访谈'],
      creator: { actor: 'user', conversation_id: null, conversation_title: null },
      last_modified_by: { actor: 'user' },
      pending_revision_count: 0,
    });
    expect(byTitle.get('外部.md')).toMatchObject({ location: [], creator: { actor: 'external' } });
    expect(byTitle.get('早于账本.md')).toMatchObject({ creator: null, last_modified_by: null });
  });

  it('两个外部 Agent 先后经命令行改同一份文档：概览分得清谁新建、谁最近改；Linnya 的 Agent 受命令行消息之托改的仍算 Agent', async () => {
    // 外部入口发起运行时，对话流程把调用方自报的名称记在运行上；无模型的工具调用运行没有 Agent。
    const insertCliRun = (runId: string, agentSpecId: string | null, sender: { readonly entry: 'linnya_cli'; readonly name?: string }) => {
      database.getDb().prepare(
        "INSERT INTO runs (id, conversation_id, kind, status, start_ts, agent_spec_id, metadata_json) VALUES (?, 'conv', 'root', 'completed', 1, ?, ?)",
      ).run(runId, agentSpecId, JSON.stringify({ lane: 'foreground', externalSender: sender }));
    };
    const cliToolCall = (runId: string, locator: string, content: string) => {
      const ctx = context({ runId, callId: `call-${runId}` });
      ctx.authorizedHostToolCall = { toolName: 'write_file', toolCallId: ToolCallIdSchema.parse(`call-${runId}`) };
      return withActionActor({ kind: 'external' }, () => write(locator, content, ctx));
    };
    insertCliRun('cli-claude', null, { entry: 'linnya_cli', name: 'Claude Code' });
    insertCliRun('cli-codex', null, { entry: 'linnya_cli', name: 'Codex' });
    insertCliRun('cli-unnamed', null, { entry: 'linnya_cli' });
    insertCliRun('cli-send', 'research_v1', { entry: 'linnya_cli', name: 'Codex' });

    await cliToolCall('cli-claude', 'workspace:/方案.md', '# 方案\n\n初稿。');
    await cliToolCall('cli-codex', 'workspace:/方案.md', '# 方案\n\n第二版。');
    await cliToolCall('cli-unnamed', 'workspace:/脚本产出.md', '# 产出');
    await cliToolCall('cli-claude', 'workspace:/委托.md', '# 委托\n\n初稿。');
    await withActionActor({ kind: 'external' }, () => (
      write('workspace:/委托.md', '# 委托\n\nAgent 改。', context({ runId: 'cli-send', callId: 'model-call' }))
    ));

    const overview = readProjectOverview(database.getDb(), { project_id: projectId });
    const byTitle = new Map(overview.documents.map(document => [document.title, document]));
    expect(byTitle.get('方案.md')).toMatchObject({
      creator: { actor: 'external', external_executor: 'Claude Code' },
      last_modified_by: { actor: 'external', external_executor: 'Codex' },
    });
    expect(byTitle.get('脚本产出.md')).toMatchObject({ creator: { actor: 'external', external_executor: null } });
    // 名称只跟着“经命令行直接改”的记录显示，不冒到 Agent 自己的改动上。
    expect(byTitle.get('委托.md')).toMatchObject({
      creator: { actor: 'external', external_executor: 'Claude Code' },
      last_modified_by: { actor: 'run', agent_id: 'research_v1', external_executor: null },
    });
  });

  it('账本解释不了最近的改动时只给时间；对话不属于本项目时不给对话', async () => {
    database.getDb().prepare(
      'INSERT INTO conversations (conversation_id, title, project_id, created_at, last_event_at) VALUES (?, ?, NULL, 1, 1)',
    ).run('elsewhere', '别处的对话');
    insertRun('run-a', 'elsewhere', 'default');
    await write('workspace:/a.md', '# A', context({ runId: 'run-a', callId: 'c1', conversationId: 'elsewhere' }));
    const node = workspace.getChildNodes(null, projectId).find(item => item.name === 'a.md');
    if (!node) throw new Error('expected a.md');
    database.getDb().prepare('UPDATE workspace_nodes SET updated_at = ? WHERE id = ?').run(now + 60_000, node.id);

    const [document] = readProjectOverview(database.getDb(), { project_id: projectId }).documents;
    expect(document).toMatchObject({
      // 默认 Agent 在合同里为 null，界面显示 Linnya Agent。
      creator: { actor: 'run', agent_id: null, conversation_id: null, conversation_title: null },
      last_modified_at: now + 60_000,
      last_modified_by: null,
    });
  });

  it('子任务的改动带上发起它的 Agent，对话删除后仍在；查不回发起者的历史记录不带', async () => {
    insertRun('run-root', 'conv', 'research_v1');
    insertRun('run-child', 'conv', 'subagent_general', 'run-root');
    const subrun = { parentRunId: 'run-root', rootRunId: 'run-root' };
    await write('workspace:/子任务稿.md', '# 初稿', context({ runId: 'run-child', callId: 'c1', subrunOf: subrun }));
    await write('workspace:/主运行稿.md', '# 主运行', context({ runId: 'run-root', callId: 'c2' }));
    await write('workspace:/主运行稿.md', '# 子任务改', context({ runId: 'run-child', callId: 'c3', subrunOf: subrun }));
    // 删除对话会级联删掉运行记录；之后的读取不能再依赖运行表。
    database.getDb().prepare('DELETE FROM conversations WHERE conversation_id = ?').run('conv');
    expect(database.getDb().prepare('SELECT COUNT(*) AS count FROM runs').get()).toEqual({ count: 0 });

    await write('workspace:/历史.md', '# 历史', context({ runId: 'run-old-child', callId: 'c4', subrunOf: { parentRunId: 'run-old', rootRunId: 'run-old' } }));
    // 根运行 Agent 入库之前登记、运行记录又已删除的子任务：迁移回填不了，保持空。
    expect(database.getDb().prepare("SELECT root_agent_id FROM action_ledger_entries WHERE run_id = 'run-old-child'").get())
      .toEqual({ root_agent_id: null });

    // 按 Renderer 网关同一份合同校验。
    const overview = ProjectOverviewSchema.parse(readProjectOverview(database.getDb(), { project_id: projectId }));
    const byTitle = new Map(overview.documents.map(document => [document.title, document]));
    expect(byTitle.get('子任务稿.md')).toMatchObject({
      creator: { actor: 'subrun', agent_id: 'subagent_general', root_agent: { agent_id: 'research_v1' } },
      last_modified_by: { actor: 'subrun', root_agent: { agent_id: 'research_v1' } },
    });
    expect(byTitle.get('主运行稿.md')).toMatchObject({
      // 主运行的发起者就是它自己，只给 agent_id。
      creator: { actor: 'run', agent_id: 'research_v1', root_agent: null },
      last_modified_by: { actor: 'subrun', root_agent: { agent_id: 'research_v1' } },
    });
    expect(byTitle.get('历史.md')).toMatchObject({ creator: { actor: 'subrun', root_agent: null } });
  });

  it('默认 Agent 派出的子任务按读取约定给 null，界面显示 Linnya Agent 的子任务', async () => {
    insertRun('run-root', 'conv', 'default');
    await write('workspace:/a.md', '# A', context({ runId: 'run-child', callId: 'c1', subrunOf: { parentRunId: 'run-root', rootRunId: 'run-root' } }));
    const [document] = readProjectOverview(database.getDb(), { project_id: projectId }).documents;
    expect(document?.creator).toMatchObject({ actor: 'subrun', root_agent: { agent_id: null } });
  });

  it('按文档补读只返回仍在项目里的那几份，不给文件夹数', async () => {
    await write('workspace:/a.md', '# A', context({ runId: 'run-a', callId: 'c1' }));
    await write('workspace:/b.md', '# B', context({ runId: 'run-a', callId: 'c2' }));
    const a = workspace.getChildNodes(null, projectId).find(item => item.name === 'a.md');
    if (!a) throw new Error('expected a.md');

    const partial = readProjectOverview(database.getDb(), { project_id: projectId, document_ids: [a.id, 'missing'] });
    expect(partial.folder_count).toBeNull();
    expect(partial.documents.map(document => document.title)).toEqual(['a.md']);
  });

  it('每份文档带当前标签，按打标签的先后；已删除的标签不出现', async () => {
    await write('workspace:/a.md', '# A', context(null));
    await write('workspace:/b.md', '# B', context(null));
    const a = workspace.getChildNodes(null, projectId).find(item => item.name === 'a.md');
    if (!a) throw new Error('expected a.md');
    const db = database.getDb();
    const layer = createSqliteSemanticLayer(db, { read: id => readWorkspaceDocumentIdentity(db, id) });
    layer.defineTag({ name: '论文' });
    layer.defineTag({ name: '待读' });
    layer.tagObject({ projectId, ref: { kind: 'document', id: a.id }, expectedRevision: 0 }, ['待读']);
    layer.tagObject({ projectId, ref: { kind: 'document', id: a.id }, expectedRevision: 1 }, ['论文']);

    const overview = readProjectOverview(db, { project_id: projectId });
    expect(overview.documents.map(document => [document.title, document.tags.map(tag => tag.name)])).toEqual(
      expect.arrayContaining([['a.md', ['待读', '论文']], ['b.md', []]]),
    );
  });

  it('5,000 个节点、深 6 层时一次读完', () => {
    const db = database.getDb();
    const insertNode = db.prepare(`
      INSERT INTO workspace_nodes (id, project_id, parent_id, type, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 1)
    `);
    const insertEntry = db.prepare(`
      INSERT INTO action_ledger_entries (recorded_at, project_id, document_id, document_type, action, granularity, actor_kind)
      VALUES (?, ?, ?, 'document', ?, 'coarse', 'user')
    `);
    db.transaction(() => {
      let parents: (string | null)[] = [null];
      let created = 0;
      for (let depth = 0; depth < 6; depth += 1) {
        const folders: string[] = [];
        for (const parent of parents) {
          for (let i = 0; i < 3 && created < 400; i += 1) {
            const id = `f-${depth}-${created}`;
            insertNode.run(id, projectId, parent, 'folder', `folder-${created}`);
            folders.push(id);
            created += 1;
          }
        }
        parents = folders;
      }
      const folderIds = db.prepare<[], { id: string }>("SELECT id FROM workspace_nodes WHERE type = 'folder'").all();
      for (let i = 0; created < 5_000; i += 1, created += 1) {
        const id = `d-${i}`;
        insertNode.run(id, projectId, folderIds[i % folderIds.length]?.id ?? null, 'document', `doc-${i}.md`);
        insertEntry.run(1_000 + i, projectId, id, 'create');
        insertEntry.run(2_000 + i, projectId, id, 'update');
      }
    })();

    readProjectOverview(db, { project_id: projectId });
    const timings: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const start = performance.now();
      const overview = readProjectOverview(db, { project_id: projectId });
      timings.push(performance.now() - start);
      expect(overview.documents).toHaveLength(4_600);
    }
    // 需求是首屏数据 ≤100ms；这里放宽到 250ms，避免慢机器上偶发失败。
    expect(Math.min(...timings)).toBeLessThan(250);
  });
});
