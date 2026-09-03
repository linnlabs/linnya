import { describe, expect, it } from 'vitest';
import {
  createSingleConversationBatchSelection,
  extendConversationBatchSelection,
  resolveConversationSelectionGesture,
  toggleConversationBatchSelection,
} from './conversationSelection';

describe('conversation selection', () => {
  it('支持建立单项操作集合、切换多选和范围多选', () => {
    const first = createSingleConversationBatchSelection('a');
    const toggled = toggleConversationBatchSelection(first, 'c');
    const ranged = extendConversationBatchSelection({ ...toggled, anchorId: 'a' }, ['a', 'b', 'c', 'd'], 'd');
    expect(ranged.selectedIds).toEqual(['a', 'c', 'b', 'd']);
    expect(ranged.anchorId).toBe('a');
  });

  it('普通点击交给活动会话处理，组合键点击只更新批量选择', () => {
    const current = createSingleConversationBatchSelection('a');

    expect(resolveConversationSelectionGesture(current, ['a', 'b'], 'b', {
      shiftKey: false,
      toggleKey: false,
      activeConversationId: 'a',
    })).toEqual({ kind: 'open-conversation' });

    expect(resolveConversationSelectionGesture(current, ['a', 'b'], 'b', {
      shiftKey: false,
      toggleKey: true,
      activeConversationId: 'a',
    })).toEqual({
      kind: 'update-batch-selection',
      selection: { selectedIds: ['a', 'b'], anchorId: 'b' },
    });

    expect(resolveConversationSelectionGesture(current, ['a', 'b'], 'b', {
      shiftKey: true,
      toggleKey: false,
      activeConversationId: 'a',
    })).toEqual({
      kind: 'update-batch-selection',
      selection: { selectedIds: ['a', 'b'], anchorId: 'a' },
    });
  });

  it('首次 Shift 点击从当前打开的会话连续选到点击位置', () => {
    const result = resolveConversationSelectionGesture(
      { selectedIds: [], anchorId: null },
      ['a', 'b', 'c', 'd'],
      'd',
      { shiftKey: true, toggleKey: false, activeConversationId: 'b' },
    );

    expect(result).toEqual({
      kind: 'update-batch-selection',
      selection: { selectedIds: ['b', 'c', 'd'], anchorId: 'b' },
    });
  });

  it('连续 Shift 点击固定原锚点并扩展已有选择', () => {
    const firstRange = extendConversationBatchSelection(
      { selectedIds: [], anchorId: null },
      ['a', 'b', 'c', 'd'],
      'c',
      'b',
    );
    const secondRange = extendConversationBatchSelection(
      firstRange,
      ['a', 'b', 'c', 'd'],
      'a',
    );

    expect(secondRange).toEqual({
      selectedIds: ['b', 'c', 'a'],
      anchorId: 'b',
    });
  });
});
