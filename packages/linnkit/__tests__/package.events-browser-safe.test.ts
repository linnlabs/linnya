/**
 * 0.1.3 新增：runtime-kernel/events 子入口 browser-safe 静态守卫。
 *
 * 这个 entry 是给桌面 / 浏览器 UI 层订阅运行时事件用的，必须 100% browser-safe：
 * 不能 import 任何 node-only 包（async_hooks、fs、child_process、worker_threads…）
 * 也不能拖入 tiktoken 这类带 wasm/native binding 的运行时依赖。
 *
 * 这是结构性守卫，跟 package.runtime-import.test.ts 的"实际 spawn node import"互补：
 *   - runtime-import 测：dist 能不能干净 import（动态行为）
 *   - 本测试测：dist 静态产物里没有违禁字符串（结构守卫，比 runtime 测更严：
 *               防止有人加 import 后没运行就过测试，本测试 grep 字符串不需要执行）
 *
 * 这类问题由公开包 smoke 测试长期守护。
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const FORBIDDEN_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'tiktoken (wasm 运行时)', pattern: /["']tiktoken["']/ },
  { name: 'tiktoken_bg.wasm 资源路径', pattern: /tiktoken_bg\.wasm/ },
  { name: 'node:async_hooks', pattern: /["']node:async_hooks["']/ },
  { name: 'node:child_process', pattern: /["']node:child_process["']/ },
  { name: 'node:worker_threads', pattern: /["']node:worker_threads["']/ },
  { name: 'better-sqlite3', pattern: /["']better-sqlite3["']/ },
];

describe('package.events-browser-safe — browser-safe 公开入口结构守卫', () => {
  describe.each([
    'dist/contracts.js',
    'dist/contracts.cjs',
    'dist/runtime-kernel/events.js',
    'dist/runtime-kernel/events.cjs',
  ] as const)('%s', (relPath) => {
    it.each(FORBIDDEN_PATTERNS)(
      '不能含违禁 import：$name',
      async ({ pattern }) => {
        const content = await readFile(resolve(PACKAGE_ROOT, relPath), 'utf8');
        expect(content).not.toMatch(pattern);
      }
    );
  });
});
