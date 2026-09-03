import path from 'node:path';

import type {
  RendererModuleResolutionEntry,
} from '../definitions/rendererModuleResolutionCatalog.js';

export type RendererTsconfigPaths = Readonly<Record<string, readonly string[]>>;

export function projectRendererTsconfigPaths(
  catalog: readonly RendererModuleResolutionEntry[],
  repositoryRoot: string,
  rendererProjectRoot: string,
): RendererTsconfigPaths {
  const paths: Record<string, readonly string[]> = {};

  for (const entry of catalog) {
    if (!entry.consumers.includes('typescript')) continue;

    const key = entry.match === 'subpath' ? `${entry.specifier}/*` : entry.specifier;
    const repositoryTarget = entry.match === 'subpath'
      ? `${entry.canonicalTarget}/*`
      : entry.canonicalTarget;
    const absoluteTarget = path.resolve(repositoryRoot, repositoryTarget);
    const relativeTarget = normalizePath(path.relative(rendererProjectRoot, absoluteTarget));
    paths[key] = [relativeTarget.startsWith('.') ? relativeTarget : `./${relativeTarget}`];
  }

  return sortRecord(paths);
}

function normalizePath(value: string): string {
  return value.replaceAll(path.sep, '/');
}

function sortRecord(
  value: Readonly<Record<string, readonly string[]>>,
): RendererTsconfigPaths {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}
