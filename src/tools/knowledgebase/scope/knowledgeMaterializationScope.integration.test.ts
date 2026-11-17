import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { AssembleDocumentsToolOutputSchema, KnowledgeSearchResultSchema } from '@app/schemas';
import { ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { DatabaseService } from '../../../electron-main/services/database';
import type { KnowledgeBaseService } from '../../../features/knowledge-base/application/knowledgeBaseService';
import { GraphSearchService } from '../../../features/knowledge-base/graph/application/graphSearchService';
import { BetterSqliteMetadataRepository } from '../../../features/knowledge-base/infrastructure/sqlite/better-sqlite-metadata.repository';
import { BetterSqliteKnowledgeGraphRepository } from '../../../features/knowledge-base/graph/infrastructure/better-sqlite-knowledge-graph.repository';
import { FileSotRepository } from '../../../features/knowledge-base/infrastructure/sotRepository';
import { createKnowledgeBase } from '../../../features/knowledge-base/domain/knowledgeBase';
import { createDocument } from '../../../features/knowledge-base/domain/document';
import { BlockType } from '../../../features/knowledge-base/domain/block';
import { attachCitationRefAllocator, attachCitationSequence } from '../../../domains/citation';
import { createCitationRefAllocatorFixture } from '../../../domains/citation/testkit/citationRefAllocatorFixture';
import { resolveEvidenceFromBundles } from '../../../domains/evidence';
import { createTempWorkspaceFixture } from '../../../app-hosts/linnya/testkit/tool-fixtures/tempWorkspace';
import type { ToolContext } from '../../types';
import { AssembleDocumentsTool } from '../assemble/AssembleDocumentsTool';
import { KnowledgeSearchTool } from '../search/KnowledgeSearchTool';

async function createFixture() {
  const workspace = await createTempWorkspaceFixture('knowledge-materialization-scope-');
  const database = new DatabaseService(path.join(workspace.root, 'workspace.sqlite'));
  database.initialize();
  const db = database.getDb();
  const metadata = new BetterSqliteMetadataRepository(db);
  const sot = new FileSotRepository(path.join(workspace.root, 'sot'));
  const graph = new GraphSearchService(new BetterSqliteKnowledgeGraphRepository(db));
  const unused = async (): Promise<never> => { throw new Error('Scope reads must not call an unrelated capability'); };
  // 工具窄读取使用真实SQLite/SoT/图谱；不装配与此路径无关的摄入队列或模型。
  const service: KnowledgeBaseService = {
    getDocumentById: id => metadata.getDocumentById(id),
    getRawSoTDocument: id => sot.get(id),
    getGraphAugmentationsForEvidenceBlocks: (refs, options) => graph.getAugmentationsForEvidenceBlocks(refs, options),
    createKnowledgeBase: unused, getAllKnowledgeBases: unused, getOrCreateDefaultKnowledgeBase: unused,
    addDocument: unused, getDocumentsInKnowledgeBase: unused, getTasksStatus: unused,
    cancelTask: unused, pauseTask: unused, resumeTask: unused, deleteDocument: unused,
    continueFailedPdfPages: unused, deleteKnowledgeBase: unused, updateKnowledgeBaseSettings: unused,
    search: unused, searchKnowledgeBase: unused, searchInDocument: unused, searchRawResults: unused,
    searchForAgent: unused, searchForAgentAcrossKnowledgeBases: unused,
    getSoTDocumentForAgent: unused, getSoTTableForAgent: unused, getDocumentContent: unused,
  };
  for (const id of ['a', 'b']) {
    db.prepare('INSERT INTO projects(id, name, created_at, updated_at) VALUES (?, ?, 1, 1)').run(id, id);
  }
  for (const kb of ['a', 'b', 'default']) {
    if (kb !== 'default') await metadata.createKnowledgeBase(createKnowledgeBase(kb, kb, '合成验收资料'));
    await metadata.addDocument(createDocument(`doc-${kb}`, kb, `${kb}.md`, 20));
    await sot.save(`doc-${kb}`, {
      doc_id: `doc-${kb}`, doc_title: kb, metadata: {},
      content_blocks: { block: { block_type: BlockType.PARAGRAPH, text: `${kb} 的独有原文` } },
      structure: { root: ['block'] },
    });
  }
  for (const id of ['a', 'b']) {
    db.prepare('INSERT INTO project_knowledge_base_links(project_id,kb_id,created_at,updated_at) VALUES (?,?,1,1)').run(id, id);
  }
  const readSoT = vi.spyOn(sot, 'get');
  const allocator = createCitationRefAllocatorFixture();
  const allocate = vi.spyOn(allocator, 'allocate');
  function context(projectId: string | undefined = 'a'): ToolContext {
    const result: ToolContext = {
      conversationId: 'scope-conversation', turnId: 'scope-turn', workspaceProjectId: projectId,
      research: { instanceId: 'scope-instance' },
      parentToolCallId: ToolCallIdSchema.parse('scope-tool-call'),
      databaseService: database, knowledgeBaseService: service,
      createSubRunTracePublisher: () => ({ publish: () => {} }),
    };
    attachCitationSequence(result, { offset: 0 });
    attachCitationRefAllocator(result, allocator);
    return result;
  }
  return {
    context, readSoT, allocate,
    unlink: () => db.prepare('DELETE FROM project_knowledge_base_links WHERE project_id = ?').run('a'),
    async cleanup() { vi.restoreAllMocks(); database.close(); await workspace.cleanup(); },
  };
}

const selection = (id: string) => ({ query: '资料', selected_blocks: [{ doc_id: `doc-${id}`, block_id: 'block' }] });

// 子运行端口只替代模型选择；项目SQL、元数据/SoT、组装、deep格式化和Evidence均为真实实现。
function connectChild(context: ToolContext, output: () => Promise<string>) {
  const invoke = vi.fn(async () => ({
    success: true, subrunId: 'scope-child', events: [], stepCount: 1,
    judgeToolOutput: await output(),
  }));
  context.registeredChildRunInvoker = { invoke };
  return invoke;
}

function forgedSelection(id: string): string {
  return JSON.stringify(AssembleDocumentsToolOutputSchema.parse({
    data: { query: '资料', kept: [{ doc_id: `doc-${id}`, block_id: 'block', snippet: '旧快照', doc_name: `${id}.md` }],
      dropped: [], stats: { total_input: 1, kept_count: 1, dropped_count: 0 } },
    observation: '组装完成', control: { terminateRun: true, reason: 'assemble_documents: completed' },
  }));
}

describe('Knowledge materialization project scope', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  const assemble = new AssembleDocumentsTool();
  beforeEach(async () => { fixture = await createFixture(); });
  afterEach(async () => { await fixture?.cleanup(); });

  it('同项目组装保持正文和收尾合同，无绑定项目仍只可读default', async () => {
    const result = AssembleDocumentsToolOutputSchema.parse(JSON.parse(await assemble.run(selection('a'), fixture.context())));
    expect(result.data.kept[0].snippet).toBe('a 的独有原文');
    expect(result.control?.terminateRun).toBe(true);
    fixture.unlink();
    const fallback = AssembleDocumentsToolOutputSchema.parse(JSON.parse(await assemble.run(selection('default'), fixture.context())));
    expect(fallback.data.kept[0].snippet).toBe('default 的独有原文');
  });

  it.each(['foreign', 'unlinked', 'no-project'] as const)('组装%s在任何SoT读取前拒绝', async scenario => {
    const context = fixture.context();
    if (scenario === 'unlinked') fixture.unlink();
    if (scenario === 'no-project') delete context.workspaceProjectId;
    await expect(assemble.run(selection(scenario === 'foreign' ? 'b' : 'a'), context)).rejects.toThrow(/项目/);
    expect(fixture.readSoT).not.toHaveBeenCalled();
  });

  it('混合批次先核对全部归属，不能先读取允许的第一份再发现越界', async () => {
    await expect(assemble.run({ query: '资料', selected_blocks: [
      { doc_id: 'doc-a', block_id: 'block' }, { doc_id: 'doc-b', block_id: 'block' },
    ] }, fixture.context())).rejects.toThrow(/项目/);
    expect(fixture.readSoT).not.toHaveBeenCalled();
  });

  it('深搜经真实组装/阅读格式化并捕获相同canonical引用', async () => {
    const context = fixture.context();
    connectChild(context, () => assemble.run(selection('a'), context));
    const result = KnowledgeSearchResultSchema.parse(JSON.parse(await new KnowledgeSearchTool().run({ query: '资料', deep_search: true }, context)));
    expect(result.data.search_strategy).toBe('deep');
    expect(result.observation).toContain('a 的独有原文');
    const ref = result.data.citations.citations[0].ref;
    const evidence = await resolveEvidenceFromBundles({ conversationId: 'scope-conversation', instanceId: 'scope-instance', refs: [ref], max_units: 1000, max_chars: 1000 });
    expect(evidence.resolved[ref]).toMatchObject({ doc_id: 'doc-a', text: 'a 的独有原文' });
  });

  it('父深搜再次核对judge返回的范围，不能靠其他项目的旧结果物化原文', async () => {
    const context = fixture.context();
    connectChild(context, async () => forgedSelection('b'));
    await expect(new KnowledgeSearchTool().run({ query: '资料', deep_search: true }, context)).rejects.toThrow(/项目/);
    expect(fixture.readSoT).not.toHaveBeenCalled();
    expect(fixture.allocate).not.toHaveBeenCalled();
  });

  it('子运行完成前解绑，父深搜不得继续读取或登记来源', async () => {
    const context = fixture.context();
    connectChild(context, async () => {
      const output = await assemble.run(selection('a'), context);
      fixture.unlink();
      fixture.readSoT.mockClear();
      return output;
    });
    await expect(new KnowledgeSearchTool().run({ query: '资料', deep_search: true }, context)).rejects.toThrow(/项目/);
    expect(fixture.readSoT).not.toHaveBeenCalled();
    expect(fixture.allocate).not.toHaveBeenCalled();
  });

  it.each(['no-project', 'foreign-document'] as const)('深搜%s在启动子运行前拒绝', async scenario => {
    const context = fixture.context();
    if (scenario === 'no-project') delete context.workspaceProjectId;
    const invoke = connectChild(context, async () => forgedSelection('b'));
    await expect(new KnowledgeSearchTool().run({ query: '资料', deep_search: true,
      ...(scenario === 'foreign-document' ? { doc_id: 'doc-b' } : {}),
    }, context)).rejects.toThrow(/项目/);
    expect(invoke).not.toHaveBeenCalled();
    expect(fixture.readSoT).not.toHaveBeenCalled();
    expect(fixture.allocate).not.toHaveBeenCalled();
  });
});
