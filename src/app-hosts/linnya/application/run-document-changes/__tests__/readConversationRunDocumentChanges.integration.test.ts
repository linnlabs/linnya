import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';

import { attachCitationSourceResolver } from 'src/domains/citation';
import { createProjectLifecycle } from 'src/domains/projects';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import type { ToolContext } from 'src/tools/types';
import { WriteFileTool } from 'src/tools/workspace/write_file/WriteFileTool';
import { readConversationRunDocumentChanges } from '../orchestration/readConversationRunDocumentChanges';

let database: DatabaseService;
let workspace: WorkspaceService;
let projectId: string;

beforeEach(() => {
  // 账本按登记时刻排序；同一毫秒内的多次写入顺序不确定，测试里让时钟逐次前进。
  let now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 10));
  database = new DatabaseService(':memory:');
  database.initialize();
  workspace = new WorkspaceService(database.getDb());
  projectId = createProjectLifecycle(database.getDb()).create({ name: 'Run changes' });
  database.getDb().prepare(
    'INSERT INTO conversations (conversation_id, project_id, created_at, last_event_at) VALUES (?, ?, 1, 1)',
  ).run('conv', projectId);
});

afterEach(async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  database.close();
  vi.restoreAllMocks();
});

function contextFor(identity: {
  readonly runId: string;
  readonly rootRunId: string;
  readonly parentRunId?: string;
  readonly callId: string;
}): ToolContext {
  const context = {
    databaseService: database,
    workspaceService: workspace,
    workspaceProjectId: projectId,
    conversationId: 'conv',
    parentToolCallId: ToolCallIdSchema.parse(identity.callId),
    runId: RunIdSchema.parse(identity.runId),
    rootRunId: identity.rootRunId,
    ...(identity.parentRunId ? { parentRunId: RunIdSchema.parse(identity.parentRunId) } : {}),
  } as ToolContext;
  attachCitationSourceResolver(context, { resolveSources: async () => [], resolveSourcesByUrl: async () => [] });
  return context;
}

const root = (callId: string) => contextFor({ runId: 'run-a', rootRunId: 'run-a', callId });
const child = (callId: string) => contextFor({ runId: 'run-a-child', rootRunId: 'run-a', parentRunId: 'run-a', callId });

describe('一轮回复改过的文档', () => {
  it('按文档合并主运行和子运行；Markdown 带当前待审阅数，删除的文档保留名字但标为已删除', async () => {
    const write = new WriteFileTool();
    await write.run({ locator: 'workspace:/report.md', content: '# Report\n\nOld line.' }, contextFor({ runId: 'run-0', rootRunId: 'run-0', callId: 'c0' }));
    await write.run({ locator: 'workspace:/report.md', content: '# Report\n\nNew line.' }, root('c1'));
    await write.run({ locator: 'workspace:/notes.md', content: '# Notes' }, child('c2'));
    await write.run({ locator: 'workspace:/report.md', content: '# Report\n\nNewer line.' }, child('c3'));
    await write.run({ locator: 'workspace:/draft.md', content: '# Draft' }, root('c4'));
    await write.run({ locator: 'workspace:/elsewhere.md', content: '# Other run' }, contextFor({ runId: 'run-b', rootRunId: 'run-b', callId: 'c5' }));
    const draft = workspace.getChildNodes(null, projectId).find(node => node.name === 'draft.md');
    if (!draft) throw new Error('expected draft.md');
    workspace.deleteNode(draft.id);

    const result = readConversationRunDocumentChanges(database.getDb(), { conversation_id: 'conv', root_run_ids: ['run-a'] });
    expect(result.truncated).toBe(false);
    expect(result.documents.map(doc => [doc.title, doc.presence, doc.created, doc.actor])).toEqual([
      ['draft.md', 'deleted', true, 'run'],
      ['report.md', 'present', false, 'mixed'],
      ['notes.md', 'present', true, 'subrun'],
    ]);
    const [deleted, report, notes] = result.documents;
    expect(deleted?.pending_revision_count).toBeNull();
    expect(report?.pending_revision_count).toBeGreaterThan(0);
    expect(notes?.pending_revision_count).toBe(0);
    expect(report).toMatchObject({ project_id: projectId, node_type: 'document', parent_id: null });
  });

  it('多个根运行合成一张表；会话没有项目或不存在时为空', async () => {
    const write = new WriteFileTool();
    await write.run({ locator: 'workspace:/a.md', content: '# A' }, root('c1'));
    await write.run({ locator: 'workspace:/b.md', content: '# B' }, contextFor({ runId: 'run-b', rootRunId: 'run-b', callId: 'c2' }));

    const both = readConversationRunDocumentChanges(database.getDb(), { conversation_id: 'conv', root_run_ids: ['run-a', 'run-b', 'run-a'] });
    expect(both.documents.map(doc => doc.title)).toEqual(['b.md', 'a.md']);
    expect(readConversationRunDocumentChanges(database.getDb(), { conversation_id: 'missing', root_run_ids: ['run-a'] }))
      .toEqual({ documents: [], truncated: false });
  });
});
