import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentTools } from '@linnlabs/linnkit/context-manager';
import {
  createFinalAnswerEvent,
  createToolCallDecisionEvent,
  createToolOutputEvent,
  createUserInputEvent,
  RunIdSchema,
  type HistorySummaryEvent,
  type RuntimeEvent,
} from '@linnlabs/linnkit/contracts';
import type { LlmCallOptions, LlmRequestMessage } from '@linnlabs/linnkit/ports';
import { llm, type telemetry } from '@linnlabs/linnkit/runtime-kernel';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import { findRegisteredAgentDefinitionByPromptKey } from 'src/app-hosts/linnya/agent-registry/agentDefinitionResolver';
import { clearRegisteredAgentTaskCache } from 'src/app-hosts/linnya/agent-registry/agentTaskResolver';
import { ensureBuiltinBackendPluginsRegistered } from 'src/app-hosts/linnya/plugin-registry/builtin';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { ToolRegistry } from 'src/app-hosts/linnya/adapters/tools/toolRegistry';
import { createDefaultGraphAgentExecutor } from '../graphRuntimeFactory';

const MODEL_ID = 'custom-context-budget-fixture';
const CONVERSATION_ID = 'conversation-context-budget-fixture';
const INPUT_BUDGET = 32_768 - 1;
// 保留旧模型的低容量设置，避免测试因扩大窗口而掩盖 tokenizer / 工具目录装配回归。
const model: llm.ModelCatalogEntry = {
  id: MODEL_ID,
  enabled: true,
  capabilities: ['chat', 'tool_calling'],
  inference_route: {
    context_window_tokens: 32_768,
    max_output_tokens: 4_096,
  },
};
const documentFragment = '这份项目记录包含已确认的研究结论、修改依据、当前工作进展和仍待核对的事项。\n'.repeat(170);
// 使用框架公开文档规定的 checkpoint 格式，真实 applyCompaction 负责验收和重建。
const checkpoint = `<context-checkpoint version="1" trust="untrusted-memory">
## Current Goal
The report is being reviewed.
## Hard Constraints
Existing project constraints remain in effect.
## Completed Work
Earlier sections have been reviewed.
## Key Facts and Evidence
Evidence is recorded in the report.
## Artifacts and External Handles
The current document contains the report.
## Failures and Lessons
No external action was performed.
## Open Work
The latest request is awaiting a response.
## Next Action
A response to the latest request remains pending.
</context-checkpoint>`;

function createHarness(route = model.inference_route) {
  const registry = new ToolRegistry({ strictInitialization: true });
  const definition = findRegisteredAgentDefinitionByPromptKey('default');
  const availableTools = definition?.config?.availableTools;
  if (!availableTools) throw new Error('默认 Agent 缺少正式工具目录。');
  const modelCatalog: llm.ModelCatalogLike = {
    getModelById: id => id === MODEL_ID ? { ...model, inference_route: route } : undefined,
    getModelsByCapability: () => [{ ...model, inference_route: route }],
    getModelsByUIVisibility: () => [{ ...model, inference_route: route }],
  };
  const events: telemetry.TelemetryEvent[] = [];
  const committed: HistorySummaryEvent[] = [];
  const published: HistorySummaryEvent[] = [];
  const compactionCall = vi.fn(async (
    _modelId: string,
    _messages: LlmRequestMessage[],
    _options: LlmCallOptions,
  ) => ({ content: checkpoint }));
  const mainCall = vi.fn(async (
    modelId: string,
    messages: LlmRequestMessage[],
    _options: LlmCallOptions,
    _eventHandler: unknown,
    _signal: unknown,
    fallbackObserver?: llm.LlmFallbackObserver,
    invocationContext?: llm.LlmCallInvocationContext,
  ) => {
    const usage = await invocationContext?.measurePromptUsage?.(modelId, messages);
    fallbackObserver?.onLlmAttemptSucceeded?.(modelId, usage);
    return { content: 'hello' };
  });
  const executor = createDefaultGraphAgentExecutor({
    modelCatalog,
    modelResolver: new llm.ModelResolver({ modelCatalog }),
    toolRuntime: registry,
    toolManager: new agentTools.ToolManager(registry),
    llmCaller: { call: compactionCall, callWithRetries: mainCall },
    telemetryPort: { emit: event => { events.push(event); } },
  });
  const request: AgentInvokeRequest = {
    model_id: MODEL_ID,
    promptKey: 'default',
    query: 'hi',
    enableTools: true,
    availableTools: [...availableTools],
    document_title: '研究报告',
    document_fragment: documentFragment,
  };

  return {
    toolNames: registry.getAvailableToolNames([...availableTools]),
    events,
    committed,
    published,
    compactionCall,
    mainCall,
    tick: (history: RuntimeEvent[], turnId: string) => executor.tick({
      request,
      history,
      toolContext: {
        conversationId: CONVERSATION_ID,
        turnId,
        runId: RunIdSchema.parse('run-context-budget-fixture'),
      },
      runtimeEventCommitPort: async event => {
        if (event.type === 'history_summary') committed.push(event);
      },
    }, event => {
      if (event.type !== 'history_summary') return;
      expect(committed).toContainEqual(event);
      published.push(event);
    }),
  };
}

