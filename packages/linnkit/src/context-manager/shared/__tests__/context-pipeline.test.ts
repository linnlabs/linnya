import { describe, expect, it, vi } from 'vitest';

import type { AiMessage, RuntimeResourceRef } from '../../../contracts';
import {
  generateFinalMessages,
  runContextPipeline,
  type ContextPipelineStats,
} from '../context-pipeline';
import {
  ContextProviderError,
  type IContextProvider,
  type MessageProcessingState,
  type ProviderContext,
  type ProviderResult,
} from '../providers/base';
import { ContextProviderRegistry } from '../providers/registry';

type TestPhase = 'first' | 'second';
type TestConfig = { marker: string };
type TestStats = ContextPipelineStats<TestPhase>;

const message: AiMessage = {
  id: 'msg-1',
  role: 'user',
  type: 'user_input',
  content: 'hello',
  timestamp: 1,
};

function createStats(): TestStats {
  return {
    phaseTiming: {
      first: 0,
      second: 0,
    },
    phaseTokenUsage: {
      first: { used: 0, percentage: 0 },
      second: { used: 0, percentage: 0 },
    },
    messageStats: {
      original: 1,
      afterCoreContext: 0,
      afterWorkingMemory: 0,
    },
  };
}

function createProviderContext(): ProviderContext<TestConfig> {
  return {
    totalBudget: 100,
    config: { marker: 'test' },
    debugMode: false,
    estimateTokens: () => 1,
  };
}

function createProvider(params: {
  name: string;
  priority: number;
  provide: IContextProvider<TestConfig>['provide'];
}): IContextProvider<TestConfig> {
  return {
    name: params.name,
    description: params.name,
    priority: params.priority,
    provide: params.provide,
  };
}

function createSuccessResult(states: MessageProcessingState[], strategy: string): ProviderResult {
  return {
    states: states.map((state) => ({
      ...state,
      action: 'keep_core',
    })),
    tokensUsed: 1,
    strategiesApplied: [strategy],
    stats: {
      processedCount: states.length,
      skippedCount: 0,
      addedCount: 0,
    },
  };
}

async function runWithProviders(providers: IContextProvider<TestConfig>[]) {
  const registry = new ContextProviderRegistry<TestConfig>();
  for (const provider of providers) {
    registry.register(provider);
  }

  return runContextPipeline({
    messages: [message],
    totalBudget: 100,
    buildStats: createStats(),
    providerRegistry: registry,
    providerContext: createProviderContext(),
    estimateTokens: () => ({ tokens: 1 }),
    getPhaseByProviderName: (providerName) => {
      if (providerName === 'first') return 'first';
      if (providerName === 'second') return 'second';
      return null;
    },
  });
}

describe('runContextPipeline provider error policy', () => {
  it('默认 rethrow provider 编程错误，避免 pipeline 静默缺阶段', async () => {
    const secondProvider = vi.fn<IContextProvider<TestConfig>['provide']>(async (states) =>
      createSuccessResult(states, 'second')
    );

    await expect(runWithProviders([
      createProvider({
        name: 'first',
        priority: 1,
        provide: async () => {
          throw new Error('unexpected provider bug');
        },
      }),
      createProvider({
        name: 'second',
        priority: 2,
        provide: secondProvider,
      }),
    ])).rejects.toThrow('unexpected provider bug');

    expect(secondProvider).not.toHaveBeenCalled();
  });

  it('显式非致命 ContextProviderError 可以继续后续 provider', async () => {
    const secondProvider = vi.fn<IContextProvider<TestConfig>['provide']>(async (states) =>
      createSuccessResult(states, 'second')
    );

    const result = await runWithProviders([
      createProvider({
        name: 'first',
        priority: 1,
        provide: async () => {
          throw new ContextProviderError({
            code: 'context_provider_failed',
            fatal: false,
            providerName: 'first',
            message: 'optional provider unavailable',
          });
        },
      }),
      createProvider({
        name: 'second',
        priority: 2,
        provide: secondProvider,
      }),
    ]);

    expect(secondProvider).toHaveBeenCalledTimes(1);
    expect(result.strategiesApplied).toEqual(['second']);
  });

  it('显式 fatal ContextProviderError 必须 rethrow', async () => {
    await expect(runWithProviders([
      createProvider({
        name: 'first',
        priority: 1,
        provide: async () => {
          throw new ContextProviderError({
            code: 'context_provider_failed',
            fatal: true,
            providerName: 'first',
            message: 'fatal provider failure',
          });
        },
      }),
    ])).rejects.toThrow('fatal provider failure');
  });
});

describe('generateFinalMessages message materialization', () => {
  it('保持消息本体，只覆盖 provider 明确修改的 content 与 metadata', () => {
    const attachments: RuntimeResourceRef[] = [
      {
        id: 'attachment-1',
        kind: 'image',
        resourceId: 'resource-1',
        mediaType: 'image/png',
        byteLength: 1024,
        width: 640,
        height: 480,
        sha256: 'a'.repeat(64),
      },
    ];
    const original: AiMessage = {
      id: 'user-with-image',
      role: 'user',
      type: 'user_input',
      content: 'original',
      timestamp: 42,
      metadata: { fenceKind: 'before-selection' },
      attachments,
    };

    const result = generateFinalMessages([{
      message: original,
      originalIndex: 0,
      action: 'keep_core',
      tokens: 1,
      overrideContent: 'selected',
      overrideMetadata: { fenceKind: 'after-selection' },
    }]);

    expect(result).toEqual([{
      ...original,
      content: 'selected',
      metadata: { fenceKind: 'after-selection' },
    }]);
    expect(original).toEqual({
      id: 'user-with-image',
      role: 'user',
      type: 'user_input',
      content: 'original',
      timestamp: 42,
      metadata: { fenceKind: 'before-selection' },
      attachments,
    });
  });
});
