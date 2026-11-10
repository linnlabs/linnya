import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, openSync, realpathSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { discoverWorkspaceDiskBackendPlugins } from '../../plugin-backend-composition/functions/discoverWorkspaceDiskBackendPlugins.mjs';
import { resolveDevelopmentBackendDirectories } from '../../plugin-backend-composition/functions/resolveDevelopmentBackendDirectories.mjs';
import { readDesktopCdpPort, readDesktopReady } from '../functions/desktopLaunchMarkers.mjs';
import { idleMs, ProbeError, repoRoot } from '../definitions/probeContract.mjs';
import { connectCdp, evaluate, findPage, waitFor } from '../infrastructure/cdpClient.mjs';
import { readOptional, readSession, writeSession } from '../infrastructure/instanceStore.mjs';
import { startIsolatedRenderer } from '../infrastructure/rendererProcess.mjs';
import { observeTree, readProcessTable, sameProcess, stopOwnedTree } from '../infrastructure/processTree.mjs';

const require = createRequire(import.meta.url);
const root = process.argv[2];
const session = readSession(root);
const { options, logs } = session;
const toy = options.entry === 'toy';
const stopping = Promise.withResolvers();
const owned = new Map();
const ownedChildren = new Map();
let electron;
let vite;
let cdp;
let sequence = 0;
let stopReason;
let desktopExit;

function requestStop(reason) {
  stopReason ??= reason;
  stopping.resolve();
}
process.on('SIGTERM', () => requestStop('requested'));
process.on('SIGINT', () => requestStop('requested'));

function save(fields) {
  Object.assign(session, fields);
  writeSession(root, session);
}

function checkStarting() {
  if (stopReason) throw new ProbeError('START_FAILED', `启动已停止：${stopReason}`);
}

function watchRenderer(event) {
  const { method, params } = event;
  let level;
  let text;
  if (method === 'Runtime.consoleAPICalled') {
    level = params.type === 'warning' ? 'warn' : params.type;
    text = params.args.map(argument => argument.value ?? argument.description ?? '').join(' ');
  } else if (method === 'Runtime.exceptionThrown') {
    level = 'error';
    text = params.exceptionDetails.exception?.description ?? params.exceptionDetails.text;
  } else if (method === 'Log.entryAdded') {
    level = params.entry.level === 'warning' ? 'warn' : params.entry.level;
    // “资源加载失败”本身不说是哪个地址；带上 URL 才能直接定位，不必再抓网络请求。
    text = params.entry.url ? `${params.entry.text} ${params.entry.url}` : params.entry.text;
  } else {
    return;
  }
  appendFileSync(logs.renderer, JSON.stringify({
    seq: ++sequence, time: Date.now(), level, text: text.slice(0, 4000),
  }) + '\n', { mode: 0o600 });
}

async function connectRenderer() {
  const page = await findPage(session.cdpPort, session.viteUrl);
  if (!page) return false;
  const connection = await connectCdp(page.webSocketDebuggerUrl);
  try {
    connection.onEvent(watchRenderer);
    await connection.send('Runtime.enable');
    await connection.send('Log.enable');
    await connection.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    cdp?.close();
    cdp = connection;
    return true;
  } catch (error) {
    connection.close();
    throw error;
  }
}

