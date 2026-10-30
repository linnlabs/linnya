import type { BrowserWindow } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** 真实指针贯穿 Stage、宽度重排、串行队列和正式帧交接；同时覆盖固定/自动高度。 */
export async function verifyTextWidth(window: BrowserWindow): Promise<void> {
  const evaluate = (script: string): Promise<unknown> => window.webContents.executeJavaScript(script);
  const settle = () => evaluate('window.widthSmoke.ready()');
  async function point(expression: string) {
    const value = await evaluate(expression);
    if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)
      || typeof value.x !== 'number' || typeof value.y !== 'number') throw new Error('Invalid width pointer');
    return { x: value.x, y: value.y };
  }
  async function snapshot() {
    const value = await evaluate('window.widthSmoke.textWidthSnapshot()');
    if (typeof value !== 'object' || value === null || !('width' in value) || !('height' in value)
      || !('x' in value) || !('lines' in value) || typeof value.width !== 'number' || typeof value.height !== 'number'
      || typeof value.x !== 'number' || typeof value.lines !== 'number') throw new Error('Invalid text canvas snapshot');
    return { ...value, x: value.x, width: value.width, height: value.height, lines: value.lines };
  }
  function equal(actual: unknown, expected: unknown, reason: string) {
    function matches(left: unknown, right: unknown): boolean {
      if (typeof left === 'number' && typeof right === 'number') return Math.abs(left - right) <= 0.011;
      if (left === right) return true;
      if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
      const a = Object.entries(left), b = Object.entries(right);
      return a.length === b.length && a.every(([key, value], index) => key === b[index][0] && matches(value, b[index][1]));
    }
    if (!matches(actual, expected)) throw new Error(`${reason}: ${JSON.stringify({ actual, expected })}`);
  }
  async function down(handle: 'left' | 'right') {
    const start = await point(`window.widthSmoke.controlPoint('[data-text-width-handle="${handle}"]')`);
    window.webContents.sendInputEvent({ type: 'mouseMove', ...start });
    window.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 });
    return start;
  }
  async function move(position: { x: number; y: number }) {
    window.webContents.sendInputEvent({ type: 'mouseMove', ...position, modifiers: ['leftbuttondown'] });
    await settle();
  }
  async function up(position: { x: number; y: number }) {
    window.webContents.sendInputEvent({ type: 'mouseUp', ...position, button: 'left', clickCount: 1 });
    await settle();
  }
  const flowFrames: unknown = JSON.parse(await readFile(path.resolve(__dirname, 'flow-width-fixture.json'), 'utf8'));
  for (const mode of ['fixed', 'auto', 'flow']) {
    await evaluate(`window.widthSmoke = window.mountShapeTextEditingSmoke(false, '${mode}', ${mode === 'flow' ? JSON.stringify(flowFrames) : 'undefined'}); window.widthSmoke.ready()`);
    try {
      const text = await point('window.widthSmoke.textWidthPoint()');
      window.webContents.sendInputEvent({ type: 'mouseDown', ...text, button: 'left', clickCount: 1 });
      await up(text);
      const initial = await snapshot();
      const start = await down('right');
      await move({ ...start, x: start.x - 48 });
      await move({ ...start, x: start.x - 120 });
      const narrow = await snapshot();
      if (Math.abs(narrow.width - (initial.width - 120)) > 0.01 || narrow.lines <= initial.lines) {
        throw new Error(`Width drag did not reflow from its initial geometry: ${JSON.stringify({ initial, narrow })}`);
      }
      if (mode !== 'fixed' && narrow.height <= initial.height) throw new Error('Automatic height did not grow during width drag');
      await evaluate('window.widthSmoke.assertWidthCommands(0, 0)');
      await up({ ...start, x: start.x - 120 });
      equal(await snapshot(), narrow, 'Release flashed back while waiting for save');
      await evaluate('window.widthSmoke.assertWidthCommands(1, 0)');

      // 第一笔仍在保存，第二次从当前可见宽度继续拖；左手柄保持右边缘。
      const left = await down('left');
      await move({ ...left, x: left.x - 72 });
      const wide = await snapshot();
      if (Math.abs(wide.x + wide.width - narrow.x - narrow.width) > 0.01 || Math.abs(wide.width - narrow.width - 72) > 0.01) {
        throw new Error(`Queued left width handle lost its fixed right edge: ${JSON.stringify({ narrow, wide, left })}`);
      }
      await up({ ...left, x: left.x - 72 });
      await evaluate('window.widthSmoke.assertWidthCommands(1, 1); window.widthSmoke.resolve(0, true); window.widthSmoke.present()');
      await settle();
      equal(await snapshot(), wide, 'First committed frame replaced the second pending width');
      await evaluate('window.widthSmoke.assertWidthCommands(2, 0); window.widthSmoke.resolve(1, true); window.widthSmoke.present()');
      await settle();
      equal(await snapshot(), wide, 'Final committed width changed painted text or selection');
      await evaluate('window.widthSmoke.assertSettled()');

      const cancel = await down('right');
      await move({ ...cancel, x: cancel.x + 48 });
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await up({ ...cancel, x: cancel.x + 48 });
      equal(await snapshot(), wide, 'Escape did not restore the confirmed text width');
      await evaluate('window.widthSmoke.assertWidthCommands(2, 0); window.widthSmoke.assertCanvasFocused()');

      const failure = await down('right');
      await move({ ...failure, x: failure.x + 96 });
      await up({ ...failure, x: failure.x + 96 });
      await evaluate('window.widthSmoke.assertWidthCommands(3, 0); window.widthSmoke.resolve(2, false)');
      await settle();
      equal(await snapshot(), wide, 'Failed save did not roll back text, bounds and selection together');
    } finally { await evaluate('window.widthSmoke.dispose()'); }
  }
  console.log('Slides native text width reflow, queued anchor, frame handoff, cancellation and failure passed (fixed/auto/flow height).');
}
