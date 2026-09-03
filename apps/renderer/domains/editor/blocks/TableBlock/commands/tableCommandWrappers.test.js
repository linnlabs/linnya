// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { alignCellRight } from './tableAlignCommands';
import { splitCell } from './tableCellCommands';
import { deleteColumn } from './tableDeleteCommands';
import { addColumnAfter, addRowBefore } from './tableToolbarCommands';

function createChainEditor(runResult) {
  const calls = [];
  const chain = {
    focus() {
      calls.push('focus');
      return chain;
    },
    addRowBefore() {
      calls.push('addRowBefore');
      return chain;
    },
    addColumnAfter() {
      calls.push('addColumnAfter');
      return chain;
    },
    deleteColumn() {
      calls.push('deleteColumn');
      return chain;
    },
    command() {
      calls.push('command');
      return chain;
    },
    splitCell() {
      calls.push('splitCell');
      return chain;
    },
    run() {
      calls.push('run');
      return runResult;
    },
  };

  return {
    calls,
    editor: {
      chain() {
        calls.push('chain');
        return chain;
      },
    },
  };
}

describe('table command wrappers', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns the real chain run result instead of reporting success on no-op commands', () => {
    const addRow = createChainEditor(false);
    const deleteCol = createChainEditor(false);
    const alignRight = createChainEditor(false);

    expect(addRowBefore(addRow.editor)).toBe(false);
    expect(deleteColumn(deleteCol.editor)).toBe(false);
    expect(alignCellRight(alignRight.editor)).toBe(false);

    expect(addRow.calls).toEqual(['chain', 'focus', 'addRowBefore', 'run']);
    expect(deleteCol.calls).toEqual(['chain', 'focus', 'deleteColumn', 'run']);
    expect(alignRight.calls).toEqual(['chain', 'focus', 'command', 'run']);
  });

  it('clears command executing state even when column insertion is rejected by the editor command', () => {
    vi.useFakeTimers();
    const { editor } = createChainEditor(false);
    const setCommandExecuting = vi.fn();

    expect(addColumnAfter(editor, setCommandExecuting)).toBe(false);
    expect(setCommandExecuting).toHaveBeenCalledWith(true);

    vi.runAllTimers();
    expect(setCommandExecuting).toHaveBeenLastCalledWith(false);
  });

  it('does not enter command executing state when the editor is unavailable', () => {
    const setCommandExecuting = vi.fn();
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      expect(addColumnAfter(null, setCommandExecuting)).toBe(false);
      expect(setCommandExecuting).not.toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('only schedules split-cell content repair when the split command actually runs', () => {
    const requestAnimationFrameSpy = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameSpy);

    expect(splitCell(createChainEditor(false).editor)).toBe(false);
    expect(requestAnimationFrameSpy).not.toHaveBeenCalled();

    expect(splitCell(createChainEditor(true).editor)).toBe(true);
    expect(requestAnimationFrameSpy).toHaveBeenCalledOnce();
  });
});
