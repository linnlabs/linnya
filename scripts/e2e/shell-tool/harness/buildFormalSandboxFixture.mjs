import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

import { copySlidesTypeScriptRuntime } from '../../../../packages/plugins/slides/scripts/build/copyTypeScriptRuntime.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const fixtureEntry = fileURLToPath(new URL('../fixtures/formal-sandbox-runner/main.ts', import.meta.url));

/** 两个平台使用相同的插件制品边界，不让开发机的依赖目录掩盖缺失的运行库。 */
export async function buildFormalSandboxFixture(projectDirectory) {
  const options = {
    absWorkingDir: repositoryRoot,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
  };
  await build({
    ...options,
    entryPoints: [fixtureEntry],
    outfile: path.join(projectDirectory, 'main.cjs'),
    plugins: [{
      name: 'formal-sandbox-plugin-artifact',
      setup(builder) {
        builder.onResolve({ filter: /^@plugin\/slides\/backend-sandbox$/ }, () => ({
          // main 在 app.asar 内，Slides 与正式插件一样位于外置 Resources 目录。
          path: '../plugins/slides/index.cjs',
          external: true,
        }));
      },
    }],
  });
  await build({
    ...options,
    stdin: {
      contents: "export { pptComposeProfile } from '@plugin/slides/backend-sandbox';",
      resolveDir: repositoryRoot,
      sourcefile: 'formal-sandbox-slides-entry.ts',
      loader: 'ts',
    },
    outfile: path.join(projectDirectory, 'plugins/slides/index.cjs'),
  });
  // 复用插件正式构建的最小 compiler + 标准库闭包，不额外安装或借用全局 TypeScript。
  await copySlidesTypeScriptRuntime({
    targetDir: path.join(projectDirectory, 'plugins/slides/node_modules/typescript'),
  });
}
