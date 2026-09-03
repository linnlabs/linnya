// @vitest-environment jsdom

import { Schema } from 'prosemirror-model';
import { describe, expect, it, vi } from 'vitest';
import { positionInCellAtCoords } from './tableNodeAtCoords';

const schema = new Schema({
  nodes: {
    doc: { content: 'tableCell' },
    text: { group: 'inline' },
    tableCell: {
      content: 'tableCellContentBlock',
      tableRole: 'cell',
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        colwidth: { default: null },
      },
      toDOM: () => ['td', 0],
      parseDOM: [{ tag: 'td' }],
    },
    tableCellContentBlock: {
      content: 'text*',
      toDOM: () => ['div', 0],
      parseDOM: [{ tag: 'div' }],
    },
  },
});

function createRect({ left = 10, right = 110, top, bottom }) {
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function withRangeClientRects(rectsByTextNode, run) {
  const originalGetClientRects = Range.prototype.getClientRects;
  Range.prototype.getClientRects = function getClientRects() {
    const rects = rectsByTextNode.get(this.startContainer);
    return rects ?? [];
  };

  try {
    return run();
  } finally {
    Range.prototype.getClientRects = originalGetClientRects;
  }
}

function createViewFixture(textContent = 'abcdef') {
  const contentBlock = schema.nodes.tableCellContentBlock.create(null, schema.text(textContent));
  const cell = schema.nodes.tableCell.create(null, contentBlock);
  const doc = schema.nodes.doc.create(null, cell);
  const contentDom = document.createElement('div');
  const span = document.createElement('span');
  const textNode = document.createTextNode(textContent);
  span.appendChild(textNode);
  contentDom.appendChild(span);

  const view = {
    state: { doc },
    nodeDOM(pos) {
      return pos === 1 ? contentDom : null;
    },
    posAtDOM(node, offset) {
      if (node !== textNode) return -1;
      return 2 + offset;
    },
  };

  return {
    view,
    contentDom,
    textNode,
  };
}

describe('positionInCellAtCoords', () => {
  it('finds nested inline text and clamps blank-space Y back into the nearest text line', () => {
    const { view, textNode } = createViewFixture();
    const captured = [];
    const originalCaretRangeFromPoint = document.caretRangeFromPoint;

    document.caretRangeFromPoint = vi.fn((x, y) => {
      captured.push({ x, y });
      if (y > 121) return null;
      const range = document.createRange();
      range.setStart(textNode, 3);
      range.collapse(true);
      return range;
    });

    try {
      const result = withRangeClientRects(
        new Map([[textNode, [createRect({ top: 100, bottom: 120 })]]]),
        () => positionInCellAtCoords(view, 0, 300, 360)
      );

      expect(result).toBe(5);
      expect(captured).toEqual([{ x: 109, y: 119 }]);
    } finally {
      document.caretRangeFromPoint = originalCaretRangeFromPoint;
    }
  });

  it('chooses the closest rendered text line before asking the browser for a caret', () => {
    const { view, textNode } = createViewFixture();
    const captured = [];
    const originalCaretRangeFromPoint = document.caretRangeFromPoint;

    document.caretRangeFromPoint = vi.fn((x, y) => {
      captured.push({ x, y });
      const range = document.createRange();
      range.setStart(textNode, 4);
      range.collapse(true);
      return range;
    });

    try {
      const result = withRangeClientRects(
        new Map([
          [
            textNode,
            [
              createRect({ top: 100, bottom: 120 }),
              createRect({ top: 240, bottom: 260 }),
            ],
          ],
        ]),
        () => positionInCellAtCoords(view, 0, 40, 230)
      );

      expect(result).toBe(6);
      expect(captured).toEqual([{ x: 40, y: 241 }]);
    } finally {
      document.caretRangeFromPoint = originalCaretRangeFromPoint;
    }
  });

  it('rejects caret results outside the table cell content DOM', () => {
    const { view, textNode } = createViewFixture();
    const outsideTextNode = document.createTextNode('outside');
    const originalCaretRangeFromPoint = document.caretRangeFromPoint;

    document.caretRangeFromPoint = vi.fn(() => {
      const range = document.createRange();
      range.setStart(outsideTextNode, 2);
      range.collapse(true);
      return range;
    });

    try {
      const result = withRangeClientRects(
        new Map([[textNode, [createRect({ top: 100, bottom: 120 })]]]),
        () => positionInCellAtCoords(view, 0, 30, 110)
      );

      expect(result).toBeNull();
    } finally {
      document.caretRangeFromPoint = originalCaretRangeFromPoint;
    }
  });
});
