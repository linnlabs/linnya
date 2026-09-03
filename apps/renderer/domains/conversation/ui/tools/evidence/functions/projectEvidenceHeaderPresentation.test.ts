import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import { projectEvidenceHeaderPresentation } from './projectEvidenceHeaderPresentation';

function project(
  toolName: 'assemble_documents' | 'evidence_resolve',
  overrides: Partial<ToolPresentationProjectorInput>,
) {
  return projectEvidenceHeaderPresentation({
    sourceToolName: toolName,
    uiKey: toolName,
    args: {},
    result: undefined,
    status: 'loading',
    phase: 'start',
    ...overrides,
  });
}

describe('projectEvidenceHeaderPresentation', () => {
  it('生命周期阶段只接纳参数，不读取 success 结果', () => {
    expect(project('assemble_documents', {
      args: { query: '研究主题', selected_blocks: [] },
      result: { invalid: true },
    })).toMatchObject({
      data: { kind: 'lifecycle', operation: 'write' },
      title: { text: { key: 'conversation.tool.evidence.write' } },
    });

    expect(project('evidence_resolve', {
      args: { mode: 'list_refs', max_units: 100, max_chars: 1000 },
      result: { invalid: true },
    })).toMatchObject({
      data: { kind: 'lifecycle', operation: 'read' },
      title: { text: { key: 'conversation.tool.evidence.read' } },
    });
  });

  it('成功阶段分别按工具 owner 合同完成 strict admission', () => {
    expect(project('assemble_documents', {
      args: { query: '研究主题', selected_blocks: [] },
      status: 'success',
      phase: 'complete',
      result: {
        data: {
          query: '研究主题',
          kept: [],
          dropped: [],
          stats: { total_input: 0, kept_count: 0, dropped_count: 0 },
        },
        observation: '组装完成。',
        control: { terminateRun: true, reason: 'completed' },
      },
    })).toMatchObject({ data: { kind: 'complete', operation: 'write' } });

    expect(project('evidence_resolve', {
      args: { mode: 'list_refs' },
      status: 'success',
      phase: 'complete',
      result: {
        data: {
          conversation_id: 'conversation-1',
          instance_id: 'instance-1',
          mode: 'list_refs',
          total_refs: 0,
          offset: 0,
          limit: 50,
          refs: [],
        },
        observation: '证据列表为空。',
      },
    })).toMatchObject({ data: { kind: 'complete', operation: 'read' } });
  });

  it('拒绝成功结果与请求身份不一致', () => {
    expect(() => project('evidence_resolve', {
      args: { mode: 'list_refs' },
      status: 'success',
      phase: 'complete',
      result: {
        data: {
          conversation_id: 'conversation-1',
          instance_id: 'instance-1',
          mode: 'resolve_refs',
          resolved_count: 0,
          missing_count: 0,
          incomplete_count: 0,
          conflict_count: 0,
          scanned_bundle_count: 0,
          resolved: [],
          missing_refs: [],
          incomplete_refs: [],
          conflicts: [],
        },
        observation: '完成。',
      },
    })).toThrow(/mode does not match request/);
  });
});
