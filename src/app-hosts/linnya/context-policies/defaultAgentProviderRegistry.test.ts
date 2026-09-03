import { describe, expect, it } from 'vitest';

import * as contextManager from '@linnlabs/linnkit/context-manager';
import type { AiMessage } from '@linnlabs/linnkit/contracts';
import { createDefaultAgentProviderRegistry } from './defaultAgentProviderRegistry';
import { PluginRuntimeDatabaseNotReadyError } from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';

type MessageProcessingState = contextManager.agentContext.MessageProcessingState;
type ProviderContext = contextManager.agentContext.ProviderContext;

function createState(message: AiMessage, originalIndex: number): MessageProcessingState {
  return {
    message,
    originalIndex,
    action: 'skip',
    tokens: 1,
  };
}

function createContext(messages: AiMessage[]): ProviderContext {
  return {
    totalBudget: 1000,
    config: contextManager.AGENT_CONTEXT_BUILDER_CONFIG,
    debugMode: false,
    estimateTokens: message => Math.max(1, Math.ceil(message.content.length / 4)),
  };
}

async function runCoreProvider(
  registry: contextManager.agentContext.ContextProviderRegistry,
  messages: AiMessage[]
): Promise<MessageProcessingState[]> {
  const provider = registry.getProvider('AgentCoreContextProvider');
  if (!provider) {
    throw new Error('AgentCoreContextProvider should be registered');
  }

  const result = await provider.provide(messages.map(createState), 1000, createContext(messages));
  return result.states;
}

describe('createDefaultAgentProviderRegistry', () => {
  it('构造 provider registry 时不读取插件运行态数据库', () => {
    expect(() => createDefaultAgentProviderRegistry()).not.toThrow(
      PluginRuntimeDatabaseNotReadyError
    );
  });

  it('默认入口保留 linnya 的 additional-context fence', async () => {
    const messages: AiMessage[] = [
      {
        id: 'ctx-1',
        role: 'user',
        type: 'context_injection',
        content: '宿主注入上下文',
        timestamp: 1,
        metadata: { fenceKind: 'additional-context' },
      },
      {
        id: 'user-1',
        role: 'user',
        type: 'user_input',
        content: '继续',
        timestamp: 2,
      },
    ];

    const states = await runCoreProvider(createDefaultAgentProviderRegistry(), messages);

    expect(states.find(state => state.message.id === 'ctx-1')?.action).toBe('keep_core');
  });

  it('默认只注册核心上下文与工作记忆 Provider', () => {
    expect(
      createDefaultAgentProviderRegistry().getAllProviders().map(provider => provider.name),
    ).toEqual(['AgentCoreContextProvider', 'AgentWorkingMemoryProvider']);
  });

  it('显式 providerOptions 可以替换默认 mustKeep 策略', async () => {
    const messages: AiMessage[] = [
      {
        id: 'ctx-1',
        role: 'user',
        type: 'context_injection',
        content: '宿主注入上下文',
        timestamp: 1,
        metadata: { fenceKind: 'additional-context' },
      },
      {
        id: 'agent-ctx-1',
        role: 'user',
        type: 'context_injection',
        content: 'agent 指定上下文',
        timestamp: 2,
        metadata: { fenceKind: 'agent-context' },
      },
      {
        id: 'user-1',
        role: 'user',
        type: 'user_input',
        content: '继续',
        timestamp: 3,
      },
    ];
    const registry = createDefaultAgentProviderRegistry({
      providerOptions: contextManager.contextPolicyToProviderOptions(
        contextManager.mergeContextPolicy({
          agentSpec: {
            mustKeep: {
              alwaysKeepFenceKinds: ['agent-context'],
            },
          },
        })
      ),
    });

    const states = await runCoreProvider(registry, messages);

    expect(states.find(state => state.message.id === 'ctx-1')?.action).toBe('skip');
    expect(states.find(state => state.message.id === 'agent-ctx-1')?.action).toBe('keep_core');
  });

});
