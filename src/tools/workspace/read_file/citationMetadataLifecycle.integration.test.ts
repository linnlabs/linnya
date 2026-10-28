import { createProjectLifecycle } from 'src/domains/projects';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolOutputEvent } from '@linnlabs/linnkit/contracts';
import {
  WorkspaceEditFileResultSchema,
  WorkspaceReadFileResultSchema,
  WorkspaceWriteFileResultSchema,
} from '@app/schemas';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { MarkdownDocumentService, PendingRevisionApplyService } from 'src/domains/markdown';
import {
  admitDocumentCitations,
  attachCitationRefAllocator,
  attachCitationSequence,
  attachCitationSourceResolver,
  type CitationSource,
} from 'src/domains/citation';
import {
  allocateCitationRefFixture, createCitationRefAllocatorFixture,
} from 'src/domains/citation/testkit/citationRefAllocatorFixture';
import { createCitationSourceResolver } from 'src/app-hosts/linnya/adapters/tools/citation-source-resolution';
import type { ResolveEvidenceResult } from 'src/domains/evidence';
import type { ToolContext } from 'src/tools/types';
import { EditFileTool } from '../edit_file/EditFileTool';
import { WriteFileTool } from '../write_file/WriteFileTool';
import { ReadFileTool } from './ReadFileTool';

const webRef = allocateCitationRefFixture({ sourceType: 'web', url: 'https://example.com/paper' });
const knowledgeRef = allocateCitationRefFixture({
  sourceType: 'knowledge_base', docId: 'knowledge-document', blockId: 'knowledge-block',
});
const sources: readonly CitationSource[] = [{
  sourceType: 'web', ref: webRef, url: 'https://example.com/paper',
  title: 'Synthetic paper', authors: ['Alice', 'Bob', 'Carol'],
  publishedAt: '2026-01-02', containerTitle: 'Synthetic Journal',
  snippet: 'The preserved source passage.',
}, {
  sourceType: 'knowledge_base', ref: knowledgeRef, docId: 'knowledge-document',
  blockId: 'knowledge-block', kbId: 'knowledge-base', title: 'Synthetic knowledge source',
  snippet: 'The preserved knowledge block.',
}];
const initialBody = `主结论 [@${webRef}]。\n\n知识库说明 [@${knowledgeRef}]。\n\n独立尾段。`;
const reader = new ReadFileTool();
const writer = new WriteFileTool();
const editor = new EditFileTool();
let database: DatabaseService;
let workspace: WorkspaceService;
let documents: MarkdownDocumentService;
let originalContext: ToolContext;
let projectId: string;
let originalDocumentId: string;

function contextFor(conversationId: string): ToolContext {
  const target: ToolContext = {
    databaseService: database, workspaceService: workspace,
    workspaceProjectId: projectId, conversationId,
  };
  attachCitationRefAllocator(target, createCitationRefAllocatorFixture());
  attachCitationSequence(target, { offset: 0 });
  return target;
}

async function readOriginal(target: ToolContext, locator = 'workspace:/original.md') {
  const result = WorkspaceReadFileResultSchema.parse(JSON.parse(await reader.run({
    locator,
  }, target)));
  if (result.data.source_kind !== 'workspace_vfs') throw new Error('Expected VFS text read');
  return { ...result, data: result.data };
}

function expectCompleteMetadata(values: readonly { readonly sourceType: string }[]): void {
  expect(values).toEqual([
    expect.objectContaining({
      sourceType: 'web', authors: ['Alice', 'Bob', 'Carol'],
      containerTitle: 'Synthetic Journal', publishedAt: '2026-01-02',
      url: 'https://example.com/paper',
    }),
    expect.objectContaining({
      sourceType: 'knowledge_base', docId: 'knowledge-document',
      blockId: 'knowledge-block', kbId: 'knowledge-base',
    }),
  ]);
}

function savedSources(documentId = originalDocumentId) {
  return admitDocumentCitations(documents.getDocument(documentId)).sources
    .filter(source => source.sourceType !== 'manual');
}

function bindReadHistory(target: ToolContext, read: Awaited<ReturnType<typeof readOriginal>>) {
  const evidenceFallback = vi.fn(async (): Promise<ResolveEvidenceResult> => {
    throw new Error('A persisted read_file snapshot must not need Evidence fallback');
  });
  // 测试中的再次写入必须经过真实 Host history admission，不能直接把完整来源 port 注回工具。
  attachCitationSourceResolver(target, createCitationSourceResolver({
    events: [createToolOutputEvent(
      'read-original', target.conversationId ?? 'reader', 'turn-read', 'read_file', 'call-read',
      { status: 'success', data: read.data, observation: read.observation },
    )],
    resolveEvidence: evidenceFallback,
  }));
  return evidenceFallback;
}

