import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    conformance: 'conformance/index.ts',
  },
  format: ['cjs', 'esm'],
  platform: 'node',
  // AI SDK 7 与当前正式 Provider packages 的公开 engines 下限均为 Node 22。
  target: 'node22',
  outDir: 'dist',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  // OpenRouter 当前未导出 VERSION，仅将其 package.json 内联为构建诊断值，
  // 避免 packed ESM 在运行时加载 JSON 子路径。Provider 实现本身仍保持 external。
  noExternal: ['@openrouter/ai-sdk-provider/package.json'],
  external: [
    '@linnlabs/linnkit-provider-ai-sdk',
    '@linnlabs/linnkit',
    '@linnlabs/linnkit/ports',
    '@linnlabs/linnkit/contracts',
  ],
});
