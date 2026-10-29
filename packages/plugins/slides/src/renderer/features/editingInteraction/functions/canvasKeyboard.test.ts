// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ownsCanvasKeyboard, ownsDocumentShortcut, preserveCanvasFocus } from './canvasKeyboard';

function keydownFrom(element: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'target', { value: element });
  return event;
}

function mousedownOn(element: Element): MouseEvent {
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
  element.dispatchEvent(event);
  return event;
}

describe('canvas keyboard ownership', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('lets Ctrl/Cmd document shortcuts through a focused command button, but not through text input', () => {
    const button = document.createElement('button');
    const input = document.createElement('input');
    expect(ownsCanvasKeyboard(keydownFrom(button, { key: 'z', ctrlKey: true }))).toBe(false);
    expect(ownsDocumentShortcut(keydownFrom(button, { key: 'z', ctrlKey: true }))).toBe(true);
    expect(ownsDocumentShortcut(keydownFrom(input, { key: 'z', ctrlKey: true }))).toBe(false);
  });

  it('keeps canvas focus on a plain command button press, and leaves popup triggers and active input alone', () => {
    const canvas = document.createElement('div'); canvas.tabIndex = 0;
    const plain = document.createElement('button');
    const popup = document.createElement('button'); popup.setAttribute('aria-haspopup', 'listbox');
    const input = document.createElement('input');
    for (const element of [canvas, plain, popup, input]) {
      element.addEventListener('mousedown', preserveCanvasFocus);
      document.body.append(element);
    }
    canvas.focus();
    expect(mousedownOn(plain).defaultPrevented).toBe(true);
    expect(mousedownOn(popup).defaultPrevented).toBe(false);
    input.focus();
    expect(mousedownOn(plain).defaultPrevented).toBe(false);
  });
});
