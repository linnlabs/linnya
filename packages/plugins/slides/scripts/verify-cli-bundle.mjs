import { createRequire } from 'node:module';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';

const MAX_STANDALONE_CLI_BYTES = Math.floor(1.9 * 1024 * 1024);

const REQUIRED_EXTERNAL_IMPORTS = ['fontkit'];

const FORBIDDEN_INPUTS = [
  { label: 'TypeScript compiler', pattern: /node_modules\/(?:\.pnpm\/typescript@[^/]+\/node_modules\/)?typescript\// },
  { label: 'PptxGenJS authoring runtime', pattern: /node_modules\/(?:\.pnpm\/pptxgenjs@[^/]+\/node_modules\/)?pptxgenjs\// },
  { label: 'pptx-automizer mutation runtime', pattern: /node_modules\/(?:\.pnpm\/pptx-automizer@[^/]+\/node_modules\/)?pptx-automizer\// },
  { label: 'Slides codegen runtime', pattern: /(?:^|\/)src\/backend\/codegen\// },
  { label: 'inlined MathJax runtime', pattern: /node_modules\/@mathjax\// },
  { label: 'full Slides coordinator', pattern: /(?:^|\/)src\/backend\/coordinator\/(?:PptCoordinator|createPptCoordinator|presentationCodegenRuntime)\.ts$/ },
  { label: 'full workspace runtime', pattern: /(?:^|\/)src\/plugin-sdk\/backend\/workspaceRuntime\.ts$/ },
  { label: 'unrelated plugin package', pattern: /(?:^|\/)packages\/plugins\/(?!slides\/)[^/]+\/src\// },
  { label: 'broad application schemas barrel', pattern: /schemas\/src\/index\.ts$/ },
  { label: 'inlined fontkit runtime', pattern: /node_modules\/(?:\.pnpm\/fontkit@[^/]+\/node_modules\/)?fontkit\// },
  { label: 'inlined fontkit Brotli dictionary', pattern: /node_modules\/(?:\.pnpm\/brotli@[^/]+\/node_modules\/)?brotli\// },
];

/** 构建图是 standalone CLI 的架构门禁，不只检查最终文件大小。 */
export async function verifySlidesCliBundle({ bundlePath, metafilePath }) {
  const runtimePath = path.resolve(
    path.dirname(bundlePath),
    '../backend/node_modules/@linnya/slides-mathjax-runtime/index.cjs',
  );
  const [bundleStats, runtimeStats, rawMetafile] = await Promise.all([
    stat(bundlePath),
    stat(runtimePath),
    readFile(metafilePath, 'utf8'),
  ]);
  if (bundleStats.size > MAX_STANDALONE_CLI_BYTES) {
    throw new Error(
      `Slides standalone CLI is ${formatMiB(bundleStats.size)}, exceeding the ${formatMiB(MAX_STANDALONE_CLI_BYTES)} budget.`,
    );
  }

  const metafile = JSON.parse(rawMetafile);
  // esbuild 记录的是相对构建 cwd 的路径；先还原绝对身份，避免门禁因 metafile
  // 使用 `../mindmap` 或 `../../schemas` 形式而漏检跨插件与宽 barrel 依赖。
  const inputPaths = Object.keys(metafile.inputs ?? {}).map((inputPath) => (
    normalizePath(path.resolve(inputPath))
  ));
  const violations = FORBIDDEN_INPUTS.flatMap(({ label, pattern }) => (
    inputPaths.some((inputPath) => pattern.test(inputPath)) ? [label] : []
  ));
  if (violations.length > 0) {
    throw new Error(
      `Slides standalone CLI contains forbidden dependency classes: ${violations.join(', ')}.`,
    );
  }
  const output = Object.values(metafile.outputs ?? {}).find((candidate) => (
    candidate.entryPoint && normalizePath(candidate.entryPoint).endsWith('/presentationCli/infrastructure/electronMain.ts')
  ));
  const externalImports = new Set(
    (output?.imports ?? [])
      .filter((entry) => entry.external === true)
      .map((entry) => entry.path),
  );
  const missingExternalImports = REQUIRED_EXTERNAL_IMPORTS.filter((specifier) => (
    !externalImports.has(specifier)
  ));
  if (missingExternalImports.length > 0) {
    throw new Error(
      `Slides standalone CLI must keep host runtime imports external: ${missingExternalImports.join(', ')}.`,
    );
  }
  const runtime = createRequire(path.resolve(bundlePath))('@linnya/slides-mathjax-runtime');
  if (typeof runtime?.renderMathMlToSvg !== 'function') {
    throw new Error('Slides standalone CLI cannot resolve the shared MathJax runtime.');
  }

  process.stdout.write(
    `[slides-cli] bundle guard passed: entry=${formatMiB(bundleStats.size)} / ${formatMiB(MAX_STANDALONE_CLI_BYTES)}, `
      + `shared-mathjax=${formatMiB(runtimeStats.size)}\n`,
  );
}

function normalizePath(value) {
  return value.replaceAll('\\', '/');
}

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}
