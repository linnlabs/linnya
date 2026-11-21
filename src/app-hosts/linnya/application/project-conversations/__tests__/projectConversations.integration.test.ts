import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { ProjectConversationQueryOptionsSchema, type ProjectConversationQueryOptions } from '@app/schemas';
import { createCoreCli } from '../../core-cli';
import { createConversationActivityPorts } from '../../../adapters/persistence/run-registry';

import { attachCitationSourceResolver } from 'src/domains/citation';
import { createProjectLifecycle } from 'src/domains/projects';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import type { ToolContext } from 'src/tools/types';
import { WriteFileTool } from 'src/tools/workspace/write_file/WriteFileTool';
import {
  createProjectConversationStorageMeasurer,
  readConversationTranscript,
  readProjectConversationDetail,
  readProjectConversations,
  searchProjectConversations,
  queryProjectConversations,
} from '..';

let database: DatabaseService;
let workspace: WorkspaceService;
let projectId: string;
let otherProjectId: string;
let now: number;

function db() {
  return database.getDb();
}

function addConversation(id: string, title: string, project: string | null, lastEventAt: number, extra: { pinned?: boolean; agent?: string | null; turns?: number } = {}) {
  db().prepare(`INSERT INTO conversations (conversation_id, title, project_id, created_at, last_event_at, is_pinned, selected_agent_id, user_message_count)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)`).run(id, title, project, lastEventAt, extra.pinned ? 1 : 0, extra.agent ?? null, extra.turns ?? 0);
}

function addRun(id: string, conversationId: string, agent: string | null, startTs = 1, parentRunId: string | null = null, kind = 'agent') {
  db().prepare(`INSERT INTO runs (id, conversation_id, kind, status, agent_spec_id, start_ts, parent_run_id, metadata_json) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)`)
    .run(id, conversationId, kind, agent, startTs, parentRunId, JSON.stringify({ lane: agent === 'conversation_title' ? 'auxiliary' : 'foreground' }));
}

let sortSeq = 0;
function addMessage(conversationId: string, runId: string, type: string, content: string) {
  sortSeq += 1;
  db().prepare(`INSERT INTO conversation_ui_messages (message_id, conversation_id, turn_id, role, message_type, sort_seq, timestamp, content, run_id)
    VALUES (?, ?, 'turn', ?, ?, ?, 1, ?, ?)`).run(`m${sortSeq}`, conversationId, type === 'user_input' ? 'user' : 'assistant', type, sortSeq, content, runId);
}

function context(conversationId: string, runId: string, callId: string): ToolContext {
  const value: ToolContext = {
    databaseService: database,
    workspaceService: workspace,
    workspaceProjectId: projectId,
    conversationId,
    parentToolCallId: ToolCallIdSchema.parse(callId),
    runId: RunIdSchema.parse(runId),
    rootRunId: runId,
  };
  attachCitationSourceResolver(value, { resolveSources: async () => [], resolveSourcesByUrl: async () => [] });
  return value;
}

beforeEach(() => {
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 10));
  database = new DatabaseService(':memory:');
  database.initialize();
  workspace = new WorkspaceService(db());
  const projects = createProjectLifecycle(db());
  projectId = projects.create({ name: '出海调研' });
  otherProjectId = projects.create({ name: '别的项目' });
  sortSeq = 0;
});

afterEach(async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  database.close();
  vi.restoreAllMocks();
});

