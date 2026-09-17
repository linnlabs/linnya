import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

async function run(): Promise<void> {
  const window = new BrowserWindow({ width: 820, height: 820, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  window.webContents.on('console-message', event => {
    if (event.level === 'error') console.error('[preview browser]', event.message);
  });
  try {
    await window.loadFile(path.resolve(__dirname, 'preview-transitions/previewTransitionSmoke.html'));
    const result: unknown = await window.webContents.executeJavaScript('window.previewTransitionSmoke');
    assertFrameCount(result, 16);
    assertManualTranslationFrames(result, 2);
    assertManualVisualFrames(result, 5);
    console.log('Slides live Vue/Konva transition pixels passed:', JSON.stringify(result));
    await verifyPropertyInteraction(window);
    await verifyShapeTextEditing(window);
    await verifySelectionToolbar(window);
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
  const evaluate = (script: string): Promise<unknown> => window.webContents.executeJavaScript(script).catch((error: unknown) => {
    throw new Error(`Browser step failed: ${script}\n${String(error)}`);
  });
  await evaluate('window.manualPropertySmoke = window.mountManualPropertySmoke(); void 0');
  await evaluate('window.manualPropertySmoke.verifyDeletionControls()');
  const colorResult = await evaluate('window.manualPropertySmoke.verifyColorsAndNumbers()');
  async function point(handle: string): Promise<{ x: number; y: number }> {
    const result = await evaluate(`window.manualPropertySmoke.point(${JSON.stringify(handle)})`);
    if (typeof result !== 'object' || result === null || !('x' in result) || !('y' in result)
      || typeof result.x !== 'number' || typeof result.y !== 'number') throw new Error('Invalid handle position');
    return { x: result.x, y: result.y };
  }
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const settleColorMotion = () => evaluate('Promise.allSettled(document.getAnimations().map(animation => animation.finished)).then(() => undefined)');
  async function colorPoint(selector: string) {
    const value = await evaluate(`window.manualPropertySmoke.controlPoint(${JSON.stringify(selector)})`);
    if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)
      || typeof value.x !== 'number' || typeof value.y !== 'number') throw new Error('Missing color control point');
    return { x: value.x, y: value.y };
  }
  async function colorClick(selector: string) {
    const position = await colorPoint(selector);
    window.webContents.sendInputEvent({ type: 'mouseMove', ...position });
    window.webContents.sendInputEvent({ type: 'mouseDown', ...position, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...position, button: 'left', clickCount: 1 });
    await settle();
  }
  async function colorKey(keyCode: string) {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await settle();
  }
  async function colorInput(channel: string, value: string) {
    const selector = `[data-channel="${channel}"]`;
    await colorClick(selector);
    await evaluate(`window.manualPropertySmoke.prepareInput(${JSON.stringify(selector)})`);
    await window.webContents.insertText(value);
    await settle();
  }
  await evaluate('window.manualPropertySmoke.openPalette()');
  await settleColorMotion();
  const customRow = await colorPoint('.slides-element-color__custom');
  window.webContents.sendInputEvent({ type: 'mouseMove', ...customRow });
  await settle(); await settleColorMotion();
  await evaluate('window.manualPropertySmoke.assertSubmenu(true, "palette")');
  window.webContents.sendInputEvent({ type: 'mouseMove', ...await colorPoint('[role="tab"]:last-child') });
  // 必须跨过实际 200ms 悬停关闭周期，才能证明进入子菜单确实取消了关闭计时。
  await evaluate('new Promise(resolve => setTimeout(resolve, 240))');
  await evaluate('window.manualPropertySmoke.assertSubmenu(true, "palette")');
  window.webContents.sendInputEvent({ type: 'mouseMove', x: 750, y: 730 });
  await evaluate('new Promise(resolve => setTimeout(resolve, 240))');
  await evaluate('window.manualPropertySmoke.assertSubmenu(false, "palette")');
  window.webContents.sendInputEvent({ type: 'mouseMove', ...customRow });
  await settle(); await settleColorMotion();
  await colorKey('Escape');
  await evaluate('window.manualPropertySmoke.assertSubmenu(false, "row")');
  await colorKey('Right');
  await settleColorMotion();
  await evaluate('window.manualPropertySmoke.assertSubmenu(true, "submenu")');
  // 真实指针穿过菜单间隙进入表单，点击模式/输入框不能被外部点击处理器关闭。
  await colorClick('[role="tab"]:last-child');
  await colorInput('red', '256');
  await evaluate('window.manualPropertySmoke.assertColorDraft("#2563EB", false)');
  await colorInput('red', '64');
  await colorInput('green', '128');
  await colorInput('blue', '192');
  await evaluate('window.manualPropertySmoke.assertColorDraft("#4080C0", true)');
  await colorClick('[role="tab"]:first-child');
  await colorClick('[role="tab"]:last-child');
  await evaluate('window.manualPropertySmoke.assertColorDraft("#4080C0", true)');
  await colorClick('.action-btn.secondary');
  await evaluate('window.manualPropertySmoke.assertSubmenu(false, "row")');
  await colorClick('.slides-element-color__custom');
  await settleColorMotion();
  await evaluate('window.manualPropertySmoke.assertColorDraft("#2563EB", true)');
  await colorInput('red', '64');
  await colorInput('green', '128');
  await colorInput('blue', '192');
  await colorClick('.slides-element-color__rgb input[type="range"]');
  await colorKey('End');
  await evaluate('window.manualPropertySmoke.assertColorDraft("#FF80C0", true)');
  await colorInput('red', '64');
  await colorKey('Enter');
  await evaluate('window.manualPropertySmoke.assertCustomApplied("#4080C0"); window.manualPropertySmoke.resetColorChecks()');
  await settleColorMotion();
  console.log('Slides custom color: native hover, keyboard submenu, RGB/HSV/HEX, invalid ranges and single Apply passed');
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
    // Animation 实例不可跨 Electron structured clone；只等待清理，不把它们作为返回值。
    await evaluate('Promise.allSettled(document.getAnimations().map(animation => animation.finished)).then(() => undefined)');
    const screenshot = await window.webContents.capturePage();
    await writeFile(path.resolve(__dirname, `manual-properties-${theme}.png`), screenshot.toPNG());
    await evaluate('window.manualPropertySmoke.showMode("rgb")');
    await settle(); await settleColorMotion();
    await writeFile(path.resolve(__dirname, `manual-properties-rgb-${theme}.png`), (await window.webContents.capturePage()).toPNG());
    await evaluate('window.manualPropertySmoke.showMode("hsv")');
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
  const evaluate = (script: string): Promise<unknown> => window.webContents.executeJavaScript(script).catch((error: unknown) => {
    throw new Error(`Browser step failed: ${script}\n${String(error)}`);
  });
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await evaluate('window.shapeTextEditingSmoke = window.mountShapeTextEditingSmoke(); window.shapeTextEditingSmoke.ready()');
  async function click(which: string, double = false) {
    const point = await evaluate(`window.shapeTextEditingSmoke.point(${JSON.stringify(which)})`);
    if (typeof point !== 'object' || point === null || !('x' in point) || !('y' in point)
      || typeof point.x !== 'number' || typeof point.y !== 'number') throw new Error('Missing shape point');
    const position = { x: point.x, y: point.y };
    window.webContents.sendInputEvent({ type: 'mouseMove', ...position });
    for (const clickCount of double ? [1, 2] : [1]) {
      window.webContents.sendInputEvent({ type: 'mouseDown', ...position, button: 'left', clickCount });
      window.webContents.sendInputEvent({ type: 'mouseUp', ...position, button: 'left', clickCount });
    }
    await settle();
  }
  async function enter(commit = false) {
    const modifiers: ('control')[] = commit ? ['control'] : [];
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers });
    if (!commit) window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers });
    await settle();
  }
  await click('badge', true);
  await evaluate('window.shapeTextEditingSmoke.assertEditing()');
  await enter();
  await evaluate('window.shapeTextEditingSmoke.assertInput("Shape text\\n")');
  await evaluate('window.shapeTextEditingSmoke.verifyIme()');
  await settle();
  const screenshot = await window.webContents.capturePage();
  await writeFile(path.resolve(__dirname, 'shape-text-editing.png'), screenshot.toPNG());
  // 普通点击必须在 IPC 完成前结束文字输入并选中 B。
  await click('second');
  await evaluate('window.shapeTextEditingSmoke.assertSelected("second"); window.shapeTextEditingSmoke.assertSubmitted()');
  await writeFile(path.resolve(__dirname, 'shape-text-pending.png'), (await window.webContents.capturePage()).toPNG());
  await click('second', true);
  await enter();
  await evaluate('window.shapeTextEditingSmoke.assertInput("Second shape\\n"); window.shapeTextEditingSmoke.setInput("B pending")');
  await enter(true);
  await click('badge', true);
  await evaluate('window.shapeTextEditingSmoke.assertInput("修改形状"); window.shapeTextEditingSmoke.setInput("新会话草稿")');
  await evaluate('window.shapeTextEditingSmoke.resolve(0, true)');
  await settle();
  await evaluate('window.shapeTextEditingSmoke.assertInput("新会话草稿"); window.shapeTextEditingSmoke.present()');
  await settle();
  await evaluate('window.shapeTextEditingSmoke.assertInput("新会话草稿"); window.shapeTextEditingSmoke.assertSubmitted(2); window.shapeTextEditingSmoke.resolve(1, false)');
  await settle();
  await evaluate('window.shapeTextEditingSmoke.assertInput("新会话草稿"); window.shapeTextEditingSmoke.assertFailedDraft("B pending")');
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await settle();
  await click('second', true);
  await evaluate('window.shapeTextEditingSmoke.assertInput("B pending")');
  await enter(true);
  await evaluate('window.shapeTextEditingSmoke.assertSubmitted(3); window.shapeTextEditingSmoke.resolve(2, true)');
  await settle();
  await evaluate('window.shapeTextEditingSmoke.present()');
  await settle();
  await evaluate('window.shapeTextEditingSmoke.assertSettled()');
  // 同一 Stage 的普通 Text 也保留原生换行及 targetKind。
  await click('standalone', true);
  await enter();
  await evaluate('window.shapeTextEditingSmoke.assertInput("Plain text\\n")');
  await enter(true);
  await evaluate('window.shapeTextEditingSmoke.assertTextCommand(3, "Plain text\\n"); window.shapeTextEditingSmoke.resolve(3, true)');
  await settle(); await evaluate('window.shapeTextEditingSmoke.present()'); await settle();
  await evaluate('window.shapeTextEditingSmoke.assertSettled()');
  // 输入交接后立刻拉伸：无焦点文字也必须实时跟随，并在取消时回到原位置。
  await click('badge', true);
  await evaluate('window.shapeTextEditingSmoke.setInput("Pending resize")');
  await enter(true);
  const resize = await evaluate('window.shapeTextEditingSmoke.resizePoint()');
  if (typeof resize !== 'object' || resize === null || !('x' in resize) || !('y' in resize)
    || typeof resize.x !== 'number' || typeof resize.y !== 'number') throw new Error('Invalid resize position');
  const start = { x: resize.x, y: resize.y };
  const end = { x: start.x + 48, y: start.y + 48 };
  window.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseMove', ...end, modifiers: ['leftbuttondown'] });
  await settle();
  await evaluate('window.shapeTextEditingSmoke.assertPendingSize(3, 1.5)');
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'mouseUp', ...end, button: 'left', clickCount: 1 });
  await settle();
  await evaluate('window.shapeTextEditingSmoke.assertPendingSize(2.5, 1); window.shapeTextEditingSmoke.dispose()');
  console.log('Slides production Stage + queue: native Enter, outside selection, pending re-entry, late receipts, failure recovery and frame settlement passed');
}

