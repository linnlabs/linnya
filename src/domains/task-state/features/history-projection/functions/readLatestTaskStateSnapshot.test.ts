import { describe, expect, it } from 'vitest';
import type { TaskState } from '@app/schemas';
import {
  createToolCallDecisionEvent,
  createToolOutputEvent,
  RunIdSchema,
  type RuntimeEvent,
  type SerializableJsonValue,
} from '@linnlabs/linnkit/contracts';

import { readLatestTaskStateSnapshot } from './readLatestTaskStateSnapshot';

const taskstate: TaskState = {
  goal: '验证 TaskState 历史投影',
  constraints: [],
  current_phase: 'verify',
  current_plan: ['核对正式工具事实'],
  progress: '正在验证。',
  next_steps: ['完成验证'],
  references: ['workspace:/src/domains/task-state'],
};

function decision(toolName: string, toolCallId: string, id: string): RuntimeEvent {
  return createToolCallDecisionEvent(
    `decision-${id}`,
    'conversation-1',
    'turn-1',
    toolName,
    toolCallId,
    { run_id: RunIdSchema.parse('run-1') },
  );
}

function successOutput(params: {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly id: string;
  readonly data: SerializableJsonValue;
}): RuntimeEvent {
  return createToolOutputEvent(
    `output-${params.id}`,
    'conversation-1',
    'turn-1',
    params.toolName,
    params.toolCallId,
    { status: 'success', observation: 'TaskState fixture', data: params.data },
    { run_id: RunIdSchema.parse('run-1') },
  );
}

function taskWritePair(version: number, id: string): RuntimeEvent[] {
  const toolCallId = `call-${id}`;
  return [
    decision('task_write', toolCallId, id),
    successOutput({
      toolName: 'task_write',
      toolCallId,
      id,
      data: { operation: version === 1 ? 'create' : 'update', version, taskstate },
    }),
  ];
}

describe('readLatestTaskStateSnapshot', () => {
  it('只依赖传入的 admitted history，重启可恢复且编辑重发会随分支回退', () => {
    const version1 = taskWritePair(1, 'branch-v1');
    const version2CallId = 'call-branch-v2';
    const version2 = [
      decision('task_write', version2CallId, 'branch-v2'),
      successOutput({
        toolName: 'task_write',
        toolCallId: version2CallId,
        id: 'branch-v2',
        data: {
          operation: 'update',
          version: 2,
          taskstate: { ...taskstate, progress: '旧分支第二版。' },
        },
      }),
    ];

    expect(readLatestTaskStateSnapshot([...version1, ...version2])).toMatchObject({
      version: 2,
      taskstate: { progress: '旧分支第二版。' },
    });

    // 应用重启只是重新投影同一 admitted history；编辑重发截断旧分支后则只能看到 v1。
    expect(readLatestTaskStateSnapshot([...version1])?.version).toBe(1);
  });

  it('裸 output、错配 call id、失败结果和旧工具名不能伪造状态', () => {
    const fakeData = { operation: 'update', version: 99, taskstate };
    const history = [
      ...taskWritePair(1, 'valid'),
      successOutput({
        toolName: 'task_write',
        toolCallId: 'call-without-decision',
        id: 'bare',
        data: fakeData,
      }),
      decision('task_write', 'call-other', 'wrong'),
      successOutput({
        toolName: 'task_write',
        toolCallId: 'call-mismatch',
        id: 'wrong',
        data: fakeData,
      }),
      decision('taskstate_write', 'call-legacy', 'legacy'),
      successOutput({
        toolName: 'taskstate_write',
        toolCallId: 'call-legacy',
        id: 'legacy',
        data: fakeData,
      }),
      createToolOutputEvent(
        'output-error',
        'conversation-1',
        'turn-1',
        'task_write',
        'call-error',
        { status: 'error', observation: '写入失败。', error: 'failed' },
        { run_id: RunIdSchema.parse('run-1') },
      ),
    ];
    expect(readLatestTaskStateSnapshot(history)?.version).toBe(1);
  });

  it('相同 tool_call_id 不能跨 run 配对', () => {
    const callId = 'call-cross-run';
    const history = [
      ...taskWritePair(1, 'valid'),
      createToolCallDecisionEvent(
        'decision-other-run',
        'conversation-1',
        'turn-2',
        'task_write',
        callId,
        { run_id: RunIdSchema.parse('run-other') },
      ),
      successOutput({
        toolName: 'task_write',
        toolCallId: callId,
        id: 'current-run-output',
        data: { operation: 'update', version: 99, taskstate },
      }),
    ];

    expect(readLatestTaskStateSnapshot(history)?.version).toBe(1);
  });

  it('最新已配对事实损坏时明确失败，不回退旧快照', () => {
    const history = [
      ...taskWritePair(1, 'valid'),
      decision('task_write', 'call-broken', 'broken'),
      successOutput({
        toolName: 'task_write',
        toolCallId: 'call-broken',
        id: 'broken',
        data: { operation: 'update', version: 2 },
      }),
    ];
    expect(() => readLatestTaskStateSnapshot(history)).toThrow();
  });
});
