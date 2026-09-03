import type { RendererTsconfigPaths } from './projectRendererTsconfigPaths.js';

const GENERATED_HEADER = '// 此文件由 renderer module-resolution catalog 生成，禁止手工修改。\n';

export function renderRendererTsconfigPaths(paths: RendererTsconfigPaths): string {
  return `${GENERATED_HEADER}${JSON.stringify({
    compilerOptions: {
      baseUrl: '.',
      paths,
    },
  }, null, 2)}\n`;
}
