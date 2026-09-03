import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  RENDERER_MODULE_RESOLUTION_CATALOG,
} from '../definitions/rendererModuleResolutionCatalog.js';
import { projectRendererTsconfigPaths } from './projectRendererTsconfigPaths.js';
import {
  projectRendererViteAliases,
  resolveCatalogTarget,
} from './projectRendererViteAliases.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const rendererRoot = path.join(repositoryRoot, 'apps/renderer');

describe('Renderer module-resolution catalog', () => {
  it('projects @shared only to the Renderer owner', () => {
    const paths = projectRendererTsconfigPaths(
      RENDERER_MODULE_RESOLUTION_CATALOG,
      repositoryRoot,
      rendererRoot,
    );

    expect(paths['@shared/*']).toEqual(['./shared/*']);
    expect(paths['@shared/*']).not.toContain('../../src/shared/*');
  });

  it('keeps exact package entries ahead of their shorter prefixes', () => {
    const aliases = projectRendererViteAliases(
      RENDERER_MODULE_RESOLUTION_CATALOG,
      repositoryRoot,
      'vite',
    );
    const schemasIndex = aliases.findIndex(alias => alias.find.test('@app/schemas'));
    const appIndex = aliases.findIndex(alias => alias.find.test('@app/schemas/example'));

    expect(schemasIndex).toBeGreaterThanOrEqual(0);
    expect(appIndex).toBeGreaterThan(schemasIndex);
  });

  it.each([
    ['@shared/utils/idUtils', 'apps/renderer/shared/utils/idUtils'],
    ['@linnya/plugin-host-contract/renderer/toolUi', 'packages/plugin-host-contract/renderer/toolUi'],
    ['@linnya/renderer-ui', 'packages/renderer-ui/src/index.ts'],
    ['@linnya/renderer-ui/font-stack', 'packages/renderer-ui/src/features/font-stack/index.ts'],
    ['@linnya/renderer-ui/scroll', 'packages/renderer-ui/src/scroll/index.ts'],
    ['@app/schemas', 'packages/schemas/src/index.ts'],
    ['stream-markdown-parser', 'packages/stream-markdown-parser/src/index.ts'],
  ])('resolves %s to its canonical browser target', (specifier, relativeTarget) => {
    expect(resolveCatalogTarget(
      RENDERER_MODULE_RESOLUTION_CATALOG,
      repositoryRoot,
      'vite',
      specifier,
    )).toBe(path.resolve(repositoryRoot, relativeTarget));
  });

  it.each([
    '@linnlabs/linnkit/contracts',
    '@linnlabs/linnkit/runtime-kernel/events',
  ])('leaves published Linnkit entry %s to the package resolver', specifier => {
    expect(resolveCatalogTarget(
      RENDERER_MODULE_RESOLUTION_CATALOG,
      repositoryRoot,
      'vite',
      specifier,
    )).toBeUndefined();
  });
});
