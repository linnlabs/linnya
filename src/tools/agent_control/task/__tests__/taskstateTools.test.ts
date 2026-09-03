import { describe, expect, it } from 'vitest';
import {
  TaskStateReadResultSchema,
  TaskStateWriteResultSchema,
  type TaskStateWriteResult,
} from '@app/schemas';
import {
  createToolCallDecisionEvent,
  createToolOutputEvent,
  RunIdSchema,
  type RuntimeEvent,
} from '@linnlabs/linnkit/contracts';

import { taskStateToolClasses } from '..';
import { TaskReadTool } from '../taskReadTool';
import { TaskWriteTool } from '../taskWriteTool';
import type { ToolContext } from '../../../types';

const validArgs = {
  goal: '完成 TaskState 事件真源迁移',
  constraints: ['不新增状态表'],
  current_phase: 'execute',
  current_plan: ['投影正式工具事实', '验证编辑重发语义'],
  progress: '已完成领域边界设计。',
  next_steps: ['完成工具迁移', '运行回归'],
  references: ['workspace:/src/domains/task-state/README.md'],
};

function makeContext(history: ReadonlyArray<RuntimeEvent> = []): ToolContext {
  return {
    conversationView: {
      getWorkingHistoryEvents: () => history,
      getPersistedHistoryEvents: () => history,
    },
  };
}

function pairedTaskWriteFact(
  result: TaskStateWriteResult,
  id: string,
): RuntimeEvent[] {
  const toolCallId = `call-${id}`;
  return [
    createToolCallDecisionEvent(
      `decision-${id}`,
      'conversation-1',
      'turn-1',
      'task_write',
      toolCallId,
      { args: validArgs, run_id: RunIdSchema.parse('run-1') },
    ),
    createToolOutputEvent(
      `output-${id}`,
      'conversation-1',
      'turn-1',
      'task_write',
      toolCallId,
      { status: 'success', observation: result.observation, data: result.data },
      { run_id: RunIdSchema.parse('run-1') },
    ),
  ];
}

describe('TaskState tools (task_write/read)', () => {
  it('live 工具清单只注册新名称，不保留旧 executable alias', () => {
    expect(taskStateToolClasses.map(ToolClass => new ToolClass().name)).toEqual([
      'task_write',
      'task_read',
    ]);
  });

  it('task_write 从当前工作历史计算版本并只返回业务快照', async () => {
    const tool = new TaskWriteTool();
    const first = TaskStateWriteResultSchema.parse(
      JSON.parse(await tool.run(validArgs, makeContext())),
    );
    expect(first.data).toMatchObject({ operation: 'create', version: 1 });
    expect(first.data).not.toHaveProperty('conversation_id');
    expect(first.data).not.toHaveProperty('instance_id');

    const second = TaskStateWriteResultSchema.parse(
      JSON.parse(await tool.run(
        { ...validArgs, progress: '第一版已成为正式工具事实。' },
        makeContext(pairedTaskWriteFact(first, 'first')),
      )),
    );
    expect(second.data).toMatchObject({ operation: 'update', version: 2 });
  });

  it('task_read 从配对的正式事实恢复状态，不依赖数据库或 instance', async () => {
    const writeTool = new TaskWriteTool();
    const writeResult = TaskStateWriteResultSchema.parse(
      JSON.parse(await writeTool.run(validArgs, makeContext())),
    );
    const result = TaskStateReadResultSchema.parse(JSON.parse(
      await new TaskReadTool().run({}, makeContext(pairedTaskWriteFact(writeResult, 'read'))),
    ));

    expect(result.data.exists).toBe(true);
    if (!result.data.exists) throw new Error('expected existing TaskState');
    expect(result.data.version).toBe(1);
    expect(result.data.taskstate.goal).toBe(validArgs.goal);
    expect(result.data).not.toHaveProperty('conversation_id');
    expect(result.data).not.toHaveProperty('instance_id');
  });

  it('没有正式事实时 task_read 返回 exists=false', async () => {
    const result = TaskStateReadResultSchema.parse(JSON.parse(
      await new TaskReadTool().run({}, makeContext()),
    ));
    expect(result.data).toEqual({ exists: false });
  });

  it('references 必填，并拒绝已经退役的 SharedMemory URI', async () => {
    const tool = new TaskWriteTool();
    const { references: _references, ...withoutReferences } = validArgs;
    await expect(tool.run(withoutReferences, makeContext())).rejects.toThrow(/required parameter:\s*references/i);
    await expect(tool.run({
      ...validArgs,
      references: ['shared_memory://docs/TaskState.md'],
    }, makeContext())).rejects.toThrow(/not an active path or reference/);
  });

  it('references 与 read_file 共享显式 locator，并支持宿主外部文件', async () => {
    const tool = new TaskWriteTool();
    for (const reference of [
      'workspace:/研究/report.md',
      'conversation:/artifacts/chart.png',
      'file:///Users/test/Downloads/reference.png',
    ]) {
      await expect(tool.run({
        ...validArgs,
        references: [reference],
      }, makeContext())).resolves.toEqual(expect.any(String));
    }

    for (const reference of [
      '/Users/test/Downloads/reference.png',
      '../reference.png',
    ]) {
      await expect(tool.run({
        ...validArgs,
        references: [reference],
      }, makeContext())).rejects.toThrow(/not an active path or reference/);
    }
  });

  it('TaskState 参数合同包含显式预算', () => {
    const taskWrite = new TaskWriteTool();
    expect(taskWrite.parameters.properties.goal?.maxLength).toBe(500);
    expect(taskWrite.parameters.properties.current_plan?.maxItems).toBe(7);
    expect(taskWrite.parameters.properties.next_steps?.maxItems).toBe(3);
    expect(taskWrite.parameters.additionalProperties).toBe(false);
  });
});
