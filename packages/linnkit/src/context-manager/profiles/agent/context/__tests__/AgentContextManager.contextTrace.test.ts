import { describe, expect, it } from 'vitest';
import {
  defineContextPolicy,
  AiMessage,
  type AgentSpecTokenEstimationPolicy,
  type TokenRoute,
  type TokenUsageCalibrationSample,
  ToolCallIdSchema,
} from '../../../../../contracts';
import type { TokenCounterPort, TokenizerPort } from '../../../../../ports';
import { createContextComponentLedgerEntry } from '../../../../../runtime-kernel';
import { AgentContextManager } from '../AgentContextManager';
import { AgentBuildPhase } from '../config';
import {
  AgentCoreContextProvider,
  AgentWorkingMemoryProvider,
  ContextProviderRegistry,
} from '../providers';
import { convertEventsToAiMessages } from '../../utils/eventConverter';

function message(
  id: string,
  role: AiMessage['role'],
  type: AiMessage['type'],
  content: string,
  timestamp: number
): AiMessage {
  return AiMessage.parse({ id, role, type, content, timestamp });
}

function createManager(): AgentContextManager {
  const registry = new ContextProviderRegistry();
  registry.register(new AgentCoreContextProvider());
  return new AgentContextManager({
    debugMode: false,
    providerRegistry: registry,
  });
}

function createManagerWithWorkingMemory(): AgentContextManager {
  const registry = new ContextProviderRegistry();
  registry.register(new AgentCoreContextProvider());
  registry.register(
    new AgentWorkingMemoryProvider({
      WORKING_MEMORY_BUDGET_PERCENTAGE: 1,
      MIN_TOOL_INTERACTIONS_TO_KEEP: 1,
    })
  );
  return new AgentContextManager({
    debugMode: false,
    providerRegistry: registry,
    tokenizer: {
      estimateText: text => text.length,
      estimateMessage: msg => msg.content?.length ?? 0,
    },
  });
}

function createManagerWithCalibration(input: {
  route?: TokenRoute;
  samples?: readonly TokenUsageCalibrationSample[];
  policy?: AgentSpecTokenEstimationPolicy['calibration'];
  tokenizer?: TokenizerPort;
}): AgentContextManager {
  const registry = new ContextProviderRegistry();
  registry.register(new AgentCoreContextProvider());
  return new AgentContextManager({
    debugMode: false,
    providerRegistry: registry,
    tokenizer: input.tokenizer,
    tokenizerModelId: input.route?.modelId,
    tokenCalibration: {
      policy: input.policy,
      route: input.route,
      samples: input.samples,
    },
  });
}

function createManagerWithRemoteCounter(input: {
  route?: TokenRoute;
  remoteCount?: AgentSpecTokenEstimationPolicy['remoteCount'];
  tokenCounter?: TokenCounterPort;
  tokenizer?: TokenizerPort;
}): AgentContextManager {
  const registry = new ContextProviderRegistry();
  registry.register(new AgentCoreContextProvider());
  return new AgentContextManager({
    debugMode: false,
    providerRegistry: registry,
    tokenizer: input.tokenizer,
    tokenizerModelId: input.route?.modelId,
    tokenRoute: input.route,
    tokenCounter: input.tokenCounter,
    remoteCount: input.remoteCount,
  });
}

const route: TokenRoute = {
  capabilityId: 'openrouter',
  baseURL: 'https://openrouter.ai/api/v1',
  modelId: 'glm-via-openrouter',
  endpointModelId: 'z-ai/glm-4.5',
};

const remoteCountRoute: TokenRoute = {
  ...route,
  capabilities: {
    supportsRemoteTokenCount: true,
  },
};

const otherRoute: TokenRoute = {
  capabilityId: 'zai',
  baseURL: 'https://api.z.ai',
  modelId: 'glm-direct',
  endpointModelId: 'glm-4.5',
};

const fixedTokenizer: TokenizerPort = {
  estimateText: () => 5,
  estimateMessage: () => 10,
};