function bodyWithReadRefs(read: Awaited<ReturnType<typeof readOriginal>>): string {
  const citations = read.data.citations?.citations ?? [];
  const web = citations.find(source => source.sourceType === 'web');
  const knowledge = citations.find(source => source.sourceType === 'knowledge_base');
  if (!web || !knowledge) throw new Error('Expected both persisted source snapshots');
  return `主结论 [@${web.ref}]。\n\n知识库说明 [@${knowledge.ref}]。\n\n独立尾段。`;
}

async function decidePending(mode: 'accept' | 'reject'): Promise<void> {
  const version = documents.getLatestVersion(originalDocumentId);
  if (!version) throw new Error('Expected persisted Markdown version');
  await new PendingRevisionApplyService(documents).commitEditorRevision({
    documentId: originalDocumentId,
    expectedVersionNumber: version.version_number,
    expectedPending: documents.getPendingRevisions(originalDocumentId)
      .map(({ id, revision }) => ({ id, revision })),
    baseline: documents.getDocument(originalDocumentId),
    decision: { mode },
  });
}

beforeEach(async () => {
  database = new DatabaseService(':memory:');
  database.initialize();
  workspace = new WorkspaceService(database.getDb());
  documents = new MarkdownDocumentService(database.getDb());
  projectId = createProjectLifecycle(database.getDb()).create({ name: 'Citation metadata lifecycle' });
  originalContext = contextFor('original-conversation');
  // 只在构造原始持久化文档时提供完整来源；所有被测迁移都从正式 read_file 结果重新接纳。
  attachCitationSourceResolver(originalContext, {
    resolveSources: async refs => sources.filter(source => refs.includes(source.ref)),
    resolveSourcesByUrl: async () => [],
  });
  const created = WorkspaceWriteFileResultSchema.parse(JSON.parse(await writer.run({
    locator: 'workspace:/original.md', content: initialBody,
  }, originalContext)));
  originalDocumentId = created.data.documentId;
  expectCompleteMetadata(savedSources());
});

afterEach(async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  database.close();
});

