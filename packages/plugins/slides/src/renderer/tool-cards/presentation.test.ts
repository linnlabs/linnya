import { describe, expect, it } from 'vitest';
import { presentationToolConfigs } from './presentation';

const RETIRED_SLIDES_EDIT_TOOL_NAMES = [
  'ppt_edit_text',
  'ppt_edit_data',
  'ppt_edit_image',
  'ppt_edit_style',
  'ppt_edit_geometry',
  'ppt_edit_arrangement',
  'ppt_align_elements',
  'ppt_delete_element',
  'ppt_manage_slides',
] as const;

describe('presentationToolConfigs', () => {
  it('ppt_plan 应采用和 ask 一致的无外层卡片布局', () => {
    expect(presentationToolConfigs['ppt_plan']?.layout).toEqual({
      hideBorder: true,
      hideBackground: true,
      noPadding: true,
      fullWidth: true,
      overflowVisible: true,
    });
  });

  it('旧 Slides 源码 wrapper 不应再有前端卡片配置', () => {
    expect(presentationToolConfigs['ppt_codegen']).toBeUndefined();
    expect(presentationToolConfigs['ppt_write']).toBeUndefined();
    expect(presentationToolConfigs['ppt_read']).toBeUndefined();
    expect(presentationToolConfigs['ppt_edit']).toBeUndefined();
    expect(presentationToolConfigs['ppt_grep']).toBeUndefined();
    expect(presentationToolConfigs['ppt_structure']).toBeUndefined();
  });

  it('ppt_inspect 标题不应暴露内部 ID', () => {
    const projection = presentationToolConfigs['ppt_inspect']?.presentation?.({
      sourceToolName: 'ppt_inspect',
      uiKey: 'ppt_inspect',
      args: {},
      result: {
        data: {
          artifact: {
            presentationId: 'ppt-123',
            versionId: 'version-1',
            slideCount: 0,
          },
          document: { title: '销售复盘' },
          selection: {
            requestedSlideNumbers: [],
            shownSlideNumbers: [],
            truncated: false,
          },
          pages: [],
          buildStatus: { state: 'ready' },
          findingSummary: {
            rawFindingCount: 0,
            uniqueFindingCount: 0,
            rootGroupCount: 0,
            p0Count: 0,
            p1Count: 0,
            p2Count: 0,
          },
        },
        observation: '"销售复盘" | 共 0 页',
      },
      status: 'success',
      phase: 'complete',
    });

    expect(projection?.title?.text).toEqual({
      key: 'slides.tool.title.inspectNamed',
      fallback: '检查演示文稿 · {title}',
      params: { title: '销售复盘' },
    });
  });

  it('ppt_plan success 应拒绝被部分丢弃的非法页面结果', () => {
    const projector = presentationToolConfigs['ppt_plan']?.presentation;
    if (!projector) throw new Error('ppt_plan must register a presentation projector');

    expect(() => projector({
      sourceToolName: 'ppt_plan',
      uiKey: 'ppt_plan',
      toolCallId: 'ppt-plan-invalid',
      args: {},
      result: {
        data: {
          title: '销售复盘',
          pageCount: 2,
          visualDirection: {
            concept: '克制可信的经营分析风。',
            composition: '高密度证据页与留白结论页交替。',
            signature: '每章使用一次超大结论数字。',
          },
          pages: [
            { slideNumber: 1, title: '结论', content: '先说明结论。' },
            { slideNumber: 2, title: '', content: '非法空标题。' },
          ],
        },
      },
      status: 'success',
      phase: 'complete',
    })).toThrow('pages.1.title');
  });

  it('旧 Slides 编辑工具不应再有前端卡片配置', () => {
    for (const toolName of RETIRED_SLIDES_EDIT_TOOL_NAMES) {
      expect(presentationToolConfigs[toolName]).toBeUndefined();
    }
  });
});
