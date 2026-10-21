import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WorkspaceEditFileResultSchema,
  WorkspaceReadFileResultSchema,
  WorkspaceWriteFileResultSchema,
} from '@app/schemas';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { MarkdownDocumentService, PendingRevisionApplyService } from 'src/domains/markdown';
import {
  attachCitationRefAllocator,
  attachCitationSequence,
  attachCitationSourceResolver,
} from 'src/domains/citation';
import { createCitationRefAllocatorFixture } from 'src/domains/citation/testkit/citationRefAllocatorFixture';
import type { ToolContext } from 'src/tools/types';
import { WriteFileTool } from '../write_file/WriteFileTool';
import { EditFileTool } from '../edit_file/EditFileTool';
import { ReadFileTool } from './ReadFileTool';

let database: DatabaseService;
let context: ToolContext;
const writer = new WriteFileTool();
const editor = new EditFileTool();
const reader = new ReadFileTool();

beforeEach(() => {
  database = new DatabaseService(':memory:');
  database.initialize();
  const workspaceService = new WorkspaceService(database.getDb());
  context = {
    databaseService: database,
    workspaceService,
    workspaceProjectId: workspaceService.createProject('Text metric lifecycle'),
    conversationId: 'text-metric-conversation',
  };
  attachCitationSourceResolver(context, {
    resolveSources: async refs => refs.includes('Abc234') ? [{
      sourceType: 'web', ref: 'Abc234', url: 'https://example.com/evidence',
      title: '很长的来源标题', snippet: '来源附录内容'.repeat(500),
    }] : [],
    resolveSourcesByUrl: async () => [],
  });
  attachCitationRefAllocator(context, createCitationRefAllocatorFixture());
  attachCitationSequence(context, { offset: 0 });
});

afterEach(async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  database.close();
});

async function read(args: Record<string, unknown>) {
  const result = WorkspaceReadFileResultSchema.parse(JSON.parse(await reader.run(args, context)));
  if (result.data.source_kind !== 'workspace_vfs') throw new Error('Expected ordinary VFS text');
  return result;
}