beforeEach(() => {
  ensureBuiltinBackendPluginsRegistered();
  setPluginRuntimeStateForTests({ installedPluginIds: ['platform'], enabledPluginIds: ['platform'] });
  clearRegisteredAgentTaskCache();
});
afterEach(() => {
  clearPluginRuntimeStateForTests();
  clearRegisteredAgentTaskCache();
});

describe('自定义模型的真实工具目录与上下文预算', () => {
  it('32K 模型携带完整工具目录和当前文档时，连续两个 hi 均未达到历史整理水位', async () => {
    const harness = createHarness();
    const first = await harness.tick([], 'turn-first-hi');
    const second = await harness.tick([
      createUserInputEvent('user-first-hi', CONVERSATION_ID, 'turn-first-hi', 'hi', { timestamp: 1 }),
      createFinalAnswerEvent('answer-first-hi', CONVERSATION_ID, 'turn-first-hi', 'hello', {
        timestamp: 2,
        completion_reason: 'terminal',
      }),
    ], 'turn-second-hi');

    expect(harness.compactionCall).not.toHaveBeenCalled();
    expect(harness.committed).toEqual([]);
    expect(harness.mainCall).toHaveBeenCalledTimes(2);
    for (const call of harness.mainCall.mock.calls) {
      expect(call[2].tools?.map(tool => tool.name)).toEqual(harness.toolNames);
    }
    for (const result of [first, second]) {
      expect(result.decision).toEqual({ kind: 'final_answer', answer: 'hello' });
      expect(result.contextUsage?.input_budget_tokens).toBe(INPUT_BUDGET);
      expect(result.contextUsage?.used_tokens).toBeLessThan(INPUT_BUDGET * 0.8);
    }
  });

  it('窗口与输出能力均为 1M 时仍可携带工具和文档调用，输出只使用剩余窗口', async () => {
    const capacity = 1_048_576;
    const harness = createHarness({ context_window_tokens: capacity, max_output_tokens: capacity });
    const result = await harness.tick([], 'turn-equal-output-capacity');

    expect(result.decision).toEqual({ kind: 'final_answer', answer: 'hello' });
    expect(harness.compactionCall).not.toHaveBeenCalled();
    expect(harness.mainCall).toHaveBeenCalledOnce();
    const usage = result.contextUsage;
    if (!usage) throw new Error('成功调用缺少实际 Prompt 预算快照。');
    expect(usage.input_budget_tokens).toBe(capacity - 1);
    expect(usage.used_tokens).toBeGreaterThan(0);
    expect(usage.output_limit_tokens).toBe(capacity - usage.used_tokens);
  });

  it('同一装配下长历史达到 80% 水位时仍先整理、提交摘要，再完成主调用', async () => {
    const harness = createHarness();
    // 最近 run 的完整工具组必须成对保留；三次读取使完整 Prompt 越线，最老一组可整理。
    const history: RuntimeEvent[] = [
      createUserInputEvent('user-read-report', CONVERSATION_ID, 'turn-read-report', 'Read the report.', { timestamp: 1 }),
      ...Array.from({ length: 3 }, (_, index) => [
        createToolCallDecisionEvent(
          `decision-read-${index}`, CONVERSATION_ID, 'turn-read-report', 'read_file', `call-read-${index}`,
          { timestamp: index * 2 + 2, args: { locator: `workspace:/report-${index}.md` } },
        ),
        createToolOutputEvent(
          `output-read-${index}`, CONVERSATION_ID, 'turn-read-report', 'read_file', `call-read-${index}`,
          {
            status: 'success',
            observation: 'The report records verified evidence and completed changes.\n'.repeat(400),
            data: null,
          },
          { timestamp: index * 2 + 3 },
        ),
      ]).flat(),
    ];
    const result = await harness.tick(history, 'turn-long-history');
    const completed = harness.events.find(
      event => event.kind === 'context_compaction' && event.outcome === 'completed',
    );

    if (!completed || completed.kind !== 'context_compaction') {
      throw new Error(`未完成历史整理：${JSON.stringify({ usage: result.contextUsage, events: harness.events.filter(event => event.kind === 'context_compaction') })}`);
    }
    expect(completed.beforeTokens).toBeGreaterThanOrEqual(INPUT_BUDGET * 0.8);
    expect(completed.beforeTokens).toBeLessThan(INPUT_BUDGET);
    expect(completed.afterTokens).toBeLessThan(completed.beforeTokens);
    expect(harness.compactionCall).toHaveBeenCalledOnce();
    expect(harness.compactionCall.mock.calls[0]?.[2]).toMatchObject({
      tool_choice: 'none', retry_policy: 'none', allow_model_fallback: false,
    });
    expect(harness.compactionCall.mock.calls[0]?.[2].tools?.map(tool => tool.name)).toEqual(harness.toolNames);
    expect(harness.committed).toHaveLength(1);
    expect(harness.published).toEqual(harness.committed);
    expect(harness.mainCall).toHaveBeenCalledOnce();
    expect(result.decision).toEqual({ kind: 'final_answer', answer: 'hello' });
    expect(result.contextUsage?.input_budget_tokens).toBe(INPUT_BUDGET);
    expect(result.contextUsage?.used_tokens).toBeLessThan(INPUT_BUDGET);
  });
});