function startElectron() {
  const profile = join(root, 'user-data');
  const desktop = openSync(logs.desktop, 'w', 0o600);
  const entry = toy ? fileURLToPath(new URL('../acceptance/toy-app', import.meta.url)) : join(repoRoot, 'dist/main/main.cjs');
  const bootstrap = fileURLToPath(new URL('../runtime/electronBootstrap.cjs', import.meta.url));
  rmSync(join(profile, 'DevToolsActivePort'), { force: true });
  const dev = options.mode === 'dev';
  const plugins = dev && !toy ? discoverWorkspaceDiskBackendPlugins(repoRoot) : [];
  try {
    electron = spawn(require('electron'), [
      '-r', bootstrap, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows', entry,
    ], {
      cwd: repoRoot,
      detached: true,
      stdio: ['ignore', desktop, desktop],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '',
        NODE_ENV: 'development', APP_VERSION: require(join(repoRoot, 'package.json')).version,
        LINNYA_DEV_MODE: String(dev), LINNYA_DEV_INSTANCE_ROOT: root,
        LINNYA_DISABLE_UPDATE_CHECKS: '1', LINNYA_API_PORT: '',
        LINNYA_WORKSPACE_DIR: join(root, 'workspace'), LINNYA_CONVERSATION_ROOT: '',
        LINNYA_PLUGIN_ROOT: join(root, 'plugins'),
        LINNYA_CLI_CONNECTION_FILE: session.connectionFile,
        LINNYA_BUNDLED_PLUGIN_ROOT: join(repoRoot, 'extraResources/plugins'),
        LINNYA_PLUGIN_BACKEND_LOADING: 'disk', LINNYA_PLUGIN_DIRECT_DIRS: '',
        LINNYA_PLUGIN_BACKEND_DIRECT_DIRS: resolveDevelopmentBackendDirectories(plugins),
        VITE_DEV_SERVER_URL: session.viteUrl,
        LINNYA_PROBE_WINDOW: options.window,
        LINNYA_PROBE_WIDTH: String(options.width), LINNYA_PROBE_HEIGHT: String(options.height),
      },
    });
  } finally {
    closeSync(desktop);
  }
  electron.once('error', error => { desktopExit = error.message; requestStop('electron-error'); });
  electron.once('exit', (code, signal) => { desktopExit = code ?? signal; requestStop('electron-exit'); });
}

function observeChildren() {
  const table = readProcessTable();
  for (const [pid, entry] of observeTree(session.supervisor, table)) {
    if (pid !== process.pid) ownedChildren.set(pid, entry);
  }
  for (const [pid, entry] of observeTree(session.electron, table)) owned.set(pid, entry);
  // 子进程可能在看管器退出后改挂到 launchd，接管时仍需要此前确认过的进程身份。
  const live = [...ownedChildren.values()].filter(entry => sameProcess(entry, table));
  if (live.length !== session.processes?.length ||
      live.some((entry, index) => !sameProcess(session.processes[index], table) || session.processes[index].pid !== entry.pid)) {
    save({ processes: live });
  }
}

