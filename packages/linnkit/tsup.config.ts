import { defineConfig } from 'tsup';

/**
 * tsup build config for `@linnlabs/linnkit`.
 *
 * 8 个稳定公开子入口（与 package.json#exports 1:1；CLI 另走 bin）：
 *   .                       → dist/index.{js,cjs,d.ts}
 *   ./ports                 → dist/ports.{js,cjs,d.ts}
 *   ./contracts             → dist/contracts.{js,cjs,d.ts}
 *   ./runtime-kernel        → dist/runtime-kernel.{js,cjs,d.ts}     (Node-only 全展开)
 *   ./runtime-kernel/events → dist/runtime-kernel/events.{js,cjs,d.ts}  (browser-safe slim seam)
 *   ./context-manager       → dist/context-manager.{js,cjs,d.ts}
 *   ./testkit               → dist/testkit.{js,cjs,d.ts}            (test-only；AGENT-GUARD-10)
 *   ./quickstart            → dist/quickstart.{js,cjs,d.ts}         (demo host DX helper)
 *
 * 不变量（详见 RELEASE.md §3）：
 *   - 所有公开入口都同时 emit cjs + esm + .d.ts；缺一个就是 break
 *   - ./runtime-kernel/events 的产物必须 browser-safe，禁止引入 node:async_hooks / crypto / fs
 *     （由 src 侧约束保证；tsup 不会主动注入这些依赖）
 *   - splitting: false —— 多入口禁用 chunk 共享，确保 require/cjs 形态干净；接入方装包后能稳定 deep import 单个子入口
 *   - external 真相（0.1.3 教训，详见 RELEASE-HISTORY §C.5）：tsup 默认**只**把 package.json#dependencies / peerDependencies 已声明的包视为 external；
 *     未声明的 import 会被 inline bundle 进 dist。非 node-builtin 的 src import 必须**同时**满足两个条件：
 *       (a) 出现在本包 package.json#dependencies 或 #peerDependencies（让 npm 装包时一并装上）
 *       (b) 出现在下方 external 数组（让 tsup 不要 inline bundle，避免吞掉子模块的资源文件如 wasm）
 *     `__tests__/package.shell.test.ts` 有反向稽核测试守住这条规则。tiktoken 之前漏了这两条，导致 0.1.0~0.1.2 三个版本
 *     的 runtime-kernel/context-manager/index 入口 import 时报 "Missing tiktoken_bg.wasm"。
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    ports: 'src/ports/index.ts',
    contracts: 'src/contracts/index.ts',
    'runtime-kernel': 'src/runtime-kernel/index.ts',
    'runtime-kernel/events': 'src/runtime-kernel/events/index.ts',
    'context-manager': 'src/context-manager/index.ts',
    testkit: 'src/testkit/index.ts',
    quickstart: 'src/quickstart/index.ts',
    cli: 'src/cli/index.ts',
  },
  format: ['cjs', 'esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  shims: false,
  // 显式 external 列表（必须同时在 package.json#dependencies/peerDependencies 出现，详见上方注释）：
  //   - vitest:   testkit 入口的 peer 依赖（接入方在自己 devDeps 里装；package.shell.test 校验它在 peerDependencies）
  //   - tiktoken: TokenCalculator → llmTelemetryMiddleware / context-manager 用；自带 wasm 必须从 tiktoken 包目录加载，不能 inline
  //   - zod:      contracts/{events,execution,messages,sse}.ts 用；必须 external + 标 peerDependency 让接入方自己锁版本，
  //               否则 inline 后接入方 import 出的 z.ZodSchema 跟自己装的 zod 不是同实例，instanceof / .parse() 行为会出错
  external: ['eventsource-parser', 'vitest', 'tiktoken', 'zod'],
});
