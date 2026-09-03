import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import { projectSharedMemoryWritePresentation } from './projectSharedMemoryWritePresentation';

function project(overrides: Partial<ToolPresentationProjectorInput>) {
  return projectSharedMemoryWritePresentation({
    sourceToolName: 'sharedmemory_write',
    uiKey: 'sharedmemory_write',
    args: { doc_name: 'plan', content: 'hello world' },
    result: undefined,
    status: 'loading',
    phase: 'start',
    ...overrides,
  });
}

describe('projectSharedMemoryWritePresentation', () => {
  it('非 success 阶段从正式参数构造生命周期展示，不读取结果', () => {
    expect(project({ result: { invalid: true } })).toMatchObject({
      data: {
        kind: 'lifecycle',
        documentName: 'plan.md',
        contentUnits: 2,
      },
      title: { text: { key: 'conversation.tool.sharedMemory.write' } },
    });
  });

  it('成功后只使用 strict result 构造快照', () => {
    expect(project({
      status: 'success',
      phase: 'complete',
      result: {
        data: {
          source: 'shared_memory',
          operation: 'create',
          conversation_id: 'conversation-1',
          instance_id: 'instance-1',
          doc_name: 'plan',
          uri: 'shared_memory://docs/plan.md',
          file_path: '/tmp/plan.md',
          action: 'write',
          version: 1,
          created: true,
        },
        observation: 'created',
      },
    })).toMatchObject({
      data: {
        kind: 'snapshot',
        documentName: 'plan.md',
        contentUnits: 2,
        action: 'write',
        operation: 'create',
        version: 1,
      },
    });
  });

  it('拒绝 created 与 operation 不一致的成功结果', () => {
    expect(() => project({
      status: 'success',
      result: {
        data: {
          source: 'shared_memory',
          operation: 'update',
          conversation_id: 'conversation-1',
          instance_id: 'instance-1',
          doc_name: 'plan',
          uri: 'shared_memory://docs/plan.md',
          file_path: '/tmp/plan.md',
          action: 'append',
          version: 2,
          created: true,
        },
        observation: 'updated',
      },
    })).toThrow();
  });
});
