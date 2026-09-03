/**
 * 0.1.3 新增：dist 子入口运行时 import 烟雾测试。
 *
 * 起因：0.1.0 ~ 0.1.2 三个版本的 dist/runtime-kernel.* / dist/context-manager.* / dist/index.* 都把
 * tiktoken 整段 inline bundle 进去（因为 package.json 没声明 tiktoken dep + tsup 默认只把已声明 deps
 * 视为 external），但 tiktoken_bg.wasm 没有跟着进 dist；外部 consumer 一旦 import 这三个入口就立刻
 * 报 "Missing tiktoken_bg.wasm"。
 *
 * 本测试用 `node -e` 子进程在隔离环境里 import dist 产物，覆盖：
 *   1. 之前会炸的 4 个入口（runtime-kernel / context-manager / index）现在能干净 import
 *   2. browser-safe seam (runtime-kernel/events) 一直能 import
 *   3. 纯类型入口 (contracts / ports) 一直能 import
 *   4. testkit 入口 by-design 在 vitest 上下文外 throw 特定错误（受 AGENT-GUARD-10 约束，
 *      只能在 vitest run 内 import）—— 行为锁定，防止有人误以为它能在生产代码 import
 *   5. dist 文件里 tiktoken 必须以 require/import external 模式出现，不能 inline；
 *      并且 dist 不能含 tiktoken_bg.wasm 资源路径字符串
 *
 * 必须用子进程而不是 vitest 内联 await import：vitest 上下文有 paths alias
 * （linnkit/* → src/*），会把 './dist/runtime-kernel.js' 误解析到源码而不是真 dist。
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

interface NodeImportResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function nodeImport(distRelative: string): Promise<NodeImportResult> {
  return new Promise((resolveResult) => {
    const child = spawn(
      'node',
      [
        '-e',
        `import('./${distRelative}').then(()=>{process.stdout.write('ok')}).catch(e=>{process.stderr.write(String(e && (e.message ?? e)));process.exit(1)})`,
      ],
      { cwd: PACKAGE_ROOT }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      resolveResult({ ok: code === 0, exitCode: code, stdout, stderr });
    });
    child.on('error', (err) => {
      resolveResult({ ok: false, exitCode: null, stdout, stderr: String(err.message ?? err) });
    });
  });
}

function nodeRun(args: readonly string[]): Promise<NodeImportResult> {
  return new Promise((resolveResult) => {
    const child = spawn('node', args, { cwd: PACKAGE_ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      resolveResult({ ok: code === 0, exitCode: code, stdout, stderr });
    });
    child.on('error', (err) => {
      resolveResult({ ok: false, exitCode: null, stdout, stderr: String(err.message ?? err) });
    });
  });
}

describe('package.runtime-import — dist 子入口隔离 import 烟雾测试', () => {
  describe('Node 全展开运行时入口（之前会炸 tiktoken wasm，0.1.3 修复）', () => {
    const NODE_RUNTIME_ENTRIES = [
      'dist/runtime-kernel.js',
      'dist/runtime-kernel.cjs',
      'dist/context-manager.js',
      'dist/context-manager.cjs',
      'dist/index.js',
      'dist/index.cjs',
    ] as const;

    it.each(NODE_RUNTIME_ENTRIES)(
      'import("./%s") 应该不报 Missing tiktoken_bg.wasm，干净返回',
      async (entry) => {
        const result = await nodeImport(entry);
        if (!result.ok) {
          throw new Error(
            `Failed to import ${entry}:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
          );
        }
        expect(result.stdout).toContain('ok');
        expect(result.stderr).not.toContain('tiktoken_bg.wasm');
        expect(result.stderr).not.toContain('Missing');
      }
    );
  });

  describe('Browser-safe seam + 纯类型入口（应一直能 import）', () => {
    const SAFE_ENTRIES = [
      'dist/runtime-kernel/events.js',
      'dist/runtime-kernel/events.cjs',
      'dist/contracts.js',
      'dist/contracts.cjs',
      'dist/ports.js',
      'dist/ports.cjs',
      'dist/quickstart.js',
      'dist/quickstart.cjs',
      'dist/cli.js',
      'dist/cli.cjs',
    ] as const;

    it.each(SAFE_ENTRIES)('import("./%s") 应该干净返回', async (entry) => {
      const result = await nodeImport(entry);
      if (!result.ok) {
        throw new Error(
          `Failed to import ${entry}:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
        );
      }
      expect(result.stdout).toContain('ok');
    });
  });

  describe('CLI bin', () => {
    it('node dist/cli.cjs --help 应该输出帮助文本且不依赖真实 provider', async () => {
      const result = await nodeRun(['dist/cli.cjs', '--help']);
      if (!result.ok) {
        throw new Error(`Failed to run CLI:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
      }
      expect(result.stdout).toContain('linnkit v0 CLI');
      expect(result.stdout).toContain('linnkit init <name>');
    });

    it('node bin/linnkit.cjs --help 应该通过 npm bin wrapper 调到 dist CLI', async () => {
      const result = await nodeRun(['bin/linnkit.cjs', '--help']);
      if (!result.ok) {
        throw new Error(`Failed to run CLI bin wrapper:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
      }
      expect(result.stdout).toContain('linnkit v0 CLI');
      expect(result.stdout).toContain('linnkit init <name>');
    });
  });

  describe('testkit 入口（AGENT-GUARD-10：只能在 vitest run 上下文 import）', () => {
    const TESTKIT_ENTRIES = ['dist/testkit.js', 'dist/testkit.cjs'] as const;

    it.each(TESTKIT_ENTRIES)(
      'import("./%s") 在普通 node 里应该 throw 跟 vitest 相关的错误（行为锁定，证明它必须在 vitest 上下文用）',
      async (entry) => {
        const result = await nodeImport(entry);
        expect(result.ok).toBe(false);
        // ESM 入口 throw "Vitest failed to access its internal state"
        // CJS 入口 throw "Vitest cannot be imported in a CommonJS module using require()"
        // 两者都证明 vitest 模块只能在 vitest 上下文 import；这是 by-design，
        // AGENT-GUARD-10 已经在生产代码层禁止 import @linnlabs/linnkit/testkit
        const isVitestContextError =
          /Vitest failed to access its internal state/.test(result.stderr) ||
          /Vitest cannot be imported in a CommonJS module/.test(result.stderr);
        if (!isVitestContextError) {
          throw new Error(
            `${entry} 期望 throw vitest 上下文相关错误，实际:\n${result.stderr}`
          );
        }
        expect(result.stderr).not.toContain('tiktoken_bg.wasm');
      }
    );
  });

  describe('结构性退化守卫', () => {
    const BUNDLE_FILES = [
      'dist/runtime-kernel.js',
      'dist/runtime-kernel.cjs',
      'dist/context-manager.js',
      'dist/context-manager.cjs',
      'dist/index.js',
      'dist/index.cjs',
      'dist/testkit.js',
      'dist/testkit.cjs',
    ] as const;

    it.each(BUNDLE_FILES)(
      'dist/%s 不能含 "tiktoken_bg.wasm" 字符串（如果含，说明 tsup 又把 tiktoken inline 了）',
      async (rel) => {
        const content = await readFile(resolve(PACKAGE_ROOT, rel), 'utf8');
        expect(content).not.toContain('tiktoken_bg.wasm');
      }
    );

    const TIKTOKEN_USERS = [
      'dist/runtime-kernel.js',
      'dist/runtime-kernel.cjs',
      'dist/context-manager.js',
      'dist/context-manager.cjs',
      'dist/index.js',
      'dist/index.cjs',
    ] as const;

    it.each(TIKTOKEN_USERS)(
      'dist/%s 必须以 external 形式 require/import "tiktoken"（不能 inline）',
      async (rel) => {
        const content = await readFile(resolve(PACKAGE_ROOT, rel), 'utf8');
        const isCjs = rel.endsWith('.cjs');
        if (isCjs) {
          expect(content).toMatch(/require\(["']tiktoken["']\)/);
        } else {
          expect(content).toMatch(/from\s*["']tiktoken["']/);
        }
      }
    );

    const ZOD_USERS = [
      'dist/contracts.js',
      'dist/contracts.cjs',
      'dist/index.js',
      'dist/index.cjs',
      'dist/runtime-kernel.js',
      'dist/runtime-kernel.cjs',
      'dist/context-manager.js',
      'dist/context-manager.cjs',
    ] as const;

    it.each(ZOD_USERS)(
      'dist/%s 必须以 external 形式 require/import "zod"（不能 inline，否则 schema 实例隔离会炸）',
      async (rel) => {
        const content = await readFile(resolve(PACKAGE_ROOT, rel), 'utf8');
        const isCjs = rel.endsWith('.cjs');
        if (isCjs) {
          expect(content).toMatch(/require\(["']zod["']\)/);
        } else {
          expect(content).toMatch(/from\s*["']zod["']/);
        }
      }
    );
  });
});
