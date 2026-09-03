import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RENDERER_MODULE_RESOLUTION_CATALOG,
} from '../definitions/rendererModuleResolutionCatalog.js';
import {
  projectRendererTsconfigPaths,
} from '../functions/projectRendererTsconfigPaths.js';
import {
  renderRendererTsconfigPaths,
} from '../functions/renderRendererTsconfigPaths.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const rendererProjectRoot = path.join(repositoryRoot, 'apps/renderer');
const generatedPath = path.join(rendererProjectRoot, 'tsconfig.paths.generated.json');

const paths = projectRendererTsconfigPaths(
  RENDERER_MODULE_RESOLUTION_CATALOG,
  repositoryRoot,
  rendererProjectRoot,
);

await writeFile(generatedPath, renderRendererTsconfigPaths(paths), 'utf8');
console.log(`Renderer TypeScript paths 已生成：${path.relative(repositoryRoot, generatedPath)}`);
