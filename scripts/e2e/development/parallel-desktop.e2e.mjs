import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRendererDevelopmentServer } from '../../development/orchestration/startElectronDevelopment.mjs';
import { discoverWorkspaceDiskBackendPlugins } from '../../development/features/plugin-backend-composition/functions/discoverWorkspaceDiskBackendPlugins.mjs';
import {
  isSameMacosProcessInstanceAlive, readMacosDescendantInstances,
} from '../shell-tool/harness/macosElectronProcessObservation.mjs';

// 使用当前仓的正式 Main/Backend/Worker 制品，临时 cwd 只隔离各实例的运行数据。
// 不读取开发者数据库、不请求模型，也不关闭既有开发会话。
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
if (process.platform !== 'darwin') throw new Error('当前并行 Desktop 真机 gate 使用 macOS 进程归属观察器');
const require = createRequire(import.meta.url);
const { CONVERSATION_CONTROL_PROTOCOL_VERSION, CONVERSATION_CONTROL_TOKEN_HEADER } = require('@app/schemas');
const electronPath = require('electron');
const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'linnya-parallel-desktop-')));
const renderers = [];
const applications = [];
const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
const pluginDirectories = discoverWorkspaceDiskBackendPlugins(repositoryRoot).map(plugin => plugin.packageDir);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(label, read, app, timeout = 60_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await read();
    if (result) return result;
    if (app?.child.exitCode !== null && app?.child.exitCode !== undefined) {
      throw new Error(`${label}: Electron exited (${app.child.exitCode})\n${app.output.slice(-8000)}`);
    }
    await pause(100);
  }
  throw new Error(`${label} timed out\n${app?.output.slice(-8000) ?? ''}`);
}

