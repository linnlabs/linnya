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
  it('从注册定义冻结身份与类型范围，忽略请求伪造并保留空名单', () => {
    const definition = agentDefinitions.findRegisteredAgentDefinitionByPromptKey(
      PromptKeys.DEFAULT
    );
    if (!definition) throw new Error('Default fixture Agent is unavailable');
    const types = ['approved-role'];
    const lookup = vi.spyOn(agentDefinitions, 'findRegisteredAgentDefinitionByPromptKey');
    lookup.mockReturnValue({
      ...definition,
      id: 'registered-parent',
      config: { ...definition.config, availableSubagentTypes: types },
    });
    const request = {
      query: 'Delegate',
      promptKey: PromptKeys.DEFAULT,
      callerAgentId: 'forged-parent',
      availableSubagentTypes: ['general'],
    };
    const admitted = AgentInvokeRequestSchema.parse(freezeAgentRunInput(request));
    types.push('later-added-role');
    expect(admitted.callerAgentId).toBe('registered-parent');
    expect(admitted.availableSubagentTypes).toEqual(['approved-role']);
    lookup.mockReturnValue({ ...definition, config: { availableSubagentTypes: [] } });
    expect(freezeAgentRunInput(request).availableSubagentTypes).toEqual([]);
    lookup.mockReturnValue({ ...definition, config: {} });
    expect(freezeAgentRunInput(request).availableSubagentTypes).toBeUndefined();
  });
});
