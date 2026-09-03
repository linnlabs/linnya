import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubagentResultSchema } from '@app/schemas';
import { createToolContextFixture } from '@linnlabs/linnkit/testkit';

import type { AgentDefinition } from 'src/app-hosts/linnya/agent-registry/types';
import {
  createChildRunHarness,
  type ChildRunHarness,
} from 'src/app-hosts/linnya/testkit/agent-harness/childRunHarness';
import { BaseTool, type ToolContext, type ToolParameterSchema } from 'src/tools/types';
import { SubagentTool } from '../subagentTool';

const { TEST_AGENT_DEFINITION } = vi.hoisted(() => ({
  TEST_AGENT_DEFINITION: {
    id: 'subagent_general_test',
    promptKey: 'subagent_general',
    defaultMode: 'agent',
    description: '测试通用子 Agent',
    config: {
      enableTools: true,
      availableTools: ['write_file'],
    },
    task: {
      systemPromptBuilder: () => '你是一个测试用通用子 Agent。',
    },
  } satisfies AgentDefinition,
}));

vi.mock('src/app-hosts/linnya/agent-registry/agents', () => ({
  ALL_AGENT_DEFINITIONS_FOR_TESTS: [TEST_AGENT_DEFINITION],
}));

class TestWorkspaceWriteTool extends BaseTool {
  readonly name = 'write_file';
  readonly description = '写入测试 Workspace 文档。';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: { path: { type: 'string', description: '项目路径' } },
    required: ['path'],
  };

  async run(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
    const path = typeof args.path === 'string' ? args.path : '/recovered.md';
    return JSON.stringify({
      observation: `已写入 Workspace：${path}`,
      data: {
        inode: 'workspace:recovered',
        path,
        operation: 'create',
      },
    });
  }
}

describe('SubagentTool failure recovery integration', () => {
  let childRunHarness: ChildRunHarness | undefined;

  afterEach(() => {
    childRunHarness?.restore();
    childRunHarness = undefined;
  });

  it('child 写入 Workspace 后失败时，仍以正式 inode 返回 partial 结果', async () => {
    childRunHarness = createChildRunHarness({
      agentDefinitions: [TEST_AGENT_DEFINITION],
      tools: [new TestWorkspaceWriteTool()],
      turns: [
        {
          toolCalls: [{
            id: 'subagent_call_1',
            name: 'write_file',
            argumentsJson: '{"path":"/recovered.md"}',
          }],
        },
        {},
        {},
        {},
        {},
      ],
    });

    const output = await new SubagentTool().run(
      {
        description: '失败恢复测试',
        prompt: '先写入 Workspace，再继续总结。',
      },
      createToolContextFixture({
        conversationId: 'conv_parent',
        turnId: 'turn_parent',
        patch: {
          modelId: 'scripted-test-model',
          runId: 'run_parent',
          parentToolCallId: 'call_subagent',
          createSubRunTracePublisher: () => ({ publish: vi.fn() }),
          registeredChildRunInvoker: childRunHarness.invoker,
        },
      }),
    );
    const parsed = SubagentResultSchema.parse(JSON.parse(output));

    expect(parsed.data.status).toBe('partial');
    expect(parsed.data.error).toBe('LLM返回了空响应');
    expect(parsed.data.artifacts).toEqual(['workspace:recovered']);
    expect(parsed.observation).toContain('artifacts=workspace:recovered');
    expect(childRunHarness.getToolExecutions()).toHaveLength(1);
    childRunHarness.assertAllTurnsConsumed();
  });
});