function launch(directory, rendererUrl) {
  const env = { ...process.env };
  // 准入与路径均使用正式开发默认值，不继承调用者可能指定的共享目标。
  for (const key of [
    'LINNYA_API_PORT', 'LINNYA_WORKSPACE_DIR', 'LINNYA_CLI_CONNECTION_FILE',
    'LINNYA_PLUGIN_ROOT', 'LINNYA_CONVERSATION_ROOT', 'ELECTRON_RUN_AS_NODE',
  ]) delete env[key];
  const child = spawn(electronPath, [
    '--remote-debugging-port=0', path.join(repositoryRoot, 'dist/main/main.cjs'),
  ], {
    cwd: directory,
    env: {
      ...env, NODE_ENV: 'development', LINNYA_DEV_MODE: 'true', APP_VERSION: packageJson.version,
      VITE_DEV_SERVER_URL: rendererUrl,
      MODEL_REGISTRY_DEFAULTS_PATH: path.join(repositoryRoot,
        'src/domains/model-catalog/features/default-catalog/assets/default_models.json'),
      LINNYA_PLUGIN_BACKEND_DIRECT_DIRS: pluginDirectories.join(path.delimiter),
      LINNYA_PLUGIN_DIRECT_DIRS: pluginDirectories.join(path.delimiter),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const app = { child, directory, rendererUrl, output: '', exit: null, cdp: null, descendants: [] };
  app.exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  void app.exit.catch(() => {});
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', chunk => { app.output = `${app.output}${chunk}`.slice(-500_000); });
  }
  applications.push(app);
  return app;
}

async function connectPage(app) {
  const match = await waitFor('CDP endpoint', () => app.output.match(/DevTools listening on (ws:\/\/[^\s]+)/u), app);
  const browserUrl = new URL(match[1]);
  const pages = await waitFor('Renderer target', async () => {
    const targets = await (await fetch(`http://${browserUrl.host}/json/list`)).json();
    return targets.find(target => target.type === 'page' && target.url.startsWith(app.rendererUrl));
  }, app);
  const socket = new WebSocket(pages.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const cdp = {
    socket,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, 10_000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    async evaluate(expression) {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    },
  };
  app.cdp = cdp;
  return cdp;
}

async function readDescriptor(app) {
  return JSON.parse(await readFile(path.join(app.directory,
    '_dev_electron/runtime/conversation-control-v1.json'), 'utf8'));
}

async function handshake(app) {
  const descriptor = await readDescriptor(app);
  const response = await fetch(`http://127.0.0.1:${descriptor.port}/api/v1/conversation-control/handshake`, {
    method: 'POST', headers: {
      [CONVERSATION_CONTROL_TOKEN_HEADER]: descriptor.session_token, 'content-type': 'application/json',
    },
    body: JSON.stringify({ protocol_version: CONVERSATION_CONTROL_PROTOCOL_VERSION,
      client_name: 'linnya-cli', client_version: 'parallel-desktop-e2e' }),
  });
  assert.equal(response.status, 200);
  return descriptor;
}

async function closeApp(app) {
  await app.cdp.evaluate("window.electronAPI.windowAction('close'); true");
  const exit = await Promise.race([app.exit, pause(15_000).then(() => { throw new Error('Desktop close timed out'); })]);
  assert.equal(exit.code, 0);
  app.cdp.socket.close();
  await waitFor('Desktop process tree empty', async () => {
    const alive = await Promise.all(app.descendants.map(isSameMacosProcessInstanceAlive));
    return alive.every(value => !value);
  });
}

try {
  for (const label of ['worktree-a', 'worktree-b', 'worktree-c']) {
    const directory = path.join(root, label);
    await mkdir(directory);
    for (const artifact of ['extraResources', 'dist', 'src', 'packages']) {
      await symlink(path.join(repositoryRoot, artifact), path.join(directory, artifact), 'junction');
    }
    const renderer = await startRendererDevelopmentServer();
    renderers.push(renderer);
    launch(directory, renderer.url);
  }
  const instances = [...applications];
  await Promise.all(instances.map(app => waitFor('Desktop ready', () => app.output.includes('[Desktop] ready'), app)));
  for (const app of instances) app.descendants = await readMacosDescendantInstances(app.child.pid);
  const descriptors = await Promise.all(instances.map(handshake));
  assert.equal(new Set(descriptors.map(descriptor => descriptor.port)).size, 3);
  assert.equal(new Set(descriptors.map(descriptor => descriptor.app_instance_id)).size, 3);
  assert.equal(new Set(renderers.map(renderer => renderer.url)).size, 3);
  const qdrantUrls = instances.map(app => {
    const match = app.output.match(/Qdrant service started successfully on (127\.0\.0\.1:\d+)/u);
    assert.ok(match, 'current Qdrant ready endpoint');
    return `http://${match[1]}`;
  });
  assert.equal(new Set(qdrantUrls).size, 3);
  await Promise.all(instances.map(connectPage));
  for (let index = 0; index < instances.length; index++) {
    const app = instances[index];
    await waitFor('Vue mounted', () => app.cdp.evaluate('document.querySelector("#app")?.childElementCount > 0'), app);
    assert.equal(await app.cdp.evaluate('localStorage.getItem("parallel-instance")'), null);
    await app.cdp.evaluate(`localStorage.setItem('parallel-instance', '${index}')`);
    const response = await fetch(`${qdrantUrls[index]}/collections/instance_${index}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vectors: { size: 2, distance: 'Cosine' } }),
    });
    assert.equal(response.status, 200);
  }
  for (let index = 0; index < instances.length; index++) {
    const body = await (await fetch(`${qdrantUrls[index]}/collections`)).json();
    assert.deepEqual(body.result.collections.filter(item => item.name.startsWith('instance_')),
      [{ name: `instance_${index}` }]);
  }
  const duplicate = launch(instances[0].directory, instances[0].rendererUrl);
  const duplicateExit = await Promise.race([duplicate.exit, pause(10_000).then(() => { throw new Error('duplicate did not exit'); })]);
  assert.equal(duplicateExit.code, 0);
  assert.ok(duplicate.output.includes('已有运行实例'));
  await closeApp(instances[0]);
  await assert.rejects(readDescriptor(instances[0]), { code: 'ENOENT' });
  await Promise.all(instances.slice(1).map(handshake));
  assert.equal((await fetch(`${qdrantUrls[1]}/readyz`)).status, 200);
  await Promise.all(instances.slice(1).map(closeApp));
  console.info(JSON.stringify({ success: true, desktopInstances: 3, rendererOrigins: renderers.map(item => item.url),
    apiPorts: descriptors.map(item => item.port), qdrantUrls, duplicateRejected: true, independentShutdown: true }));
} catch (error) {
  console.error(error);
  // 诊断保存在运行目录外；finally 仍回收临时数据库与 profile。
  const diagnosticPath = `${root}.log`;
  await writeFile(diagnosticPath, applications.map(app =>
    `${path.basename(app.directory)} pid=${app.child.pid}\n${app.output}`).join('\n\n'));
  console.error(`并行 Desktop 诊断: ${diagnosticPath}`);
  throw error;
} finally {
  for (const app of applications) {
    if (app.child.exitCode === null && app.child.signalCode === null) {
      app.descendants = await readMacosDescendantInstances(app.child.pid);
    }
  }
  for (const app of applications) {
    app.cdp?.socket.close();
    if (app.child.exitCode === null && app.child.signalCode === null) app.child.kill('SIGTERM');
  }
  await Promise.all(applications.map(app => app.exit));
  await Promise.all(renderers.map(renderer => renderer.viteServer.close()));
  // 失败清理也只处理本测试记录过且 identity 未变的后代，不按进程名扫全机。
  for (const instance of applications.flatMap(app => app.descendants)) {
    if (await isSameMacosProcessInstanceAlive(instance)) process.kill(instance.pid, 'SIGKILL');
  }
  await waitFor('test child cleanup', async () => {
    const alive = await Promise.all(applications.flatMap(app => app.descendants).map(isSameMacosProcessInstanceAlive));
    return alive.every(value => !value);
  });
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
