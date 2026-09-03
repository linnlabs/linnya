import { describe, expect, it, vi } from 'vitest';

import type { RuntimeEvent } from '../../../../contracts';
import { EventBus } from '../../../execution/event-bus';
import { createAwaitingUserWatcher } from '../awaitingUserWatcher';
import { RunIdSchema, ToolCallIdSchema } from '../../../../contracts';

type RequiresUserInteractionEvent = Extract<RuntimeEvent, { type: 'requires_user_interaction' }>;

function createWaitUserEvent(runId: string, prompt = '需要用户确认'): RequiresUserInteractionEvent {
  return {
    type: 'requires_user_interaction',
    id: 'wait-1',
    conversation_id: 'conv-1',
    turn_id: 'turn-1',
    timestamp: 100,
    version: 1,
    prompt,
    interaction_id: 'wait-1',
    run_id: RunIdSchema.parse(runId),
    lane: 'foreground',
    visibility: 'conversation',
    tool_call_id: ToolCallIdSchema.parse('tool-1'),
    checkpoint_revision: 2,
    resume_token: 'resume-1',
    interaction_status: 'pending',
  };
}

function publish(eventBus: EventBus, event: RuntimeEvent): void {
  eventBus.publish({
    seq: 1,
    timestamp: event.timestamp,
    trace: { execution_id: eventBus.executionId },
    source: 'test',
    payload: event,
  });
}

describe('awaitingUserWatcher', () => {
  it('requires_user_interaction 会触发对应 run 的 awaiting_user 写入', () => {
    const markAwaitingUser = vi.fn(async () => undefined);
    const watcher = createAwaitingUserWatcher({ markAwaitingUser });
    const eventBus = new EventBus('exec-1');

    watcher.watch(RunIdSchema.parse('run-1'), eventBus);
    publish(eventBus, createWaitUserEvent('run-1'));

    expect(markAwaitingUser).toHaveBeenCalledWith('run-1', {
      currentNode: 'wait_user',
      eventId: 'wait-1',
      reason: '需要用户确认',
      interaction: {
        interactionId: 'wait-1',
        toolCallId: 'tool-1',
        checkpointRevision: 2,
        resumeToken: 'resume-1',
      },
    });
  });

  it('过滤其它 runId 的 requires_user_interaction 事件', () => {
    const markAwaitingUser = vi.fn(async () => undefined);
    const watcher = createAwaitingUserWatcher({ markAwaitingUser });
    const eventBus = new EventBus('exec-1');

    watcher.watch(RunIdSchema.parse('run-1'), eventBus);
    publish(eventBus, createWaitUserEvent('run-2'));

    expect(markAwaitingUser).not.toHaveBeenCalled();
  });

  it('prompt 缺失时从 form.prompt 读取 reason', () => {
    const markAwaitingUser = vi.fn(async () => undefined);
    const watcher = createAwaitingUserWatcher({ markAwaitingUser });
    const eventBus = new EventBus('exec-1');
    const event: RequiresUserInteractionEvent = {
      ...createWaitUserEvent('run-1', ''),
      form: {
        prompt: '表单提示',
      },
    };

    watcher.watch(RunIdSchema.parse('run-1'), eventBus);
    publish(eventBus, event);

    expect(markAwaitingUser).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        reason: '表单提示',
      })
    );
  });

  it('EventBus close 后 watcher 不再触发', () => {
    const markAwaitingUser = vi.fn(async () => undefined);
    const onDisposed = vi.fn();
    const watcher = createAwaitingUserWatcher({ markAwaitingUser, onDisposed });
    const eventBus = new EventBus('exec-1');

    watcher.watch(RunIdSchema.parse('run-1'), eventBus);
    eventBus.close();
    publish(eventBus, createWaitUserEvent('run-1'));

    expect(markAwaitingUser).not.toHaveBeenCalled();
    expect(onDisposed).toHaveBeenCalledTimes(1);
    expect(onDisposed).toHaveBeenCalledWith('run-1');
  });

  it('重复 dispose 只触发一次 onDisposed', () => {
    const markAwaitingUser = vi.fn(async () => undefined);
    const onDisposed = vi.fn();
    const watcher = createAwaitingUserWatcher({ markAwaitingUser, onDisposed });
    const eventBus = new EventBus('exec-1');

    const dispose = watcher.watch(RunIdSchema.parse('run-1'), eventBus);
    dispose();
    dispose();

    expect(onDisposed).toHaveBeenCalledTimes(1);
  });
});
