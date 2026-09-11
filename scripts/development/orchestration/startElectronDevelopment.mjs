import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'vite';

import { discoverWorkspaceDiskBackendPlugins } from '../features/plugin-backend-composition/functions/discoverWorkspaceDiskBackendPlugins.mjs';

import { createDevelopmentProcessScope } from '../features/build-session/orchestration/createDevelopmentProcessScope.mjs';
import { runDevelopmentBuildGraph } from '../features/build-session/orchestration/runDevelopmentBuildGraph.mjs';
import { createElectronDevelopmentBuilds } from '../features/build-session/definitions/electronDevelopmentBuilds.mjs';

const SUPPORTED_RENDERER_PORTS = new Set([5173, 5174]);

function readListeningPort(viteServer) {
  const address = viteServer.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('Vite 已启动，但无法读取 renderer dev server 的监听端口');
  }
  return address.port;
}

export async function startRendererDevelopmentServer() {
  // Vite 直接持有端口后再返回实际结果，避免“先探测空闲端口、稍后再绑定”的竞态。
  const viteServer = await createServer({
    server: {
      // Electron renderer 只需要本机访问；固定 IPv4 回环地址，避免 localhost 在
      // IPv4/IPv6 上分别命中不同进程，也不把开发服务暴露到局域网。
      host: '127.0.0.1',
      port: 5173,
    },
  });

  await viteServer.listen();
  const port = readListeningPort(viteServer);
  if (!SUPPORTED_RENDERER_PORTS.has(port)) {
    await viteServer.close();
    throw new Error(
      `Vite 自动选择了 ${port}，但 Linnya 开发后端只允许 5173/5174。`
      + '请释放其中一个端口后重试。',
    );
  }

  const url = `http://127.0.0.1:${port}`;
  viteServer.printUrls();
  console.info(`[dev:electron] Electron renderer URL: ${url}`);
  return { viteServer, url };
}

export async function runElectronDevelopment({ buildOnly = false } = {}) {
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) throw new Error('请通过 pnpm run dev:electron 启动开发会话');
  const plugins = discoverWorkspaceDiskBackendPlugins(repositoryRoot);
  const configuredDiskBackendDirs = (process.env.LINNYA_PLUGIN_BACKEND_DIRECT_DIRS ?? '')
    .split(path.delimiter).map(entry => entry.trim()).filter(Boolean);
  const backendDirectDirs = [...new Set([
    ...plugins.map(plugin => plugin.packageDir), ...configuredDiskBackendDirs,
  ])];
  const scope = createDevelopmentProcessScope();
  const requestedStop = Promise.withResolvers();
  const requestStop = () => requestedStop.resolve('stop');
  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);
  let rendererStartup;
  const tasks = createElectronDevelopmentBuilds({ repositoryRoot, pnpmCli, plugins });
  tasks.push({ id: 'renderer', dependencies: ['schemas', 'provider-catalog', 'wasm'] });
  const failed = scope.failure.then(error => { throw error; });

  try {
    const outcome = await Promise.race([
      runDevelopmentBuildGraph(tasks, task => {
        if (task.id !== 'renderer') return scope.start(task);
        rendererStartup = startRendererDevelopmentServer();
        return { ready: rendererStartup };
      }).then(() => 'ready'),
      failed,
      requestedStop.promise,
    ]);
    if (outcome === 'stop' || buildOnly) return;
    const { url } = await rendererStartup;
    const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
    const require = createRequire(import.meta.url);
    // 已收到本轮全部成功事件；此处不再运行 wait-on 或第二轮编译。
    const electron = scope.start({
      id: 'electron', cwd: repositoryRoot, file: process.execPath,
      args: [require.resolve('electron/cli.js'), 'dist/main/main.cjs'], watch: false,
      env: {
        NODE_ENV: 'development', LINNYA_DEV_MODE: 'true', APP_VERSION: packageJson.version,
        VITE_DEV_SERVER_URL: url,
        LINNYA_PLUGIN_BACKEND_DIRECT_DIRS: backendDirectDirs.join(path.delimiter),
      },
    });
    await Promise.race([electron.done, failed, requestedStop.promise]);
  } finally {
    await scope.stop();
    if (rendererStartup) {
      const renderer = await rendererStartup.catch(() => null);
      await renderer?.viteServer.close();
    }
    process.off('SIGINT', requestStop);
    process.off('SIGTERM', requestStop);
  }
}

const invokedModuleUrl = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(process.argv[1]).href;

if (import.meta.url === invokedModuleUrl) {
  runElectronDevelopment({ buildOnly: process.argv.includes('--build-only') }).catch((error) => {
    console.error('[dev:electron] 启动失败:', error);
    process.exitCode = 1;
  });
}
