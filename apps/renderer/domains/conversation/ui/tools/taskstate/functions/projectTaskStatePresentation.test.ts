import { describe, expect, it } from 'vitest';
import type {
  HistoricalTaskStateReadResult,
  HistoricalTaskStateWriteResult,
  TaskState,
  TaskStateReadResult,
  TaskStateWriteResult,
} from '@app/schemas';
import { projectTaskStatePresentation } from './projectTaskStatePresentation';

const taskstate: TaskState = {
  goal: '完成工具展示合同迁移',
  constraints: [],
  current_phase: 'execute',
  current_plan: ['迁移 projector'],
  progress: '正在迁移首批工具。',
  next_steps: ['运行语义门禁', '运行导航 E2E'],
  references: ['conversation-platform'],
};

const writeResult: HistoricalTaskStateWriteResult = {
  data: {
    source: 'shared_memory',
    operation: 'update',
    conversation_id: 'conv-taskstate',
    instance_id: 'instance-taskstate',
    doc_name: 'TaskState',
    uri: 'shared_memory://docs/TaskState.md',
    version: 3,
    taskstate,
  },
  observation: 'TaskState 已更新。',
};

const canonicalWriteResult: TaskStateWriteResult = {
  data: {
    operation: 'update',
    version: 3,
    taskstate,
  },
  observation: 'TaskState 已更新。',
};

describe('projectTaskStatePresentation', () => {
  it('loading 只校验 args，不读取尚不存在的 success result', () => {
    expect(projectTaskStatePresentation({
      sourceToolName: 'task_write',
      uiKey: 'task_write',
      args: taskstate,
      result: undefined,
      status: 'loading',
      phase: 'start',
    })).toMatchObject({
      data: { kind: 'lifecycle', operation: 'write' },
      title: { text: { key: 'conversation.tool.taskState.update' } },
    });
  });

  it('write success 将新工具 canonical 与旧工具 historical 结果投影为同一 snapshot', () => {
    for (const input of [
      {
        sourceToolName: 'task_write',
        uiKey: 'task_write',
        result: canonicalWriteResult,
      },
      {
        sourceToolName: 'taskstate_write',
        uiKey: 'taskstate_write',
        result: writeResult,
      },
    ]) {
      expect(projectTaskStatePresentation({
        sourceToolName: input.sourceToolName,
        uiKey: input.uiKey,
        args: taskstate,
        result: input.result,
        status: 'success',
        phase: 'complete',
      })).toMatchObject({
        data: {
          kind: 'snapshot',
          operation: 'write',
          version: 3,
          nextStepRows: [
            { id: '运行语义门禁', text: '运行语义门禁' },
            { id: '运行导航 E2E', text: '运行导航 E2E' },
          ],
        },
        title: {
          text: {
            key: 'conversation.tool.taskState.updateVersionPhase',
            params: { version: 3, phase: 'execute' },
          },
        },
      });
    }
  });

  it('新 task_read 使用 canonical 合同投影现有快照', () => {
    const result: TaskStateReadResult = {
      data: {
        exists: true,
        version: 3,
        taskstate,
      },
      observation: 'TaskState (v3) 已读取。',
    };

    expect(projectTaskStatePresentation({
      sourceToolName: 'task_read',
      uiKey: 'task_read',
      args: {},
      result,
      status: 'success',
      phase: 'complete',
    })).toMatchObject({
      data: {
        kind: 'snapshot',
        operation: 'read',
        version: 3,
      },
      title: {
        text: {
          key: 'conversation.tool.taskState.readVersion',
          params: { version: 3 },
        },
      },
    });
  });

  it('旧 read missing 保留历史空状态，新工具收到旧合同或非法结果时明确失败', () => {
    const missing: HistoricalTaskStateReadResult = {
      data: {
        exists: false,
        conversation_id: 'conv-taskstate',
        instance_id: 'instance-taskstate',
        doc_name: 'TaskState',
      },
      observation: 'TaskState 文档不存在。',
    };
    expect(projectTaskStatePresentation({
      sourceToolName: 'taskstate_read',
      uiKey: 'taskstate_read',
      args: {},
      result: missing,
      status: 'success',
      phase: 'complete',
    })).toMatchObject({
      data: { kind: 'missing', operation: 'read' },
      title: { text: { key: 'conversation.tool.taskState.readMissing' } },
    });

    expect(() => projectTaskStatePresentation({
      sourceToolName: 'task_read',
      uiKey: 'task_read',
      args: {},
      result: missing,
      status: 'success',
      phase: 'complete',
    })).toThrow();

    expect(() => projectTaskStatePresentation({
      sourceToolName: 'task_read',
      uiKey: 'task_read',
      args: {},
      result: { data: { exists: true } },
      status: 'success',
      phase: 'complete',
    })).toThrow();
  });
});
