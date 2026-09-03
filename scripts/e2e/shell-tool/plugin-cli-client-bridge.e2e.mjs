#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repositoryRoot = process.cwd();

function run(command, args, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: environment,
      shell: false,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

function resolveClientPath() {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return path.join(
      repositoryRoot,
      'dist/main/plugin-cli-runtime/darwin/arm64/linnya-plugin-cli-client',
    );
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return path.join(
      repositoryRoot,
      'dist/main/plugin-cli-runtime/win32/x64/linnya-plugin-cli-client.exe',
    );
  }
  throw new Error(`Plugin CLI native E2E does not support ${process.platform}/${process.arch}`);
}

await run('pnpm', ['run', 'build:plugin-cli-client']);
// 开发态 command runner watcher 会 clean 自己的输出根。这个顺序回放真实启动竞态，
// 确保 native client 的独立制品不会再被 watcher 删除。
await run('pnpm', ['run', 'build:command-runner']);
await access(resolveClientPath(), constants.X_OK);
await run('pnpm', [
  'exec',
  'vitest',
  'run',
  'src/app-hosts/linnya/application/plugin-cli-shell-bridge/__tests__/pluginCliShellBridge.integration.test.ts',
], {
  ...process.env,
  LINNYA_PLUGIN_CLI_NATIVE_CLIENT_E2E_PATH: resolveClientPath(),
});
