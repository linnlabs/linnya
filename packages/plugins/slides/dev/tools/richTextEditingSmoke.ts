import type { BrowserWindow } from 'electron';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

/** 真实文字选区 → 共用工具条 → 完整作者值提交；不调用编辑器格式命令替代用户操作。 */
export async function verifyRichTextEditing(window: BrowserWindow): Promise<void> {
  const evaluate = (script: string): Promise<unknown> => window.webContents.executeJavaScript(script).catch((error: unknown) => {
    throw new Error(`Rich text step failed: ${script}\n${String(error)}`);
  });
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const control = (selector: string) => `window.shapeTextEditingSmoke.controlPoint(${JSON.stringify(selector)})`;
  async function click(expression: string, double = false) {
    const point = await evaluate(expression);
    if (typeof point !== 'object' || point === null || !('x' in point) || !('y' in point)
      || typeof point.x !== 'number' || typeof point.y !== 'number') throw new Error('Missing rich text control');
    for (const count of double ? [1, 2] : [1]) {
      window.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: count });
      window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: count });
    }
    await settle();
  }
  async function key(keyCode: string, modifiers: ('shift' | 'control' | 'meta')[] = []) {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Enter' && modifiers.length === 0) window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await settle();
  }
  async function assert(expression: string) {
    await evaluate(`{ const s = window.shapeTextEditingSmoke.richSnapshot(); if (!(${expression})) throw new Error(JSON.stringify(s)); }`);
  }
  await evaluate('window.shapeTextEditingSmoke = window.mountShapeTextEditingSmoke(); window.shapeTextEditingSmoke.ready()');
  await click('window.shapeTextEditingSmoke.point("standalone")', true);
  for (let i = 0; i < 4; i++) await key('Left', ['shift']);
  await assert('s.phase === "editing" && s.font === "14" && !s.hasDelete && s.commands.length === 0');
  await click(control('[data-property="text"]'));
  await click(control('[title="#DC2626"]'));
  await assert('s.phase === "editing" && s.commands.length === 0 && s.draft[0].text === "Plain " && s.draft[1].text === "text" && s.draft[1].style.color === "#DC2626"');
  await click(control('.slides-element-property-toolbar__font input'));
  await evaluate('window.shapeTextEditingSmoke.prepareNumberInput(".slides-element-property-toolbar__font input")');
  await window.webContents.insertText('28');
  await key('Enter');
  await assert('s.phase === "editing" && s.commands.length === 0 && s.draft[1].style.fontSize === 28');
  await click(control('.slides-rich-text-surface'));
  await key('z', ['meta']);
  await assert('s.draft[1].style.fontSize === undefined && s.draft[1].style.color === "#DC2626"');
  await key('z', ['meta', 'shift']);
  await assert('s.draft[1].style.fontSize === 28');
  await writeFile(path.resolve(__dirname, 'rich-text-selection.png'), (await window.webContents.capturePage()).toPNG());
  // 点击别的对象一次即可提交完整 runs 并选中 B；再次进入 pending 文本也应保留局部样式。
  await click('window.shapeTextEditingSmoke.point("second")');
  await assert('s.phase === "idle" && s.selected === "second" && s.commands.length === 1 && s.commands[0].content[1].style.fontSize === 28');
  await click('window.shapeTextEditingSmoke.point("standalone")');
  await assert('s.font === undefined && s.hasDelete');
  await click('window.shapeTextEditingSmoke.point("standalone")', true);
  for (let i = 0; i < 10; i++) await key('Left', ['shift']);
  await assert('s.phase === "editing" && s.font === "" && s.commands.length === 1');
  await key('Escape');
  await evaluate('window.shapeTextEditingSmoke.resolve(0, true)');
  await settle();
  await evaluate('window.shapeTextEditingSmoke.present()');
  await settle();
  await click('window.shapeTextEditingSmoke.point("standalone")', true);
  await assert('s.phase === "editing" && s.draft[1].style.fontSize === 28 && s.draft[1].style.color === "#DC2626"');
  await evaluate('window.shapeTextEditingSmoke.richComposition("compositionstart")');
  await window.webContents.insertText('中文');
  await key('Enter', ['control']);
  await assert('s.phase === "editing" && s.commands.length === 1');
  await evaluate('window.shapeTextEditingSmoke.richComposition("compositionend")');
  await settle();
  await key('Enter');
  await key('Enter', ['control']);
  await assert('s.phase === "idle" && s.commands.length === 2');
  await evaluate('window.shapeTextEditingSmoke.dispose()');
  console.log('Slides rich text: native range, color/font, mixed values, pending re-entry, source revision re-entry, undo/redo, IME and Enter passed');
}
