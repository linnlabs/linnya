import { describe, expect, it } from 'vitest';
import {
  PptInspectToolArgsSchema,
  PptInspectToolMessageResultSchema,
  PptInspectToolResultSchema,
} from './pptInspectToolContract';

function makeResult() {
  return {
    data: {
      artifact: {
        presentationId: 'deck-1',
        versionId: 'version-2',
        slideCount: 12,
      },
      document: {
        title: '经营复盘',
        locator: 'workspace:/经营复盘.slides',
        inode: 'inode-1',
      },
      selection: {
        requestedSlideNumbers: [2, 3],
        shownSlideNumbers: [2, 3],
        truncated: false,
      },
      pages: [
        { slideNumber: 2, layoutKey: 'comparison', elementCount: 8, editableTargetCount: 5 },
        { slideNumber: 3, layoutKey: 'matrix', elementCount: 11, editableTargetCount: 7 },
      ],
      buildStatus: { state: 'ready' as const },
      findingSummary: {
        rawFindingCount: 6,
        uniqueFindingCount: 5,
        rootGroupCount: 2,
        p0Count: 2,
        p1Count: 1,
        p2Count: 2,
      },
    },
    observation: 'Slides inspection\nfindings\nF1 ...',
    observationPreviewMeta: {
      document_name: '经营复盘',
      doc_type: 'slides/inspection' as const,
    },
  };
}

describe('PptInspectToolArgsSchema', () => {
  it('接纳唯一目标、合法页范围、聚焦范围和显式启发式选项', () => {
    expect(PptInspectToolArgsSchema.parse({
      inode: ' inode-1 ',
      slideNumber: 2,
      endSlide: 4,
      heuristics: false,
      focus: [{ startLine: 30, endLine: 42 }],
    })).toEqual({
      inode: 'inode-1',
      slideNumber: 2,
      endSlide: 4,
      heuristics: false,
      focus: [{ startLine: 30, endLine: 42 }],
    });
  });

  it.each([
    [{}, '必须且只能提供一个'],
    [{ presentation_id: 'deck-1', inode: 'inode-1' }, '必须且只能提供一个'],
    [{ presentation_id: '' }, 'at least 1 character'],
    [{ presentation_id: 'deck-1', endSlide: 2 }, '只能与 slideNumber 同时提供'],
    [{ presentation_id: 'deck-1', slideNumber: 3, endSlide: 2 }, '不能小于 slideNumber'],
    [{ presentation_id: 'deck-1', diagnose: true }, 'Unrecognized key'],
    [{ presentation_id: 'deck-1', legacy: true }, 'Unrecognized key'],
    [{ presentation_id: 'deck-1', focus: [{ startLine: 8, endLine: 7 }] }, '不能小于 startLine'],
    [{ presentation_id: 'deck-1', focus: Array.from({ length: 5 }, () => ({ startLine: 1, endLine: 1 })) }, 'at most 4'],
  ])('拒绝无效调用 %#', (input, message) => {
    const parsed = PptInspectToolArgsSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.message).toContain(message);
    }
  });
});

describe('PptInspectToolResultSchema', () => {
  it('接纳紧凑 data 与完整 observation 分层结果', () => {
    expect(PptInspectToolResultSchema.parse(makeResult())).toEqual(makeResult());
  });

  it('拒绝 selection 与 pages 页码漂移', () => {
    const result = makeResult();
    result.data.selection.shownSlideNumbers = [2];
    expect(() => PptInspectToolResultSchema.parse(result)).toThrow(
      'shownSlideNumbers 必须与 pages 的页码和顺序一致',
    );
  });

  it('拒绝缺失必需的 finding 统计', () => {
    const result = {
      ...makeResult(),
      data: {
        ...makeResult().data,
        findingSummary: undefined,
      },
    };
    expect(() => PptInspectToolResultSchema.parse(result)).toThrow();
  });

  it('执行期结果仍要求 preview meta，不把当前错误降级为 optional', () => {
    const result = makeResult();
    const messageResult = { data: result.data, observation: result.observation };
    expect(() => PptInspectToolResultSchema.parse(messageResult)).toThrow(
      'observationPreviewMeta',
    );
  });
});

describe('PptInspectToolMessageResultSchema', () => {
  it('接纳 Conversation 持久化后重建的 data 与 observation', () => {
    const result = makeResult();
    const messageResult = { data: result.data, observation: result.observation };
    expect(PptInspectToolMessageResultSchema.parse(messageResult)).toEqual(messageResult);
  });

  it('拒绝把执行期 preview meta 混入持久化消息合同', () => {
    expect(() => PptInspectToolMessageResultSchema.parse(makeResult())).toThrow(
      'Unrecognized key',
    );
  });
});
