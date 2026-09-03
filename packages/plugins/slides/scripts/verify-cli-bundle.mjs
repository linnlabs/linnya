import { createRequire } from 'node:module';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';

const MAX_STANDALONE_CLI_BYTES = 4 * 1024 * 1024;

const FORBIDDEN_INPUTS = [
  { label: 'TypeScript compiler', pattern: /node_modules\/(?:\.pnpm\/typescript@[^/]+\/node_modules\/)?typescript\// },
  { label: 'PptxGenJS authoring runtime', pattern: /node_modules\/(?:\.pnpm\/pptxgenjs@[^/]+\/node_modules\/)?pptxgenjs\// },
  { label: 'pptx-automizer mutation runtime', pattern: /node_modules\/(?:\.pnpm\/pptx-automizer@[^/]+\/node_modules\/)?pptx-automizer\// },
  { label: 'Slides codegen runtime', pattern: /(?:^|\/)src\/backend\/codegen\// },
  { label: 'inlined MathJax runtime', pattern: /node_modules\/@mathjax\// },
  { label: 'full Slides coordinator', pattern: /(?:^|\/)src\/backend\/coordinator\/(?:PptCoordinator|createPptCoordinator|presentationCodegenRuntime)\.ts$/ },
  { label: 'full workspace runtime', pattern: /(?:^|\/)src\/plugin-sdk\/backend\/workspaceRuntime\.ts$/ },
  { label: 'unrelated plugin package', pattern: /(?:^|\/)packages\/plugins\/(?!slides\/)[^/]+\/src\// },
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
  const inputPaths = Object.keys(metafile.inputs ?? {}).map(normalizePath);
  const violations = FORBIDDEN_INPUTS.flatMap(({ label, pattern }) => (
    inputPaths.some((inputPath) => pattern.test(inputPath)) ? [label] : []
  ));
  if (violations.length > 0) {
    throw new Error(
      `Slides standalone CLI contains forbidden dependency classes: ${violations.join(', ')}.`,
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
