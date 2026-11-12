import { connectProbePage, createProbeClient } from '../development/features/desktop-probe/orchestration/probeClient.mjs';
import { evaluate } from '../development/features/desktop-probe/infrastructure/cdpClient.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outputDir = resolve(process.env.LINNYA_STYLE_SMOKE_OUTPUT_DIR ?? '/tmp/linnya-style-smoke');

const screenshotCases = [
  { path: 'light-main.png', theme: 'light', view: 'main' },
  { path: 'light-settings.png', theme: 'light', view: 'settings' },
  { path: 'dark-settings.png', theme: 'dark', view: 'settings' },
  { path: 'dark-main.png', theme: 'dark', view: 'main' },
  { path: 'dark-knowledgebase.png', theme: 'dark', view: 'knowledgebase' },
  { path: 'light-knowledgebase.png', theme: 'light', view: 'knowledgebase' },
  { path: 'light-plugin-store.png', theme: 'light', view: 'pluginstore' },
  { path: 'dark-plugin-store.png', theme: 'dark', view: 'pluginstore' },
];

const requiredTexts = {
  main: ['新对话', '新项目'],
  settings: ['设置', '外观', '跟随系统'],
  knowledgebase: ['知识库', '新建知识库'],
  pluginstore: ['插件', 'Slides'],
};

const forbiddenTexts = {
  pluginstore: ['Linnya Platform'],
};

function wait(ms) {
  return new Promise((resolveWait) => {
    setTimeout(resolveWait, ms);
  });
}

async function captureScreenshot(cdp, filePath) {
  const screenshot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  }, 15000);

  writeFileSync(filePath, Buffer.from(screenshot.data, 'base64'));
}

async function applyTheme(cdp, theme) {
  const applied = await evaluate(cdp, `(() => {
    const uiStore = window.__APP_INSTANCE__?.config.globalProperties.$uiStore;
    if (!uiStore) return false;
    uiStore.setTheme(${JSON.stringify(theme)});
    return true;
  })()`);
  if (!applied) {
    throw new Error(`无法通过 UI store 切换主题: ${theme}`);
  }
  await wait(100);
}

async function openView(cdp, view) {
  if (view === 'main') {
    await evaluate(cdp, `(() => {
      document.querySelector('.settings-modal-close')?.click();
      document.querySelector('.project-nav-back-button')?.click();
    })()`);
    await wait(300);

    const opened = await evaluate(cdp, `(() => {
      const newConversationButton = Array.from(document.querySelectorAll('button'))
        .find((button) => button.innerText.trim() === '新对话');
      newConversationButton?.click();
      return Boolean(newConversationButton);
    })()`);
    if (!opened) {
      throw new Error('无法通过稳定的“新对话”入口返回主界面');
    }
    await wait(800);
    return;
  }

  if (view === 'settings') {
    const isOpen = await evaluate(cdp, `Boolean(document.querySelector('.settings-modal-overlay'))`);
    if (!isOpen) {
      await evaluate(cdp, `(() => {
        const settingsButton = Array.from(document.querySelectorAll('button'))
          .find((button) => button.getAttribute('aria-label') === '设置');
        settingsButton?.click();
      })()`);
    }

    await wait(800);
    return;
  }

  if (view === 'knowledgebase') {
    await evaluate(cdp, `(() => {
      document.querySelector('.settings-modal-close')?.click();
      const knowledgeBaseButton = Array.from(document.querySelectorAll('button'))
        .find((button) => button.getAttribute('aria-label') === '知识库' || button.innerText.trim() === '知识库');
      knowledgeBaseButton?.click();
    })()`);
    await wait(1400);
    return;
  }

  if (view === 'pluginstore') {
    await evaluate(cdp, `(() => {
      document.querySelector('.settings-modal-close')?.click();
      const pluginStoreButton = Array.from(document.querySelectorAll('button'))
        .find((button) => button.innerText.trim() === '插件');
      pluginStoreButton?.click();
    })()`);
    await wait(1400);
    return;
  }

  throw new Error(`未知 smoke 视图: ${view}`);
}

async function closeUpdateDialogIfVisible(cdp) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const closed = await evaluate(cdp, `(() => {
      if (!document.body.innerText.includes('发现新版本')) {
        return false;
      }

      const dialogContent = document.querySelector('.update-dialog-content');
      const laterButton = Array.from(dialogContent?.querySelectorAll('button') ?? [])
        .find((button) => button.innerText.includes('稍后提醒') || button.innerText.includes('关闭'));
      const closeButton = laterButton ?? dialogContent?.closest('.modal-container')?.querySelector('.modal-close');
      closeButton?.click();
      return Boolean(closeButton);
    })()`);

    if (!closed) {
      return;
    }

    await wait(600);
  }
}

