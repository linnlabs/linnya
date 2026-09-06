import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleDragEndForEditor,
  handleDragStart,
  handleDragStartByRootBlockId,
  resolveRootBlockDragSource,
  validateMoveOperation,
} from './dragUtils';
import {
  getRootBlockDragStateSnapshot,
  publishRootBlockDragEnd,
} from './rootBlockDragState';
import { PositionUtils } from '../../position/PositionUtils';

function createRootBlock(id, nodeSize = 10) {
  return {
    type: { name: 'rootBlock' },
    attrs: { id },
    nodeSize,
  };
}

function createDoc(blocks) {
  const entries = [];
  let pos = 0;
  for (const node of blocks) {
    entries.push({ node, pos });
    pos += node.nodeSize;
  }

  return {
    content: {
      content: blocks,
      size: pos,
    },
    descendants(callback) {
      for (const entry of entries) {
        const result = callback(entry.node, entry.pos);
        if (result === false) continue;
      }
    },
    nodeAt(targetPos) {
      return entries.find((entry) => entry.pos === targetPos)?.node ?? null;
    },
  };
}

afterEach(() => {
  publishRootBlockDragEnd();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('validateMoveOperation', () => {
  it('publishes drag source state without relying on sessionStorage', () => {
    const doc = createDoc([
      createRootBlock('root-drag', 10),
    ]);
    const body = {
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
    };
    vi.stubGlobal('document', { body });
    const setData = vi.fn();
    const event = {
      dataTransfer: {
        effectAllowed: '',
        setData,
      },
      stopPropagation: vi.fn(),
    };
    const editor = {
      state: { doc },
      emit: vi.fn(),
    };

    expect(handleDragStart(event, {
      editor,
      node: {
        attrs: { id: 'root-drag' },
        type: { name: 'rootBlock' },
      },
    })).toBe(true);

    expect(getRootBlockDragStateSnapshot().draggingRootBlockInfo).toEqual({
      id: 'root-drag',
      type: 'rootBlock',
      pos: 0,
    });
    expect(setData).toHaveBeenCalledWith('application/x-prosemirror-block', 'root-drag');
    expect(editor.emit).toHaveBeenCalledWith('blockDragStart', expect.objectContaining({
      id: 'root-drag',
      position: { pos: 0 },
    }));

    publishRootBlockDragEnd('root-drag');
  });

  it('starts dragging from editor state and rootBlockId without NodeView props', () => {
    const doc = createDoc([
      createRootBlock('before', 12),
      createRootBlock('root-drag', 10),
    ]);
    vi.stubGlobal('document', {
      body: {
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
      },
    });
    const event = {
      dataTransfer: {
        effectAllowed: '',
        setData: vi.fn(),
      },
      stopPropagation: vi.fn(),
    };
    const editor = {
      state: { doc },
      emit: vi.fn(),
    };

    expect(handleDragStartByRootBlockId(event, {
      editor,
      rootBlockId: 'root-drag',
    })).toBe(true);

    expect(getRootBlockDragStateSnapshot().draggingRootBlockInfo).toEqual({
      id: 'root-drag',
      type: 'rootBlock',
      pos: 12,
    });
    expect(event.stopPropagation).toHaveBeenCalledOnce();

    publishRootBlockDragEnd('root-drag');
  });

  it('reports drag start failure without publishing stale dragging state', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const doc = createDoc([
      createRootBlock('root-existing', 10),
    ]);
    vi.stubGlobal('document', {
      body: {
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
      },
    });
    const event = {
      dataTransfer: {
        effectAllowed: '',
        setData: vi.fn(),
      },
      stopPropagation: vi.fn(),
    };
    const editor = {
      state: { doc },
      emit: vi.fn(),
    };

    expect(handleDragStartByRootBlockId(event, {
      editor,
      rootBlockId: 'root-missing',
    })).toBe(false);

    expect(getRootBlockDragStateSnapshot().draggingRootBlockInfo).toBeNull();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(editor.emit).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      '[BlockDrag root-missing] 处理拖拽开始事件失败: 未找到源块'
    );
  });

  it('resolves drag source from blockPosIndex', () => {
    const doc = createDoc([
      createRootBlock('block-0', 10),
      createRootBlock('block-1', 20),
    ]);

    expect(resolveRootBlockDragSource({ doc }, 'block-1')).toMatchObject({
      valid: true,
      sourceId: 'block-1',
      sourcePos: 10,
      sourceType: 'rootBlock',
    });
    expect(resolveRootBlockDragSource({ doc }, 'missing')).toEqual({
      valid: false,
      message: '未找到源块',
      sourceId: 'missing',
    });
  });

  it('uses blockPosIndex instead of scanning all descendants for source and target lookup', () => {
    let descendantsCallCount = 0;
    const doc = createDoc([
      createRootBlock('block-0', 10),
      createRootBlock('block-1', 20),
      createRootBlock('block-2', 30),
    ]);
    const originalDescendants = doc.descendants.bind(doc);
    doc.descendants = (callback) => {
      descendantsCallCount += 1;
      return originalDescendants(callback);
    };

    const first = validateMoveOperation({ doc }, 'block-0', 2);
    const second = validateMoveOperation({ doc }, 'block-0', 3);

    expect(first).toMatchObject({
      valid: true,
      needsMove: true,
      insertPos: 30,
      sourceIndex: 0,
      targetIndex: 2,
    });
    expect(second).toMatchObject({
      valid: true,
      needsMove: true,
      insertPos: 60,
      sourceIndex: 0,
      targetIndex: 3,
    });
    // 第一次构建 WeakMap 索引需要遍历一次；第二次同 doc 命中缓存，不再遍历。
    expect(descendantsCallCount).toBe(1);
  });

  it('treats dropping a block immediately after itself as no-op', () => {
    const doc = createDoc([
      createRootBlock('block-0', 10),
      createRootBlock('block-1', 20),
      createRootBlock('block-2', 30),
    ]);

    const result = validateMoveOperation({ doc }, 'block-1', 2);

    expect(result).toMatchObject({
      valid: true,
      needsMove: false,
    });
  });

  it('ends dragging from editor only and emits requestBlockMove when movement is valid', () => {
    const doc = createDoc([
      createRootBlock('block-0', 10),
      createRootBlock('block-1', 20),
      createRootBlock('block-2', 30),
    ]);
    const editor = {
      state: { doc },
      emit: vi.fn(),
    };
    const event = {
      currentTarget: null,
    };
    vi.stubGlobal('document', {
      body: {
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
      },
      querySelectorAll: vi.fn(() => []),
    });
    publishRootBlockDragEnd();
    handleDragStartByRootBlockId({
      dataTransfer: null,
      stopPropagation: vi.fn(),
    }, {
      editor,
      rootBlockId: 'block-0',
    });

    vi.spyOn(PositionUtils.prototype, 'calculateDragTargetIndex').mockReturnValue(2);

    handleDragEndForEditor(event, {
      editor,
      fallbackBlockId: 'block-0',
    });

    expect(editor.emit).toHaveBeenCalledWith('requestBlockMove', expect.objectContaining({
      sourceId: 'block-0',
      targetIndex: 2,
    }));
    expect(getRootBlockDragStateSnapshot().draggingRootBlockInfo).toBeNull();
  });

  it('treats a drop without a valid target as a cancelled drag', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const doc = createDoc([
      createRootBlock('block-0', 10),
      createRootBlock('block-1', 20),
    ]);
    const editor = {
      state: { doc },
      emit: vi.fn(),
    };
    const event = { currentTarget: null };
    vi.stubGlobal('document', {
      body: {
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
      },
    });
    handleDragStartByRootBlockId({
      dataTransfer: null,
      stopPropagation: vi.fn(),
    }, {
      editor,
      rootBlockId: 'block-0',
    });

    vi.spyOn(PositionUtils.prototype, 'calculateDragTargetIndex').mockReturnValue(null);

    handleDragEndForEditor(event, {
      editor,
      fallbackBlockId: 'block-0',
    });

    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('无法计算目标索引')
    );
    expect(editor.emit).not.toHaveBeenCalledWith(
      'requestBlockMove',
      expect.anything()
    );
    expect(getRootBlockDragStateSnapshot().draggingRootBlockInfo).toBeNull();
  });
});
