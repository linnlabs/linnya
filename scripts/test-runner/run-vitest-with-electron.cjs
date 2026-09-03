#!/usr/bin/env node

/**
 * 用 Electron 的 Node runtime 运行 Vitest。
 *
 * 中文说明：
 * - 项目运行时依赖 Electron ABI 的 better-sqlite3；
 * - 如果用普通 Node 跑会触发 ABI 不一致，或诱导开发者执行 npm rebuild 覆盖 Electron 版本；
 * - 所以测试入口统一经由 Electron，避免 native binding 在 Node/Electron 之间来回切换。
 */

const { spawnSync } = require('child_process');

const vitestPath = require.resolve('vitest/vitest.mjs');
const args = process.argv.slice(2);

const result = spawnSync(
  'npx',
  ['electron', vitestPath, ...args],
  {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  }
);

process.exit(result.status ?? 1);