describe('text metrics follow actual saved current projection', () => {
  it('创建、pending编辑、接受与撤回使用实际规范化全文，Unicode码点不等于UTF-16或字词数', async () => {
    // 尾换行会被规范化，列表保持紧凑；扩展汉字、emoji、组合音标分别覆盖不同计量。
    const created = WorkspaceWriteFileResultSchema.parse(JSON.parse(await writer.run({
      locator: 'workspace:/metrics.md',
      content: '## 标题\n\n- 中文𠀀🙂 e\u0301\n- English\n\n尾声。\n',
    }, context)));
    const originalMetrics = { characters: 31, han_characters: 7 };
    expect(created.data.text_metrics).toEqual(originalMetrics);
    expect(created.observation).toContain('当前全文（含待确认修订）：31 字符');
    const first = await read({ locator: 'workspace:/metrics.md', offset: 3, limit: 1 });
    expect(first.data).toMatchObject({
      text_metrics: { window: { characters: 9, han_characters: 3 }, full_text: originalMetrics },
      has_more: true, next_offset: 4,
    });
    const next = await read({ locator: 'workspace:/metrics.md', offset: 4, limit: 1 });
    expect(next.data).toMatchObject({
      text_metrics: { window: { characters: 9, han_characters: 0 }, full_text: originalMetrics },
    });

    const edited = WorkspaceEditFileResultSchema.parse(JSON.parse(await editor.run({
      locator: 'workspace:/metrics.md', old_string: '尾声。', new_string: '最后的结论。',
    }, context)));
    const editedMetrics = { characters: 34, han_characters: 10 };
    expect(edited.data.text_metrics).toEqual(editedMetrics);
    const store = new MarkdownDocumentService(database.getDb());
    expect(store.getPendingRevisions(created.data.documentId)).toHaveLength(1);
    expect((await read({ locator: 'workspace:/metrics.md' })).data)
      .toMatchObject({ text_metrics: { full_text: editedMetrics, window: editedMetrics } });
    const version = store.getLatestVersion(created.data.documentId);
    if (!version) throw new Error('Expected accepted version');
    await new PendingRevisionApplyService(store).commitEditorRevision({
      documentId: created.data.documentId,
      expectedVersionNumber: version.version_number,
      expectedPending: store.getPendingRevisions(created.data.documentId)
        .map(({ id, revision }) => ({ id, revision })),
      baseline: store.getDocument(created.data.documentId), decision: { mode: 'reject' },
    });
    expect((await read({ inode: created.data.inode })).data)
      .toMatchObject({ text_metrics: { full_text: originalMetrics } });
    // 历史写入回执绑定当次提交，不能随用户拒绝 pending 追溯改变。
    expect(edited.data.text_metrics).toEqual(editedMetrics);
    const acceptedEdit = WorkspaceEditFileResultSchema.parse(JSON.parse(await editor.run({
      inode: created.data.inode, old_string: '尾声。', new_string: '最后的结论。',
    }, context)));
    const beforeAccept = store.getLatestVersion(created.data.documentId);
    if (!beforeAccept) throw new Error('Expected accepted version');
    await new PendingRevisionApplyService(store).commitEditorRevision({
      documentId: created.data.documentId,
      expectedVersionNumber: beforeAccept.version_number,
      expectedPending: store.getPendingRevisions(created.data.documentId)
        .map(({ id, revision }) => ({ id, revision })),
      baseline: store.getDocument(created.data.documentId), decision: { mode: 'accept' },
    });
    expect(store.getPendingRevisions(created.data.documentId)).toHaveLength(0);
    expect((await read({ inode: created.data.inode })).data).toMatchObject({
      text_metrics: { full_text: acceptedEdit.data.text_metrics },
    });
  });

  it('来源附录和工具包装不计入窗口或全文，空文本合法且明确为零', async () => {
    const created = WorkspaceWriteFileResultSchema.parse(JSON.parse(await writer.run({
      locator: 'workspace:/cited.md', content: '依据 [@Abc234]。\n\n余下。',
    }, context)));
    expect(created.data.text_metrics).toEqual({ characters: 18, han_characters: 4 });
    const result = await read({ locator: 'workspace:/cited.md', limit: 1 });
    expect(result.data).toMatchObject({ text_metrics: {
      window: { characters: 13, han_characters: 2 },
      full_text: { characters: 18, han_characters: 4 },
    } });
    expect(result.observation).toContain('Citation Sources');
    expect(result.observation.length).toBeGreaterThan(1_000);

    const empty = WorkspaceWriteFileResultSchema.parse(JSON.parse(await writer.run({
      locator: 'workspace:/empty.md', content: '',
    }, context)));
    expect(empty.data.text_metrics).toEqual({ characters: 0, han_characters: 0 });
    expect((await read({ locator: 'workspace:/empty.md' })).data).toMatchObject({
      text_metrics: { window: { characters: 0, han_characters: 0 }, full_text: { characters: 0, han_characters: 0 } },
    });
  });

  it('批注包含在实际current投影中，规范化等价编辑不以请求长度虚增计量', async () => {
    const created = WorkspaceWriteFileResultSchema.parse(JSON.parse(await writer.run({
      locator: 'workspace:/annotated.md', content: '正文 (口径)。\n\n<!-- 核对依据 -->',
    }, context)));
    const before = await read({ locator: 'workspace:/annotated.md' });
    expect(before.data).toMatchObject({ text_metrics: { full_text: created.data.text_metrics } });
    expect(created.data.text_metrics?.han_characters).toBe(8);
    const equivalent = WorkspaceEditFileResultSchema.parse(JSON.parse(await editor.run({
      locator: 'workspace:/annotated.md', old_string: '(口径)', new_string: '\\(口径\\)',
    }, context)));
    expect(equivalent.observation).toContain('本次规范化后正文和批注无变化');
    expect(equivalent.data.text_metrics).toEqual(created.data.text_metrics);
    expect((await read({ locator: 'workspace:/annotated.md' })).data)
      .toMatchObject({ text_metrics: { full_text: equivalent.data.text_metrics } });
  });
});