async function assertViewState(cdp, expected) {
  const state = await evaluate(cdp, `(() => ({
    theme: document.documentElement.getAttribute('data-linnya-ui-theme'),
    backgroundColor: getComputedStyle(document.body).backgroundColor,
    oldThemeClasses: ['light-mode', 'green-mode', 'pink-mode', 'brown-mode']
      .filter((className) => document.documentElement.classList.contains(className) || document.body.classList.contains(className)),
    themeOptions: document.querySelectorAll('.appearance-theme-option').length,
    themeSelector: document.querySelector('.appearance-theme-selector')?.getAttribute('aria-label'),
    text: document.body.innerText,
    hasUpdateDialog: document.body.innerText.includes('发现新版本'),
    brokenImages: Array.from(document.images)
      .filter((image) => image.complete && image.naturalWidth === 0)
      .map((image) => image.alt || image.currentSrc || image.src),
  }))()`);

  if (state.theme !== expected.theme) {
    throw new Error(`${expected.path} 主题属性不符合预期: ${JSON.stringify(state)}`);
  }

  const backgroundChannels = state.backgroundColor.match(/[\d.]+/gu)?.slice(0, 3).map(Number) ?? [];
  if (backgroundChannels.length !== 3) {
    throw new Error(`${expected.path} 无法解析页面背景色: ${state.backgroundColor}`);
  }
  const backgroundBrightness = backgroundChannels.reduce((sum, channel) => sum + channel, 0) / 3;
  if (expected.theme === 'dark' && backgroundBrightness >= 128) {
    throw new Error(`${expected.path} 暗色主题仍呈现浅色背景: ${state.backgroundColor}`);
  }
  if (expected.theme === 'light' && backgroundBrightness <= 180) {
    throw new Error(`${expected.path} 浅色主题仍呈现暗色背景: ${state.backgroundColor}`);
  }

  if (state.oldThemeClasses.length > 0) {
    throw new Error(`${expected.path} 出现旧主题 class: ${state.oldThemeClasses.join(', ')}`);
  }

  if (expected.view === 'settings' && (state.themeOptions < 2 || state.themeSelector !== '选择主题')) {
    throw new Error(`${expected.path} 设置页主题选择器不完整`);
  }

  if (state.hasUpdateDialog) {
    throw new Error(`${expected.path} 截图时仍有更新弹窗遮挡`);
  }

  if (expected.view === 'pluginstore' && state.brokenImages.length > 0) {
    throw new Error(`${expected.path} 插件页存在加载失败的图片: ${state.brokenImages.join(', ')}`);
  }

  const missingTexts = requiredTexts[expected.view].filter((text) => !state.text.includes(text));
  if (missingTexts.length > 0) {
    throw new Error(`${expected.path} 缺少关键文案: ${missingTexts.join(', ')}`);
  }

  const unexpectedTexts = (forbiddenTexts[expected.view] ?? []).filter((text) => state.text.includes(text));
  if (unexpectedTexts.length > 0) {
    throw new Error(`${expected.path} 出现不应展示的文案: ${unexpectedTexts.join(', ')}`);
  }

  return {
    theme: state.theme,
    backgroundColor: state.backgroundColor,
    themeOptions: state.themeOptions,
    textMatched: requiredTexts[expected.view],
  };
}

async function runSmoke() {
  mkdirSync(outputDir, { recursive: true });
  const name = `style-smoke-${process.pid}`;
  const probe = createProbeClient({ name });
  let cdp;
  try {
    await probe.run('up');
    ({ cdp } = await connectProbePage(name));
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1400,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await wait(5000);
    await closeUpdateDialogIfVisible(cdp);

    const results = [];
    for (const smokeCase of screenshotCases) {
      await applyTheme(cdp, smokeCase.theme);
      await closeUpdateDialogIfVisible(cdp);
      await openView(cdp, smokeCase.view);
      await closeUpdateDialogIfVisible(cdp);
      const assertion = await assertViewState(cdp, smokeCase);
      const screenshotPath = resolve(outputDir, smokeCase.path);
      await captureScreenshot(cdp, screenshotPath);
      results.push({
        ...smokeCase,
        screenshotPath,
        assertion,
      });
    }

    writeFileSync(resolve(outputDir, 'summary.json'), `${JSON.stringify(results, null, 2)}\n`);
    console.log(`[electron-style-smoke] 通过，截图输出: ${outputDir}`);
  } finally {
    cdp?.close();
    await probe.run('stop', '--clean');
  }
}

runSmoke().catch((error) => {
  console.error('[electron-style-smoke] 失败:', error);
  process.exitCode = 1;
});