describe('项目对话页', () => {
  it('面板 Host 查询与 CLI 同条件同序：回复过的 Agent、日历窗口、文档、搜索、置顶及各排序', async () => {
    const today = new Date(2026, 10, 17, 12).getTime();
    now = today;
    addConversation('a', '定价10', projectId, today, { agent: 'selected-but-never-replied', turns: 2 });
    addConversation('b', '定价2', projectId, today - 86400000 * 8, { turns: 4, pinned: true });
    addConversation('c', '旧资料', projectId, today - 86400000 * 40, { agent: 'research_v1' });
    addConversation('other', '私有定价', otherProjectId, today);
    for (const id of ['a', 'b', 'c', 'other']) addRun(`run-${id}`, id, 'default');
    addMessage('a', 'run-a', 'final_answer', '定价结论');
    addRun('changed-agent', 'a', 'research_v1', 2);
    addMessage('a', 'changed-agent', 'partial_answer', '研究里的定价');
    addMessage('b', 'run-b', 'final_answer', '以前的定价');
    addMessage('other', 'run-other', 'final_answer', '其他项目的秘密');
    addRun('title-agent', 'c', 'conversation_title');
    addMessage('c', 'title-agent', 'final_answer', '内部标题');
    addRun('child-agent', 'c', 'child-agent');
    db().prepare('UPDATE runs SET parent_run_id = ? WHERE id = ?').run('run-c', 'child-agent');
    addMessage('c', 'child-agent', 'final_answer', '子运行不算回复');
    await new WriteFileTool().run({ locator: 'workspace:/定价.md', content: '# 定价' }, context('a', 'run-a', 'query-change'));
    const activity = createConversationActivityPorts(db(), { readControlPending: () => [] });
    const cli = createCoreCli(db(), 30000, { readFile: async () => { throw new Error('query must not read files'); } }, activity);
    async function command(args: string[], project: string | undefined = projectId) {
      const prepared = cli.prepare({ argv: ['conversations', ...args], invocationId: 'query', conversationRoot: '/unused' });
      if (prepared.status === 'completed') return prepared.result;
      expect(prepared.plan.access).toMatchObject({ internalDataAccess: 'required', conversationFiles: 'none' });
      return prepared.plan.execute({ projectId: project, conversationId: 'a', hostContext: {}, signal: new AbortController().signal });
    }
    const lists: Partial<ProjectConversationQueryOptions>[] = [
      {}, { agent: 'research_v1' }, { agent: 'default' }, { agent: 'selected-but-never-replied' },
      { activity: 'today' }, { activity: 'week' }, { activity: 'month' }, { documents: 'changed' },
      { documents: 'unchanged' }, { query: '定价', agent: 'research_v1' },
      ...(['title', 'turns', 'documents', 'activity', 'storage'] as const).flatMap(sort =>
        (['asc', 'desc'] as const).map(direction => ({ sort, direction }))),
    ];
    for (const options of lists) {
      const query = ProjectConversationQueryOptionsSchema.parse(options);
      const panel = await queryProjectConversations(db(), { ...query, project_id: projectId }, activity);
      const argv = Object.entries(query).flatMap(([key, value]) => value === null || value === '' ? [] : [`--${key}`, value]);
      const shell = await command(['list', ...argv]);
      expect(shell.exitCode).toBe(0);
      const output = JSON.parse(shell.stdout);
      expect(output.conversations.map((row: { id: string }) => row.id)).toEqual(panel.conversations.map(row => row.conversation_id));
      expect(shell.stdout).not.toContain('其他项目的秘密');
    }
    const rows = readProjectConversations(db(), { project_id: projectId }).conversations;
    // 回复过的 Agent 取根运行、最近在前；标题等内部 Agent 与子运行不算，默认 Agent 为 null。
    expect(rows.find(row => row.conversation_id === 'a')?.replied_agent_ids).toEqual(['research_v1', null]);
    expect(rows.find(row => row.conversation_id === 'c')?.replied_agent_ids).toEqual([null]);
    expect((await command(['list', '--agent', 'research_v1'])).stdout).toContain('定价10');
    expect((await command(['read', 'other'])).exitCode).toBe(1);
    expect((await command(['read', 'missing'])).stderr).toBe((await command(['read', 'other'])).stderr);
    expect((await command(['list', '--project', otherProjectId])).exitCode).toBe(2);
    const prepared = cli.prepare({ argv: ['conversations', 'list'], invocationId: 'no-project', conversationRoot: '/unused' });
    if (prepared.status !== 'ready') throw new Error('list was not prepared');
    expect((await prepared.plan.execute({ hostContext: {}, signal: new AbortController().signal })).exitCode).toBe(2);
  });

  it('超过200条搜索命中时先按回复过的 Agent筛选，旧对话不会被其他Agent的结果挤掉', async () => {
    for (let index = 0; index < 205; index += 1) {
      const id = `other-agent-${index}`;
      addConversation(id, `共同标题${index}`, projectId, 1000 + index);
      addRun(`run-${id}`, id, 'default');
      addMessage(id, `run-${id}`, 'final_answer', '共同内容关键词');
    }
    addConversation('older-match', '共同标题：需要的研究', projectId, 1);
    addRun('older-research', 'older-match', 'research_v1');
    addMessage('older-match', 'older-research', 'final_answer', '共同内容关键词');
    const activity = createConversationActivityPorts(db(), { readControlPending: () => [] });
    const cli = createCoreCli(db(), 30000, { readFile: async () => { throw new Error('unused'); } }, activity);
    for (const query of ['共同标题', '共同内容关键词']) {
      expect(searchProjectConversations(db(), { project_id: projectId, query })).toMatchObject({ truncated: true });
      const result = await queryProjectConversations(db(), {
        ...ProjectConversationQueryOptionsSchema.parse({ query, agent: 'research_v1' }), project_id: projectId,
      }, activity);
      expect(result.conversations.map(row => row.conversation_id)).toEqual(['older-match']);
      expect(result.truncated).toBe(false);
      const prepared = cli.prepare({ argv: ['conversations', 'list', '--query', query, '--agent', 'research_v1'], invocationId: 'cap', conversationRoot: '/unused' });
      if (prepared.status !== 'ready') throw new Error('list not prepared');
      const output = await prepared.plan.execute({ projectId, hostContext: {}, signal: new AbortController().signal });
      expect(output.exitCode).toBe(0);
      expect(JSON.parse(output.stdout).conversations.map((row: { id: string }) => row.id)).toEqual(['older-match']);
    }
  });

  it('列出本项目对话：置顶在前、Agent 为实际回复过的（最近在前，内部 Agent 与子运行不算）、改过的文档按账本去重', async () => {
    addConversation('conv-a', '三季度汇报初稿', projectId, 500, { turns: 9, agent: 'research_v1' });
    addConversation('conv-b', '欧洲市场渠道梳理', projectId, 400, { pinned: true, agent: 'research_v1', turns: 3 });
    addConversation('conv-c', '刚建的对话', projectId, 300, { agent: 'default' });
    addConversation('conv-other', '别处的对话', otherProjectId, 900);
    addConversation('conv-assistant', '助手对话', null, 900);
    addRun('run-a', 'conv-a', 'default', 10);
    addRun('run-a-title', 'conv-a', 'conversation_title', 11);
    addRun('run-a-research', 'conv-a', 'research_v1', 20);
    addRun('run-a-again', 'conv-a', 'default', 30);
    addRun('run-a-sub', 'conv-a', 'subagent_general', 31, 'run-a-again');
    addRun('run-a-input', 'conv-a', null, 32, null, 'user_input');
    addRun('run-b', 'conv-b', 'research_v1');
    addRun('run-other', 'conv-other', 'research_v1');

    const write = new WriteFileTool();
    await write.run({ locator: 'workspace:/汇报.md', content: '# 汇报' }, context('conv-a', 'run-a', 'c1'));
    await write.run({ locator: 'workspace:/汇报.md', content: '# 汇报\n\n改。' }, context('conv-a', 'run-a', 'c2'));
    await write.run({ locator: 'workspace:/定价.md', content: '# 定价' }, context('conv-a', 'run-a', 'c3'));

    const list = readProjectConversations(db(), { project_id: projectId });
    expect(list.conversations.map(row => [
      row.conversation_id, row.is_pinned, row.replied_agent_ids, row.selected_agent_id, row.turn_count, row.changed_document_count, row.storage,
    ])).toEqual([
      ['conv-b', true, ['research_v1'], 'research_v1', 3, 0, null],
      ['conv-a', false, [null, 'research_v1'], 'research_v1', 9, 2, null],
      ['conv-c', false, [], null, 0, 0, null],
    ]);
  });

  it('详情：派出的子 Agent 按 Agent 计子运行次数（含多层），内部 Agent 不算', () => {
    addConversation('conv-a', '三季度汇报初稿', projectId, 500);
    addRun('run-a', 'conv-a', 'default', 1);
    addRun('sub-1', 'conv-a', 'research_source_review_v1', 2, 'run-a');
    addRun('sub-2', 'conv-a', 'research_source_review_v1', 3, 'run-a');
    addRun('sub-3', 'conv-a', 'subagent_general', 4, 'run-a');
    addRun('sub-3-web', 'conv-a', 'deep_web_search', 5, 'sub-3');
    addRun('sub-internal', 'conv-a', 'system_batch_summarizer', 6, 'run-a');

    const detail = readProjectConversationDetail(db(), { project_id: projectId, conversation_id: 'conv-a' });
    expect(detail?.subagents).toEqual([
      { agent_id: 'research_source_review_v1', run_count: 2 },
      { agent_id: 'deep_web_search', run_count: 1 },
      { agent_id: 'subagent_general', run_count: 1 },
    ]);
  });

  it('详情：第一个问题、最后的答复截取原文，改过的文档带待审阅数，删掉的文档标出', async () => {
    addConversation('conv-a', '三季度汇报初稿', projectId, 500);
    addRun('run-a', 'conv-a', 'default');
    addMessage('conv-a', 'run-a', 'user_input', '根据调研写一份三季度汇报');
    addMessage('conv-a', 'run-a', 'thought', '思考过程不出现');
    addMessage('conv-a', 'run-a', 'final_answer', '初稿写好了');
    addMessage('conv-a', 'run-a', 'user_input', '再改一下定价');
    addMessage('conv-a', 'run-a', 'final_answer', '已更新定价部分');
    const write = new WriteFileTool();
    await write.run({ locator: 'workspace:/汇报.md', content: '# 汇报' }, context('conv-a', 'run-a', 'c1'));
    await write.run({ locator: 'workspace:/旧稿.md', content: '# 旧稿' }, context('conv-a', 'run-a', 'c2'));
    const old = db().prepare("SELECT id FROM workspace_nodes WHERE name = '旧稿.md'").get() as { id: string };
    workspace.deleteNode(old.id);

    const detail = readProjectConversationDetail(db(), { project_id: projectId, conversation_id: 'conv-a' });
    expect(detail).toMatchObject({ subagents: [], first_question: '根据调研写一份三季度汇报', last_answer: '已更新定价部分', storage: null });
    expect(detail?.changed_documents.map(document => [document.title, document.deleted])).toEqual([
      ['旧稿.md', true],
      ['汇报.md', false],
    ]);
    expect(readProjectConversationDetail(db(), { project_id: otherProjectId, conversation_id: 'conv-a' })).toBeNull();
  });

  it('搜索：标题命中在前；内容只搜可读消息，三字以上走索引，短词逐条扫描；不跨项目', () => {
    addConversation('conv-a', '定价讨论', projectId, 500);
    addConversation('conv-b', '渠道梳理', projectId, 400);
    addConversation('conv-c', '别处', otherProjectId, 300);
    addRun('run-a', 'conv-a', null);
    addRun('run-b', 'conv-b', null);
    addRun('run-c', 'conv-c', null);
    addMessage('conv-b', 'run-b', 'final_answer', '德国市场的定价按欧元口径计算');
    addMessage('conv-b', 'run-b', 'thought', '只在思考里出现的雪绒花');
    addMessage('conv-c', 'run-c', 'final_answer', '别处也有定价按欧元口径');

    expect(searchProjectConversations(db(), { project_id: projectId, query: '定价' }).matches).toEqual([
      { conversation_id: 'conv-a', excerpt: null },
      { conversation_id: 'conv-b', excerpt: '德国市场的定价按欧元口径计算' },
    ]);
    expect(searchProjectConversations(db(), { project_id: projectId, query: '欧元口径' }).matches)
      .toEqual([{ conversation_id: 'conv-b', excerpt: '德国市场的定价按欧元口径计算' }]);
    expect(searchProjectConversations(db(), { project_id: projectId, query: '雪绒花' }).matches).toEqual([]);
  });

  it('测量占用：写入缓存，对话有新活动后缓存过期；工作目录读不出时不记成 0', async () => {
    addConversation('conv-a', '汇报', projectId, 500);
    addRun('run-a', 'conv-a', null);
    addMessage('conv-a', 'run-a', 'final_answer', '一段答复');
    const measurer = createProjectConversationStorageMeasurer({
      db: db(),
      workDirectoryUsage: { measureWorkDirectory: async () => { throw new Error('locked'); } },
      now: () => 1_000,
    });
    const result = await measurer.measure({ project_id: projectId });
    expect(result.measurements).toHaveLength(1);
    expect(result.measurements[0]?.storage).toMatchObject({
      record_bytes: Buffer.byteLength('一段答复'),
      attachment_bytes: 0,
      work_file_bytes: null,
      work_files_state: 'unavailable',
      measured_at: 1_000,
    });
    expect(readProjectConversations(db(), { project_id: projectId }).conversations[0]?.storage?.record_bytes)
      .toBe(Buffer.byteLength('一段答复'));
    expect((await measurer.measure({ project_id: projectId })).measurements).toEqual([]);

    db().prepare("UPDATE conversations SET last_event_at = 2000 WHERE conversation_id = 'conv-a'").run();
    expect(readProjectConversations(db(), { project_id: projectId }).conversations[0]?.storage).toBeNull();
    db().prepare("DELETE FROM conversations WHERE conversation_id = 'conv-a'").run();
    expect(db().prepare('SELECT COUNT(*) AS n FROM conversation_storage_usage').get()).toEqual({ n: 0 });
  });

  it('读别的对话：只给可读消息，按序号翻页，范围外的对话读不到', () => {
    addConversation('conv-a', '三季度汇报初稿', projectId, 500);
    addConversation('conv-other', '别处的对话', otherProjectId, 900);
    addRun('run-a', 'conv-a', 'default');
    addRun('run-o', 'conv-other', 'default');
    addMessage('conv-a', 'run-a', 'user_input', '写一份汇报');
    addMessage('conv-a', 'run-a', 'thought', '思考不出现');
    addMessage('conv-a', 'run-a', 'tool_preamble', '先读一下资料');
    addMessage('conv-a', 'run-a', 'final_answer', '写好了');
    addMessage('conv-other', 'run-o', 'user_input', '别处的问题');

    const scope = { kind: 'project' as const, projectId };
    const first = readConversationTranscript(db(), { scope, conversationId: 'conv-a', limit: 2 });
    expect(first?.messages.map(message => [message.role, message.type, message.text])).toEqual([
      ['user', 'user_input', '写一份汇报'],
      ['assistant', 'tool_preamble', '先读一下资料'],
    ]);
    expect(first?.nextAfterSeq).toBe(first?.messages[1]?.seq);
    const second = readConversationTranscript(db(), { scope, conversationId: 'conv-a', afterSeq: first?.nextAfterSeq ?? 0, limit: 2 });
    expect(second?.messages.map(message => message.text)).toEqual(['写好了']);
    expect(second?.nextAfterSeq).toBeNull();
    expect(readConversationTranscript(db(), { scope, conversationId: 'conv-other', limit: 10 })).toBeNull();
  });
});
