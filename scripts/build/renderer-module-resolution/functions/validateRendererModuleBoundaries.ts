import type {
  RendererModuleResolutionEntry,
} from '../definitions/rendererModuleResolutionCatalog.js';

export interface RendererModuleBoundaryIssue {
  readonly code:
    | 'duplicate-entry'
    | 'forbidden-specifier'
    | 'forbidden-target'
    | 'missing-consumer';
  readonly message: string;
}

const FORBIDDEN_SPECIFIER_PREFIXES = [
  '@linnya/plugin-host-contract/backend',
  '@plugin/backend',
] as const;

const FORBIDDEN_TARGET_SEGMENTS = [
  'src/electron-main/',
  'src/tools/',
  'src/app-hosts/',
] as const;

export function validateRendererModuleBoundaries(
  catalog: readonly RendererModuleResolutionEntry[],
): readonly RendererModuleBoundaryIssue[] {
  const issues: RendererModuleBoundaryIssue[] = [];
  const identities = new Set<string>();

  for (const entry of catalog) {
    const identity = `${entry.specifier}:${entry.match}`;
    if (identities.has(identity)) {
      issues.push({
        code: 'duplicate-entry',
        message: `重复目录项：${identity}`,
      });
    }
    identities.add(identity);

    const forbiddenSpecifier = FORBIDDEN_SPECIFIER_PREFIXES.find(prefix => (
      entry.specifier === prefix || entry.specifier.startsWith(`${prefix}/`)
    ));
    if (forbiddenSpecifier) {
      issues.push({
        code: 'forbidden-specifier',
        message: `Renderer profile 禁止说明符：${entry.specifier}`,
      });
    }

    const normalizedTarget = entry.canonicalTarget.replaceAll('\\', '/');
    const forbiddenTarget = FORBIDDEN_TARGET_SEGMENTS.find(segment => normalizedTarget.includes(segment));
    if (forbiddenTarget) {
      issues.push({
        code: 'forbidden-target',
        message: `Renderer profile 禁止目标：${entry.specifier} -> ${entry.canonicalTarget}`,
      });
    }

    for (const consumer of ['typescript', 'vite', 'vitest'] as const) {
      if (!entry.consumers.includes(consumer)) {
        issues.push({
          code: 'missing-consumer',
          message: `${entry.specifier} (${entry.match}) 未覆盖 ${consumer}`,
        });
      }
    }
  }

  return issues;
}
