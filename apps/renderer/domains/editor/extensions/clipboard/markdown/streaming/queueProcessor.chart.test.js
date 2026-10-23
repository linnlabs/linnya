// 流式写入的 linnya-chart 围栏：与导入共用准入，合法落地为 chartBlock，无效整体跳过并提示。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ show: vi.fn() }));

vi.mock('../../../position/NodeFinder', () => ({
  NodeFinder: vi.fn().mockImplementation(function MockNodeFinder() {
    return { findNodeById: () => ({ pos: 5 }) };
  }),
}));
vi.mock('../StreamingMarkdown', () => ({ STREAMING_PLUGIN_KEY: { getState: () => null } }));
vi.mock('../../../../functions/resolveCurrentEditorMessage', () => ({
  resolveCurrentEditorMessage: (key, params) => `translated:${key}${params ? `:${JSON.stringify(params)}` : ''}`,
}));
vi.mock('@/app/notification', () => ({ useNotificationStore: () => ({ show: mocks.show }) }));

import { processQueue } from './queueProcessor';

function createFakeEditor() {
  const createRootBlock = vi.fn().mockReturnValue(true);
  const setStreamingState = vi.fn();
  const editor = {
    schema: { nodes: {}, text: text => ({ type: 'text', text }), marks: {} },
    state: { doc: { content: { size: 0 }, nodesBetween: () => {} } },
    commands: { createRootBlock, setStreamingState },
    view: {},
    isDestroyed: false,
  };
  return { editor, createRootBlock, setStreamingState };
}

const pluginState = { currentInsertPos: null, initialBlockContext: null, hasProcessedFirstEventYet: false };
const chartEvent = (body, language = 'linnya-chart') => ({ block_type: 'CodeBlock', language, raw_content_fallback: body });
const validBody = JSON.stringify({ chartType: 'bar', categories: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] });

describe('processQueue: linnya-chart 围栏', () => {
  beforeEach(() => mocks.show.mockClear());

  it('未接纳图片使当前流式批次明确失败，不能留下默认空图或部分文字', () => {
    const { editor, createRootBlock, setStreamingState } = createFakeEditor();
    processQueue(editor, pluginState, [chartEvent('{}', 'json'), {
      block_type: 'ImageBlock', attrs: { src: 'conversation:/plot.png', caption: '', title: '' },
    }], {});
    expect(createRootBlock).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledTimes(1);
    expect(setStreamingState).toHaveBeenCalledWith(expect.objectContaining({ streamingError: expect.objectContaining({ code: 'MARKDOWN_IMAGE_INVALID' }) }));
  });

  it('合法图表创建 chartBlock，携带准入后的规格，不携带代码语言', () => {
    const { editor, createRootBlock } = createFakeEditor();

    processQueue(editor, pluginState, [chartEvent(validBody)], {});

    expect(createRootBlock).toHaveBeenCalledTimes(1);
    const call = createRootBlock.mock.calls[0][0];
    expect(call.contentType).toBe('chartBlock');
    expect(call.blockAttrs.blockType).toBe('chart');
    expect(call.blockAttrs.spec).toMatchObject({ chartType: 'bar', categories: ['A', 'B'] });
    expect(call.blockAttrs.language).toBeUndefined();
    expect(call.contentChildren).toBeUndefined();
  });

  it('无效图表不创建任何块，提示一次，且后续事件继续落地', () => {
    const { editor, createRootBlock } = createFakeEditor();
    const after = { block_type: 'CodeBlock', language: 'json', raw_content_fallback: '{}' };

    processQueue(editor, pluginState, [chartEvent('{"chartType": "nope"}'), after], {});

    expect(createRootBlock).toHaveBeenCalledTimes(1);
    expect(createRootBlock.mock.calls[0][0].contentType).toBe('CodeBlock');
    expect(mocks.show).toHaveBeenCalledTimes(1);
    expect(mocks.show.mock.calls[0][0]).toContain('editor.chart.streaming.invalid');
    expect(mocks.show.mock.calls[0][1]).toBe('warning');
  });

  it('chart / echarts 等其他语言保持普通代码块，不嗅探 JSON 形状', () => {
    const { editor, createRootBlock } = createFakeEditor();

    processQueue(editor, pluginState, [chartEvent(validBody, 'chart'), chartEvent(validBody, 'echarts')], {});

    expect(createRootBlock.mock.calls.map(call => call[0].contentType)).toEqual(['CodeBlock', 'CodeBlock']);
    expect(createRootBlock.mock.calls.map(call => call[0].blockAttrs.language)).toEqual(['chart', 'echarts']);
    expect(mocks.show).not.toHaveBeenCalled();
  });
});
