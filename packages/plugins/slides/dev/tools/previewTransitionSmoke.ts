import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

async function run(): Promise<void> {
  const window = new BrowserWindow({ width: 820, height: 820, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  try {
    await window.loadFile(path.resolve(__dirname, 'preview-transitions/previewTransitionSmoke.html'));
    const result: unknown = await window.webContents.executeJavaScript('window.previewTransitionSmoke');
    assertFrameCount(result, 16);
    assertManualTranslationFrames(result, 2);
    assertManualVisualFrames(result, 5);
    console.log('Slides live Vue/Konva transition pixels passed:', JSON.stringify(result));
    await verifyPropertyInteraction(window);
    await verifyShapeTextEditing(window);
    const fixtureFile = process.argv[2];
    if (fixtureFile) {
      const sequence: unknown = JSON.parse(await readFile(fixtureFile, 'utf8'));
      if (!Array.isArray(sequence)) throw new Error('Expected paint sequence array');
      const fixtureResult: unknown = await window.webContents.executeJavaScript(
        `window.verifyPreviewPaintSequence(${JSON.stringify(sequence)})`,
      );
      assertFrameCount(fixtureResult, sequence.length * 2);
      console.log('Supplied paint sequence passed:', JSON.stringify(fixtureResult));
    }
  } finally { window.destroy(); }
}

/** 用 Chromium 的真实指针输入验证 pointer capture、连续拖拽和 Escape，避免模拟掉手势生命周期。 */
async function verifyPropertyInteraction(window: BrowserWindow): Promise<void> {
  const evaluate = (script: string): Promise<unknown> => window.webContents.executeJavaScript(script);
  await evaluate('window.manualPropertySmoke = window.mountManualPropertySmoke(); void 0');
  const colorResult = await evaluate('window.manualPropertySmoke.verifyColorsAndNumbers()');
  async function point(handle: string): Promise<{ x: number; y: number }> {
    const result = await evaluate(`window.manualPropertySmoke.point(${JSON.stringify(handle)})`);
    if (typeof result !== 'object' || result === null || !('x' in result) || !('y' in result)
      || typeof result.x !== 'number' || typeof result.y !== 'number') throw new Error('Invalid handle position');
    return { x: result.x, y: result.y };
  }
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  async function down(handle: string) {
    const position = await point(handle);
    window.webContents.sendInputEvent({ type: 'mouseMove', ...position });
    window.webContents.sendInputEvent({ type: 'mouseDown', ...position, button: 'left', clickCount: 1 });
    await settle();
    return position;
  }
  async function move(position: { x: number; y: number }) {
    window.webContents.sendInputEvent({ type: 'mouseMove', ...position, modifiers: ['leftbuttondown'] });
    await settle();
  }
  async function up(position: { x: number; y: number }) {
    window.webContents.sendInputEvent({ type: 'mouseUp', ...position, button: 'left', clickCount: 1 });
    await settle();
  }
  const corner = await down('corner');
  const grown = { x: corner.x + 96, y: corner.y + 48 };
  await move(grown);
  await evaluate('window.manualPropertySmoke.assertResize(3, 1.5, 0, true)');
  await up(grown);
  await evaluate('window.manualPropertySmoke.assertResize(3, 1.5, 1, false)');
  const right = await down('right');
  const wider = { x: right.x + 48, y: right.y };
  await move(wider);
  await up(wider);
  await evaluate('window.manualPropertySmoke.assertResize(3.5, 1.5, 2, false)');
  const bottom = await down('bottom');
  const taller = { x: bottom.x, y: bottom.y + 48 };
  await move(taller);
  await evaluate('window.manualPropertySmoke.assertResize(3.5, 2, 2, true)');
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await settle();
  await up(taller);
  await evaluate('window.manualPropertySmoke.assertResize(3.5, 1.5, 2, false)');
  const click = await down('corner');
  await up(click);
  await evaluate('window.manualPropertySmoke.assertResize(3.5, 1.5, 2, false)');
  for (const theme of ['light', 'dark', 'moon-blue']) {
    await evaluate(`window.manualPropertySmoke.showCustom(${JSON.stringify(theme)})`);
    await settle();
    await evaluate('Promise.all(document.getAnimations().map(animation => animation.finished))');
    const screenshot = await window.webContents.capturePage();
    await writeFile(path.resolve(__dirname, `manual-properties-${theme}.png`), screenshot.toPNG());
  }
  await evaluate('window.manualPropertySmoke.prepareSliderKeyboard()');
  for (const [keyCode, expected] of [['Right', 1], ['End', 359], ['Home', 0]] as const) {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await settle();
    await evaluate(`window.manualPropertySmoke.assertSliderKeyboard(${expected})`);
  }
  await evaluate('window.manualPropertySmoke.disableSlider()');
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
  await settle();
  await evaluate('window.manualPropertySmoke.assertSliderKeyboard(0)');
  await evaluate('window.manualPropertySmoke.dispose()');
  console.log('Slides property UI and native resize input passed:', JSON.stringify(colorResult));
}

async function verifyShapeTextEditing(window: BrowserWindow): Promise<void> {
  const evaluate = (script: string): Promise<unknown> => window.webContents.executeJavaScript(script);
  await evaluate('window.shapeTextEditingSmoke = window.mountShapeTextEditingSmoke(); void 0');
  const point = await evaluate('window.shapeTextEditingSmoke.point()');
  if (typeof point !== 'object' || point === null || !('x' in point) || !('y' in point)
    || typeof point.x !== 'number' || typeof point.y !== 'number') throw new Error('Missing shape point');
  const position = { x: point.x, y: point.y };
  window.webContents.sendInputEvent({ type: 'mouseMove', ...position });
  for (const clickCount of [1, 2]) {
    window.webContents.sendInputEvent({ type: 'mouseDown', ...position, button: 'left', clickCount });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...position, button: 'left', clickCount });
  }
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await evaluate('window.shapeTextEditingSmoke.assertEditing()');
  await evaluate('window.shapeTextEditingSmoke.verifyIme()');
  const screenshot = await window.webContents.capturePage();
  await writeFile(path.resolve(__dirname, 'shape-text-editing.png'), screenshot.toPNG());
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['control'] });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['control'] });
  await evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
  await evaluate('window.shapeTextEditingSmoke.assertSubmitted()');
  await evaluate('window.shapeTextEditingSmoke.dispose()');
  console.log('Slides native shape double click, single outline, IME and text submission passed');
}

function assertFrameCount(result: unknown, expected: number): void {
  if (typeof result !== 'object' || result === null || !('frames' in result) || result.frames !== expected) {
    throw new Error(`Preview transition smoke did not finish ${expected} frame comparisons`);
  }
}

function assertManualTranslationFrames(result: unknown, expected: number): void {
  if (
    typeof result !== 'object'
    || result === null
    || !('manualTranslationFrames' in result)
    || result.manualTranslationFrames !== expected
  ) {
    throw new Error(`Preview transition smoke did not finish ${expected} manual translation comparisons`);
  }
}

function assertManualVisualFrames(result: unknown, expected: number): void {
  if (
    typeof result !== 'object'
    || result === null
    || !('manualVisualFrames' in result)
    || result.manualVisualFrames !== expected
  ) {
    throw new Error(`Preview transition smoke did not finish ${expected} manual visual comparisons`);
  }
}

app.on('window-all-closed', () => {});
void app.whenReady().then(run).then(() => app.quit()).catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
