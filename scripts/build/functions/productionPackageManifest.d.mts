export const productionBundledWorkspaceDependencyNames: readonly [
  '@linnlabs/linnkit-provider-ai-sdk',
  '@linnya/provider-catalog',
  '@linnya/renderer-ui',
  'parser-wasm',
];

export function projectProductionPackageManifest(
  sourceManifest: Readonly<Record<string, unknown>>
): Record<string, unknown>;
