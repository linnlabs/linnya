import { Buffer } from 'node:buffer';

const DEFAULT_MAX_CHUNK_BYTES = 500_000;
const FORBIDDEN_BROWSER_MODULE_FRAGMENTS = [
  '/node_modules/typescript/',
];

/** ECharts core 与 zrender 是不同运行时边界，单独分块后均保持在默认预算内。 */
export function resolveSlidesBrowserManualChunk(moduleId) {
  if (moduleId.includes('/node_modules/zrender/')) {
    return 'zrender-runtime';
  }
  return undefined;
}

/**
 * Vite 默认只打印体积 warning；Slides 插件发布构建需要可执行的失败门禁。
 * 同时检查模块图，避免后端/编译器依赖再次从共享根桶泄漏到浏览器。
 */
export function slidesBrowserBundleGuard(options) {
  const maxChunkBytes = options.maxChunkBytes ?? DEFAULT_MAX_CHUNK_BYTES;
  return {
    name: `slides-browser-bundle-guard:${options.target}`,
    generateBundle(_outputOptions, bundle) {
      const failures = [];

      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;

        const bytes = Buffer.byteLength(output.code, 'utf8');
        if (bytes > maxChunkBytes) {
          failures.push(
            `${output.fileName} 为 ${(bytes / 1000).toFixed(2)} kB，超过 ${(maxChunkBytes / 1000).toFixed(0)} kB`,
          );
        }

        for (const moduleId of Object.keys(output.modules)) {
          const forbidden = FORBIDDEN_BROWSER_MODULE_FRAGMENTS.find(fragment => (
            moduleId.includes(fragment)
          ));
          if (forbidden) {
            failures.push(`${output.fileName} 包含禁止进入浏览器的模块：${moduleId}`);
          }
        }
      }

      if (failures.length > 0) {
        this.error(
          `[${options.target}] Slides 浏览器构建边界失败：\n- ${failures.join('\n- ')}`,
        );
      }
    },
  };
}
