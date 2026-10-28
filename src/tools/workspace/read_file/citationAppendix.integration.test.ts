import { createProjectLifecycle } from 'src/domains/projects';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolOutputEvent } from '@linnlabs/linnkit/contracts';
import { WorkspaceReadFileResultSchema, WorkspaceWriteFileResultSchema } from '@app/schemas';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import {
  attachCitationRefAllocator, attachCitationSequence, attachCitationSourceResolver,
  type CitationSource,
} from 'src/domains/citation';
import { createCitationRefAllocatorFixture } from 'src/domains/citation/testkit/citationRefAllocatorFixture';
import { createCitationSourceResolver } from 'src/app-hosts/linnya/adapters/tools/citation-source-resolution';
import type { ResolveEvidenceResult } from 'src/domains/evidence';
import type { ToolContext } from 'src/tools/types';
import { WriteFileTool } from '../write_file/WriteFileTool';
import { ReadFileTool } from './ReadFileTool';

const sources: readonly CitationSource[] = [{
  sourceType: 'web', ref: 'Abc234', url: 'https://example.com/report',
  title: '公开报告', snippet: '来源快照原文。'.repeat(150),
  authors: ['Alice', 'Bob', 'Carol'], publishedAt: '2026-01-01', containerTitle: '刊物',
}, {
  sourceType: 'knowledge_base', ref: 'Def567', docId: 'doc-1', blockId: 'block-1',
  kbId: 'kb-1', title: '知识库原件', snippet: '该块的保存原文。',
}];
const reader = new ReadFileTool();
const writer = new WriteFileTool();
let database: DatabaseService;
let context: ToolContext;

function bindReadContext(target: ToolContext): void {
  attachCitationRefAllocator(target, createCitationRefAllocatorFixture());
  attachCitationSequence(target, { offset: 0 });
}

async function readWorkspace(args: Record<string, unknown>, target: ToolContext) {
  const result = WorkspaceReadFileResultSchema.parse(JSON.parse(await reader.run(args, target)));
  const data = result.data;
  if (data.source_kind !== 'workspace_vfs' && data.source_kind !== 'workspace_document') {
    throw new Error('Expected a Workspace document read');
  }
  return { ...result, data };
}

beforeEach(() => {
  database = new DatabaseService(':memory:');
  database.initialize();
  const workspaceService = new WorkspaceService(database.getDb());
  context = {
    databaseService: database, workspaceService,
    workspaceProjectId: createProjectLifecycle(database.getDb()).create({ name: 'Citation read lifecycle' }),
    conversationId: 'original-conversation',
  };
  bindReadContext(context);
  attachCitationSourceResolver(context, {
    resolveSources: async refs => sources.filter(source => refs.includes(source.ref)),
    resolveSourcesByUrl: async () => [],
  });
});

afterEach(async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  database.close();
});

