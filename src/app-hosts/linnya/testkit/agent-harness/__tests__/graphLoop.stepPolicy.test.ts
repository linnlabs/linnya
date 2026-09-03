import { afterEach, describe, expect, it } from 'vitest';
import { BaseTool, type ToolContext, type ToolParameterSchema } from 'src/tools/types';
import { createGraphLoopHarness, type GraphLoopHarness } from 'src/app-hosts/linnya/testkit/agent-harness/graphLoopHarness';
import { assertions } from 'linnkit/testkit';

class TestDraftTool extends BaseTool {
  readonly name = 'test_draft_tool';
  readonly description = '生成一个中间草稿。';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      topic: { type: 'string', description: '草稿主题。' },
    },
    required: ['topic'],
  };

  async run(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
    const topic = typeof args.topic === 'string' ? args.topic : '';
    return JSON.stringify({
      data: { topic },
      observation: `草稿已生成：${topic}`,
    });
  }
}

class TestCommitTool extends BaseTool {
  readonly name = 'test_commit_tool';
  readonly description = '提交最终结果。';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '最终摘要。' },
    },
    required: ['summary'],
  };

  async run(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
    const summary = typeof args.summary === 'string' ? args.summary : '';
    return JSON.stringify({
      data: { summary },
      observation: `最终提交：${summary}`,
      control: {
        terminateRun: true,
        reason: '测试最终产物已经提交',
      },
    });
  }
}

describe('Graph loop stepPolicy 集成测试', () => {
  let harness: GraphLoopHarness | undefined;

  afterEach(() => {
    harness?.restore();
    harness = undefined;
  });

  it('force_tools 应在仍能执行最终工具时收缩工具，并且不跳过 ToolNode', async () => {
    harness = createGraphLoopHarness({
      maxSteps: 4,
      tools: [new TestDraftTool(), new TestCommitTool()],
      executorLocalPatch: {
        finalStepPolicy: 'force_tools',
        finalStepForcedTools: ['test_commit_tool'],
      },
      turns: [
        {
          toolCalls: [
            {
              id: 'commit_call_1',
              name: 'test_commit_tool',
              argumentsJson: '{"summary":"收尾提交"}',
            },
          ],
          assertCall: (call) => {
            assertions.expectFinalStepForcedTools(call, 'test_commit_tool');
          },
        },
      ],
    });

    const result = await harness.run();

    expect(result.stepCount).toBe(3);
    expect(harness.getToolExecutions().map((item) => item.toolName)).toEqual(['test_commit_tool']);
    expect(result.checkpointNodeId).toBe('tool');
    harness.assertAllTurnsConsumed();
  });

  it('final_answer 应在只剩一个后续节点时提前禁用工具并直接回答', async () => {
    harness = createGraphLoopHarness({
      maxSteps: 3,
      tools: [new TestDraftTool()],
      executorLocalPatch: {
        finalStepPolicy: 'final_answer',
      },
      turns: [
        {
          contentChunks: ['预算边界前直接回答，不再调用工具。'],
          assertCall: (call) => {
            expect(call.options.tool_choice).toBe('none');
            expect(Array.isArray(call.options.tools) ? call.options.tools : []).toHaveLength(0);
          },
        },
      ],
    });

    const result = await harness.run();

    expect(result.stepCount).toBe(2);
    expect(harness.getToolExecutions()).toHaveLength(0);
    expect(result.events.some((event) => (
      event.type === 'final_answer'
      && event.content.includes('预算边界前直接回答')
    ))).toBe(true);
    harness.assertAllTurnsConsumed();
  });

  it('final_answer 应让边界前接受的多工具批次完整执行后再收尾', async () => {
    const toolCalls = Array.from({ length: 6 }, (_, index) => ({
      id: `draft_batch_call_${index + 1}`,
      name: 'test_draft_tool',
      argumentsJson: JSON.stringify({ topic: `草稿 ${index + 1}` }),
    }));
    harness = createGraphLoopHarness({
      maxSteps: 4,
      tools: [new TestDraftTool()],
      executorLocalPatch: {
        finalStepPolicy: 'final_answer',
      },
      turns: [
        { toolCalls },
        {
          contentChunks: ['全部六项工具结果已经回收。'],
          assertCall: (call) => {
            expect(call.options.tool_choice).toBe('none');
            expect(Array.isArray(call.options.tools) ? call.options.tools : []).toHaveLength(0);
          },
        },
      ],
    });

    const result = await harness.run();

    expect(result.stepCount).toBe(4);
    expect(harness.getToolExecutions().map((item) => item.toolName)).toEqual(
      Array.from({ length: 6 }, () => 'test_draft_tool'),
    );
    const outputs = result.events.filter((event) => event.type === 'tool_output');
    expect(outputs).toHaveLength(6);
    expect(result.events.some((event) => (
      event.type === 'final_answer'
      && event.content.includes('全部六项工具结果已经回收')
    ))).toBe(true);
    harness.assertAllTurnsConsumed();
  });
});
