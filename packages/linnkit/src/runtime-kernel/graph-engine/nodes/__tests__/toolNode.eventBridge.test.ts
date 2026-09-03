import { describe, expect, it } from 'vitest';
import { routeRuntimeEvent, type RuntimeEvent, ToolCallIdSchema } from '../../../../contracts';
import { ToolNodeEventBridge } from '../toolNode.eventBridge';

function createSubject(publishError?: Error) {
  const published: RuntimeEvent[] = [];
  const identity = {
    run_id: 'run_tool',
    lane: 'foreground' as const,
    visibility: 'conversation' as const,
  };
  const bridge = new ToolNodeEventBridge({
    runtimeEventSink: event => {
      if (publishError) throw publishError;
      const routed = routeRuntimeEvent(event, identity);
      published.push(routed);
      return routed;
    },
    conversationId: 'conv_tool',
    turnId: 'turn_tool',
    toolName: 'search',
    toolCallId: ToolCallIdSchema.parse('call_1'),
    toolArgs: { query: 'hello' },
    idempotencyKey: 'idem_1',
  });
  return { bridge, published };
}

describe('ToolNodeEventBridge runtime facts', () => {
  it('映射、附加幂等身份、发布后只写入一次 journal', () => {
    const { bridge, published } = createSubject();
    bridge.emitToolProcess('start', 'loading', { args: { query: 'hello' } });
    bridge.emitToolOutput(
      { status: 'success', observation: 'search done', data: { ok: true } },
      {
        metadata: { artifact: { id: 'asset_1' } },
      }
    );

    expect(published).toHaveLength(2);
    expect(published[0]).toMatchObject({
      type: 'tool_process',
      run_id: 'run_tool',
      metadata: { idempotency: { key: 'idem_1' } },
    });
    expect(published[1]).toMatchObject({
      type: 'tool_output',
      run_id: 'run_tool',
      observation: 'search done',
      data: { ok: true },
      metadata: { artifact: { id: 'asset_1' } },
    });
    expect(bridge.getRuntimeEvents()).toEqual(published);
  });

  it('工具正文带首尾换行时仍能发布正式 tool_output', () => {
    const { bridge, published } = createSubject();

    bridge.emitToolProcess('start', 'loading', { args: { query: 'hello' } });
    bridge.emitToolOutput({
      status: 'success',
      observation: '\nsearch result\n',
      data: { ok: true },
    });

    expect(published.at(-1)).toMatchObject({
      type: 'tool_output',
      observation: '\nsearch result\n',
      status: 'success',
    });
  });

  it('工具业务错误码随失败事实进入正式 tool_output', () => {
    const { bridge, published } = createSubject();

    bridge.emitToolOutput({
      status: 'error',
      observation: 'image model missing',
      error: 'image model missing',
      error_code: 'image_generation.model_not_configured',
    });

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: 'tool_output',
      status: 'error',
      error_code: 'image_generation.model_not_configured',
    });
  });

  it('publisher 失败必须传播，失败事实不能进入 journal', () => {
    const publishError = new Error('publisher unavailable');
    const { bridge } = createSubject(publishError);
    expect(() => bridge.emitToolProcess('start', 'loading', {})).toThrow(publishError);
    expect(bridge.getRuntimeEvents()).toEqual([]);
  });

  it('工具终止 run 的完整答案共用 chunk live 链与 durable final_answer 链', () => {
    const { bridge, published } = createSubject();

    bridge.emitFinalAnswer({ answer: '工具最终报告', sourceToolName: 'write_report' });

    expect(published.map(event => event.type)).toEqual(['final_answer_chunk', 'final_answer']);
    expect(published[0]).toMatchObject({
      seq: 0,
      content: '工具最终报告',
      is_last: true,
      ephemeral: true,
    });
    expect(published[1]).toMatchObject({
      content: '工具最终报告',
    });
    const chunk = published[0];
    const finalAnswer = published[1];
    if (chunk?.type !== 'final_answer_chunk' || finalAnswer?.type !== 'final_answer') {
      throw new Error('工具终答必须按 chunk → final_answer 顺序发布');
    }
    expect(chunk.answer_id).toBe(finalAnswer.answer_id);
    expect(finalAnswer.id).toBe(finalAnswer.answer_id);
    expect(bridge.getRuntimeEvents()).toEqual(published);
  });
});
