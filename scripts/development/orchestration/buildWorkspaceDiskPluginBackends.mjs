import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { discoverWorkspaceDiskBackendPlugins } from '../features/plugin-backend-composition/functions/discoverWorkspaceDiskBackendPlugins.mjs';

function runPluginBackendBuild(plugin) {
  return new Promise((resolve, reject) => {
    const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const child = spawn(pnpmExecutable, ['--dir', plugin.packageDir, 'run', 'build:backend'], {
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `${plugin.pluginId} backend 构建失败: ${signal ? `signal=${signal}` : `exit=${code ?? 'unknown'}`}`,
      ));
    });
  });
}

export async function buildWorkspaceDiskPluginBackends(repositoryRoot = process.cwd()) {
  const plugins = discoverWorkspaceDiskBackendPlugins(repositoryRoot);
  await Promise.all(plugins.map(runPluginBackendBuild));
}

const invokedModuleUrl = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(process.argv[1]).href;

if (import.meta.url === invokedModuleUrl) {
  buildWorkspaceDiskPluginBackends().catch((error) => {
    console.error('[development-plugin-backends] 构建失败:', error);
    process.exitCode = 1;
  });
}