describe('citation appendix remains self-contained across document consumers', () => {
  it('重读确定、分页不串来源，普通文本与DocumentView保留相同预算后快照', async () => {
    await writer.run({
      locator: 'workspace:/report.md',
      content: '报告依据 [@Abc234]。\n\n另一依据 [@Def567]。',
    }, context);
    const first = await readWorkspace({
      locator: 'workspace:/report.md', limit: 1,
    }, context);
    const repeat = await readWorkspace({
      locator: 'workspace:/report.md', limit: 1,
    }, context);
    expect(repeat).toEqual(first);
    expect(first.data.citations?.citations).toHaveLength(1);
    const source = first.data.citations?.citations[0];
    expect(source).toMatchObject({
      sourceType: 'web', url: 'https://example.com/report',
      docTitle: '公开报告', snippet: sources[0]?.snippet.slice(0, 500),
    });
    expect(first.observation).toContain('not claim-matched support');
    expect(first.observation).toContain(JSON.stringify(source?.snippet));
    expect(first.observation).not.toContain('知识库原件');
    expect(first.observation.indexOf('文件下一页'))
      .toBeLessThan(first.observation.indexOf('Citation Sources'));
    expect(first.data.citation_diagnostics).toEqual([
      expect.objectContaining({ code: 'excerpt_truncated', ref: source?.ref }),
    ]);

    const full = await readWorkspace({
      locator: 'workspace:/report.md',
    }, context);
    const document = await readWorkspace({
      locator: 'workspace:/report.md', view: 'document', max_chars: 4000,
    }, context);
    expect(document.data.citations).toEqual(full.data.citations);
    expect(document.data.citation_diagnostics).toEqual(full.data.citation_diagnostics);
    expect(full.observation.indexOf('源文件已读至末行'))
      .toBeLessThan(full.observation.indexOf('Citation Sources'));
    expect(full.observation.match(/<<<BEGIN_UNTRUSTED_CITATION_SOURCE_/g)).toHaveLength(1);
  });

  it('新会话读取后可直接写入保留的快照，不调用Evidence或新增解引用工具', async () => {
    await writer.run({
      locator: 'workspace:/original.md', content: '原始论断 [@Abc234]。',
    }, context);
    const nextContext: ToolContext = { ...context, conversationId: 'next-conversation' };
    bindReadContext(nextContext);
    const read = await readWorkspace({
      locator: 'workspace:/original.md',
    }, nextContext);
    const fallback = vi.fn(async (): Promise<ResolveEvidenceResult> => {
      throw new Error('This transfer must resolve the read_file snapshot without Evidence');
    });
    attachCitationSourceResolver(nextContext, createCitationSourceResolver({
      events: [createToolOutputEvent('read-event', 'next-conversation', 'turn-1', 'read_file', 'call-read', {
        status: 'success', data: read.data, observation: read.observation,
      })],
      resolveEvidence: fallback,
    }));
    const ref = read.data.citations?.citations[0]?.ref;
    if (!ref) throw new Error('Expected an admitted read_file ref');
    const saved = WorkspaceWriteFileResultSchema.parse(JSON.parse(await writer.run({
      locator: 'workspace:/copied.md', content: `新文档的引用 [@${ref}]。`,
    }, nextContext)));
    const copied = await readWorkspace({
      inode: saved.data.inode,
    }, nextContext);
    // 正式 read_file history admission 必须保留快照元数据，不能经搜索卡片摘要缩水。
    const originalSource = read.data.citations?.citations[0];
    expect(copied.data.citations?.citations[0]).toMatchObject({
      ref, sourceType: 'web', url: 'https://example.com/report',
      docTitle: originalSource?.docTitle, snippet: originalSource?.snippet,
      authors: ['Alice', 'Bob', 'Carol'], publishedAt: '2026-01-01', containerTitle: '刊物',
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('跨来源的反引号不吞掉重绑标签，快照记录与可信索引使用同一新别名', async () => {
    const quotedSources: readonly CitationSource[] = [{
      sourceType: 'web', ref: 'Abc234', url: 'https://example.com/first',
      title: '来源一的未闭合 `', snippet: '第一段原文含字面 \\[@Abc234]。',
    }, {
      sourceType: 'web', ref: 'Def567', url: 'https://example.com/second',
      title: '来源二的闭合 `', snippet: '第二段原文。',
    }];
    attachCitationSourceResolver(context, {
      resolveSources: async refs => quotedSources.filter(source => refs.includes(source.ref)),
      resolveSourcesByUrl: async () => [],
    });
    await writer.run({
      locator: 'workspace:/quoted.md', content: '第一条 [@Abc234]。第二条 [@Def567]。',
    }, context);
    const fresh: ToolContext = { ...context, conversationId: 'quoted-new-conversation' };
    bindReadContext(fresh);
    const result = await readWorkspace({ locator: 'workspace:/quoted.md' }, fresh);
    expect(result.data.citations?.citations).toHaveLength(2);
    for (const source of result.data.citations?.citations ?? []) {
      expect(result.observation).toContain(`[@${source.ref}]\n` + '```json\n' + JSON.stringify({
        title: source.docTitle, excerpt: source.snippet,
      }));
    }
  });
});
