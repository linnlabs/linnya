// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { shouldHandleManualDeleteShortcut } from './manualDeleteShortcut';

describe('shouldHandleManualDeleteShortcut', () => {
  it('accepts Backspace and Delete from the canvas', () => {
    const canvas = document.createElement('div');
    expect(shouldHandleManualDeleteShortcut({ key: 'Backspace', target: canvas })).toBe(true);
    expect(shouldHandleManualDeleteShortcut({ key: 'Delete', target: canvas })).toBe(true);
    expect(shouldHandleManualDeleteShortcut({ key: 'Enter', target: canvas })).toBe(false);
  });

  it('preserves native deletion in form controls and inline editors', () => {
    const input = document.createElement('input');
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editor.append(child);

    expect(shouldHandleManualDeleteShortcut({ key: 'Delete', target: input })).toBe(false);
    expect(shouldHandleManualDeleteShortcut({ key: 'Backspace', target: child })).toBe(false);
  });
});
