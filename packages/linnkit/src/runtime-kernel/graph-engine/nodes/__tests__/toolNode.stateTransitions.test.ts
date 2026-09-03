import { describe, expect, it } from 'vitest';
import {
  applyToolOutputIdempotencyMetadata,
  buildErrorLocalState,
  buildRequireUserLocalState,
  buildSuccessLocalState,
  extractToolControlInfo,
  readStructuredObservation,
  validateStructuredToolResultContract,
} from '../toolNode.stateTransitions';
import { createToolOutputEvent, createUserInputEvent, ToolCallIdSchema } from '../../../../contracts';

function createHistoryEvent(id: string) {
  return createUserInputEvent(id, 'conv_1', 'turn_1', `content:${id}`);
}

describe('toolNode.stateTransitions', () => {
  it('应提取 structuredObservation 与 tool control', () => {
    const parsed = {
      observation: 'hello',
      control: {
        requireUser: true,
        questionnaireId: 'q_1',
        resumeStrategy: 'continue',
        finalAnswer: 'final report',
      },
    };

    expect(readStructuredObservation(parsed)).toBe('hello');
    expect(extractToolControlInfo(parsed)).toEqual({
      requireUser: true,
      questionnaireId: 'q_1',
      resumeStrategy: 'continue',
      finalAnswer: 'final report',
    });
  });

  it('应强制校验 data 与非空 observation', () => {
    expect(
      validateStructuredToolResultContract({ data: { ok: true }, observation: '完成' })
    ).toEqual({
      ok: true,
      result: { data: { ok: true }, observation: '完成' },
      observation: '完成',
    });
    expect(validateStructuredToolResultContract({ data: { ok: true } })).toEqual({
      ok: false,
      reason: '工具成功结果缺少非空字符串 observation。',
    });
    expect(validateStructuredToolResultContract({ observation: '完成' })).toEqual({
      ok: false,
      reason: '工具成功结果缺少必填字段 data。',
    });
    expect(validateStructuredToolResultContract('plain text')).toEqual({
      ok: false,
      reason: '工具成功结果必须是 JSON 对象。',
    });
  });

  it('应严格校验有序 modelInput selections', () => {
    const valid = {
      data: { ok: true },
      observation: '已读取图片',
      modelInput: {
        attachments: [
          { id: 'selection_1', uri: 'asset://assets/asset_1', label: 'diagram.png' },
          { id: 'selection_2', uri: 'asset://assets/asset_1' },
        ],
      },
    };

    expect(validateStructuredToolResultContract(valid)).toEqual({
      ok: true,
      result: valid,
      observation: '已读取图片',
      modelInputAttachments: valid.modelInput.attachments,
    });

    expect(
      validateStructuredToolResultContract({
        ...valid,
        modelInput: {
          attachments: [
            { id: 'selection_1', uri: 'asset://assets/asset_1' },
            { id: 'selection_1', uri: 'asset://assets/asset_2' },
          ],
        },
      })
    ).toEqual({
      ok: false,
      reason: 'modelInput attachment selection id 重复: selection_1',
    });

    expect(
      validateStructuredToolResultContract({
        ...valid,
        modelInput: {
          attachments: [
            { id: 'selection_1', uri: 'asset://assets/asset_1', path: '/tmp/image.png' },
          ],
        },
      })
    ).toEqual({
      ok: false,
      reason: 'modelInput.attachments[0] 必须是 strict selection。',
    });
  });

  it('应把 idempotency 状态写入 canonical tool_output', () => {
    const runtimeEvent = createToolOutputEvent(
      'output-1',
      'conv-1',
      'turn-1',
      'search',
      'call-1',
      { status: 'success', observation: 'done', data: { ok: true } },
    );
    applyToolOutputIdempotencyMetadata({
      runtimeToolOutput: runtimeEvent,
      execIdempotency: { key: 'idem_1', cacheHit: true },
    });

    expect(runtimeEvent.ephemeral).toBe(true);
    expect(runtimeEvent.metadata).toEqual({
      idempotency: { key: 'idem_1', cache_hit: true },
    });
  });

  it('应构造 requireUser local state', () => {
    const parsed = {
      data: { form: true },
      control: { requireUser: true, question: '继续吗？' },
    };

    const nextLocal = buildRequireUserLocalState({
      local: { history: [createHistoryEvent('h1')] },
      parsed,
      toolCallId: ToolCallIdSchema.parse('call_1'),
      toolName: 'interactive_form',
      remainingCalls: [],
      conversationId: 'conv_1',
      turnId: 'turn_1',
      runtimeEvents: [createHistoryEvent('evt_1')],
    });

    expect(nextLocal.pendingInteractionSpec).toEqual({
      requireUser: true,
      question: '继续吗？',
      form: parsed,
      toolCallId: 'call_1',
      toolName: 'interactive_form',
    });
    expect(nextLocal.history as unknown[]).toHaveLength(2);
  });

  it('应支持无 questionnaireId 的 requireUser 工具进入 wait_user', () => {
    const parsed = {
      data: { title: 'Deck Plan', pageCount: 3 },
      control: { requireUser: true, resumeStrategy: 'continue' },
    };

    expect(extractToolControlInfo(parsed)).toEqual({
      requireUser: true,
      resumeStrategy: 'continue',
    });

    const nextLocal = buildRequireUserLocalState({
      local: { history: [] },
      parsed,
      toolCallId: ToolCallIdSchema.parse('call_ppt_plan_1'),
      toolName: 'ppt_plan',
      remainingCalls: [],
      conversationId: 'conv_1',
      turnId: 'turn_1',
      runtimeEvents: [],
    });

    expect(nextLocal.pendingInteractionSpec).toEqual({
      requireUser: true,
      resumeStrategy: 'continue',
      form: parsed,
      toolCallId: 'call_ppt_plan_1',
      toolName: 'ppt_plan',
    });
  });

  it('应构造 success / error local state，并在 error=0 时清除旧 protocol 计数', () => {
    const successLocal = buildSuccessLocalState({
      local: {
        answerId: 'ans_1',
        chunkSeq: 4,
        history: [createHistoryEvent('h1')],
      },
      remainingCalls: ['next'],
      conversationId: 'conv_1',
      turnId: 'turn_1',
      runtimeEvents: [createHistoryEvent('evt_1')],
    });

    expect('answerId' in successLocal).toBe(false);
    expect('chunkSeq' in successLocal).toBe(false);
    expect(successLocal.pendingToolCalls).toEqual(['next']);

    const errorLocal = buildErrorLocalState({
      local: {
        _consecutiveToolProtocolErrors: 3,
        history: [createHistoryEvent('h1')],
      },
      remainingCalls: [],
      conversationId: 'conv_1',
      turnId: 'turn_1',
      runtimeEvents: [createHistoryEvent('evt_2')],
      nextProtocolErrorCount: 0,
    });

    expect('_consecutiveToolProtocolErrors' in errorLocal).toBe(false);
    expect(errorLocal.history as unknown[]).toHaveLength(2);
  });
});
