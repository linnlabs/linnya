const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const { writeFile } = require('node:fs/promises');
const [url, runtime] = process.argv.slice(2);
app.setPath('userData', runtime);
app.commandLine.appendSwitch('disable-renderer-backgrounding');

async function run() {
  await app.whenReady();
  const window = new BrowserWindow({
    width: 900,
    height: 600,
    show: false,
    webPreferences: { backgroundThrottling: false, nodeIntegration: false, contextIsolation: true },
  });
  window.webContents.on('console-message', details => {
    if (details.level === 'error') console.error(details.message);
  });
  const evaluate = source =>
    window.webContents.executeJavaScript(source, true).catch(error => {
      throw new Error(
        `Browser evaluation failed: ${source}: ${error?.message ?? JSON.stringify(error)}`
      );
    });
  const settle = () => evaluate('window.menuFixture.settle()');
  const snapshot = () => evaluate('window.menuFixture.snapshot()');
  const mount = async options => {
    await evaluate(`window.menuFixture.mount(${JSON.stringify(options)})`);
    window.webContents.focus();
  };
  const press = async keyCode => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    if (keyCode === 'Space') window.webContents.sendInputEvent({ type: 'char', keyCode: ' ' });
    if (keyCode === 'ENTER') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await settle();
  };
  const focus = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const hover = selector =>
    evaluate(
      `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('mouseenter'))`
    );
  function withinViewport(state) {
    for (const panel of state.panels) {
      assert(panel.top >= 0 && panel.bottom <= state.viewport.height + 1, JSON.stringify(state));
      assert(panel.left >= 0 && panel.right <= state.viewport.width + 1, JSON.stringify(state));
    }
  }
  await window.loadURL(url);
  await evaluate(
    'new Promise(resolve => { const ready = () => window.menuFixture ? resolve() : requestAnimationFrame(ready); ready(); })'
  );

  for (const manual of [true, false]) {
    for (const theme of ['light', 'dark', 'moon-blue']) {
      for (const position of [
        { x: 20, y: 20 },
        { x: 690, y: 380 },
      ]) {
        await mount({ manual, theme, ...position, count: theme === 'dark' ? 171 : 170 });
        await focus('.custom-select__options .select-option');
        await press('RIGHT');
        let state = await snapshot();
        assert.equal(state.activeText, 'Option 0');
        assert.equal(state.panels.length, 1);
        assert(state.panels[0].scrollHeight > state.panels[0].clientHeight);
        withinViewport(state);
        await press('END');
        state = await snapshot();
        assert.equal(state.activeText, theme === 'dark' ? 'Option 170' : 'Option 169');
        assert(state.panels[0].activeVisible);
        await press('HOME');
        assert.equal((await snapshot()).activeText, 'Option 0');
        await press('LEFT');
        assert.equal((await snapshot()).panels.length, 0);
        await press('RIGHT');
        await press('END');
        await press('ENTER');
        assert.deepEqual((await snapshot()).selections, [theme === 'dark' ? 'row-170' : 'row-169']);
      }
    }

    // 快速关闭或切换发生在真实 rAF 前，不得留下迟到焦点。
    await mount({ manual });
    await evaluate(`(() => {
      const first = document.querySelector('.custom-select__options .select-option');
      first.focus();
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      document.querySelector('.custom-select__options .select-option:nth-of-type(2)').dispatchEvent(new MouseEvent('mouseenter'));
    })()`);
    await settle();
    assert.equal((await snapshot()).activeText, 'Long list›');
    assert(
      await evaluate(
        "document.querySelector('.custom-select__submenu').textContent.includes('Short child')"
      )
    );
    await click('.custom-select__submenu .select-option');
    await settle();
    assert.deepEqual((await snapshot()).selections, ['short']);
    await mount({ manual });
    await evaluate(`(() => {
      const first = document.querySelector('.custom-select__options .select-option');
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    })()`);
    await settle();
    assert.equal((await snapshot()).panels.length, 0);

    // 原生滚轮必须实际移动列表；末项只提交一次，滚动链不带动页面。
    await mount({ manual });
    await hover('.custom-select__options .select-option');
    await settle();
    let state = await snapshot();
    assert.equal(state.activeInSubmenu, false);
    const panel = state.panels[0];
    const wheel = async deltaY => {
      window.webContents.sendInputEvent({
        type: 'mouseWheel',
        x: Math.round(panel.left + 50),
        y: Math.round(panel.top + 50),
        deltaY,
        deltaX: 0,
        hasPreciseScrollingDeltas: true,
      });
      await settle();
    };
    await wheel(-1600);
    assert((await snapshot()).panels[0].scrollTop > 0);
    await wheel(-99999);
    state = await snapshot();
    assert(
      state.panels[0].scrollTop + state.panels[0].clientHeight >= state.panels[0].scrollHeight - 1
    );
    assert.equal(state.scrollY, 0);
    await click('.custom-select__submenu .select-option:last-child');
    await settle();
    assert.deepEqual((await snapshot()).selections, ['row-169']);

    // 父列表滚动／resize 后二级跟随；父项消失关闭后代。
    await mount({ manual, selectedIndex: 80 });
    await focus('.custom-select__options .select-option');
    await press('RIGHT');
    assert((await snapshot()).activeText.startsWith('Option 80'));
    await press('RIGHT');
    state = await snapshot();
    assert.equal(state.panels.length, 2);
    assert.equal(state.activeText, 'Setting 0');
    withinViewport(state);
    window.setContentSize(700, 480);
    await settle();
    state = await snapshot();
    withinViewport(state);
    assert.equal(state.panels.length, 2);
    await press('END');
    assert.equal((await snapshot()).activeText, 'Setting 170');
    await press('ESCAPE');
    assert((await snapshot()).activeText.startsWith('Option 80'));
    // Enter 原生激活父项仍须留在菜单内部（Teleport 与 manual 一致）。
    await press('ENTER');
    assert.equal((await snapshot()).activeText, 'Setting 0');
    await press('ESCAPE');
    await press('Space');
    assert.equal((await snapshot()).activeText, 'Setting 0');
    await evaluate(
      "document.querySelector('.custom-select__submenu:not(.custom-select__submenu--nested)').scrollTop = 0"
    );
    await settle();
    assert.equal((await snapshot()).panels.length, 1);
    window.setContentSize(900, 600);

    await mount({ manual });
    await hover('.custom-select__options .select-option:nth-of-type(3)');
    await settle();
    await click('.panel-item-value');
    assert.equal((await snapshot()).panelClicks, 1);
    assert.equal((await snapshot()).panels[0].overflowY, 'visible');
    await hover('.custom-select__options .select-option:nth-of-type(4)');
    await settle();
    assert.equal((await snapshot()).panels[0].overflowY, 'visible');
    assert(await evaluate("!!document.querySelector('.shared-color-picker-panel')"));
    await click('.shared-color-picker-panel__cell');
    await settle();
    assert.equal((await snapshot()).colorSelections, 1);
    assert.equal((await snapshot()).panels.length, 1);
  }
  window.setContentSize(260, 240);
  await mount({ manual: true, x: 20, y: 20 });
  await focus('.custom-select__options .select-option');
  await press('RIGHT');
  withinViewport(await snapshot());
  await press('END');
  assert((await snapshot()).panels[0].activeVisible);
  window.setContentSize(900, 600);
  await window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await mount({ manual: true, x: 690, y: 380 });
  await focus('.custom-select__options .select-option');
  await press('RIGHT');
  withinViewport(await snapshot());
  assert(await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"));
  if (process.env.LINNYA_MENU_BROWSER_SCREENSHOT) {
    await writeFile(
      process.env.LINNYA_MENU_BROWSER_SCREENSHOT,
      (await window.webContents.capturePage()).toPNG()
    );
  }
  window.destroy();
  console.log(
    'Menu Chromium checks passed: 170/171 rows, 3 themes, manual/Teleport, native keys/wheel, 2 levels, resize, custom content.'
  );
}
run().then(
  () => app.exit(0),
  error => {
    console.error(error?.stack ?? error?.message ?? JSON.stringify(error));
    app.exit(1);
  }
);
