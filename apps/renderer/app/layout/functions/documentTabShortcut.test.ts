import { describe, expect, it } from 'vitest';
import type { DocumentTabShortcutInput } from '../definitions/documentTabShortcut';
import { decideDocumentTabShortcut } from './documentTabShortcut';

function press(keys: Partial<DocumentTabShortcutInput> & Pick<DocumentTabShortcutInput, 'key'>): DocumentTabShortcutInput {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isMac: true,
    modalOpen: false,
    hasActiveTab: true,
    ...keys,
  };
}

describe('标签栏快捷键', () => {
  it('没有弹窗时照常切换、关闭和重新打开标签', () => {
    expect(decideDocumentTabShortcut(press({ key: 'Tab', ctrlKey: true }))).toEqual({ kind: 'run', shortcut: { kind: 'cycle', offset: 1 } });
    expect(decideDocumentTabShortcut(press({ key: 'Tab', ctrlKey: true, shiftKey: true }))).toEqual({ kind: 'run', shortcut: { kind: 'cycle', offset: -1 } });
    expect(decideDocumentTabShortcut(press({ key: 'w', metaKey: true }))).toEqual({ kind: 'run', shortcut: { kind: 'close' } });
    expect(decideDocumentTabShortcut(press({ key: 'T', metaKey: true, shiftKey: true }))).toEqual({ kind: 'run', shortcut: { kind: 'reopen' } });
    expect(decideDocumentTabShortcut(press({ key: 'w', ctrlKey: true, isMac: false }))).toEqual({ kind: 'run', shortcut: { kind: 'close' } });
  });

  it('弹窗开着时接住三个快捷键，不动背后的标签', () => {
    for (const keys of [
      { key: 'Tab', ctrlKey: true },
      { key: 'w', metaKey: true },
      { key: 't', metaKey: true, shiftKey: true },
    ]) {
      expect(decideDocumentTabShortcut(press({ ...keys, modalOpen: true }))).toEqual({ kind: 'swallow' });
    }
    // 没有标签时也接住：放行的 ⌘W 会让默认菜单关掉整个窗口。
    expect(decideDocumentTabShortcut(press({ key: 'w', metaKey: true, modalOpen: true, hasActiveTab: false }))).toEqual({ kind: 'swallow' });
  });

  it('没有弹窗也没有标签时 ⌘W 交给系统；其他按键不处理', () => {
    expect(decideDocumentTabShortcut(press({ key: 'w', metaKey: true, hasActiveTab: false }))).toEqual({ kind: 'pass' });
    expect(decideDocumentTabShortcut(press({ key: 'w' }))).toEqual({ kind: 'pass' });
    expect(decideDocumentTabShortcut(press({ key: 'w', metaKey: true, altKey: true }))).toEqual({ kind: 'pass' });
    expect(decideDocumentTabShortcut(press({ key: 'Escape', modalOpen: true }))).toEqual({ kind: 'pass' });
  });
});
