import { concurrently } from 'concurrently';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

import { discoverWorkspaceDiskBackendPlugins } from '../features/plugin-backend-composition/functions/discoverWorkspaceDiskBackendPlugins.mjs';

const SUPPORTED_RENDERER_PORTS = new Set([5173, 5174]);

const DEVELOPMENT_COMMANDS = [
  { command: 'pnpm run watch:main', name: 'main' },
  { command: 'pnpm run watch:preload', name: 'preload' },
  { command: 'pnpm run watch:measurement-worker', name: 'measurement-worker' },
  { command: 'pnpm run watch:measurement-preload', name: 'measurement-preload' },
  { command: 'pnpm run watch:slides-raster-worker', name: 'slides-raster-worker' },
  { command: 'pnpm run watch:slides-raster-preload', name: 'slides-raster-preload' },
  { command: 'pnpm run watch:slides-brush-worker', name: 'slides-brush-worker' },
  { command: 'pnpm run watch:slides-brush-preload', name: 'slides-brush-preload' },
  { command: 'pnpm run watch:worker', name: 'worker' },
  { command: 'pnpm run watch:backend:dev', name: 'backend' },
  { command: 'pnpm run watch:sandbox-runner', name: 'sandbox-runner' },
  { command: 'pnpm run watch:command-runner', name: 'command-runner' },
  { command: 'pnpm run watch:schemas', name: 'schemas' },
  { command: 'pnpm run start:electron', name: 'electron' },
];

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

function resolveFailureExitCode(closeEvents) {
  if (!Array.isArray(closeEvents)) return 1;
  const failedEvent = closeEvents.find(({ exitCode, killed }) => (
    !killed && typeof exitCode === 'number' && exitCode !== 0
  ));
  return failedEvent?.exitCode ?? 1;
}

export async function runElectronDevelopment() {
  const { viteServer, url } = await startRendererDevelopmentServer();
  const workspaceDiskBackendDirs = discoverWorkspaceDiskBackendPlugins()
    .map((plugin) => plugin.packageDir);
  const configuredDiskBackendDirs = (process.env.LINNYA_PLUGIN_BACKEND_DIRECT_DIRS ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const backendDirectDirs = [...new Set([
    ...workspaceDiskBackendDirs,
    ...configuredDiskBackendDirs,
  ])];
  const commands = DEVELOPMENT_COMMANDS.map((command) => ({
    ...command,
    env: {
      VITE_DEV_SERVER_URL: url,
      ...(backendDirectDirs.length > 0
        ? { LINNYA_PLUGIN_BACKEND_DIRECT_DIRS: backendDirectDirs.join(path.delimiter) }
        : {}),
    },
  }));

  try {
    const { result } = concurrently(commands, {
      handleInput: true,
      killOthersOn: ['failure', 'success'],
      prefix: 'name',
    });
    await result;
  } catch (closeEvents) {
    process.exitCode = resolveFailureExitCode(closeEvents);
  } finally {
    await viteServer.close();
  }
}

const invokedModuleUrl = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(process.argv[1]).href;

if (import.meta.url === invokedModuleUrl) {
  runElectronDevelopment().catch((error) => {
    console.error('[dev:electron] 启动失败:', error);
    process.exitCode = 1;
  });
}
