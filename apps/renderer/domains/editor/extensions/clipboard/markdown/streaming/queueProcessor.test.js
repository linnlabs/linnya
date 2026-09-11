// apps/renderer/domains/editor/extensions/clipboard/markdown/streaming/queueProcessor.test.js
// 测试：当 StreamingParser 返回 TableBlock 事件时，queueProcessor 能正确调用 createRootBlock
// 并使用 contentType: 'table' 及合理的子节点结构。

import { describe, it, expect, vi } from 'vitest';

// NodeFinder 在 insertNewRootBlock 末尾用于根据 id 查找新插入节点的位置。
// 这里将其 mock 掉，避免依赖真实的 ProseMirror 文档结构。
vi.mock('../../../position/NodeFinder', () => {
  return {
    NodeFinder: vi.fn().mockImplementation(function MockNodeFinder() {
      return {
        // 返回一个伪造的节点信息，pos 任意给一个非 0 的整数即可
        findNodeById: () => ({ pos: 5 }),
      };
    }),
  };
});

vi.mock('../StreamingMarkdown', () => {
  return {
    STREAMING_PLUGIN_KEY: {
      getState: () => null,
    },
  };
});

vi.mock('../../../../functions/resolveCurrentEditorMessage', () => {
  return {
    resolveCurrentEditorMessage: (key) => `translated:${key}`,
  };
});

import { processQueue } from './queueProcessor';

// 构造一个最小可用的 schema stub，满足 queueProcessor 中对 table 相关节点的访问。
function createFakeSchema() {
  const makeNodeType = (name) => ({
    name,
    create: (attrs = {}, content = [], marks = []) => ({ type: name, attrs, content, marks }),
  });

  return {
    nodes: {
      table: makeNodeType('table'),
      tableRow: makeNodeType('tableRow'),
      tableCell: makeNodeType('tableCell'),
      tableHeader: makeNodeType('tableHeader'),
      tableCellContentBlock: makeNodeType('tableCellContentBlock'),
      hardBreak: makeNodeType('hardBreak'),
      inlineLatex: makeNodeType('inlineLatex'),
    },
    text(text, marks = []) {
      return { type: 'text', text, marks };
    },
    marks: {
      bold: {
        create: () => ({ type: 'bold' }),
      },
    },
  };
}

// 构造一个假的 editor，focus 在我们关心的 createRootBlock 行为上。
function createFakeEditor() {
  const createRootBlockSpy = vi.fn().mockReturnValue(true);
  const setStreamingStateSpy = vi.fn();

  const schema = createFakeSchema();

  const editor = {
    schema,
    state: {
      doc: {
        content: { size: 0 },
        nodesBetween: () => {},
      },
    },
    commands: {
      createRootBlock: createRootBlockSpy,
      setStreamingState: setStreamingStateSpy,
    },
    // processQueue 会访问 editor.view / editor.isDestroyed 等属性，这里提供最小 stub
    view: {},
    isDestroyed: false,
  };

  return { editor, createRootBlockSpy, setStreamingStateSpy };
}

describe('queueProcessor - TableBlock integration', () => {
  it('should call createRootBlock with contentType "table" and proper children for TableBlock events', () => {
    const { editor, createRootBlockSpy } = createFakeEditor();

    // 模拟来自 WASM 的 TableBlock 事件（结构与 Rust 侧 TableModel 对应）
    const blockEvent = {
      block_type: 'TableBlock',
      raw_content_fallback: '| col1 | col2 |\n| --- | --- |\n| a | b |\n',
      language: null,
      level: null,
      structured_content: null,
      attrs: {
        with_header_row: true,
        alignments: ['left', 'left'],
        header: [
          {
            content: [
              { type: 'text', text: 'col1', marks: [], attrs: null },
            ],
          },
          {
            content: [
              { type: 'text', text: 'col2', marks: [], attrs: null },
            ],
          },
        ],
        rows: [
          {
            cells: [
              {
                content: [
                  { type: 'text', text: 'a', marks: [{ type: 'bold' }], attrs: null },
                  { type: 'hardBreak', marks: [], attrs: null },
                  { type: 'inlineLatex', attrs: { latexSource: 'x+y' }, marks: [] },
                ],
              },
              {
                content: [
                  { type: 'text', text: 'b', marks: [], attrs: null },
                ],
              },
            ],
          },
        ],
      },
    };

    const pluginState = {
      currentInsertPos: null,
      initialBlockContext: null,
      hasProcessedFirstEventYet: false,
    };

    // 调用 processQueue，处理一个 TableBlock 事件
    processQueue(editor, pluginState, [blockEvent], { finalize: false });

    // 断言 createRootBlock 被调用了一次
    expect(createRootBlockSpy).toHaveBeenCalledTimes(1);

    const callArg = createRootBlockSpy.mock.calls[0][0];
    // contentType 应该被映射为 'table'
    expect(callArg.contentType).toBe('table');

    // contentChildren 应该是若干 tableRow 节点（至少 header 行 + 一行数据）
    expect(Array.isArray(callArg.contentChildren)).toBe(true);
    expect(callArg.contentChildren.length).toBeGreaterThanOrEqual(2);

    const [headerRow, firstDataRow] = callArg.contentChildren;
    expect(headerRow.type).toBe('tableRow');
    expect(firstDataRow.type).toBe('tableRow');

    // 检查表头第一格内容
    const headerFirstCell = headerRow.content[0];
    expect(headerFirstCell.type).toBe('tableHeader');
    const headerContentBlock = headerFirstCell.content[0];
    expect(headerContentBlock.type).toBe('tableCellContentBlock');
    const headerTextNode = headerContentBlock.content[0];
    expect(headerTextNode.type).toBe('text');
    expect(headerTextNode.text).toBe('col1');

    // 检查数据行第一格内容
    const dataFirstCell = firstDataRow.content[0];
    expect(dataFirstCell.type).toBe('tableCell');
    const dataContentBlock = dataFirstCell.content[0];
    expect(dataContentBlock.type).toBe('tableCellContentBlock');
    const dataTextNode = dataContentBlock.content[0];
    expect(dataTextNode.type).toBe('text');
    expect(dataTextNode.text).toBe('a');
    expect(dataTextNode.marks).toEqual([{ type: 'bold' }]);
    expect(dataContentBlock.content[1]).toEqual({
      type: 'hardBreak',
      attrs: null,
      content: null,
      marks: [],
    });
    expect(dataContentBlock.content[2]).toEqual(
      expect.objectContaining({
        type: 'inlineLatex',
        attrs: expect.objectContaining({ latexSource: 'x+y' }),
        content: [],
        marks: [],
      })
    );
  });
});
