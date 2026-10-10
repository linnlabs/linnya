import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptKeys } from '@app/schemas';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../plugin-registry/pluginRuntimeState';
import { AgentInvokeRequestSchema } from '../context/agent/schemas';
import * as agentDefinitions from './agentDefinitionResolver';
import { freezeAgentRunInput } from './freezeAgentRunInput';

beforeEach(() =>
  setPluginRuntimeStateForTests({
    installedPluginIds: ['platform'],
    enabledPluginIds: ['platform'],
  })
);
afterEach(() => {
  vi.restoreAllMocks();
  clearPluginRuntimeStateForTests();
});

describe('Agent delegation admission', () => {
  it('从注册定义冻结身份，忽略请求伪造', () => {
    const definition = agentDefinitions.findRegisteredAgentDefinitionByPromptKey(
      PromptKeys.DEFAULT
    );
    if (!definition) throw new Error('Default fixture Agent is unavailable');
    const lookup = vi.spyOn(agentDefinitions, 'findRegisteredAgentDefinitionByPromptKey');
    lookup.mockReturnValue({
      ...definition,
      id: 'registered-parent',
    });
    const request = {
      query: 'Delegate',
      promptKey: PromptKeys.DEFAULT,
      callerAgentId: 'forged-parent',
    };
    const admitted = AgentInvokeRequestSchema.parse(freezeAgentRunInput(request));
    expect(admitted.callerAgentId).toBe('registered-parent');
  });
});
