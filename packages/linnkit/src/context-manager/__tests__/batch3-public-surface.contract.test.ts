import { describe, expect, it } from 'vitest';
import * as contextManager from '..';

describe('context-manager Batch 3 public surface', () => {
  it('exposes agent helpers without chat compatibility namespaces', () => {
    expect(contextManager.agentConfig.AGENT_CONSTANTS.DEFAULT_MAX_STEPS).toBeTypeOf('number');
    expect(contextManager.formatAgentLlmMessages).toBeTypeOf('function');
    expect(contextManager).not.toHaveProperty('chatUtils');
    expect(contextManager).not.toHaveProperty('convertEventsToChatMessages');
    expect(contextManager).not.toHaveProperty('chatMessageToAiMessage');
  });
});
