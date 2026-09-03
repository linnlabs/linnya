#!/usr/bin/env node

/**
 * 检查 better-sqlite3 是否能在 Electron runtime 下加载。
 *
 * 中文说明：
 * - 这个脚本必须通过 `ELECTRON_RUN_AS_NODE=1 electron ...` 执行；
 * - 失败表示随包 N-API 制品与当前平台、架构或 Electron runtime 不匹配。
 */

if (!process.versions.electron) {
  console.error('[better-sqlite3 guard] 当前不是 Electron runtime。');
  console.error('[better-sqlite3 guard] 请使用: pnpm run guard:better:electron');
  process.exit(1);
}

try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const row = db.prepare('SELECT 1 AS ok').get();
  db.close();

  if (!row || row.ok !== 1) {
    throw new Error('SQLite smoke query returned an unexpected result.');
  }

  console.log('[better-sqlite3 guard] OK: Electron ABI native binding is loadable.');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[better-sqlite3 guard] better-sqlite3 无法在 Electron runtime 下加载。');
  console.error(`[better-sqlite3 guard] ${message}`);
  console.error('[better-sqlite3 guard] 修复命令: pnpm install');
  process.exit(1);
}
