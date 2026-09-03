import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toolRegistry } from 'src/app-hosts/linnya/adapters/tools/toolRegistry';
import { AGENT_DEFINITION } from 'src/app-hosts/linnya/agent-registry/agents/default';
import { SUBAGENT_GENERAL_AGENT_DEFINITION } from 'src/app-hosts/linnya/agent-registry/agents/subagent_general';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import type { ToolSchemaBuildRequest } from 'linnkit/runtime-kernel';

beforeEach(() => setPluginRuntimeStateForTests({ enabledPluginIds: ['platform'] }));
afterEach(() => clearPluginRuntimeStateForTests());

describe('command production exposure', () => {
  it('唯一 ToolRegistry 与 root/通用子 Agent 同时公开 shell/process', () => {
    toolRegistry.reinitialize();
    const input: ToolSchemaBuildRequest = {
      toolNames: ['shell', 'process'],
      invocation: { query: 'command exposure test', promptKey: 'default' },
    };
    const registered = toolRegistry.getToolSchemas(input)
      .map(schema => schema.function.name);
    expect(registered).toEqual(['shell', 'process']);
    expect(AGENT_DEFINITION.config?.availableTools).toEqual(
      expect.arrayContaining(['shell', 'process']),
    );
    expect(SUBAGENT_GENERAL_AGENT_DEFINITION.config?.availableTools).toEqual(
      expect.arrayContaining(['shell', 'process']),
    );
  });
});
