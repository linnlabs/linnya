import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 脚本位于 scripts/benchmark；所有构建产物、依赖和 extraResources 都以仓库根目录为基准。
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let debugPort = Number(process.env.LINNYA_STYLE_SMOKE_DEBUG_PORT ?? 0);
const outputDir = resolve(process.env.LINNYA_STYLE_SMOKE_OUTPUT_DIR ?? '/tmp/linnya-style-smoke');
const runtimePluginRoot = resolve(outputDir, 'runtime/plugins');
const userDataRoot = resolve(outputDir, 'runtime/user-data');

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
  settings: ['设置', '外观', '选择主题'],
  knowledgebase: ['知识库', '新建知识库'],
  pluginstore: ['插件', 'Mindmap'],
};

const forbiddenTexts = {
  pluginstore: ['Linnya Platform'],
};

function wait(ms) {
  return new Promise((resolveWait) => {
    setTimeout(resolveWait, ms);
  });
}

function canListenOnPort(port) {
  return new Promise((resolveCheck) => {
    const server = net.createServer();
    server.once('error', () => {
      resolveCheck(false);
    });
    server.once('listening', () => {
      server.close(() => {
        resolveCheck(true);
      });
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailableDebugPort(startPort = 9223) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    if (await canListenOnPort(port)) {
      return port;
    }
  }

  throw new Error(`没有找到可用的 Electron CDP 端口: ${startPort}-${startPort + 99}`);
}

async function findAvailableVitePort() {
  for (const port of [5173, 5174]) {
    if (await canListenOnPort(port)) {
      return port;
    }
  }

  throw new Error('没有找到可用的 Vite 端口: 5173/5174');
}

function spawnLogged(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...options.env,
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const label = options.label ?? command;

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`);
  });

  return child;
}

function terminateProcessTree(child, signal) {
  if (!child.pid || child.killed) {
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function cleanupProcesses(electronProcess, viteProcess) {
  terminateProcessTree(electronProcess, 'SIGINT');
  terminateProcessTree(viteProcess, 'SIGTERM');

  setTimeout(() => {
    terminateProcessTree(electronProcess, 'SIGKILL');
    terminateProcessTree(viteProcess, 'SIGKILL');
  }, 3000).unref();
}

async function waitForHttpJson(path, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await getHttpJson(path);
    } catch (error) {
      lastError = error;
      await wait(250);
    }
  }

  throw new Error(`等待 ${path} 超时: ${lastError?.message ?? 'unknown error'}`);
}

async function waitForPageTarget(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let lastTargets = [];

  while (Date.now() < deadline) {
    const targets = await getHttpJson('/json/list');
    lastTargets = targets;
    const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    if (page) {
      return page;
    }

    await wait(500);
  }

  throw new Error(`没有找到 Electron page target，最后 targets=${JSON.stringify(lastTargets)}`);
}

function getHttpJson(path) {
  return new Promise((resolveJson, rejectJson) => {
    const request = http.get({
      host: '127.0.0.1',
      port: debugPort,
      path,
    }, (response) => {
      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        try {
          resolveJson(JSON.parse(data));
        } catch (error) {
          rejectJson(error);
        }
      });
    });

    request.on('error', rejectJson);
    request.setTimeout(3000, () => {
      request.destroy(new Error(`请求 ${path} 超时`));
    });
  });
}

let nextMessageId = 1;

async function connectCdp(webSocketUrl) {
  const socket = new globalThis.WebSocket(webSocketUrl);
  const pending = new Map();

  await new Promise((resolveOpen, rejectOpen) => {
    const timer = setTimeout(() => {
      rejectOpen(new Error('CDP WebSocket 连接超时'));
    }, 5000);

    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolveOpen();
    });
    socket.addEventListener('error', rejectOpen);
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      return;
    }

    const call = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(call.timer);

    if (message.error) {
      call.reject(new Error(JSON.stringify(message.error)));
      return;
    }

    call.resolve(message.result);
  });

  return {
    send(method, params = {}, timeoutMs = 10000) {
      const id = nextMessageId;
      nextMessageId += 1;
      socket.send(JSON.stringify({ id, method, params }));

      return new Promise((resolveSend, rejectSend) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectSend(new Error(`${method} 超时`));
        }, timeoutMs);

        pending.set(id, {
          resolve: resolveSend,
          reject: rejectSend,
          timer,
        });
      });
    },
    close() {
      socket.close();
    },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }

  return result.result?.value;
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

  if (expected.view === 'settings' && state.themeOptions < 2) {
    throw new Error(`${expected.path} 设置页主题选项数量少于 2: ${state.themeOptions}`);
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
  if (debugPort === 0) {
    debugPort = await findAvailableDebugPort();
  }

  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  console.log(`[electron-style-smoke] 使用 Electron CDP 端口: ${debugPort}`);
  const vitePort = await findAvailableVitePort();
  const viteUrl = `http://127.0.0.1:${vitePort}`;
  console.log(`[electron-style-smoke] 使用 Vite URL: ${viteUrl}`);

  const viteProcess = spawnLogged('npx', ['vite', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
    label: 'vite',
  });

  const electronProcess = spawnLogged('./node_modules/.bin/electron', [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataRoot}`,
    'dist/main/main.cjs',
  ], {
    label: 'electron',
    env: {
      NODE_ENV: 'development',
      LINNYA_DEV_MODE: 'true',
      LINNYA_DISABLE_UPDATE_CHECKS: '1',
      LINNYA_PLUGIN_ROOT: runtimePluginRoot,
      LINNYA_BUNDLED_PLUGIN_ROOT: resolve(repoRoot, 'extraResources/plugins'),
      VITE_DEV_SERVER_URL: viteUrl,
      APP_VERSION: process.env.npm_package_version ?? '0.0.0',
    },
  });

  const cleanup = () => {
    cleanupProcesses(electronProcess, viteProcess);
  };

  process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  try {
    await waitForHttpJson('/json/version');
    const page = await waitForPageTarget();

    const cdp = await connectCdp(page.webSocketDebuggerUrl);
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

    cdp.close();
    writeFileSync(resolve(outputDir, 'summary.json'), `${JSON.stringify(results, null, 2)}\n`);
    console.log(`[electron-style-smoke] 通过，截图输出: ${outputDir}`);
  } finally {
    cleanup();
  }
}

runSmoke().catch((error) => {
  console.error('[electron-style-smoke] 失败:', error);
  process.exitCode = 1;
});
