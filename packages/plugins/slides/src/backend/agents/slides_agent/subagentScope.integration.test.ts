import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RESEARCH_AGENT_ID } from '@app/schemas';
import { SLIDES_PLUGIN_META } from '@plugin/slides/shared';
import type { ToolContext } from 'src/tools/types';
import { ToolRegistry } from 'src/app-hosts/linnya/adapters/tools/toolRegistry';
import { backendPluginRegistry } from 'src/app-hosts/linnya/plugin-registry/registry';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { freezeAgentRunInput } from 'src/app-hosts/linnya/agent-registry/freezeAgentRunInput';
import { resolveAgentRequestAdmission } from 'src/app-hosts/linnya/agent-registry/resolveAgentRequestAdmission';
import { SLIDES_AGENT_DEFINITION } from './index';

beforeEach(() => {
  if (!backendPluginRegistry.has(SLIDES_PLUGIN_META.id)) {
    backendPluginRegistry.register({
      meta: SLIDES_PLUGIN_META,
      agentDefinitions: [SLIDES_AGENT_DEFINITION],
    });
  }
  setPluginRuntimeStateForTests({ enabledPluginIds: ['platform', SLIDES_PLUGIN_META.id] });
});
afterEach(() => clearPluginRuntimeStateForTests());

it('真实 Slides Agent 不能借请求身份看到或调用研究专属角色', async () => {
  const registry = new ToolRegistry({ strictInitialization: true });
  const research = freezeAgentRunInput(
    resolveAgentRequestAdmission(
      {
        query: 'Explain the evidence',
        promptKey: RESEARCH_AGENT_ID,
        project_metadata: { id: 'delegation-scope-project' },
      },
      { history: [] }
    )
  );
  const roles = registry.getToolSchemas({ invocation: research, toolNames: ['subagent'] })[0]
    ?.function.parameters.properties.subagent_type.enum;
  if (!roles || roles.length !== 6) throw new Error('Research role catalog is unavailable');
  const invocation = freezeAgentRunInput({
    query: 'Create a presentation',
    promptKey: SLIDES_AGENT_DEFINITION.promptKey,
    callerAgentId: RESEARCH_AGENT_ID,
    availableSubagentTypes: roles,
  });
  expect(invocation.callerAgentId).toBe(SLIDES_AGENT_DEFINITION.id);
  expect(invocation.availableSubagentTypes).toBeUndefined();
  const schema = registry.getToolSchemas({ invocation, toolNames: ['subagent'] })[0];
  expect(schema?.function.parameters.properties.subagent_type.enum).toEqual([
    'general',
    'document_editor',
  ]);
  const invoke = vi.fn();
  const context: ToolContext = {
    callerAgentId: invocation.callerAgentId,
    availableSubagentTypes: invocation.availableSubagentTypes,
    modelId: 'scope-test-model',
    registeredChildRunInvoker: { invoke },
  };
  for (const type of roles) {
    expect(schema?.function.description).not.toContain(`**${type}**`);
    expect(
      await registry.executeTool(
        'subagent',
        {
          description: 'Unauthorized role',
          prompt: 'Delegate',
          subagent_type: type,
        },
        context
      )
    ).toMatchObject({
      success: false,
      error: expect.stringContaining('unknown subagent_type'),
    });
  }
  expect(invoke).not.toHaveBeenCalled();
});
