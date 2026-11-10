import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { startRendererDevelopmentServer } from './startRendererDevelopmentServer.mjs';

import { resolveDevelopmentBackendDirectories } from '../features/plugin-backend-composition/functions/resolveDevelopmentBackendDirectories.mjs';
import { discoverWorkspaceDiskBackendPlugins } from '../features/plugin-backend-composition/functions/discoverWorkspaceDiskBackendPlugins.mjs';

import { createDevelopmentProcessScope } from '../features/build-session/orchestration/createDevelopmentProcessScope.mjs';
import { runDevelopmentBuildGraph } from '../features/build-session/orchestration/runDevelopmentBuildGraph.mjs';
import { createElectronDevelopmentBuilds } from '../features/build-session/definitions/electronDevelopmentBuilds.mjs';

export { startRendererDevelopmentServer };

export async function runElectronDevelopment({ buildOnly = false } = {}) {
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) throw new Error('请通过 pnpm run dev:electron 启动开发会话');
  const plugins = discoverWorkspaceDiskBackendPlugins(repositoryRoot);
  const backendDirectDirs = resolveDevelopmentBackendDirectories(plugins, process.env.LINNYA_PLUGIN_BACKEND_DIRECT_DIRS);
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
      args: [require.resolve('electron/cli.js'), 'dist/main/main.cjs'], watch: false, runtime: true,
      env: {
        NODE_ENV: 'development', LINNYA_DEV_MODE: 'true', APP_VERSION: packageJson.version,
        VITE_DEV_SERVER_URL: url,
        LINNYA_PLUGIN_BACKEND_DIRECT_DIRS: backendDirectDirs,
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
