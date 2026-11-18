import { PromptKeys } from '@app/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assembleExecutionPolicy } from 'src/app-hosts/linnya/adapters/flow/agent-runner/executionPolicyAssembler';
import { ensureBuiltinBackendPluginsRegistered } from 'src/app-hosts/linnya/plugin-registry/builtin';
import { backendPluginRegistry } from 'src/app-hosts/linnya/plugin-registry/registry';
import { clearPluginRuntimeStateForTests, setPluginRuntimeStateForTests } from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import knowledgePlugin from '../knowledge/src/backend';

describe('Knowledge Agent contribution → Host execution policy', () => {
  beforeEach(() => {
    backendPluginRegistry.clear();
    ensureBuiltinBackendPluginsRegistered();
    backendPluginRegistry.register(knowledgePlugin, { allowPluginCli: false, allowMultipartUpload: true });
  });
  afterEach(() => {
    clearPluginRuntimeStateForTests();
    backendPluginRegistry.clear();
  });

  it('启用时将真实插件的最终组装与提醒策略交给 runtime，停用时撤销', () => {
    const assemble = () => assembleExecutionPolicy({
      request: {
        query: 'test',
        promptKey: PromptKeys.DEEP_SEARCH,
        availableTools: ['assemble_documents'],
      },
      options: {},
      newEvents: [],
    });
    setPluginRuntimeStateForTests({ enabledPluginIds: ['platform', knowledgePlugin.meta.id] });
    const result = assemble();
    expect(result.executorLocal.finalStepPolicy).toBe('force_tools');
    expect(result.executorLocal.finalStepForcedTools).toEqual(['assemble_documents']);
    expect(result.executorLocal.systemReminderPolicy).toEqual({
      enabledRuleIds: ['max_steps_force_final_answer', 'last_steps_hint'],
      thresholds: { lastStepsHintThreshold: 3 },
    });

    setPluginRuntimeStateForTests({ enabledPluginIds: ['platform'] });
    expect(assemble().executorLocal.finalStepPolicy).toBeUndefined();
  });
});
