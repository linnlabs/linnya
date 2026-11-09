import { usage } from './parseProbeArgs.mjs';

const modifierKeys = {
  Alt: { mask: 1, code: 'AltLeft', virtual: 18 },
  Control: { mask: 2, code: 'ControlLeft', virtual: 17 },
  Meta: { mask: 4, code: 'MetaLeft', virtual: 91 },
  Shift: { mask: 8, code: 'ShiftLeft', virtual: 16 },
};
const special = {
  Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38,
  ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34, Space: 32,
};

export function resolveKeySequence(input) {
  const parts = input.split('+');
  const key = parts.pop();
  const modifiers = parts.map(part => {
    if (!Object.hasOwn(modifierKeys, part)) usage(`未知修饰键 ${part}`);
    return { key: part, ...modifierKeys[part] };
  });
  if (new Set(parts).size !== parts.length) usage('重复的修饰键');
  if (Object.hasOwn(special, key)) {
    return { modifiers, key: key === 'Space' ? ' ' : key, code: key, virtual: special[key], text: key === 'Enter' ? '\r' : key === 'Space' ? ' ' : undefined };
  }
  if (!/^[A-Za-z0-9]$/.test(key)) usage(`未知按键 ${key}`);
  const upper = key.toUpperCase();
  const text = parts.includes('Shift') ? upper : key.toLowerCase();
  return { modifiers, key: text, code: /^[0-9]$/.test(key) ? `Digit${key}` : `Key${upper}`, virtual: upper.charCodeAt(0), text };
}
