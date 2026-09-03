import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptKeys } from '@app/schemas';
import type { ToolContext } from '../../../types';
import { createToolContextFixture } from '@linnlabs/linnkit/testkit';
import { runDeepSearch } from './runDeepSearch';
import { attachCitationRefAllocator } from '../../../../domains/citation';
import { createCitationRefAllocatorFixture } from '../../../../domains/citation/testkit/citationRefAllocatorFixture';

const {
  invokeMock,
  auditContextMock,
  buildTaskMessageMock,
  parseDocumentsMock,
  parseSummaryMock,
  formatObservationMock,
  captureDeepEvidenceMock,
  buildCitationsMock,
  buildGraphDigestMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  auditContextMock: vi.fn(),
  buildTaskMessageMock: vi.fn(),
  parseDocumentsMock: vi.fn(),
  parseSummaryMock: vi.fn(),
  formatObservationMock: vi.fn(),
  captureDeepEvidenceMock: vi.fn(),
  buildCitationsMock: vi.fn(),
  buildGraphDigestMock: vi.fn(),
}));

vi.mock('../../../../shared/utils/idUtils', () => ({
  generateMessageId: () => 'fixed_subrun',
}));

vi.mock('src/domains/audit/features/llm-run-audit', () => ({
  runWithLLMAuditContext: async (
    auditContext: Record<string, unknown>,
    callback: () => Promise<unknown>
  ) => {
    auditContextMock(auditContext);
    return await callback();
  },
}));

vi.mock('../../../../app-hosts/linnya/agent-registry/agents/deep_search', () => ({
  DEEP_SEARCH_CONFIG: {
    MAX_STEPS: 30,
    CANDIDATE_TOP_K: 10,
  },
}));

vi.mock('./taskMessageBuilder', () => ({
  buildDeepSearchTaskMessage: buildTaskMessageMock,
}));

vi.mock('./parseAssembleToolOutput', () => ({
  parseAssembleToolOutputToDocuments: parseDocumentsMock,
  parseAssembleToolOutputSummary: parseSummaryMock,
}));

vi.mock('../format/formatObservation', () => ({
  formatObservationFromDocuments: formatObservationMock,
}));

vi.mock('../knowledgeSearchEvidenceAdapter', () => ({
  captureDeepKnowledgeSearchEvidence: captureDeepEvidenceMock,
}));

vi.mock('./buildDeepSearchCitations', () => ({
  buildDeepSearchCitationMetadata: buildCitationsMock,
}));

vi.mock('./buildGraphDigest', () => ({
  buildGraphDigestForSelectedBlocks: buildGraphDigestMock,
}));

function createContext(patch: Partial<ToolContext> = {}): ToolContext {
  const context = createToolContextFixture({
    conversationId: 'conv_deep_search',
    turnId: 'turn_deep_search',
    patch: {
      userQuery: '父问题',
      parentToolCallId: 'parent_call_1',
      createSubRunTracePublisher: () => ({ publish: vi.fn() }),
      registeredChildRunInvoker: { invoke: invokeMock },
      ...patch,
    },
  });
  attachCitationRefAllocator(context, createCitationRefAllocatorFixture());
  return context;
}

describe('runDeepSearch', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    auditContextMock.mockReset();
    buildTaskMessageMock.mockReset();
    parseDocumentsMock.mockReset();
    parseSummaryMock.mockReset();
    formatObservationMock.mockReset();
    captureDeepEvidenceMock.mockReset();
    buildCitationsMock.mockReset();
    buildGraphDigestMock.mockReset();

    buildTaskMessageMock.mockReturnValue('deep-search-task-message');
    parseDocumentsMock.mockReturnValue([
      {
        snippet: '片段',
        doc_id: 'doc_1',
        doc_name: '文档 A',
        block_id: 'block_1',
      },
    ]);
    parseSummaryMock.mockReturnValue('assemble-summary');
    formatObservationMock.mockResolvedValue({
      observation: 'formatted observation',
      emittedEvidence: [
        {
          ref: 'Abc234',
          docId: 'doc_1',
          blockId: 'block_1',
          docTitle: '文档 A',
          text: '实际发射的完整块',
        },
      ],
    });
    captureDeepEvidenceMock.mockResolvedValue(undefined);
    buildCitationsMock.mockImplementation(({ query, searchMode, docName }) =>
      Promise.resolve({
        query,
        searchMode,
        citations: [],
        ...(docName ? { docName } : {}),
      })
    );
    buildGraphDigestMock.mockResolvedValue({
      blocks: [],
      totals: {
        selected_blocks: 1,
        blocks_with_graph: 0,
        entities_sum: 0,
        edges_sum: 0,
        unique_entities: 0,
      },
    });
  });

  it('delegates deep_search child run to the registered child-run invoker', async () => {
    invokeMock.mockResolvedValue({
      subrunId: 'subrun_fixed_subrun',
      success: true,
      finalAnswer: '子 agent 已完成',
      stepCount: 2,
      judgeToolOutput: '{"ok":true}',
      events: [],
    });

    const result = await runDeepSearch({
      query: '气候变化',
      topK: 6,
      citationOffset: 3,
      maxSteps: 12,
      candidateTopK: 8,
      context: createContext(),
    });

    expect(buildTaskMessageMock).toHaveBeenCalledWith({
      query: '气候变化',
      originalUserRequest: '父问题',
      docId: undefined,
      topK: 6,
      candidateTopK: 8,
    });
    expect(auditContextMock).toHaveBeenCalledWith({
      subrunId: 'subrun_fixed_subrun',
      parentToolCallId: 'parent_call_1',
      source: 'tool:knowledge_search:deep_search',
    });
    expect(invokeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        promptKey: PromptKeys.DEEP_SEARCH,
        userMessage: 'deep-search-task-message',
        parentToolContext: expect.objectContaining({
          conversationId: 'conv_deep_search',
          turnId: 'turn_deep_search',
        }),
        tracePolicy: {
          parentToolCallId: 'parent_call_1',
          subrunId: 'subrun_fixed_subrun',
          source: 'tool:knowledge_search:deep_search',
          metadata: {},
        },
        historyPolicy: {
          inheritTurns: 0,
        },
        executionPolicy: {
          maxSteps: 12,
          abortSignal: expect.any(Object),
        },
      })
    );
    expect(result.data.summary).toBe('assemble-summary');
    expect(result.data.search_strategy).toBe('deep');
    expect(result.data.search_mode).toBe('global');
    expect(result.observation).toBe('formatted observation');
    expect(captureDeepEvidenceMock).toHaveBeenCalledWith({
      query: '气候变化',
      emittedEvidence: [
        {
          ref: 'Abc234',
          docId: 'doc_1',
          blockId: 'block_1',
          docTitle: '文档 A',
          text: '实际发射的完整块',
        },
      ],
      context: expect.any(Object),
    });
  });

  it('keeps the hard precondition on parent tool binding', async () => {
    await expect(
      runDeepSearch({
        query: '气候变化',
        topK: 5,
        citationOffset: 0,
        context: createContext({ parentToolCallId: undefined }),
      })
    ).rejects.toThrow('parentToolCallId is required');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
