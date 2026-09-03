import { describe, expect, it } from 'vitest';

import type { ToolPresentationProjectorInput } from '../../types';
import { projectHistoricalAssembleEvidencePresentation } from './projectHistoricalAssembleEvidencePresentation';

function project(overrides: Partial<ToolPresentationProjectorInput>) {
  return projectHistoricalAssembleEvidencePresentation({
    sourceToolName: 'assemble_evidence',
    uiKey: 'assemble_evidence',
    args: {},
    result: undefined,
    status: 'loading',
    phase: 'start',
    ...overrides,
  });
}

describe('projectHistoricalAssembleEvidencePresentation', () => {
  it('生命周期阶段只接纳历史事件身份，不读取 success 结果', () => {
    expect(
      project({
        args: { query: '研究主题' },
        result: { invalid: true },
      })
    ).toMatchObject({
      data: { kind: 'lifecycle', operation: 'write' },
      title: { text: { key: 'conversation.tool.evidence.write' } },
    });
  });

  it('成功阶段按历史 schema 严格校验请求与结果身份', () => {
    expect(() =>
      project({
        args: { query: '请求 A' },
        status: 'success',
        phase: 'complete',
        result: {
          data: {
            version: 1,
            query: '结果 B',
            kept: [],
            stats: { total_input: 0, kept_count: 0, dropped_count: 0 },
            evidence_store: { bundle_id: '0123456789abcdef' },
          },
          observation: '完成。',
        },
      })
    ).toThrow(/does not match request/);
  });
});