let failure;
try {
  const supervisor = readProcessTable().get(process.pid);
  save({ supervisor });
  appendFileSync(logs.renderer, '', { mode: 0o600, flag: 'w' });
  if (toy) {
    const { createServer } = await import('node:http');
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(readOptional(fileURLToPath(new URL('../acceptance/toy-app/page.html', import.meta.url))));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(session.preferredRendererPort ?? 0, '127.0.0.1', resolve);
    });
    vite = { close: () => new Promise(resolve => server.close(resolve)) };
    save({ viteUrl: `http://127.0.0.1:${server.address().port}` });
  } else {
    vite = await startIsolatedRenderer({
      cacheDir: join(root, 'vite-cache'), logPath: logs.vite, port: session.preferredRendererPort,
    });
    void vite.exited.then(() => requestStop('vite-exit'));
    save({ viteUrl: vite.url, vite: readProcessTable().get(vite.child.pid) });
  }
  checkStarting();
  startElectron();
  const identity = await waitFor(() => {
    checkStarting();
    return readProcessTable().get(electron.pid);
  }, 'Electron 进程身份', 2_000);
  save({ electron: identity });
  observeChildren();
  const port = await waitFor(() => {
    checkStarting();
    // dev 模式把 Chromium sessionData 放到 profile/session，端口以本次 Electron 输出为准。
    return readDesktopCdpPort(readOptional(logs.desktop));
  }, 'Electron 调试端口', 15_000);
  save({ cdpPort: port });
  await waitFor(() => { checkStarting(); return connectRenderer(); }, '专用 Renderer', 25_000);
  const ready = await waitFor(async () => {
    checkStarting();
    const log = readOptional(logs.desktop);
    const marker = readDesktopReady(log);
    // Renderer 与 Backend 产物不同步时 RPC 会被拒，Desktop 永远等不到首屏；直接报出原因，不等超时。
    const mismatch = log?.match(/^.*RPC 字段不合法.*$/m);
    if (mismatch) throw new ProbeError('BUILD_MISMATCH', mismatch[0].slice(0, 200), 'Renderer 与 Backend 产物不同步：运行 pnpm -s probe restart（会自动重建）');
    if (!toy && !marker) return false;
    if (!log.includes('[probe-bootstrap] ok') || !log.includes(`[probe-bootstrap] window intercepted mode=${options.window} wantsShow=true`)) {
      throw new ProbeError('BOOTSTRAP_FAILED', 'Electron 窗口引导未生效');
    }
    const selector = toy ? 'button' : '.project-row, .project-chat-panel';
    // 首屏出现时插件可能仍在加载；等加载结束再报就绪，否则紧接着打开插件文档会碰到“未注册类型”。
    const plugins = toy ? 'null' : 'globalThis.__LINNYA_RENDERER_PLUGIN_LOADER_DIAGNOSTICS__?.status';
    const facts = await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)}) &&
      ({ viewport: { width: innerWidth, height: innerHeight }, plugins: ${plugins} })`);
    if (!facts || (!toy && !['success', 'failed'].includes(facts.plugins))) return false;
    return { ...marker, viewport: facts.viewport, plugins: facts.plugins };
  }, 'Desktop 就绪', 25_000);
  if (!toy && (
    new URL(ready.rendererUrl).origin !== session.viteUrl ||
    realpathSync(ready.profile) !== realpathSync(join(root, 'user-data'))
  )) {
    throw new ProbeError('START_FAILED', 'Desktop 实际 Renderer 或 profile 不属于此探针');
  }
  observeChildren();
  const { viewport } = ready;
  const sizeAdjusted = viewport.width !== options.width || viewport.height !== options.height;
  save({
    state: 'ready', apiPort: ready.apiPort, viewport, sizeAdjusted, readyMs: Date.now() - session.startedAt,
    ...(ready.plugins === 'failed' && { pluginLoad: 'failed' }),
  });
  while (!stopReason) {
    observeChildren();
    if (Date.now() - statSync(join(root, 'last-used')).mtimeMs > idleMs) requestStop('idle');
    if (!cdp.connected && !stopReason) await connectRenderer().catch(error => console.error(error.message));
    await Promise.race([stopping.promise, sleep(750)]);
  }
  if (stopReason === 'vite-exit') throw new ProbeError('START_FAILED', 'Vite 已提前结束', logs.vite);
  if (stopReason === 'electron-error' || stopReason === 'electron-exit') {
    throw new ProbeError('START_FAILED', `Electron 已结束：${desktopExit}`);
  }
} catch (error) {
  failure = { code: error.code ?? 'START_FAILED', message: error.message };
  console.error(error);
} finally {
  cdp?.close();
  try {
    observeChildren();
    await stopOwnedTree(session.electron, owned);
    try {
      await vite?.close();
    } catch (error) {
      console.error(error);
    }
    // Vite 的 esbuild 服务属于看管进程。确认它们也退出后才能报告 stop 成功。
    const cleanup = await stopOwnedTree(undefined, ownedChildren, 120);
    if (cleanup.remaining.length) failure = { code: 'STOP_FAILED', message: '仍有自有进程存活' };
    save({ state: failure ? 'failed' : 'stopped', failure, cleanup, stopReason, stoppedAt: Date.now() });
  } catch (error) {
    console.error(error);
    save({ state: 'failed', failure: { code: 'STOP_FAILED', message: error.message } });
  }
}
