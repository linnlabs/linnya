import path from 'node:path';

import type {
  RendererModuleConsumer,
  RendererModuleResolutionEntry,
} from '../definitions/rendererModuleResolutionCatalog.js';

export interface RendererViteAlias {
  readonly find: RegExp;
  readonly replacement: string;
}

export function projectRendererViteAliases(
  catalog: readonly RendererModuleResolutionEntry[],
  repositoryRoot: string,
  consumer: Extract<RendererModuleConsumer, 'vite' | 'vitest'>,
): readonly RendererViteAlias[] {
  return catalog
    .filter(entry => entry.consumers.includes(consumer))
    .toSorted(compareSpecificity)
    .map(entry => ({
      find: createMatcher(entry),
      replacement: createReplacement(entry, repositoryRoot),
    }));
}

export function resolveCatalogTarget(
  catalog: readonly RendererModuleResolutionEntry[],
  repositoryRoot: string,
  consumer: RendererModuleConsumer,
  specifier: string,
): string | undefined {
  const matchingEntry = catalog
    .filter(entry => entry.consumers.includes(consumer))
    .toSorted(compareSpecificity)
    .find(entry => matchesSpecifier(entry, specifier));

  if (!matchingEntry) return undefined;

  if (matchingEntry.match === 'exact') {
    return path.resolve(repositoryRoot, matchingEntry.canonicalTarget);
  }

  const relativeSubpath = specifier.slice(matchingEntry.specifier.length + 1);
  return path.resolve(repositoryRoot, matchingEntry.canonicalTarget, relativeSubpath);
}

function createMatcher(entry: RendererModuleResolutionEntry): RegExp {
  const escapedSpecifier = escapeRegExp(entry.specifier);
  return entry.match === 'exact'
    ? new RegExp(`^${escapedSpecifier}$`, 'u')
    : new RegExp(`^${escapedSpecifier}/(.+)$`, 'u');
}

function createReplacement(
  entry: RendererModuleResolutionEntry,
  repositoryRoot: string,
): string {
  const absoluteTarget = path.resolve(repositoryRoot, entry.canonicalTarget);
  return entry.match === 'subpath'
    ? `${absoluteTarget.replaceAll(path.sep, '/')}/$1`
    : absoluteTarget;
}

function matchesSpecifier(
  entry: RendererModuleResolutionEntry,
  specifier: string,
): boolean {
  return entry.match === 'exact'
    ? entry.specifier === specifier
    : specifier.startsWith(`${entry.specifier}/`);
}

function compareSpecificity(
  left: RendererModuleResolutionEntry,
  right: RendererModuleResolutionEntry,
): number {
  const lengthDifference = right.specifier.length - left.specifier.length;
  if (lengthDifference !== 0) return lengthDifference;
  if (left.match === right.match) return 0;
  return left.match === 'exact' ? -1 : 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
