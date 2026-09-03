import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromptKeys } from '@app/schemas';
import type { AgentDefinition } from 'src/app-hosts/linnya/agent-registry/types';
import { BaseTool, type ToolContext, type ToolParameterSchema } from 'src/tools/types';
import {
  createToolContextFixture,
  expectMessagesContainText,
  expectToolOutputFedBackToHistory,
} from '@linnlabs/linnkit/testkit';
import {
  createChildRunHarness,
  type ChildRunHarness,
} from 'src/app-hosts/linnya/testkit/agent-harness/childRunHarness';
import { runRegisteredSubagent } from '../subagentRunner';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { createToolOutputEvent } from '@linnlabs/linnkit/contracts';

const { TEST_AGENT_DEFINITION } = vi.hoisted(() => ({
  TEST_AGENT_DEFINITION: {
    id: 'default',
    promptKey: 'default',
    defaultMode: 'agent',
    description: '测试子 agent',
    config: {
      enableTools: true,
      availableTools: ['test_subagent_echo'],
      modelPolicy: { kind: 'inherit_parent' },
    },
    task: {
      systemPromptBuilder: () => '你是一个测试用子 agent。',
    },
  },
})) as { TEST_AGENT_DEFINITION: AgentDefinition };

vi.mock('src/app-hosts/linnya/agent-registry/agents', () => ({
  ALL_AGENT_DEFINITIONS_FOR_TESTS: [TEST_AGENT_DEFINITION],
}));

vi.mock('src/app-hosts/linnya/agent-registry/agents', () => ({
  ALL_AGENT_DEFINITIONS_FOR_TESTS: [TEST_AGENT_DEFINITION],
}));

class TestSubagentEchoTool extends BaseTool {
  readonly name = 'test_subagent_echo';
  readonly description = '返回一条测试回声。';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: '需要回显的文本。',
      },
    },
    required: ['text'],
  };

  async run(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
    const text = typeof args.text === 'string' ? args.text : '';
    return JSON.stringify({
      observation: `子 agent 工具输出：${text}`,
      data: { text },
    });
  }
}

function buildRuntimeEvent(params: {
  type: RuntimeEvent['type'];
  id: string;
  content?: string;
  output?: string;
}): RuntimeEvent {
  if (params.type === 'tool_output') {
    return createToolOutputEvent(
      params.id,
      'conv_parent',
      'turn_parent',
      'ignored_parent_tool',
      'ignored_parent_call',
      { status: 'success', observation: params.output ?? '', data: {} }
    );
  }

  if (params.type === 'final_answer') {
    return {
      type: 'final_answer',
      id: params.id,
      conversation_id: 'conv_parent',
      turn_id: 'turn_parent',
      timestamp: Date.now(),
      version: 1,
      answer_id: params.id,
      content: params.content ?? '',
      is_complete: true,
      completion_reason: 'terminal',
    };
  }

  return {
    type: 'user_input',
    id: params.id,
    conversation_id: 'conv_parent',
    turn_id: 'turn_parent',
    timestamp: Date.now(),
    version: 1,
    source: 'user',
    content: params.content ?? '',
  };
}

describe('subagentRunner 集成测试', () => {
  let childRunHarness: ChildRunHarness | undefined;

  afterEach(() => {
    childRunHarness?.restore();
    childRunHarness = undefined;
  });

  it('应真实跑通 seed history 注入、子工具执行与结果回灌', async () => {
    childRunHarness = createChildRunHarness({
      agentDefinitions: [TEST_AGENT_DEFINITION],
      tools: [new TestSubagentEchoTool()],
      turns: [
        {
          toolCalls: [
            {
              id: 'subagent_call_1',
              name: 'test_subagent_echo',
              argumentsJson: '{"text":"来自子任务的回声"}',
            },
          ],
          assertCall: call => {
            expectMessagesContainText(call, '最近父问题');
            expectMessagesContainText(call, '最近父回答');

            const pollutedByParentToolOutput = call.messages.some(message => {
              if (!message || typeof message !== 'object') return false;
              const record = message as Record<string, unknown>;
              return typeof record.content === 'string' && record.content.includes('父工具噪音');
            });
            expect(pollutedByParentToolOutput).toBe(false);
          },
        },
        {
          contentChunks: ['子任务已经完成，最终答案可直接返回给父 agent。'],
          assertCall: call => {
            expectToolOutputFedBackToHistory(call, '子 agent 工具输出：来自子任务的回声');
          },
        },
      ],
    });

    const historyEvents: RuntimeEvent[] = [
      buildRuntimeEvent({ type: 'user_input', id: 'u_old', content: '更早的父问题' }),
      buildRuntimeEvent({ type: 'final_answer', id: 'a_old', content: '更早的父回答' }),
      buildRuntimeEvent({ type: 'tool_output', id: 'tool_noise', output: '父工具噪音' }),
      buildRuntimeEvent({ type: 'user_input', id: 'u_recent', content: '最近父问题' }),
      buildRuntimeEvent({ type: 'final_answer', id: 'a_recent', content: '最近父回答' }),
    ];

    const context = createToolContextFixture({
      conversationId: 'conv_parent',
      turnId: 'turn_parent',
      historyEvents,
      patch: {
        modelId: 'scripted-test-model',
        runId: 'run_parent',
        parentToolCallId: 'call_parent',
        createSubRunTracePublisher: () => ({ publish: vi.fn() }),
        registeredChildRunInvoker: childRunHarness.invoker,
      },
    });

    const result = await runRegisteredSubagent({
      context,
      promptKey: PromptKeys.DEFAULT,
      description: '测试子任务',
      userMessage: '请帮我执行一个子任务',
      inheritTurns: 1,
      maxSteps: 8,
      subrunSource: 'test:subagent-runner',
      subrunMetadata: { suite: 'integration' },
    });

    expect(result.success).toBe(true);
    expect(childRunHarness.getToolExecutions()).toHaveLength(1);
    expect(childRunHarness.getToolExecutions()[0]?.toolName).toBe('test_subagent_echo');
    childRunHarness.assertAllTurnsConsumed();
  });
});