function calibrationSample(
  sampleRoute: TokenRoute,
  id: string,
  actualInputTokens: number
): TokenUsageCalibrationSample {
  return {
    route: sampleRoute,
    localEstimateTokens: 10,
    actualInputTokens,
    source: 'test-fixture',
    confidence: 'actual',
    ledgerEntryId: id,
  };
}

describe('AgentContextManager ContextTrace', () => {
  it('默认不产出 trace，避免观测信息无意膨胀', async () => {
    const manager = createManager();
    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '当前问题' },
      [
        message('system_1', 'system', 'system_prompt', '系统提示', 1),
        message('assistant_1', 'assistant', 'final_answer', '旧回答', 2),
        message('user_1', 'user', 'user_input', '当前问题', 3),
      ],
      1000
    );

    expect(result.contextTrace).toBeUndefined();
  });

  it('无可替换区段时仍返回已解析的压缩策略', async () => {
    const manager = createManager();
    const effectivePolicy = defineContextPolicy({
      compaction: {
        enabled: true,
        triggerRatio: 0.85,
        targetRatio: 0.45,
      },
    });

    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '当前问题' },
      [
        message('system_1', 'system', 'system_prompt', '系统提示', 1),
        message('user_1', 'user', 'user_input', '当前问题', 2),
      ],
      1000,
      { effectiveContextPolicy: effectivePolicy },
    );

    expect(result.contextCompactionCandidate).toBeUndefined();
    expect(result.contextCompactionPolicy).toMatchObject({
      enabled: true,
      triggerRatio: 0.85,
      targetRatio: 0.45,
    });
  });

  it('开启后记录 effective policy、provider token delta 与 keep/drop 决策', async () => {
    const manager = createManager();
    const effectivePolicy = defineContextPolicy({
      contextTrace: {
        enabled: true,
        includeMessageIds: true,
        includeTokenBreakdown: true,
        maxTraceEvents: 20,
      },
    });

    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '当前问题' },
      [
        message('system_1', 'system', 'system_prompt', '系统提示', 1),
        message('assistant_1', 'assistant', 'final_answer', '旧回答', 2),
        message('user_1', 'user', 'user_input', '当前问题', 3),
      ],
      1000,
      {
        policy: effectivePolicy.contextTrace,
        effectiveContextPolicy: effectivePolicy,
      }
    );

    expect(result.contextTrace).toMatchObject({
      enabled: true,
      totalBudget: 1000,
      originalCount: 3,
      finalCount: 2,
      truncated: true,
      effectivePolicy,
    });

    expect(result.contextTrace?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'provider',
          providerName: 'AgentCoreContextProvider',
          skipped: false,
          beforeKeptCount: 0,
          afterKeptCount: 2,
        }),
        expect.objectContaining({
          kind: 'message-decision',
          messageId: 'system_1',
          action: 'keep_core',
          kept: true,
          reason: 'kept_by_CORE_CONTEXT',
        }),
        expect.objectContaining({
          kind: 'message-decision',
          messageId: 'assistant_1',
          action: 'skip',
          kept: false,
          reason: 'dropped_by_budget_or_priority',
        }),
      ])
    );
    expect(result.contextTrace?.tokenComponents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'system',
          messageId: 'system_1',
          kept: true,
        }),
        expect.objectContaining({
          kind: 'assistant',
          messageId: 'assistant_1',
          kept: false,
        }),
        expect.objectContaining({
          kind: 'user',
          messageId: 'user_1',
          kept: true,
        }),
      ])
    );
    expect(result.tokenComponents).toEqual(result.contextTrace?.tokenComponents);
  });

  it('真实 provider 名称应写入对应 phase 统计', async () => {
    const manager = createManagerWithWorkingMemory();

    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '当前问题' },
      [
        message('system_1', 'system', 'system_prompt', '系统提示', 1),
        message('assistant_1', 'assistant', 'final_answer', '旧回答', 2),
        message('user_1', 'user', 'user_input', '当前问题', 3),
      ],
      1000
    );

    const buildStats = result.processingStats.buildStats;
    expect(buildStats).toBeDefined();
    expect(buildStats?.phaseTiming[AgentBuildPhase.CORE_CONTEXT]).toBeGreaterThanOrEqual(0);
    expect(buildStats?.phaseTiming[AgentBuildPhase.WORKING_MEMORY]).toBeGreaterThanOrEqual(0);
    expect(buildStats?.phaseTokenUsage[AgentBuildPhase.CORE_CONTEXT]).toEqual(
      expect.objectContaining({
        used: expect.any(Number),
        percentage: expect.any(Number),
      })
    );
    expect(buildStats?.phaseTokenUsage[AgentBuildPhase.WORKING_MEMORY]).toEqual(
      expect.objectContaining({
        used: expect.any(Number),
        percentage: expect.any(Number),
      })
    );
  });

  it('尊重 includeMessageIds=false 与 maxTraceEvents 上限', async () => {
    const manager = createManager();
    const effectivePolicy = defineContextPolicy({
      contextTrace: {
        enabled: true,
        includeMessageIds: false,
        includeTokenBreakdown: false,
        maxTraceEvents: 2,
      },
    });

    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '当前问题' },
      [
        message('system_1', 'system', 'system_prompt', '系统提示', 1),
        message('assistant_1', 'assistant', 'final_answer', '旧回答', 2),
        message('user_1', 'user', 'user_input', '当前问题', 3),
      ],
      1000,
      {
        policy: effectivePolicy.contextTrace,
        effectiveContextPolicy: effectivePolicy,
      }
    );

    expect(result.contextTrace?.overflowed).toBe(true);
    expect(result.contextTrace?.events).toHaveLength(2);
    expect(result.contextTrace?.tokenComponents).toBeUndefined();
    for (const event of result.contextTrace?.events ?? []) {
      if (event.kind === 'message-decision') {
        expect(event.messageId).toBeUndefined();
        expect(event.tokens).toBe(0);
      }
      if (event.kind === 'provider') {
        expect(event.beforeTokens).toBe(0);
        expect(event.afterTokens).toBe(0);
      }
    }
  });

  it('token usage 回灌默认关闭时不改变本地估算', async () => {
    const manager = createManagerWithCalibration({
      route,
      tokenizer: fixedTokenizer,
      samples: [
        calibrationSample(route, 'ledger_1', 20),
        calibrationSample(route, 'ledger_2', 20),
        calibrationSample(route, 'ledger_3', 20),
      ],
    });

    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '当前问题' },
      [
        message('system_1', 'system', 'system_prompt', '系统提示', 1),
        message('user_1', 'user', 'user_input', '当前问题', 2),
      ],
      1000
    );

    expect(result.tokenUsage.used).toBe(20);
    expect(result.tokenUsage.source).toBe('local-estimate');
    expect(result.tokenUsage.confidence).toBe('estimate');
    expect(result.contextTrace).toBeUndefined();
  });

  it('开启回灌但 route 样本不足时不应用校准，并在 trace 中说明原因', async () => {
    const effectivePolicy = defineContextPolicy({
      tokenEstimation: {
        calibration: {
          enabled: true,
          minSamples: 2,
        },
      },
      contextTrace: {
        enabled: true,
      },
    });
    const manager = createManagerWithCalibration({
      route,
      tokenizer: fixedTokenizer,
      policy: effectivePolicy.tokenEstimation?.calibration,
      samples: [
        calibrationSample(otherRoute, 'ledger_other', 50),
        calibrationSample(route, 'ledger_1', 20),
      ],
    });

    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '当前问题' },
      [
        message('system_1', 'system', 'system_prompt', '系统提示', 1),
        message('user_1', 'user', 'user_input', '当前问题', 2),
      ],
      1000,
      {
        policy: effectivePolicy.contextTrace,
        effectiveContextPolicy: effectivePolicy,
      }
    );

    expect(result.tokenUsage.used).toBe(20);
    expect(result.contextTrace?.tokenCalibration).toMatchObject({
      enabled: true,
      applied: false,
      route,
      sampleCount: 1,
      minSamples: 2,
      sampleLedgerEntryIds: ['ledger_1'],
    });
  });

  it('只用同 route actual 样本校准上下文预算，并把系数写入 ContextTrace', async () => {
    const effectivePolicy = defineContextPolicy({
      tokenEstimation: {
        calibration: {
          enabled: true,
          minSamples: 2,
        },
      },
      contextTrace: {
        enabled: true,
        includeTokenBreakdown: true,
      },
    });
    const manager = createManagerWithCalibration({
      route,
      tokenizer: fixedTokenizer,
      policy: effectivePolicy.tokenEstimation?.calibration,
      samples: [
        calibrationSample(route, 'ledger_1', 20),
        calibrationSample(route, 'ledger_2', 20),
        calibrationSample(otherRoute, 'ledger_other', 50),
      ],
    });

    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '当前问题' },
      [
        message('system_1', 'system', 'system_prompt', '系统提示', 1),
        message('user_1', 'user', 'user_input', '当前问题', 2),
      ],
      1000,
      {
        policy: effectivePolicy.contextTrace,
        effectiveContextPolicy: effectivePolicy,
      }
    );

    expect(result.tokenUsage.used).toBe(40);
    expect(result.contextTrace?.tokenCalibration).toMatchObject({
      enabled: true,
      applied: true,
      route,
      sampleCount: 2,
      coefficient: 2,
      sampleLedgerEntryIds: ['ledger_1', 'ledger_2'],
    });
    expect(result.contextTrace?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'message-decision',
          messageId: 'system_1',
          tokens: 20,
          tokenCalibration: expect.objectContaining({
            applied: true,
            localEstimateTokens: 10,
            calibratedEstimateTokens: 20,
            deltaTokens: 10,
          }),
        }),
      ])
    );
  });

  it('构建结果暴露未校准 local estimate 与校准后 estimate，供 host 配对 actual usage', async () => {
    const effectivePolicy = defineContextPolicy({
      tokenEstimation: {
        calibration: {
          enabled: true,
          minSamples: 2,
        },
      },
      contextTrace: {
        enabled: true,
      },
    });
    const manager = createManagerWithCalibration({
      route,
      tokenizer: fixedTokenizer,
      policy: effectivePolicy.tokenEstimation?.calibration,
      samples: [calibrationSample(route, 'ledger_1', 20), calibrationSample(route, 'ledger_2', 20)],
    });

    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '当前问题' },
      [
        message('system_1', 'system', 'system_prompt', '系统提示', 1),
        message('user_1', 'user', 'user_input', '当前问题', 2),
      ],
      1000,
      {
        policy: effectivePolicy.contextTrace,
        effectiveContextPolicy: effectivePolicy,
      }
    );

    expect(result.tokenEstimate).toEqual({
      route,
      localEstimateTokens: 20,
      calibratedEstimateTokens: 40,
      finalTokens: 40,
      source: 'local-estimate',
      confidence: 'estimate',
    });
  });

  it('minCoefficient 默认不低于 1，避免噪声样本把预算压低', async () => {
    const effectivePolicy = defineContextPolicy({
      tokenEstimation: {
        calibration: {
          enabled: true,
          minSamples: 2,
        },
      },
      contextTrace: {
        enabled: true,
      },
    });
    const manager = createManagerWithCalibration({
      route,
      tokenizer: fixedTokenizer,
      policy: effectivePolicy.tokenEstimation?.calibration,
      samples: [calibrationSample(route, 'ledger_1', 4), calibrationSample(route, 'ledger_2', 4)],
    });

    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '当前问题' },
      [
        message('system_1', 'system', 'system_prompt', '系统提示', 1),
        message('user_1', 'user', 'user_input', '当前问题', 2),
      ],
      1000,
      {
        policy: effectivePolicy.contextTrace,
        effectiveContextPolicy: effectivePolicy,
      }
    );

    expect(result.contextTrace?.tokenCalibration).toMatchObject({
      applied: true,
      coefficient: 1,
      minCoefficient: 1,
      maxCoefficient: 4,
    });
    expect(result.tokenEstimate).toMatchObject({
      localEstimateTokens: 20,
      calibratedEstimateTokens: 20,
      finalTokens: 20,
    });
  });

  it('允许显式 minCoefficient 低于 1，用于真实需要缩小估算的 route', async () => {
    const effectivePolicy = defineContextPolicy({
      tokenEstimation: {
        calibration: {
          enabled: true,
          minSamples: 2,
          minCoefficient: 0.1,
        },
      },
      contextTrace: {
        enabled: true,
      },
    });
    const manager = createManagerWithCalibration({
      route,
      tokenizer: fixedTokenizer,
      policy: effectivePolicy.tokenEstimation?.calibration,
      samples: [calibrationSample(route, 'ledger_1', 4), calibrationSample(route, 'ledger_2', 4)],
    });

    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '当前问题' },
      [
        message('system_1', 'system', 'system_prompt', '系统提示', 1),
        message('user_1', 'user', 'user_input', '当前问题', 2),
      ],
      1000,
      {
        policy: effectivePolicy.contextTrace,
        effectiveContextPolicy: effectivePolicy,
      }
    );

    expect(result.contextTrace?.tokenCalibration).toMatchObject({
      applied: true,
      coefficient: 0.4,
      minCoefficient: 0.1,
    });
    expect(result.tokenEstimate).toMatchObject({
      localEstimateTokens: 20,
      calibratedEstimateTokens: 8,
      finalTokens: 8,
    });
  });

  it('remote count 默认关闭时不调用 TokenCounterPort，保持本地估算', async () => {
    const calls: unknown[] = [];
    const tokenCounter: TokenCounterPort = {
      countMessages: async input => {
        calls.push(input);
        return {
          inputTokens: 100,
          source: 'test-fixture',
          confidence: 'provider-estimate',
        };
      },
    };
    const manager = createManagerWithRemoteCounter({
      route: remoteCountRoute,
      tokenizer: fixedTokenizer,
      tokenCounter,
    });

    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '当前问题' },
      [
        message('system_1', 'system', 'system_prompt', '系统提示', 1),
        message('user_1', 'user', 'user_input', '当前问题', 2),
      ],
      1000
    );

    expect(result.tokenUsage.used).toBe(20);
    expect(calls).toEqual([]);
  });

  it('remote count 只在 policy 与 route capability 都开启时调用，并写入 ContextTrace', async () => {
    const calls: Array<Parameters<TokenCounterPort['countMessages']>[0]> = [];
    const tokenCounter: TokenCounterPort = {
      countMessages: async input => {
        calls.push(input);
        return {
          inputTokens: 33,
          source: 'test-fixture',
          confidence: 'provider-estimate',
        };
      },
    };
    const effectivePolicy = defineContextPolicy({
      tokenEstimation: {
        remoteCount: {
          enabled: true,
        },
      },
      contextTrace: {
        enabled: true,
      },
    });
    const manager = createManagerWithRemoteCounter({
      route: remoteCountRoute,
      tokenizer: fixedTokenizer,
      tokenCounter,
      remoteCount: effectivePolicy.tokenEstimation?.remoteCount,
    });

    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '当前问题' },
      [
        message('system_1', 'system', 'system_prompt', '系统提示', 1),
        message('user_1', 'user', 'user_input', '当前问题', 2),
      ],
      1000,
      {
        policy: effectivePolicy.contextTrace,
        effectiveContextPolicy: effectivePolicy,
      }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.route).toEqual(remoteCountRoute);
    expect(calls[0]?.messages).toHaveLength(2);
    expect(result.tokenUsage.used).toBe(33);
    expect(result.tokenUsage.source).toBe('test-fixture');
    expect(result.tokenUsage.confidence).toBe('provider-estimate');
    expect(result.contextTrace?.remoteTokenCount).toMatchObject({
      enabled: true,
      attempted: true,
      applied: true,
      route: remoteCountRoute,
      inputTokens: 33,
      localEstimateTokens: 20,
      deltaTokens: 13,
      source: 'test-fixture',
      confidence: 'provider-estimate',
    });
  });

  it('route 未声明 supportsRemoteTokenCount 时不调用 remote count', async () => {
    const calls: unknown[] = [];
    const effectivePolicy = defineContextPolicy({
      tokenEstimation: {
        remoteCount: {
          enabled: true,
        },
      },
      contextTrace: {
        enabled: true,
      },
    });
    const manager = createManagerWithRemoteCounter({
      route,
      tokenizer: fixedTokenizer,
      tokenCounter: {
        countMessages: async input => {
          calls.push(input);
          return {
            inputTokens: 100,
            source: 'test-fixture',
            confidence: 'provider-estimate',
          };
        },
      },
      remoteCount: effectivePolicy.tokenEstimation?.remoteCount,
    });

    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '当前问题' },
      [
        message('system_1', 'system', 'system_prompt', '系统提示', 1),
        message('user_1', 'user', 'user_input', '当前问题', 2),
      ],
      1000,
      {
        policy: effectivePolicy.contextTrace,
        effectiveContextPolicy: effectivePolicy,
      }
    );

    expect(calls).toEqual([]);
    expect(result.tokenUsage.used).toBe(20);
    expect(result.contextTrace?.remoteTokenCount).toMatchObject({
      enabled: true,
      attempted: false,
      applied: false,
      route,
      localEstimateTokens: 20,
    });
  });

  it('执行期截断后的工具输出会在下一轮 build 产出 dropped token 分项并进入同一账本', async () => {
    const manager = createManagerWithWorkingMemory();
    const effectivePolicy = defineContextPolicy({
      contextTrace: {
        enabled: true,
        includeMessageIds: true,
        includeTokenBreakdown: true,
        maxTraceEvents: 50,
      },
    });
    const preview = 'preview observation';
    const originalChars = preview.length * 4;
    const history = convertEventsToAiMessages([
      {
        type: 'tool_call_decision',
        id: 'tool-call-anchor',
        conversation_id: 'conv-truncation',
        turn_id: 'turn-previous',
        timestamp: 1,
        version: 1,
        tool_name: 'search',
        tool_call_id: ToolCallIdSchema.parse('call-search-1'),
        phase: 'start',
        status: 'loading',
        payload: {
          tool_calls: [
            {
              id: 'call-search-1',
              type: 'function',
              function: { name: 'search', arguments: '{"query":"token"}' },
            },
          ],
        },
      },
      {
        type: 'tool_output',
        id: 'tool-output-truncated',
        conversation_id: 'conv-truncation',
        turn_id: 'turn-previous',
        timestamp: 2,
        version: 1,
        tool_name: 'search',
        tool_call_id: ToolCallIdSchema.parse('call-search-1'),
        status: 'success',
        observation: preview,
        data: {},
        metadata: {
          observationTruncation: {
            originalChars,
            previewChars: preview.length,
            originalLines: 8,
            previewLines: 1,
          },
        },
      },
    ]);

    const result = await manager.buildContextFromPreprocessedMessages(
      { promptKey: 'default', query: '继续基于工具结果回答' },
      [...history, message('user-followup', 'user', 'user_input', '继续基于工具结果回答', 3)],
      1000,
      {
        policy: effectivePolicy.contextTrace,
        effectiveContextPolicy: effectivePolicy,
      }
    );

    const toolComponent = result.contextTrace?.tokenComponents?.find(component => {
      return component.messageId === 'tool-output-truncated';
    });
    expect(toolComponent).toMatchObject({
      kind: 'tool',
      kept: true,
      tokens: preview.length,
      truncatedAtExecution: true,
      originalTokensEstimate: originalChars,
      droppedTokensEstimate: originalChars - preview.length,
    });

    const ledger = createContextComponentLedgerEntry({
      id: 'context-ledger-truncation',
      components: result.tokenComponents?.filter(component => component.kept !== false) ?? [],
    });
    expect(ledger.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageId: 'tool-output-truncated',
          tokens: preview.length,
          droppedTokensEstimate: originalChars - preview.length,
        }),
      ])
    );
    expect(ledger.totalTokens).toBe(
      ledger.components.reduce((sum, component) => sum + component.tokens, 0)
    );
  });
});
