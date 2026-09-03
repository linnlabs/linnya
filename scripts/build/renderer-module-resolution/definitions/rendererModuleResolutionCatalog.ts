export type RendererModuleMatch = 'exact' | 'subpath';

export type RendererModuleCategory =
  | 'renderer-local'
  | 'browser-package'
  | 'renderer-host-facade'
  | 'plugin-renderer-entry';

export type RendererModuleConsumer = 'typescript' | 'vite' | 'vitest';

export interface RendererModuleResolutionEntry {
  readonly specifier: string;
  readonly canonicalTarget: string;
  readonly match: RendererModuleMatch;
  readonly category: RendererModuleCategory;
  readonly consumers: readonly RendererModuleConsumer[];
  readonly allowsValueImports: boolean;
}

const ALL_RENDERER_CONSUMERS = ['typescript', 'vite', 'vitest'] as const;

/**
 * Renderer 编译期 resolver 的唯一人工维护目录。
 * canonicalTarget 一律相对仓库根，CSS package asset 不属于 TypeScript module，不能登记在这里。
 */
export const RENDERER_MODULE_RESOLUTION_CATALOG = [
  local('@', 'apps/renderer', 'subpath'),
  local('@app', 'apps/renderer/app', 'subpath'),
  local('@shared', 'apps/renderer/shared', 'subpath'),

  browser('@app/schemas', 'packages/schemas/src/index.ts', 'exact'),
  browser('@app/schemas', 'packages/schemas/src', 'subpath'),
  browser('@linnya/app-lifecycle-contract', 'src/shared/app-lifecycle/definitions/windowCloseProtocol.ts', 'exact'),
  browser('@linnya/plugin-host-contract', 'packages/plugin-host-contract/index.ts', 'exact', false),
  browser('@linnya/plugin-host-contract/renderer', 'packages/plugin-host-contract/renderer/index.ts', 'exact', false),
  browser('@linnya/plugin-host-contract/renderer', 'packages/plugin-host-contract/renderer', 'subpath', false),
  browser('@linnya/renderer-ui', 'packages/renderer-ui/src/index.ts', 'exact'),
  browser('@linnya/renderer-ui/font-stack', 'packages/renderer-ui/src/features/font-stack/index.ts', 'exact'),
  browser('@linnya/renderer-ui/icons', 'packages/renderer-ui/src/icons/index.ts', 'exact'),
  browser('@linnya/renderer-ui/localization', 'packages/renderer-ui/src/localization/index.ts', 'exact'),
  browser('@linnya/renderer-ui/scroll', 'packages/renderer-ui/src/scroll/index.ts', 'exact'),
  browser('@linnya/renderer-ui/theme', 'packages/renderer-ui/src/theme/index.ts', 'exact'),
  browser('@linnya/renderer-ui/version', 'packages/renderer-ui/src/version.ts', 'exact'),
  browser('@linnya/text-measurement-core', 'packages/text-measurement-core/src/index.ts', 'exact'),
  browser('@linnya/citation-domain/conversation-presentation', 'src/domains/citation/conversation-presentation.ts', 'exact'),
  browser('@linnya/citation-domain/markdown-reference', 'src/domains/citation/markdown-reference.ts', 'exact'),
  browser('stream-markdown-parser', 'packages/stream-markdown-parser/src/index.ts', 'exact'),
  browser('stream-markdown-parser', 'packages/stream-markdown-parser/src', 'subpath'),

  facade('@plugin/renderer', 'src/plugin-sdk/renderer', 'subpath'),
  pluginEntry('@plugin/mindmap/shared', 'packages/plugins/mindmap/src/shared/index.ts', 'exact'),
  pluginEntry('@plugin/slides/shared', 'packages/plugins/slides/src/shared/index.ts', 'exact'),
  pluginEntry('@plugin/slides/shared', 'packages/plugins/slides/src/shared', 'subpath'),
] as const satisfies readonly RendererModuleResolutionEntry[];

function local(
  specifier: string,
  canonicalTarget: string,
  match: RendererModuleMatch,
): RendererModuleResolutionEntry {
  return entry(specifier, canonicalTarget, match, 'renderer-local', true);
}

function browser(
  specifier: string,
  canonicalTarget: string,
  match: RendererModuleMatch,
  allowsValueImports = true,
): RendererModuleResolutionEntry {
  return entry(specifier, canonicalTarget, match, 'browser-package', allowsValueImports);
}

function facade(
  specifier: string,
  canonicalTarget: string,
  match: RendererModuleMatch,
): RendererModuleResolutionEntry {
  return entry(specifier, canonicalTarget, match, 'renderer-host-facade', true);
}

function pluginEntry(
  specifier: string,
  canonicalTarget: string,
  match: RendererModuleMatch,
): RendererModuleResolutionEntry {
  return entry(specifier, canonicalTarget, match, 'plugin-renderer-entry', true);
}

function entry(
  specifier: string,
  canonicalTarget: string,
  match: RendererModuleMatch,
  category: RendererModuleCategory,
  allowsValueImports: boolean,
): RendererModuleResolutionEntry {
  return {
    specifier,
    canonicalTarget,
    match,
    category,
    consumers: ALL_RENDERER_CONSUMERS,
    allowsValueImports,
  };
}
