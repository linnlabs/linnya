import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import { projectSharedMemoryListPresentation } from './projectSharedMemoryListPresentation';

function project(overrides: Partial<ToolPresentationProjectorInput>) {
  return projectSharedMemoryListPresentation({
    sourceToolName: 'sharedmemory_list',
    uiKey: 'sharedmemory_list',
    args: {},
    result: undefined,
    status: 'loading',
    phase: 'start',
    ...overrides,
  });
}

describe('projectSharedMemoryListPresentation', () => {
  it('非 success 阶段只校验请求，不读取结果', () => {
    expect(project({ result: { invalid: true } })).toMatchObject({
      data: { kind: 'lifecycle' },
      title: { text: { key: 'conversation.tool.sharedMemory.list' } },
    });
  });

  it('归一 legacy sharedmemory_list 结果', () => {
    expect(project({
      status: 'success',
      phase: 'complete',
      result: {
        data: {
          conversation_id: 'conversation-1',
          instance_id: 'instance-1',
          docs: [{
            name: 'plan.md',
            uri: 'shared_memory://docs/plan.md',
            size_bytes: 42,
            size_chars: 42,
            updated_at_ms: 100,
            version: 1,
          }],
        },
        observation: 'one document',
      },
    })).toMatchObject({
      data: {
        kind: 'snapshot',
        documents: [{ name: 'plan.md', sizeBytes: 42, updatedAtMs: 100 }],
      },
    });
  });

  it('在同一次 admission 适配 resource_list(shared_memory) wrapper', () => {
    expect(project({
      sourceToolName: 'resource_list',
      args: { source: 'shared_memory' },
      status: 'success',
      phase: 'complete',
      result: {
        data: {
          source: 'shared_memory',
          conversation_id: 'conversation-1',
          instance_id: 'instance-1',
          docs: [{
            id: 'document-1',
            name: 'plan.md',
            uri: 'shared_memory://docs/plan.md',
            sizeBytes: 42,
            sizeChars: 42,
            updatedAtMs: 100,
            version: 1,
          }],
          total_count: 1,
          has_more: false,
          offset: 0,
        },
        observation: 'one document',
      },
    })).toMatchObject({
      data: {
        kind: 'snapshot',
        documents: [{ name: 'plan.md', sizeBytes: 42, updatedAtMs: 100 }],
      },
    });
  });

  it('拒绝 wrapper 结果中的计数漂移或额外字段', () => {
    expect(() => project({
      sourceToolName: 'resource_list',
      args: { source: 'shared_memory' },
      status: 'success',
      result: {
        data: {
          source: 'shared_memory',
          conversation_id: 'conversation-1',
          instance_id: 'instance-1',
          docs: [],
          total_count: 1,
          has_more: false,
          offset: 0,
          legacy: true,
        },
        observation: 'invalid',
      },
    })).toThrow();
  });
});
