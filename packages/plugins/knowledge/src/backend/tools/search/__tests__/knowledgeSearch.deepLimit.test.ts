import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import type { SubRunTracePublisher } from '@linnlabs/linnkit/runtime-kernel';
import type { ToolContext } from 'src/tools/types';
import { ChildRunLimitExceededError } from 'src/app-hosts/linnya/application/run-resumption';
import { attachCitationRefAllocator, attachCitationSequence } from 'src/domains/citation';
import { createCitationRefAllocatorFixture } from 'src/domains/citation/testkit/citationRefAllocatorFixture';
import { registerKnowledgeToolRuntime } from '../../runtime/knowledgeToolRuntime';
import type { KnowledgeBaseService } from '../../../application/knowledgeBaseService';
import { KnowledgeSearchTool } from '../KnowledgeSearchTool';
import { runDeepSearch } from '../deep/runDeepSearch';
import { runShallowSearch } from '../shallow/runShallowSearch';

vi.mock('../deep/runDeepSearch', () => ({
  DeepSearchFailedError: class DeepSearchFailedError extends Error {},
  runDeepSearch: vi.fn(),
}));
vi.mock('../shallow/runShallowSearch', () => ({
  runShallowSearch: vi.fn(async () => ({ data: { search_strategy: 'shallow' }, observation: 'shallow' })),
}));

const unused = async (): Promise<never> => {
  throw new Error('Deep search limit path must not call the knowledge service');
};
// 深搜与浅搜索都已替身，本路径不应触达知识库服务。
const service: KnowledgeBaseService = {
  hasActiveTasks: () => false,
  stopTasks: unused,
  rebuildIndex: unused,
  getIndexRebuildStatus: () => null,
  getDocumentById: unused,
  getRawSoTDocument: unused,
  getGraphAugmentationsForEvidenceBlocks: unused,
  createKnowledgeBase: unused,
  getAllKnowledgeBases: unused,
  getOrCreateDefaultKnowledgeBase: unused,
  addDocument: unused,
  getDocumentsInKnowledgeBase: unused,
  getTasksStatus: unused,
  continueFailedPdfPages: unused,
  deleteKnowledgeBase: unused,
  updateKnowledgeBaseSettings: unused,
  search: unused,
  searchKnowledgeBase: unused,
  searchInDocument: unused,
  searchRawResults: unused,
  searchForAgent: unused,
  searchForAgentAcrossKnowledgeBases: unused,
  getSoTDocumentForAgent: unused,
  getSoTTableForAgent: unused,
  getDocumentContent: unused,
};

function createContext(): ToolContext {
  const context: ToolContext = {
    conversationId: 'conv_limit',
    turnId: 'turn_limit',
    parentToolCallId: ToolCallIdSchema.parse('call_limit'),
    createSubRunTracePublisher: (): SubRunTracePublisher => ({ publish: () => {} }),
  };
  attachCitationSequence(context, { offset: 0 });
  attachCitationRefAllocator(context, createCitationRefAllocatorFixture());
  return context;
}

let unregister: (() => void) | undefined;
afterEach(() => {
  unregister?.();
  unregister = undefined;
  vi.clearAllMocks();
});

/**
 * 每父 run 的深搜额度由 Host 持久 admission 计数（并行调用各自拿到派生的 ToolContext，
 * 工具内不能再按上下文对象计数）。工具只负责识别额度拒绝并降级。
 */
describe('knowledge_search 深搜额度', () => {
  it('Host 拒绝超额的深搜子运行时降级为浅搜索，并把召回数提升到深搜候选数', async () => {
    unregister = registerKnowledgeToolRuntime({
      service,
      listProjectKnowledgeBaseIds: () => [],
      enterTool: () => () => {},
    });
    vi.mocked(runDeepSearch).mockRejectedValue(new ChildRunLimitExceededError(2));

    const output = await new KnowledgeSearchTool().run(
      { query: 'q', top_k: 3, deep_search: true },
      createContext()
    );

    expect(JSON.parse(output)).toMatchObject({ data: { search_strategy: 'shallow' } });
    expect(vi.mocked(runShallowSearch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runShallowSearch).mock.calls[0]?.[0].topK).toBe(10);
  });

  it('额度以外的子运行错误照常上抛，不伪装成浅搜索成功', async () => {
    unregister = registerKnowledgeToolRuntime({
      service,
      listProjectKnowledgeBaseIds: () => [],
      enterTool: () => () => {},
    });
    vi.mocked(runDeepSearch).mockRejectedValue(new Error('child admission storage unavailable'));

    await expect(
      new KnowledgeSearchTool().run({ query: 'q', top_k: 3, deep_search: true }, createContext())
    ).rejects.toThrow('child admission storage unavailable');
    expect(vi.mocked(runShallowSearch)).not.toHaveBeenCalled();
  });
});
