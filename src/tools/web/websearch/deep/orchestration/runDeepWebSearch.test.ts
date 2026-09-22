import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolContextFixture } from '@linnlabs/linnkit/testkit';
import { attachCitationRefAllocator, attachCitationSequence } from 'src/domains/citation';
import { createCitationRefAllocatorFixture } from 'src/domains/citation/testkit/citationRefAllocatorFixture';
import { ChildRunLimitExceededError } from 'src/app-hosts/linnya/application/run-resumption';
import { WebSearchTool } from '../../WebSearchTool';
import { DeepWebSearchResultSchema, WebSearchResultSchema } from '@app/schemas';
const invoke = vi.fn();
function context() {
  const context = createToolContextFixture({
    conversationId: 'deep-test',
    turnId: 'turn',
    patch: {
      modelId: 'parent-model',
      parentToolCallId: 'call',
      createSubRunTracePublisher: () => ({ publish: vi.fn() }),
      registeredChildRunInvoker: { invoke },
    },
  });
  attachCitationSequence(context, { offset: 0 });
  attachCitationRefAllocator(context, createCitationRefAllocatorFixture());
  return context;
}
const provider = { name: 'test-provider', search: vi.fn(async () => []) };
const evidenceWriter = { save: vi.fn(async () => ({ bundleId: 'test-bundle' })) };
beforeEach(() => vi.clearAllMocks());
describe('网页深搜父工具合同', () => {
  it('普通搜索没有 child；额度耗尽明确返回浅搜实际模式', async () => {
    const tool = new WebSearchTool({ provider, evidenceWriter });
    await tool.run({ query: 'normal' }, context());
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockRejectedValueOnce(new ChildRunLimitExceededError(4));
    const result = WebSearchResultSchema.parse(
      JSON.parse(await tool.run({ query: 'fifth', deep_search: true }, context()))
    );
    expect(result.data).toMatchObject({
      search_strategy: 'shallow',
      downgrade_reason: 'deep_search_limit',
    });
    expect(result.observation).toContain('ordinary search executed');
  });
  it('继承父模型，隔离历史，只接纳正式组装而非自由文本', async () => {
    const tool = new WebSearchTool({ provider, evidenceWriter });
    invoke.mockResolvedValueOnce({
      success: true,
      subrunId: 'child',
      events: [],
      stepCount: 2,
      finalAnswer: 'I searched thoroughly',
    });
    await expect(tool.run({ query: 'question', deep_search: true }, context())).rejects.toThrow(
      'valid source assembly'
    );
    expect(provider.search).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        promptKey: 'deep_web_search',
        historyPolicy: { inheritTurns: 0 },
        executionPolicy: expect.objectContaining({ modelId: 'parent-model', maxSteps: 30 }),
      })
    );
    invoke.mockResolvedValueOnce({
      success: true,
      subrunId: 'child',
      events: [],
      stepCount: 4,
      judgeToolOutput: JSON.stringify({
        data: {
          sources: [],
          summary: '',
          evidence_store: { bundle_id: 'bundle' },
          gaps: ['No candidates'],
          conflicts: [],
          failures: [],
          search_count: 1,
          read_attempt_count: 0,
        },
        observation: 'No candidates',
      }),
    });
    expect(
      DeepWebSearchResultSchema.parse(
        JSON.parse(await tool.run({ query: 'question', deep_search: true }, context()))
      ).data.resultCount
    ).toBe(0);
  });
  it('已启动的失败与取消不静默降级', async () => {
    const tool = new WebSearchTool({ provider, evidenceWriter });
    invoke.mockResolvedValueOnce({
      success: false,
      subrunId: 'child',
      events: [],
      stepCount: 30,
      error: 'step limit',
    });
    await expect(tool.run({ query: 'question', deep_search: true }, context())).rejects.toThrow(
      'valid source assembly'
    );
    invoke.mockResolvedValueOnce({
      success: false,
      cancelled: true,
      subrunId: 'child',
      events: [],
      stepCount: 4,
    });
    await expect(
      tool.run({ query: 'question', deep_search: true }, context())
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(provider.search).not.toHaveBeenCalled();
  });
});