/** 生产 Stage 中用原生指针／键盘覆盖属性草稿交接与异步队列，不调用属性组件内部方法。 */
async function verifySelectionToolbar(window: BrowserWindow): Promise<void> {
  const evaluate = (script: string): Promise<unknown> => window.webContents.executeJavaScript(script).catch((error: unknown) => {
    throw new Error(`Toolbar browser step failed: ${script}\n${String(error)}`);
  });
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await evaluate('window.shapeTextEditingSmoke = window.mountShapeTextEditingSmoke(); window.shapeTextEditingSmoke.ready()');
  async function point(expression: string) {
    const value = await evaluate(expression);
    if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)
      || typeof value.x !== 'number' || typeof value.y !== 'number') throw new Error('Missing toolbar control position');
    return { x: value.x, y: value.y };
  }
  async function click(expression: string) {
    const position = await point(expression);
    window.webContents.sendInputEvent({ type: 'mouseMove', ...position });
    window.webContents.sendInputEvent({ type: 'mouseDown', ...position, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...position, button: 'left', clickCount: 1 });
    await settle();
  }
  const control = (selector: string) => `window.shapeTextEditingSmoke.controlPoint(${JSON.stringify(selector)})`;
  async function number(selector: string, value: string) {
    await click(control(selector));
    await evaluate(`window.shapeTextEditingSmoke.prepareNumberInput(${JSON.stringify(selector)})`);
    await window.webContents.insertText(value);
    await settle();
  }
  async function key(keyCode: string) {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    // Enter 激活原生 button 依赖 keypress；Electron 原始 keyDown 不会自动补 char 事件。
    if (keyCode === 'Enter') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await settle();
  }
  await click('window.shapeTextEditingSmoke.point("standalone")');
  await click(control('[data-property="fontSize"]'));
  await evaluate('window.shapeTextEditingSmoke.assertFontMenu(14)');
  await key('Escape');
  await evaluate('window.shapeTextEditingSmoke.assertFontFocus()');
  await key('Down');
  await evaluate('window.shapeTextEditingSmoke.assertFontMenu(14)');
  await key('Escape');
  await click('window.shapeTextEditingSmoke.point("badge")');
  await evaluate('window.shapeTextEditingSmoke.assertToolbar("badge"); window.shapeTextEditingSmoke.assertGeometryUnchanged()');
  await click(control('[data-property="fill"]'));
  await evaluate('window.shapeTextEditingSmoke.assertPanelMotion(); window.shapeTextEditingSmoke.settlePanelMotion()');
  await click(control('[title="#16A34A"]'));
  await click(control('[data-property="size"]'));
  await number('.slides-element-property-popover input', '3');
  // 这个点击必须先提交 A 的尺寸再选中 B，并让 B 的工具条立即可用。
  await click('window.shapeTextEditingSmoke.point("second")');
  await evaluate('window.shapeTextEditingSmoke.assertToolbar("second"); window.shapeTextEditingSmoke.assertPopupClosed()');
  await click(control('[data-property="fill"]'));
  await click(control('[title="#DC2626"]'));
  await click('window.shapeTextEditingSmoke.point("standalone")');
  await number('.slides-element-property-toolbar input', '24');
  await key('Enter');
  await evaluate('window.shapeTextEditingSmoke.assertFontSize(24)');
  await click(control('[data-property="fontSize"]'));
  await evaluate('window.shapeTextEditingSmoke.assertFontMenu(24)');
  await key('Down');
  await key('Enter');
  await evaluate('window.shapeTextEditingSmoke.assertFontSize(28); window.shapeTextEditingSmoke.assertFontFocus()');
  await click(control('[data-property="fontSize"]'));
  await evaluate('window.shapeTextEditingSmoke.assertFontMenu(28)');
  await key('Escape');
  await evaluate('window.shapeTextEditingSmoke.assertFontSize(28); window.shapeTextEditingSmoke.assertFontFocus()');
  // 两端、非预设小数、无效值与 Escape 均经过原生输入，不能只测试 option 数据。
  for (const value of ['1', '400', '27.5']) {
    await number('.slides-element-property-toolbar input', value);
    await key('Enter');
    await evaluate(`window.shapeTextEditingSmoke.assertFontSize(${value})`);
  }
  for (const value of ['0', '401', '']) {
    await number('.slides-element-property-toolbar input', value);
    await key('Enter');
    await evaluate('window.shapeTextEditingSmoke.assertFontSize(27.5)');
  }
  await number('.slides-element-property-toolbar input', '55');
  await key('Escape');
  await click(control('[data-property="fontSize"]'));
  await evaluate('window.shapeTextEditingSmoke.assertFontSize(27.5); window.shapeTextEditingSmoke.assertFontMenu(null)');
  await click('window.shapeTextEditingSmoke.fontOptionPoint(24)');
  await evaluate('window.shapeTextEditingSmoke.assertFontSize(24); window.shapeTextEditingSmoke.assertFontFocus()');
  await click(control('[data-property="fontSize"]'));
  await evaluate('window.shapeTextEditingSmoke.assertFontMenu(24)');
  for (const theme of ['light', 'dark', 'moon-blue']) {
    await evaluate(`document.documentElement.setAttribute('data-linnya-ui-theme', ${JSON.stringify(theme)})`);
    await settle();
    // 只等待字号表面的主题过渡；Stage 的保存中旋转动画会持续到队列完成。
    await evaluate('Promise.allSettled(Array.from(document.querySelectorAll(".slides-element-property-toolbar, .slides-element-font-menu")).flatMap(element => element.getAnimations({ subtree: true })).map(animation => animation.finished)).then(() => undefined)');
    await writeFile(path.resolve(__dirname, `font-size-toolbar-${theme}.png`), (await window.webContents.capturePage()).toPNG());
  }
  // 直接切换相邻颜色入口，旧字号列表的外部点击监听不能关闭新面板。
  await click(control('[data-property="text"]'));
  await evaluate('window.shapeTextEditingSmoke.settlePanelMotion()');
  await click(control('[title="#9333EA"]'));
  await evaluate('window.shapeTextEditingSmoke.assertPropertyIntents(); window.shapeTextEditingSmoke.assertGeometryUnchanged()');
  await click('window.shapeTextEditingSmoke.point("second")');
  await click(control('[data-property="size"]'));
  await number('.slides-element-property-popover input', '4');
  await key('Escape');
  await evaluate('window.shapeTextEditingSmoke.assertPropertyIntents(); window.shapeTextEditingSmoke.assertPopupClosed()');
  const before = await evaluate('window.shapeTextEditingSmoke.toolbarRect()');
  const start = await point('window.shapeTextEditingSmoke.point("second")');
  const end = { x: start.x + 48, y: start.y + 48 };
  window.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseMove', ...end, modifiers: ['leftbuttondown'] });
  await settle();
  await evaluate('window.shapeTextEditingSmoke.assertToolbar("second", false)');
  window.webContents.sendInputEvent({ type: 'mouseUp', ...end, button: 'left', clickCount: 1 });
  await settle();
  await evaluate('window.shapeTextEditingSmoke.assertToolbar("second")');
  const after = await evaluate('window.shapeTextEditingSmoke.toolbarRect()');
  if (typeof before !== 'object' || before === null || !('left' in before) || typeof before.left !== 'number'
    || typeof after !== 'object' || after === null || !('left' in after) || typeof after.left !== 'number'
    || Math.abs(after.left - before.left - 48) > 1) throw new Error('Toolbar did not follow pending translation');
  await evaluate('window.shapeTextEditingSmoke.setZoom(0.5); window.shapeTextEditingSmoke.resizeHost(360); window.shapeTextEditingSmoke.ready()');
  await settle();
  await click('window.shapeTextEditingSmoke.point("badge")');
  await evaluate('window.shapeTextEditingSmoke.assertToolbar("badge")');
  await click(control('[data-property="fill"]'));
  await click(control('.slides-element-color__custom'));
  await evaluate('window.shapeTextEditingSmoke.settlePanelMotion()');
  await evaluate('window.shapeTextEditingSmoke.assertPopupPlacement(); window.shapeTextEditingSmoke.assertCustomPlacement()');
  await settle();
  await writeFile(path.resolve(__dirname, 'selection-property-toolbar-narrow.png'), (await window.webContents.capturePage()).toPNG());
  await key('Escape');
  await key('Escape');
  await evaluate('window.shapeTextEditingSmoke.assertToolbar("badge"); window.shapeTextEditingSmoke.assertPopupClosed()');
  await evaluate('window.shapeTextEditingSmoke.settleDismissal()');
  await writeFile(path.resolve(__dirname, 'selection-property-toolbar.png'), (await window.webContents.capturePage()).toPNG());
  await key('Delete');
  await evaluate('window.shapeTextEditingSmoke.assertDeleted("badge")');
  // 按钮与键盘必须进入同一生产删除入口；保存等待期间仍能连续删除其他作者对象。
  for (const id of ['second', 'standalone']) {
    // second 在上面的拖动中已移动 0.5 英寸，点击当前预览位置而非旧编译坐标。
    await click(`window.shapeTextEditingSmoke.point(${JSON.stringify(id)}, ${id === 'second' ? '0.5, 0.5' : '0, 0'})`);
    await evaluate(`window.shapeTextEditingSmoke.assertToolbar(${JSON.stringify(id)})`);
    if (id === 'standalone') {
      await click(control('[data-property="fontSize"]'));
      await evaluate('window.shapeTextEditingSmoke.assertFontMenu(24)');
      await key('Escape');
    }
    await click(control('[data-property="delete"]'));
    await evaluate(`window.shapeTextEditingSmoke.assertDeleted(${JSON.stringify(id)})`);
  }
  await evaluate('window.shapeTextEditingSmoke.dispose()');
  console.log('Slides selection toolbar: native numeric focus, A-to-B blur ownership, queued styles, Escape, drag, narrow viewport and icon deletion passed');
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
