import { describe, expect, it } from 'vitest';

import type { AiMessage } from '../../../../../../contracts';
import { AGENT_CONTEXT_BUILDER_CONFIG } from '../../config';
import { AgentCoreContextProvider } from '../AgentCoreContextProvider';
import type { MessageProcessingState, ProviderContext } from '../base';

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
    config: AGENT_CONTEXT_BUILDER_CONFIG,
    debugMode: false,
    estimateTokens: message => Math.max(1, Math.ceil(message.content.length / 4)),
    agentRequest: {
      query: 'current',
      promptKey: 'default',
      conversationHistory: messages,
    },
  };
}

describe('AgentCoreContextProvider MustKeepPolicy', () => {
  it('uses the default policy without treating context injections as framework core', async () => {
    const messages: AiMessage[] = [
      { id: 'system-1', role: 'system', type: 'system_prompt', content: 'system', timestamp: 1 },
      {
        id: 'ctx-1',
        role: 'user',
        type: 'context_injection',
        content: 'memory',
        timestamp: 2,
        metadata: { fenceKind: 'memory-context' },
      },
      { id: 'user-1', role: 'user', type: 'user_input', content: 'current', timestamp: 3 },
    ];
    const states = messages.map(createState);
    const provider = new AgentCoreContextProvider();

    const result = await provider.provide(states, 1000, createContext(messages));

    expect(result.states.find(state => state.message.id === 'system-1')?.action).toBe('keep_core');
    expect(result.states.find(state => state.message.id === 'ctx-1')?.action).toBe('skip');
    expect(result.states.find(state => state.message.id === 'user-1')?.action).toBe('keep_core');
  });

  it('keeps configured fence messages through an injected policy', async () => {
    const messages: AiMessage[] = [
      {
        id: 'ctx-1',
        role: 'user',
        type: 'context_injection',
        content: 'memory',
        timestamp: 2,
        metadata: { fenceKind: 'memory-context' },
      },
      { id: 'user-1', role: 'user', type: 'user_input', content: 'current', timestamp: 3 },
    ];
    const provider = new AgentCoreContextProvider({
      mustKeepPolicy: {
        alwaysKeepTypes: ['system_prompt', 'user_input'],
        alwaysKeepFenceKinds: ['memory-context'],
        truncationRules: [],
      },
    });

    const result = await provider.provide(messages.map(createState), 1000, createContext(messages));

    expect(result.states.find(state => state.message.id === 'ctx-1')?.action).toBe('keep_core');
  });

  it('始终保留有效历史中 summarySeq 最新的摘要，不让旧摘要进入 core', async () => {
    const messages: AiMessage[] = [
      {
        id: 'summary-old',
        role: 'system',
        type: 'history_summary',
        content: 'old',
        timestamp: 1,
        metadata: { summarySeq: 1, replacedMessageIds: ['source-old'] },
      },
      {
        id: 'summary-latest',
        role: 'system',
        type: 'history_summary',
        content: 'latest',
        timestamp: 2,
        metadata: { summarySeq: 2, replacedMessageIds: ['source-latest'] },
      },
      { id: 'user-1', role: 'user', type: 'user_input', content: 'current', timestamp: 3 },
    ];
    const provider = new AgentCoreContextProvider();

    const result = await provider.provide(messages.map(createState), 0, createContext(messages));

    expect(result.states.find(state => state.message.id === 'summary-old')?.action).toBe('skip');
    expect(result.states.find(state => state.message.id === 'summary-latest')?.action).toBe('keep_core');
  });
});
