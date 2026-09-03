import { afterEach, describe, expect, it } from 'vitest';
import { BaseTool, type ToolContext, type ToolParameterSchema } from 'src/tools/types';
import { createGraphLoopHarness, type GraphLoopHarness } from 'src/app-hosts/linnya/testkit/agent-harness/graphLoopHarness';
import { assertions } from '@linnlabs/linnkit/testkit';

class TestRecordNoteTool extends BaseTool {
  readonly name = 'test_record_note';
  readonly description = '记录一条测试笔记。';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      note: {
        type: 'string',
        description: '要记录的文本。',
      },
    },
    required: ['note'],
  };

  async run(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
    const note = typeof args.note === 'string' ? args.note : '';
    return JSON.stringify({
      observation: `工具已记录：${note}`,
      data: {
        note,
      },
    });
  }
}

class TestCollectFactTool extends BaseTool {
  readonly name = 'test_collect_fact';
  readonly description = '记录一条事实。';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      fact: {
        type: 'string',
        description: '事实内容。',
      },
    },
    required: ['fact'],
  };

  async run(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
    const fact = typeof args.fact === 'string' ? args.fact : '';
    return JSON.stringify({
      observation: `事实已记录：${fact}`,
      data: { fact },
    });
  }
}

describe('Graph loop 集成测试', () => {
  let harness: GraphLoopHarness | undefined;

  afterEach(() => {
    harness?.restore();
    harness = undefined;
  });

  it('应真实跑通 LLM 决策 -> ToolNode 执行 -> 结果回灌 -> 最终答案', async () => {
    harness = createGraphLoopHarness({
      query: '请先记录一条笔记，再给出总结。',
      tools: [new TestRecordNoteTool()],
      turns: [
        {
          contentChunks: ['先做一轮分析。'],
          toolCalls: [
            {
              id: 'call_record_1',
              name: 'test_record_note',
              argumentsJson: '{"note":"第一条测试笔记"}',
            },
          ],
          assertCall: (call) => {
            assertions.expectMessagesContainText(call, '请先记录一条笔记，再给出总结。');
          },
        },
        {
          contentChunks: ['最终总结：已经成功记录测试笔记。'],
          assertCall: (call) => {
            // 中文备注：
            // - 第一轮 LLM 先输出了文本，再发起 tool call；
            // - wrapped sink 会在工具调用边界把这段文本结算为历史 final_answer；
            // - 第二轮必须能同时看到“工具前文本”和“tool_output”。
            assertions.expectMessagesContainText(call, '先做一轮分析。');
            assertions.expectToolOutputFedBackToHistory(call, '工具已记录：第一条测试笔记');

            const assistantFinalAnswerIndex = call.messages.findIndex(message =>
              message.role === 'assistant' &&
              message.parts.some(part => part.type === 'text' && part.text.includes('先做一轮分析。'))
            );
            const toolOutputIndex = call.messages.findIndex(message =>
              message.role === 'tool' &&
              message.content.some(block => block.type === 'text' &&
                block.text.includes('工具已记录：第一条测试笔记'))
            );

            // 中文备注：
            // - 第二轮 LLM 看到的历史顺序必须稳定；
            // - 工具前已结算的 assistant 答案必须先于 tool_output；
            // - 否则后续重构极易在回灌阶段把历史顺序打乱，造成行为回归。
            expect(assistantFinalAnswerIndex).toBeGreaterThanOrEqual(0);
            expect(toolOutputIndex).toBeGreaterThanOrEqual(0);
            expect(assistantFinalAnswerIndex).toBeLessThan(toolOutputIndex);
          },
        },
      ],
    });

    await harness.run();
    const sinkEvents = harness.getSinkRuntimeEvents();

    expect(
      sinkEvents.some(
        (event) => event.type === 'final_answer_chunk' && typeof event.content === 'string' && event.content.includes('最终总结')
      )
    ).toBe(true);
    expect(harness.getToolExecutions()).toHaveLength(1);
    expect(harness.getToolExecutions()[0]?.toolName).toBe('test_record_note');
    harness.assertAllTurnsConsumed();
  });

  it('同一轮多个 tool_calls 回灌到下一轮时，必须保持为单条 assistant.tool_calls + 多条 tool', async () => {
    harness = createGraphLoopHarness({
      query: '请一次调用多个工具收集事实，然后汇总。',
      tools: [new TestRecordNoteTool(), new TestCollectFactTool()],
      turns: [
        {
          toolCalls: [
            {
              id: 'call_note_1',
              name: 'test_record_note',
              argumentsJson: '{"note":"第一条测试笔记"}',
            },
            {
              id: 'call_fact_1',
              name: 'test_collect_fact',
              argumentsJson: '{"fact":"第二条测试事实"}',
            },
          ],
        },
        {
          contentChunks: ['最终总结：已经收集完成。'],
          assertCall: (call) => {
            const assistantToolMessages = call.messages.filter((message) => {
              return message.role === 'assistant'
                && message.parts.some(part => part.type === 'tool_call');
            });
            const toolMessages = call.messages.filter(message => message.role === 'tool');

            expect(assistantToolMessages).toHaveLength(1);
            expect(assistantToolMessages[0]?.role === 'assistant'
              ? assistantToolMessages[0].parts.filter(part => part.type === 'tool_call')
              : []).toHaveLength(2);
            expect(toolMessages).toHaveLength(2);
            expect(toolMessages.map(message => message.role === 'tool' ? message.tool_call_id : '')).toEqual([
              'call_note_1',
              'call_fact_1',
            ]);
            assertions.expectToolOutputFedBackToHistory(call, '工具已记录：第一条测试笔记');
            assertions.expectToolOutputFedBackToHistory(call, '事实已记录：第二条测试事实');
          },
        },
      ],
    });

    const result = await harness.run();
    const sinkEvents = harness.getSinkRuntimeEvents().filter((event) => event.type === 'tool_call_decision');

    expect(result.stepCount).toBe(4);
    expect(sinkEvents).toHaveLength(1);
    expect(harness.getToolExecutions().map((item) => item.toolName)).toEqual([
      'test_record_note',
      'test_collect_fact',
    ]);
    harness.assertAllTurnsConsumed();
  });

  it('provider 取消流时必须封口已产生的 thought，不能让历史恢复后继续显示为运行中', async () => {
    const controller = new AbortController();
    harness = createGraphLoopHarness({
      query: '执行一个会被用户中断的任务。',
      tools: [],
      signal: controller.signal,
      turns: [{
        thoughtDeltas: ['正在分析已经取得的材料。'],
        assertCall: () => controller.abort('user cancelled the foreground run'),
        throwAfterEvents: new Error('Stream cancelled by user'),
      }],
    });

    await expect(harness.run()).rejects.toThrow();
    const thoughtEvents = harness.getSinkRuntimeEvents().filter(event => event.type === 'thought');

    expect(thoughtEvents).toHaveLength(2);
    expect(thoughtEvents[0]).toMatchObject({
      type: 'thought',
      is_complete: false,
      delta: '正在分析已经取得的材料。',
    });
    expect(thoughtEvents[1]).toMatchObject({
      type: 'thought',
      thought_message_id: thoughtEvents[0]?.thought_message_id,
      is_complete: true,
      content: '正在分析已经取得的材料。',
    });
    harness.assertAllTurnsConsumed();
  });
});
