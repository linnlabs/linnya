import type { BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/** 原生输入覆盖多选、键盘事务和取消手势；后端原子性另由 SQLite 集成场景验证。 */
export async function verifyCanvasSelection(window: BrowserWindow): Promise<void> {
  const evaluate = (script: string): Promise<unknown> => window.webContents.executeJavaScript(script);
  await evaluate('window.canvasSmoke = window.mountShapeTextEditingSmoke(); void 0');
  const settle = () => evaluate('window.canvasSmoke.ready()');
  async function point(name: string, dx = 0, dy = 0) {
    const value = await evaluate(`window.canvasSmoke.point(${JSON.stringify(name)}, ${dx}, ${dy})`);
    if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)
      || typeof value.x !== 'number' || typeof value.y !== 'number') throw new Error('Missing canvas point');
    return { x: value.x, y: value.y };
  }
  async function click(name: string, shift = false) {
    const position = await point(name);
    const modifiers: 'shift'[] = shift ? ['shift'] : [];
    window.webContents.sendInputEvent({ type: 'mouseMove', ...position });
    window.webContents.sendInputEvent({ type: 'mouseDown', ...position, button: 'left', clickCount: 1, modifiers });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...position, button: 'left', clickCount: 1, modifiers });
    await settle();
  }
  async function escape() {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await settle();
  }
  try {
    await settle(); await click('badge'); await click('second', true);
    await evaluate('window.canvasSmoke.assertSelection(["badge", "second"])');
    for (let i = 0; i < 12; i++) window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    await settle();
    await evaluate('window.canvasSmoke.assertCanvasCommands(0)');
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
    await settle();
    await evaluate('window.canvasSmoke.assertCanvasCommands(1, 12 / 96)');
    await evaluate('window.canvasSmoke.resolve(0, true); window.canvasSmoke.present()');
    await settle(); await escape();
    const start = await point('badge', -1.45, -0.95);
    const end = await point('badge', 4.7, 2.3);
    window.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseMove', ...end, button: 'left' });
    await settle();
    await evaluate('window.canvasSmoke.assertSelection(["badge", "second", "standalone"])');
    await escape();
    window.webContents.sendInputEvent({ type: 'mouseUp', ...end, button: 'left', clickCount: 1 });
    await settle();
    await evaluate('window.canvasSmoke.assertSelection([]); window.canvasSmoke.assertCanvasCommands(1)');
    await click('badge'); await click('second', true);
    const dragStart = await point('badge'); const dragEnd = await point('badge', 0.4, 0.4);
    window.webContents.sendInputEvent({ type: 'mouseDown', ...dragStart, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseMove', ...dragEnd, button: 'left' });
    await settle(); await escape();
    window.webContents.sendInputEvent({ type: 'mouseUp', ...dragEnd, button: 'left', clickCount: 1 });
    await settle();
    await evaluate('window.canvasSmoke.assertSelection(["badge", "second"]); window.canvasSmoke.assertCanvasCommands(1)');
    await click('gutter'); await evaluate('window.canvasSmoke.assertSelection([])');
    await click('badge');
    const shiftStart = await point('badge'); const shiftEnd = await point('badge', 0.4, 0.06);
    window.webContents.sendInputEvent({ type: 'mouseDown', ...shiftStart, button: 'left', clickCount: 1, modifiers: ['shift'] });
    window.webContents.sendInputEvent({ type: 'mouseMove', ...shiftEnd, button: 'left', modifiers: ['shift'] });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...shiftEnd, button: 'left', clickCount: 1, modifiers: ['shift'] });
    await settle();
    await evaluate('window.canvasSmoke.assertAxisLockedTranslation(2); window.canvasSmoke.assertSelection(["badge"])');
    // 没有模式：选中的对象直接从浮条或 ⌘K 交给 AI，Esc 收起输入框并回到画布。
    await evaluate('window.canvasSmoke.controlPoint(\'[data-property="ai"]\'); window.canvasSmoke.assertAiPrompt(false)');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
    await settle();
    await evaluate('window.canvasSmoke.assertAiPrompt(true)');
    await escape();
    await evaluate('window.canvasSmoke.assertAiPrompt(false); window.canvasSmoke.assertSelection(["badge"])');
    console.log('Slides native canvas: Shift selection, marquee cancel, group drag cancel, one-commit keyboard repeats, gutter deselection, Shift axis-locked drag and AI entry passed');
  } finally { await evaluate('window.canvasSmoke.dispose()'); }
  await evaluate('window.canvasSmoke = window.mountShapeTextEditingSmoke(true); void 0');
  async function commandClick(selector: string) {
    const value = await evaluate(`window.canvasSmoke.controlPoint(${JSON.stringify(selector)})`);
    if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)
      || typeof value.x !== 'number' || typeof value.y !== 'number') throw new Error('Missing command control');
    window.webContents.sendInputEvent({ type: 'mouseDown', x: value.x, y: value.y, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', x: value.x, y: value.y, button: 'left', clickCount: 1 });
    await settle();
  }
  try {
    await settle();
    await click('badge');
    await commandClick('[data-insert="text"]');
    await evaluate('window.canvasSmoke.assertCanvasFocused()');
    await evaluate('window.canvasSmoke.assertEditingCommand(0, "insert_objects"); window.canvasSmoke.resolve(0, true)');
    await settle(); await evaluate('window.canvasSmoke.present()'); await settle();
    await writeFile(path.resolve(__dirname, 'editing-command-bar.png'), (await window.webContents.capturePage()).toPNG());
    await commandClick('[data-command="undo"]');
    await evaluate('window.canvasSmoke.assertEditingCommand(1, "undo")');
    console.log('Slides command bar: native insertion keeps canvas focus, page-index admission and document undo passed');
  } finally { await evaluate('window.canvasSmoke.dispose()'); }
}
