import { PromptKeys } from '@app/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assembleExecutionPolicy,
  assembleExecutorLocalForDefinition,
} from '../executionPolicyAssembler';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import type { AgentDefinition } from 'src/app-hosts/linnya/agent-registry/types';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';

function makeRequest(promptKey: string): AgentInvokeRequest {
  return {
    query: 'test',
    promptKey,
    availableTools: ['assemble_documents'],
  };
}

describe('assembleExecutionPolicy', () => {
  beforeEach(() => {
    setPluginRuntimeStateForTests({ enabledPluginIds: ['platform'] });
  });

  afterEach(() => {
    clearPluginRuntimeStateForTests();
  });

  it('把 linnya agent 注册配置转换成 runtime systemReminderPolicy', () => {
    const result = assembleExecutionPolicy({
      request: makeRequest(PromptKeys.DEEP_SEARCH),
      options: {},
      newEvents: [],
    });

    expect(result.executorLocal.finalStepPolicy).toBe('force_tools');
    expect(result.executorLocal.finalStepForcedTools).toEqual(['assemble_documents']);
    expect(result.executorLocal.systemReminderPolicy).toEqual({
      enabledRuleIds: ['max_steps_force_final_answer', 'last_steps_hint'],
      thresholds: { lastStepsHintThreshold: 3 },
    });
  });

  it('把 agent contextPolicy.toolOutput 转换成 runtime toolObservationPolicy', () => {
    const definition: AgentDefinition = {
      id: 'custom-agent',
      promptKey: PromptKeys.DEEP_SEARCH,
      defaultMode: 'agent',
      description: 'custom',
      config: {
        contextPolicy: {
          profileId: 'agent',
          toolOutput: {
            observationGovernance: {
              enabled: false,
              maxChars: 2048,
              maxLines: 120,
            },
          },
        },
      },
      task: {
        systemPromptBuilder: () => 'test',
      },
    };

    const executorLocal = assembleExecutorLocalForDefinition({
      definition,
      request: makeRequest(PromptKeys.DEEP_SEARCH),
    });

    expect(executorLocal.toolObservationPolicy).toEqual({
      enabled: false,
      maxChars: 2048,
      maxLines: 120,
    });
  });

  it('保留 host 指定的工具调用意图，供 runner 构造 ToolNode 起点', () => {
    const result = assembleExecutionPolicy({
      request: makeRequest(PromptKeys.DEFAULT),
      options: {
        host_tool_call: {
          tool_name: 'test_tool',
          args: { rowIds: ['row-1', 'row-2'] },
        },
      },
      newEvents: [],
    });

    expect(result.hostToolCall).toEqual({
      tool_name: 'test_tool',
      args: { rowIds: ['row-1', 'row-2'] },
    });
  });
});
