import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';

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

function addRun(id: string, conversationId: string, agent: string | null, startTs = 1) {
  db().prepare(`INSERT INTO runs (id, conversation_id, kind, status, agent_spec_id, start_ts) VALUES (?, ?, 'agent', 'completed', ?, ?)`)
    .run(id, conversationId, agent, startTs);
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
  it('列出本项目对话：置顶在前、Agent 只取选定（内部根运行不算）、改过的文档按账本去重', async () => {
    addConversation('conv-a', '三季度汇报初稿', projectId, 500, { turns: 9, agent: 'default' });
    addConversation('conv-b', '欧洲市场渠道梳理', projectId, 400, { pinned: true, agent: 'research_v1', turns: 3 });
    addConversation('conv-other', '别处的对话', otherProjectId, 900);
    addConversation('conv-assistant', '助手对话', null, 900);
    addRun('run-a', 'conv-a', 'default');
    addRun('run-b', 'conv-b', 'research_v1');
    addRun('run-a-title', 'conv-a', 'conversation_title', 2);

    const write = new WriteFileTool();
    await write.run({ locator: 'workspace:/汇报.md', content: '# 汇报' }, context('conv-a', 'run-a', 'c1'));
    await write.run({ locator: 'workspace:/汇报.md', content: '# 汇报\n\n改。' }, context('conv-a', 'run-a', 'c2'));
    await write.run({ locator: 'workspace:/定价.md', content: '# 定价' }, context('conv-a', 'run-a', 'c3'));

    const list = readProjectConversations(db(), { project_id: projectId });
    expect(list.conversations.map(row => [row.conversation_id, row.is_pinned, row.agent_id, row.turn_count, row.changed_document_count, row.storage]))
      .toEqual([
        ['conv-b', true, 'research_v1', 3, 0, null],
        ['conv-a', false, null, 9, 2, null],
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
    expect(detail).toMatchObject({ first_question: '根据调研写一份三季度汇报', last_answer: '已更新定价部分', storage: null });
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
