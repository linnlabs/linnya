import { describe, expect, it } from 'vitest';
import { resolveComposerRunAction } from './resolveComposerRunAction';
import type { InteractiveRunSnapshot } from '../definitions/interactiveRun';

describe('composer 的发送与原运行控制意图', () => {
  it('运行→暂停→继续；有草稿为发送，清空草稿不丢失继续入口', () => {
    const running: InteractiveRunSnapshot = { conversationId: 'conversation', status: 'running' };
    const paused: InteractiveRunSnapshot = {
      ...running,
      status: 'paused',
      pause: { settled: true, updatedAt: 2 },
    };
    const action = (run: InteractiveRunSnapshot, hasDraft = false) =>
      resolveComposerRunAction({ run, hasDraft, extensionStreaming: false });
    expect(action(running)).toBe('pause');
    expect(action({ ...running, status: 'pausing' })).toBe('waiting');
    expect(action(paused)).toBe('continue');
    expect(action(paused, true)).toBe('send');
    expect(action(paused)).toBe('continue');
    expect(action({ ...paused, status: 'continuing' })).toBe('waiting');
    expect(action({ ...paused, status: 'completed' })).toBe('send');
    expect(action({ ...paused, status: 'awaiting_user' })).toBe('cancel');
  });
});