describe('persisted citation metadata survives Workspace read and write lifecycles', () => {
  it.each(['original-conversation', 'new-conversation'])(
    '%s 读后另写保留全部来源字段，原文档不变',
    async conversationId => {
      const target = conversationId === 'original-conversation'
        ? originalContext : contextFor(conversationId);
      const read = await readOriginal(target);
      const received = read.data.citations?.citations ?? [];
      expectCompleteMetadata(received);
      const fallback = bindReadHistory(target, read);
      const copied = WorkspaceWriteFileResultSchema.parse(JSON.parse(await writer.run({
        locator: 'workspace:/copy.md', content: bodyWithReadRefs(read),
      }, target)));
      expectCompleteMetadata(savedSources(copied.data.documentId));
      expect(savedSources().map(source => source.ref)).toEqual(sources.map(source => source.ref));
      expectCompleteMetadata(savedSources());
      expect(fallback).not.toHaveBeenCalled();
    },
  );

  it('不同的持久化别名经新会话重绑后可写入新文档，原文档别名不变', async () => {
    const oldWeb = sources.find(source => source.sourceType === 'web');
    if (!oldWeb) throw new Error('Expected Web fixture');
    const prior = { ...oldWeb, ref: 'Abc234' };
    attachCitationSourceResolver(originalContext, {
      resolveSources: async refs => refs.includes(prior.ref) ? [prior] : [],
      resolveSourcesByUrl: async () => [],
    });
    const legacy = WorkspaceWriteFileResultSchema.parse(JSON.parse(await writer.run({
      locator: 'workspace:/legacy.md', content: '旧文档引用 [@Abc234]。',
    }, originalContext)));
    const target = contextFor('rebound-conversation');
    const read = await readOriginal(target, 'workspace:/legacy.md');
    const rebound = read.data.citations?.citations[0];
    if (!rebound) throw new Error('Expected remapped Web citation');
    expect(rebound.ref).not.toBe(prior.ref);
    const fallback = bindReadHistory(target, read);
    const copied = WorkspaceWriteFileResultSchema.parse(JSON.parse(await writer.run({
      locator: 'workspace:/rebound-copy.md', content: `新文档引用 [@${rebound.ref}]。`,
    }, target)));
    expect(savedSources(copied.data.documentId)).toEqual([
      expect.objectContaining({
        ref: rebound.ref, authors: ['Alice', 'Bob', 'Carol'],
        containerTitle: 'Synthetic Journal', publishedAt: '2026-01-02',
        excerpts: ['The preserved source passage.'],
      }),
    ]);
    expect(savedSources(legacy.data.documentId)[0]?.ref).toBe(prior.ref);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('按已取得 URL 写入 Markdown 链接时保留多作者、刊名与发布日期', async () => {
    const target = contextFor('url-link-conversation');
    const read = await readOriginal(target);
    const fallback = bindReadHistory(target, read);
    const copied = WorkspaceWriteFileResultSchema.parse(JSON.parse(await writer.run({
      locator: 'workspace:/linked.md',
      content: '引用原件 [Synthetic paper](https://example.com/paper)。',
    }, target)));
    expect(savedSources(copied.data.documentId)).toEqual([
      expect.objectContaining({
        sourceType: 'web', title: 'Synthetic paper', authors: ['Alice', 'Bob', 'Carol'],
        containerTitle: 'Synthetic Journal', publishedAt: '2026-01-02',
        url: 'https://example.com/paper', excerpts: ['The preserved source passage.'],
      }),
    ]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each([
    ['主结论', '修订结论'],
    ['知识库说明', '修订知识库说明'],
    ['独立尾段', '修订尾段'],
  ])('编辑“%s”时 pending、接受与再次读取都保留来源元数据', async (oldText, newText) => {
    const target = contextFor('editing-conversation');
    const read = await readOriginal(target);
    const fallback = bindReadHistory(target, read);
    WorkspaceEditFileResultSchema.parse(JSON.parse(await editor.run({
      locator: 'workspace:/original.md', old_string: oldText, new_string: newText,
    }, target)));
    expect(documents.getPendingRevisions(originalDocumentId)).toHaveLength(1);
    expectCompleteMetadata((await readOriginal(target)).data.citations?.citations ?? []);
    expectCompleteMetadata(savedSources());
    await decidePending('accept');
    expect(documents.getPendingRevisions(originalDocumentId)).toHaveLength(0);
    expectCompleteMetadata(savedSources());
    const accepted = await readOriginal(contextFor('accepted-reader'));
    expect(accepted.observation).toContain(newText);
    expectCompleteMetadata(accepted.data.citations?.citations ?? []);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('拒绝含引用段落的修改保留原文和完整来源', async () => {
    const target = contextFor('rejecting-conversation');
    const read = await readOriginal(target);
    const fallback = bindReadHistory(target, read);
    WorkspaceEditFileResultSchema.parse(JSON.parse(await editor.run({
      locator: 'workspace:/original.md', old_string: '主结论', new_string: '待拒绝结论',
    }, target)));
    expectCompleteMetadata((await readOriginal(target)).data.citations?.citations ?? []);
    await decidePending('reject');
    expect(documents.getPendingRevisions(originalDocumentId)).toHaveLength(0);
    const restored = await readOriginal(contextFor('restored-reader'));
    expect(restored.observation).toContain('主结论');
    expect(restored.observation).not.toContain('待拒绝结论');
    expectCompleteMetadata(savedSources());
    expectCompleteMetadata(restored.data.citations?.citations ?? []);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('新快照缺省的字段不从旧快照补回，避免拼成从未取得过的来源版本', async () => {
    const target = contextFor('versioned-reader');
    const read = await readOriginal(target);
    const web = read.data.citations?.citations.find(source => source.sourceType === 'web');
    if (!web) throw new Error('Expected persisted Web source');
    const later = WorkspaceReadFileResultSchema.parse({
      ...read,
      data: {
        ...read.data,
        citations: {
          citations: [{
            sourceType: 'web', ref: web.ref, index: web.index,
            url: web.url, docTitle: 'Later title', snippet: 'Later snapshot',
            authors: ['Later Author'],
          }],
        },
      },
    });
    const fallback = vi.fn(async (): Promise<ResolveEvidenceResult> => {
      throw new Error('The latest owner snapshot is already available');
    });
    const resolver = createCitationSourceResolver({
      events: [read, later].map((result, index) => createToolOutputEvent(
        `read-${index}`, 'versioned-reader', 'turn-read', 'read_file', `call-${index}`,
        { status: 'success', data: result.data, observation: result.observation },
      )),
      resolveEvidence: fallback,
    });
    const resolved = await resolver.resolveSources([web.ref]);
    expect(resolved).toEqual([{
      sourceType: 'web', ref: web.ref, url: web.url, title: 'Later title',
      snippet: 'Later snapshot', authors: ['Later Author'],
    }]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('读回原样写入不制造修订，也不改变持久化引用别名或来源字段', async () => {
    const target = contextFor('unchanged-conversation');
    const read = await readOriginal(target);
    const fallback = bindReadHistory(target, read);
    WorkspaceWriteFileResultSchema.parse(JSON.parse(await writer.run({
      locator: 'workspace:/original.md', content: bodyWithReadRefs(read),
    }, target)));
    expect(documents.getPendingRevisions(originalDocumentId)).toHaveLength(0);
    expectCompleteMetadata(savedSources());
    expect(savedSources().map(source => source.ref)).toEqual(sources.map(source => source.ref));
    expect(fallback).not.toHaveBeenCalled();
  });
});
