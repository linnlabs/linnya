import { describe, expect, it } from 'vitest';
import { resolveComposerRunControl } from './resolveComposerRunControl';
import type { InteractiveRunSnapshot } from '../definitions/interactiveRun';

describe('composer 的三个公开动作', () => {
  it('运行→暂停→恢复，有草稿始终表达发送意图', () => {
    const running: InteractiveRunSnapshot = {
      conversationId: 'conversation',
      runId: 'run',
      executionId: 'execution',
      status: 'running',
    };
    const paused: InteractiveRunSnapshot = {
      ...running,
      status: 'paused',
      pause: { settled: true, updatedAt: 2 },
    };
    const control = (run: InteractiveRunSnapshot, hasDraft = false) =>
      resolveComposerRunControl({ run, hasDraft, extensionStreaming: false });
    expect(control(running)).toEqual({ action: 'pause', disabled: false });
    expect(control({ ...running, status: 'pausing' })).toEqual({
      action: 'resume',
      disabled: true,
    });
    expect(control(paused)).toEqual({ action: 'resume', disabled: false });
    expect(control(paused, true)).toEqual({ action: 'send', disabled: false });
    expect(control({ ...paused, pause: { settled: false, updatedAt: 2 } })).toEqual({
      action: 'resume',
      disabled: true,
    });
    expect(control({ ...paused, status: 'continuing' })).toEqual({
      action: 'pause',
      disabled: true,
    });
    expect(control({ ...paused, status: 'reconnecting' })).toEqual({
      action: 'pause',
      disabled: true,
    });
    expect(control({ ...paused, status: 'completed' })).toEqual({
      action: 'send',
      disabled: false,
    });
    // 审批需要在表单提交，不能通过恢复按钮绕过；也不再暴露终止按钮。
    expect(control({ ...paused, status: 'awaiting_user' })).toEqual({
      action: 'resume',
      disabled: true,
    });
  });

  it('尚无控制身份、以及只支持取消的扩展不提供可点击的暂停', () => {
    expect(
      resolveComposerRunControl({
        hasDraft: false,
        extensionStreaming: false,
        run: { conversationId: 'conversation', status: 'starting' },
      })
    ).toEqual({ action: 'pause', disabled: true });
    expect(resolveComposerRunControl({ hasDraft: false, extensionStreaming: true })).toEqual({
      action: 'pause',
      disabled: true,
    });
  });
});
